/**
 * CATEGORY MATCH ENGINE — merkezi DB Trendyol ağacı üzerinde leaf-only + verified eşleştirme.
 *
 * KURALLAR:
 *  - Hedef HER ZAMAN gerçek Trendyol LEAF kategoridir (children=0).
 *  - Yalnızca DB'deki gerçek `Category.externalId` kullanılır; sahte ID üretilmez.
 *  - Kural tabanlı eşleşme (exact/path/similarity) YALNIZCA ADAY üretir; tek başına categoryMatch=true YAZMAZ.
 *    (Kanıt: supplierCategory gürültülü — ör. "Tam Altın" kategorisinde tıraş jileti ürünü mevcut.)
 *  - categoryMatch=true YALNIZCA AI HIGH (>=0.95) doğrulaması + leaf + numeric externalId + aktif tt CategoryMapping ile yazılır.
 *  - AI'ya yalnızca gerçek Trendyol leaf adayları verilir; AI kendi ID uyduramaz.
 *  - DRY-RUN (preview) modunda DB'ye ÜRÜN yazılmaz.
 *  - Mevcut CategoryMapping satırları yeniden üretilmez (tree import zaten 3867 mapping oluşturdu).
 */
import { prisma } from '../db/prisma.ts';
import { normalizeName } from './categoryBrandMapper.ts';
import { matchCategoriesWithAI, chatCompletion, sanitizeJsonControlChars, type ProductForMatch, type CategoryCandidate } from './aiGateway.ts';

export interface LeafInfo {
  id: string;            // Category.uuid
  externalId: number;    // gerçek Trendyol numeric ID
  name: string;
  fullPath: string;
}

export interface TreeIndex {
  leaves: LeafInfo[];
  leafById: Map<string, LeafInfo>;
  leafByNormName: Map<string, LeafInfo[]>;
  leafByNormPath: Map<string, LeafInfo>;
  uuidByExternalId: Map<number, string>;
}

export interface Candidate {
  id: string;
  name: string;
  fullPath: string;
  score: number;
}

export interface MatchDecision {
  productId: string;
  xmlKey: string;
  title: string | null;
  supplierCategory: string | null;
  xmlBrandName: string | null;
  method: 'exact_leaf' | 'exact_path' | 'rule_similarity' | 'ai' | 'manual' | 'invalid';
  confidence: number;
  categoryId: string | null;       // hedef Category.uuid (null = yazma yok)
  externalId: number | null;       // gerçek Trendyol ID
  categoryName: string | null;
  fullPath: string | null;
  reason: string | null;
  candidates: Candidate[];
  mappingExists: boolean;
  isLeaf: boolean;
}

// ==================== AĞAÇ YÜKLEME ====================

export async function loadTrendyolTree(): Promise<TreeIndex> {
  const rows = await prisma.category.findMany({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true, name: true, parentId: true },
  });

  interface Node { id: string; externalId: number; name: string; parentId: string | null; children: Node[] }
  const byUuid = new Map<string, Node>();
  for (const r of rows) {
    const ext = Number(r.externalId);
    if (!Number.isFinite(ext)) continue;
    byUuid.set(r.id, { id: r.id, externalId: ext, name: r.name, parentId: r.parentId, children: [] });
  }
  const roots: Node[] = [];
  for (const n of byUuid.values()) {
    if (n.parentId && byUuid.has(n.parentId)) byUuid.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }

  const leaves: LeafInfo[] = [];
  const leafByNormName = new Map<string, LeafInfo[]>();
  const leafByNormPath = new Map<string, LeafInfo>();
  const uuidByExternalId = new Map<number, string>();

  const walk = (n: Node, path: string[]) => {
    const p = [...path, n.name];
    uuidByExternalId.set(n.externalId, n.id);
    if (n.children.length === 0) {
      const fullPath = p.join(' > ');
      const leaf: LeafInfo = { id: n.id, externalId: n.externalId, name: n.name, fullPath };
      leaves.push(leaf);
      const nn = normalizeName(n.name);
      if (!leafByNormName.has(nn)) leafByNormName.set(nn, []);
      leafByNormName.get(nn)!.push(leaf);
      leafByNormPath.set(normalizeName(fullPath), leaf);
    }
    for (const c of n.children) walk(c, p);
  };
  for (const r of roots) walk(r, []);

  return {
    leaves,
    leafById: new Map(leaves.map((l) => [l.id, l])),
    leafByNormName,
    leafByNormPath,
    uuidByExternalId,
  };
}

export async function loadTrendyolMarketplaceId(): Promise<string | null> {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  return mp?.id ?? null;
}

// ==================== RULE-BASED ADAY ÜRETİMİ (AUTO DEĞİL) ====================

function tokensOf(text: string): string[] {
  return Array.from(new Set(
    (text || '').toLowerCase().split(/[^a-z0-9çğıöşü]+/).map((t) => t.trim()).filter((t) => t.length >= 3)
  ));
}

function pathTokens(xmlPath: string): string[] {
  return (xmlPath || '').split('>').map((s) => normalizeName(s.trim())).filter((t) => t.length > 0);
}

function leafToken(xmlPath: string): string {
  const toks = pathTokens(xmlPath);
  return toks[toks.length - 1] || '';
}

function suffixOverlap(xmlTokens: string[], leafFullPath: string): number {
  const leafTokens = pathTokens(leafFullPath);
  let c = 0;
  const minLen = Math.min(xmlTokens.length, leafTokens.length);
  for (let i = 1; i <= minLen; i++) {
    if (xmlTokens[xmlTokens.length - i] === leafTokens[leafTokens.length - i]) c++;
    else break;
  }
  return c;
}

/**
 * Kural tabanlı ADAY üretimi. categoryId HER ZAMAN null döner (auto yazma YOK).
 * En güçlü aday(lar) candidates içinde döner.
 */
export function classifyByRule(product: { id: string; xmlKey: string; title: string | null; supplierCategory: string | null; xmlBrandName: string | null }, tree: TreeIndex): MatchDecision {
  const base: MatchDecision = {
    productId: product.id,
    xmlKey: product.xmlKey,
    title: product.title,
    supplierCategory: product.supplierCategory,
    xmlBrandName: product.xmlBrandName,
    method: 'manual',
    confidence: 0,
    categoryId: null,
    externalId: null,
    categoryName: null,
    fullPath: null,
    reason: null,
    candidates: [],
    mappingExists: false,
    isLeaf: false,
  };

  const path = (product.supplierCategory || '').trim();
  if (!path) {
    return { ...base, reason: 'supplierCategory yok (Grup A) — yalnızca başlık ile AI' };
  }

  const leafTok = leafToken(path);
  const xmlTokens = pathTokens(path);
  const exactByName = tree.leafByNormName.get(leafTok) || [];

  // 1) Benzersiz leaf ismi → güçlü aday (yine de auto değil; AI doğrular)
  if (exactByName.length === 1) {
    const l = exactByName[0];
    return {
      ...base,
      method: 'exact_leaf',
      confidence: 0.7,
      categoryId: null,
      externalId: l.externalId,
      categoryName: l.name,
      fullPath: l.fullPath,
      reason: 'Tekil leaf isim adayı (AI doğrulaması gerekli)',
      candidates: [{ id: l.id, name: l.name, fullPath: l.fullPath, score: 100 }],
      isLeaf: true,
    };
  }

  // 2) Aynı isimde birden fazla leaf → path suffix ile aday sıralama
  if (exactByName.length > 1) {
    let best: LeafInfo[] = [];
    let bestScore = 0;
    for (const l of exactByName) {
      const s = suffixOverlap(xmlTokens, l.fullPath);
      if (s > bestScore) { bestScore = s; best = [l]; }
      else if (s === bestScore && s > 0) best.push(l);
    }
    if (best.length === 1) {
      const l = best[0];
      return {
        ...base,
        method: 'exact_path',
        confidence: 0.65,
        categoryId: null,
        externalId: l.externalId,
        categoryName: l.name,
        fullPath: l.fullPath,
        reason: 'Path suffix ile tekil leaf adayı (AI doğrulaması gerekli)',
        candidates: [{ id: l.id, name: l.name, fullPath: l.fullPath, score: 95 }],
        isLeaf: true,
      };
    }
    if (best.length > 1) {
      return {
        ...base,
        method: 'manual',
        confidence: 0.4,
        reason: 'Aynı isimde birden fazla leaf var (AMBIGUOUS)',
        candidates: best.map((l) => ({ id: l.id, name: l.name, fullPath: l.fullPath, score: 50 })),
      };
    }
  }

  // 3) Kural tabanlı benzerlik adayları (MEDIUM/LOW)
  const productTokens = new Set([...tokensOf(product.title || ''), ...xmlTokens.filter((t) => t.length >= 3)]);
  const scored: Candidate[] = [];
  for (const l of tree.leaves) {
    const leafNorm = normalizeName(l.name);
    const contains = leafNorm.length >= 4 && leafTok.length >= 4 && (leafNorm.includes(leafTok) || leafTok.includes(leafNorm));
    const leafTokens = new Set(tokensOf(l.fullPath));
    let overlap = 0;
    for (const t of productTokens) if (leafTokens.has(t)) overlap++;
    let score = overlap * 10;
    if (contains) score += 20;
    if (score > 0) scored.push({ id: l.id, name: l.name, fullPath: l.fullPath, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 15);

  return {
    ...base,
    method: 'rule_similarity',
    confidence: top.length > 0 ? Math.min(0.6, 0.3 + top[0].score / 100) : 0,
    reason: top.length > 0 ? 'Kural benzerliği adayları (MEDIUM/LOW)' : 'Güvenilir aday bulunamadı',
    candidates: top,
  };
}

// ==================== AI ADAY ÜRETİMİ ====================

function buildAiCandidates(product: { title: string | null; supplierCategory: string | null }, tree: TreeIndex, ruleCandidates: Candidate[], topK: number): CategoryCandidate[] {
  const leafTok = leafToken(product.supplierCategory || '');
  const xmlTokens = new Set(pathTokens(product.supplierCategory || '').filter((t) => t.length >= 3));
  const titleTokens = tokensOf(product.title || '');
  const allTokens = new Set([...xmlTokens, ...titleTokens]);

  const scored = tree.leaves.map((l) => {
    const leafTokens = new Set(tokensOf(l.fullPath));
    let overlap = 0;
    for (const t of allTokens) if (leafTokens.has(t)) overlap++;
    const leafNorm = normalizeName(l.name);
    const contains = leafNorm.length >= 4 && leafTok.length >= 4 && (leafNorm.includes(leafTok) || leafTok.includes(leafNorm));
    return { leaf: l, score: overlap * 10 + (contains ? 25 : 0) };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const out: CategoryCandidate[] = [];
  const seen = new Set<string>();

  // Kural adayları önce (exact leaf/path dahil)
  for (const c of ruleCandidates) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, name: c.name, fullPath: c.fullPath }); }
  }
  // Başlık/token skor adayları
  for (const s of scored) {
    if (!seen.has(s.leaf.id)) { seen.add(s.leaf.id); out.push({ id: s.leaf.id, name: s.leaf.name, fullPath: s.leaf.fullPath }); }
  }

  return out.slice(0, topK);
}

// ==================== AI İKİNCİ DOĞRULAMA (STRICT VERIFIER) ====================

interface VerifyItem {
  productId: string;
  title: string | null;
  supplierCategory: string | null;
  categoryName: string;
  fullPath: string;
}

export interface VerifyResult {
  verdict: boolean;
  confidence: number;
  reason: string;
}

/**
 * AI HIGH adayını ikinci, çok daha sıkı bir doğrulamadan geçirir.
 * Fail-closed: doğrulama çağrısı başarısız olursa veya yanıt bozuksa → verdict=false.
 */
export async function verifyHighConfidence(items: VerifyItem[]): Promise<Map<string, VerifyResult>> {
  const out = new Map<string, VerifyResult>();
  if (items.length === 0) return out;

  const system = `You are a STRICT e-commerce category verifier.
For each product, decide whether the product ITSELF truly belongs to the proposed Trendyol leaf category.
A product belongs ONLY if it IS that exact thing — not an accessory, part, case, cover, hanger, cleaner, tool for it, or a related-but-different item.
Judge by what the product actually is (title), not by keyword overlap or the supplier category path.
Return ONLY strict JSON in this exact shape:
{"results":[{"productId":"...","verdict":"YES"|"NO","confidence":0.0,"reason":"brief reason"}]}
Rules:
- verdict "YES" only when you are sure the product IS the category item.
- If the product is a case/cover/hanger/accessory/part or a different product type, verdict "NO".
- confidence is a number 0..1. Use >=0.9 only for clear YES.`;

  const user = `ITEMS:
${JSON.stringify(items.map((i) => ({ productId: i.productId, title: i.title, supplierCategory: i.supplierCategory, categoryName: i.categoryName, fullPath: i.fullPath })))}

Return ONLY the JSON.`;

  const res = await chatCompletion({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  if (!res.ok || !res.content) {
    for (const i of items) out.set(i.productId, { verdict: false, confidence: 0, reason: `Doğrulama çağrısı başarısız: ${res.error || 'yanıt yok'}` });
    return out;
  }

  try {
    let jsonStr = String(res.content).trim();
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON yok');
    const parsed = JSON.parse(sanitizeJsonControlChars(match[0]));
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    const byId = new Map<string, VerifyResult>();
    for (const r of results) {
      if (!r || typeof r !== 'object') continue;
      const productId = String(r.productId ?? '');
      if (!productId) continue;
      const verdict = String(r.verdict ?? '').toUpperCase() === 'YES';
      const confidence = Number(r.confidence);
      byId.set(productId, {
        verdict,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '',
      });
    }
    for (const i of items) {
      if (!out.has(i.productId)) out.set(i.productId, byId.get(i.productId) || { verdict: false, confidence: 0, reason: 'Doğrulama yanıtında ürün yok' });
    }
  } catch (e) {
    for (const i of items) out.set(i.productId, { verdict: false, confidence: 0, reason: `Doğrulama yanıtı bozuk: ${String(e instanceof Error ? e.message : e)}` });
  }

  return out;
}

// ==================== AI SINIFLANDIRMA (TEK AUTO KAPISI) ====================

export interface AiPassResult {
  ok: boolean;
  provider: string;
  model: string;
  decisions: Map<string, MatchDecision>;
  error?: string;
  errorCode?: string;
}

export async function classifyByAi(
  products: ProductForMatch[],
  tree: TreeIndex,
  marketplaceName: string | null,
  topK = 25,
): Promise<AiPassResult> {
  const decisions = new Map<string, MatchDecision>();
  if (products.length === 0) return { ok: true, provider: 'none', model: 'none', decisions };

  // Her ürün için kural adayı + başlık skoru birleştirilmiş GERÇEK leaf adayları
  const candidatesByProduct = new Map<string, CategoryCandidate[]>();
  for (const p of products) {
    const rule = classifyByRule(p, tree);
    const cands = buildAiCandidates(p, tree, rule.candidates, topK);
    candidatesByProduct.set(p.id, cands);
  }

  const allCandidates = Array.from(new Map(
    products.flatMap((p) => candidatesByProduct.get(p.id) || []).map((c) => [c.id, c])
  ).values());

  const ai = await matchCategoriesWithAI(products, allCandidates, marketplaceName);

  const manualFor = (p: ProductForMatch, reason: string): MatchDecision => ({
    productId: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
    method: 'manual', confidence: 0, categoryId: null, externalId: null, categoryName: null, fullPath: null,
    reason, candidates: [], mappingExists: false, isLeaf: false,
  });

  if (!ai.ok) {
    for (const p of products) decisions.set(p.id, manualFor(p, `AI başarısız: ${ai.error || 'AI yanıt yok'}`));
    return { ok: false, provider: ai.provider, model: ai.model, decisions, error: ai.error, errorCode: ai.errorCode };
  }

  for (const m of ai.matches) {
    const p = products.find((x) => x.id === m.productId);
    const leaf = tree.leafById.get(m.categoryId);
    if (!p) continue;
    if (!leaf) {
      decisions.set(m.productId, {
        productId: m.productId, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
        method: 'invalid', confidence: m.confidence, categoryId: null, externalId: null, categoryName: null, fullPath: null,
        reason: 'AI adayı leaf değil / gerçek Trendyol kategorisi değil — REDDEDİLDİ', candidates: [], mappingExists: false, isLeaf: false,
      });
      continue;
    }

    if (m.confidence >= 0.95) {
      decisions.set(m.productId, {
        productId: m.productId, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
        method: 'ai',
        confidence: m.confidence,
        categoryId: leaf.id,
        externalId: leaf.externalId,
        categoryName: leaf.name,
        fullPath: leaf.fullPath,
        reason: m.reason || `AI HIGH eşleşmesi (${ai.provider}/${ai.model})`,
        candidates: [{ id: leaf.id, name: leaf.name, fullPath: leaf.fullPath, score: Math.round(m.confidence * 100) }],
        mappingExists: false,
        isLeaf: true,
      });
    } else if (m.confidence >= 0.85) {
      decisions.set(m.productId, {
        productId: m.productId, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
        method: 'ai',
        confidence: m.confidence,
        categoryId: null,   // MEDIUM → suggestion, auto YOK
        externalId: leaf.externalId,
        categoryName: leaf.name,
        fullPath: leaf.fullPath,
        reason: m.reason || `AI MEDIUM öneri (${ai.provider}/${ai.model}) — otomatik yazılmaz`,
        candidates: [{ id: leaf.id, name: leaf.name, fullPath: leaf.fullPath, score: Math.round(m.confidence * 100) }],
        mappingExists: false,
        isLeaf: true,
      });
    } else {
      decisions.set(m.productId, manualFor(p, `AI düşük güven (${m.confidence}) — MANUAL`));
    }
  }

  // İKİNCİ DOĞRULAMA: yalnızca AUTO yazılacak HIGH adaylar sıkı verifier'dan geçer.
  const highDecisions = Array.from(decisions.values()).filter((d) => d.method === 'ai' && d.categoryId !== null);
  if (highDecisions.length > 0) {
    const verifyItems: VerifyItem[] = highDecisions.map((d) => ({
      productId: d.productId,
      title: d.title,
      supplierCategory: d.supplierCategory,
      categoryName: d.categoryName as string,
      fullPath: d.fullPath as string,
    }));
    const verdicts = await verifyHighConfidence(verifyItems);
    for (const d of highDecisions) {
      const v = verdicts.get(d.productId);
      const pass = v && v.verdict === true && v.confidence >= 0.9;
      if (!pass) {
        decisions.set(d.productId, {
          ...d,
          method: 'manual',
          confidence: v ? Math.min(v.confidence, 0.84) : 0,
          categoryId: null,
          reason: `AI ikinci doğrulama reddetti: ${v?.reason || 'doğrulanamadı'}`,
        });
      } else {
        decisions.set(d.productId, {
          ...d,
          reason: `${d.reason} · Doğrulama: ${v.reason}`,
        });
      }
    }
  }

  for (const p of products) {
    if (!decisions.has(p.id)) decisions.set(p.id, manualFor(p, 'AI eşleşme dönmedi (MANUAL)'));
  }

  return { ok: true, provider: ai.provider, model: ai.model, decisions };
}

// ==================== DRY-RUN PREVIEW (YAZMA YOK) ====================

export interface PreviewRow extends MatchDecision {
  mappingExists: boolean;
  gate: { category: boolean; brand: boolean; variant: boolean; template: boolean; readyPossible: boolean };
}

export async function previewProducts(productIds: string[], withAi: boolean): Promise<{ tree: { total: number; leaf: number }; rows: PreviewRow[]; ai?: { ok: boolean; provider: string; model: string; error?: string } }> {
  const tree = await loadTrendyolTree();
  const treeTotal = await prisma.category.count({ where: { externalId: { not: null } } });
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true,
      categoryId: true, categoryMatch: true, brandMatch: true, variantMatch: true, variantStatus: true, templateMatch: true, status: true,
    },
  });

  const ruleDecisions = new Map<string, MatchDecision>();
  for (const p of products) ruleDecisions.set(p.id, classifyByRule(p, tree));

  let aiResult: { ok: boolean; provider: string; model: string; error?: string } | undefined;
  const aiDecisions = new Map<string, MatchDecision>();
  if (withAi && products.length > 0) {
    const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { name: true } });
    const aiInput: ProductForMatch[] = products.map((p) => ({
      id: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName, description: p.description,
    }));
    const res = await classifyByAi(aiInput, tree, mp?.name ?? 'Trendyol');
    aiResult = { ok: res.ok, provider: res.provider, model: res.model, error: res.error };
    for (const [k, v] of res.decisions) aiDecisions.set(k, v);
  }

  // Mapping doğrulaması (read-only)
  const targetIds = new Set<string>();
  for (const d of [...ruleDecisions.values(), ...aiDecisions.values()]) if (d.categoryId) targetIds.add(d.categoryId);
  const mappings = await prisma.categoryMapping.findMany({
    where: { categoryId: { in: Array.from(targetIds) }, active: true, externalId: { not: null } },
    select: { categoryId: true },
  });
  const mappedIds = new Set(mappings.map((m) => m.categoryId));

  const rows: PreviewRow[] = products.map((p) => {
    const d = aiDecisions.get(p.id) || ruleDecisions.get(p.id)!;
    const mappingExists = d.categoryId ? mappedIds.has(d.categoryId) : false;
    const categoryOk = p.categoryMatch === true || (d.categoryId !== null && mappingExists && d.isLeaf);
    const brandOk = p.brandMatch === true;
    const variantOk = p.variantMatch === true || p.variantStatus === 'NOT_REQUIRED';
    const templateOk = p.templateMatch === true;
    const readyPossible = categoryOk && brandOk && variantOk && templateOk;
    return {
      ...d,
      mappingExists,
      gate: { category: categoryOk, brand: brandOk, variant: variantOk, template: templateOk, readyPossible },
    };
  });

  return { tree: { total: treeTotal, leaf: tree.leaves.length }, rows, ai: aiResult };
}

// ==================== UYGULAMA (VERIFIED WRITE) ====================

export interface ApplyResult {
  productId: string;
  applied: boolean;
  method: string | null;
  externalId: number | null;
  reason: string | null;
}

export async function applyVerifiedMatch(decision: MatchDecision, marketplaceId: string): Promise<ApplyResult> {
  const fail = (reason: string): ApplyResult => ({ productId: decision.productId, applied: false, method: decision.method, externalId: decision.externalId, reason });

  if (!decision.categoryId || decision.externalId === null || !decision.isLeaf) {
    return fail('Hedef leaf değil veya externalId yok — yazılmadı');
  }
  if (decision.confidence < 0.95) {
    return fail(`Düşük güven (${decision.confidence}) — MANUAL bırakıldı`);
  }

  const category = await prisma.category.findUnique({ where: { id: decision.categoryId }, select: { id: true, externalId: true } });
  if (!category || category.externalId === null || Number(category.externalId) !== decision.externalId) {
    return fail('Hedef kategori doğrulanamadı (externalId uyuşmuyor)');
  }

  const mapping = await prisma.categoryMapping.findFirst({
    where: { categoryId: decision.categoryId, marketplaceId, active: true, externalId: { not: null } },
    select: { id: true },
  });
  if (!mapping) {
    return fail('Aktif tt CategoryMapping yok — categoryMatch yazılmadı');
  }

  const product = await prisma.product.findUnique({ where: { id: decision.productId }, select: { id: true } });
  if (!product) return fail('Ürün bulunamadı');

  await prisma.product.update({
    where: { id: decision.productId },
    data: {
      categoryId: decision.categoryId,
      categoryMatch: true,
      matchedBy: decision.method === 'ai' ? 'ai' : 'auto',
      lastMatchDate: new Date(),
      aiSuggestedCategoryId: decision.categoryId,
      aiScore: decision.confidence,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: decision.method === 'ai' ? 'CATEGORY_MATCH_AI' : 'CATEGORY_MATCH_AUTO',
      entity: 'category',
      entityId: decision.categoryId,
      meta: JSON.stringify({
        productId: decision.productId,
        sourceCategory: decision.supplierCategory,
        targetCategory: decision.categoryName,
        externalId: decision.externalId,
        method: decision.method,
        confidence: decision.confidence,
      }),
      details: `Ürün ${decision.xmlKey} → "${decision.categoryName}" (externalId=${decision.externalId}, ${decision.method}, conf=${decision.confidence})`,
    },
  });

  await prisma.aIDecisionLog.create({
    data: {
      productId: decision.productId,
      module: 'category',
      suggestion: decision.categoryId,
      confidence: decision.confidence,
      reason: decision.reason,
      autoApplied: true,
    },
  }).catch(() => null);

  return { productId: decision.productId, applied: true, method: decision.method, externalId: decision.externalId, reason: 'OK' };
}
