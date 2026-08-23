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

// FIX(build): V3 servisleri bu tipi categoryMatchEngine üzerinden import ediyor.
import type { StageCandidate } from './aiGateway.ts';
export type { StageCandidate };

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

// FIX(build): productUnderstanding/categoryCanonical/scripts tarafından import edilir.
// FIX(build): productUnderstanding.extractCoreFromCleanedTitle bu kumeyi import eder.
// Urun tipi cikariminda anlam tasimayan genel ticaret kelimeleri.
export const GENERIC_CATEGORY_TOKENS = new Set<string>([
  'urun', 'urunler', 'adet', 'takim', 'set', 'cesit', 'model', 'marka',
  'renk', 'beden', 'numara', 'boyut', 'ozel', 'yeni', 'kaliteli',
  'product', 'products', 'piece', 'pieces', 'kit', 'pack',
  'assorted', 'various', 'generic', 'item', 'items',
]);
export function tokensOf(text: string): string[] {
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

export function buildAiCandidates(product: { title: string | null; supplierCategory: string | null }, tree: TreeIndex, ruleCandidates: Candidate[], topK: number): CategoryCandidate[] {
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

// ==================== V3 SEMANTIC STAGE (FIX/build) ====================

/**
 * FIX(build): categoryCore.runFullPipeline bu fonksiyonu import ediyordu ama engine'de
 * tanımlı değildi → modül yüklenemiyordu (ölü kod). Deterministik ve yalnızca mevcut
 * buildAiCandidates skorlamasını StageCandidate sözleşmesine çeviren minimal implementasyon.
 * Yeni eşik/skor semantiği EKLENMEDİ; canlı (klasik) pipeline bu fonksiyonu kullanmaz.
 */
export function buildSemanticCandidates(
  identity: { coreObject: string },
  tree: TreeIndex,
  topK: number,
): StageCandidate[] {
  const pseudo = { title: identity?.coreObject ?? '', supplierCategory: null as string | null };
  const ranked = buildAiCandidates(pseudo, tree, [], topK);
  return ranked.map((c, i) => ({
    id: c.id,
    name: c.name,
    fullPath: c.fullPath,
    matchStage: 'semantic',
    matchScore: Math.max(1, 100 - i * 5),
    semanticFit: i === 0 ? 'STRONG' : 'UNKNOWN',
    externalId: tree.leafById.get(c.id)?.externalId ?? null,
  }));
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

  // FIX(jsonstr-scope): jsonStr catch bloğunda da kullanıldığı için try dışında tanımlanmalı;
  // aksi halde bozuk AI yanıtında ReferenceError fırlayıp fail-closed yerine endpoint 500 olurdu.
  let jsonStr = '';
  try {
    jsonStr = String(res.content).trim();
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
    const productRegex = /"productId"\s*:\s*"([^"]+)"\s*,\s*"verdict"\s*:\s*"([^"]+)"\s*,\s*"confidence"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = productRegex.exec(jsonStr)) !== null) {
      const productId = m[1];
      const verdict = m[2].toUpperCase() === 'YES';
      const confidence = parseFloat(m[3]);
      if (!out.has(productId)) {
        out.set(productId, {
          verdict,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
          reason: 'Regex recovery from malformed JSON',
        });
      }
    }
    for (const i of items) {
      if (!out.has(i.productId)) {
        out.set(i.productId, { verdict: false, confidence: 0, reason: `Do\u011frulama yan\u0131t\u0131 bozuk: ${String(e instanceof Error ? e.message : e)}` });
      }
    }
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

  const BATCH_SIZE = 10;
  const batches: ProductForMatch[][] = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    batches.push(products.slice(i, i + BATCH_SIZE));
  }

  const candidatesByProduct = new Map<string, CategoryCandidate[]>();
  let provider = 'none';
  let model = 'none';
  let anyFailed = false;
  const errors: string[] = [];


  const manualFor = (p: ProductForMatch, reason: string): MatchDecision => ({
    productId: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
    method: 'manual', confidence: 0, categoryId: null, externalId: null, categoryName: null, fullPath: null,
    reason, candidates: [], mappingExists: false, isLeaf: false,
  });

  // FIX(F-04): batch'ler sıralı yerine SINIRLI eşzamanlılıkla çalışır.
  // Karar mantığı, prompt, eşikler ve provider önceliği DEĞİŞMEDİ.
  const AI_BATCH_CONCURRENCY = 3;
  // FIX(F-04): geçici hatalar (429/5xx/timeout/tüm-sağlayıcılar-dolu) için sınırlı backoff retry.
  // Kalıcı hatalar (INVALID_KEY, MODEL_NOT_FOUND vb.) retry EDİLMEZ.
  const TRANSIENT_ERROR_CODES = new Set(['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR', 'NO_AI_PROVIDER_AVAILABLE']);
  const RETRY_BACKOFF_MS = [1000, 2000];

  const callWithBoundedRetry = async (batch: ProductForMatch[]) => {
    let res = await matchCategoriesWithAI(batch, candidatesByProduct, marketplaceName);
    for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt++) {
      if (res.ok || !TRANSIENT_ERROR_CODES.has(res.errorCode || '')) break;
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
      res = await matchCategoriesWithAI(batch, candidatesByProduct, marketplaceName);
    }
    return res;
  };

  const processBatch = async (batch: ProductForMatch[]): Promise<void> => {
    for (const p of batch) {
      if (!candidatesByProduct.has(p.id)) {
        const rule = classifyByRule(p, tree);
        const cands = buildAiCandidates(p, tree, rule.candidates, topK);
        candidatesByProduct.set(p.id, cands);
      }
    }

    const ai = await callWithBoundedRetry(batch);

    if (!ai.ok) {
      anyFailed = true;
      errors.push(ai.error || 'Batch failed');
      for (const p of batch) {
        const cands = candidatesByProduct.get(p.id) || [];
        decisions.set(p.id, {
          ...manualFor(p, `AI batch failed: ${ai.error || 'AI yanıt yok'}`),
          candidates: cands.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: 0 })),
        });
      }
      return; // FIX(F-04): eski for-loop 'continue'sunun fonksiyon karşılığı
    }

    provider = ai.provider;
    model = ai.model;

    for (const m of ai.matches) {
      const p = products.find((x) => x.id === m.productId);
      if (!p) continue;

      if (m.decision === 'NO_SAFE_MATCH') {
        const cands = candidatesByProduct.get(m.productId) || [];
        decisions.set(m.productId, {
          ...manualFor(p, `AI güvenli eşleşme bulamadı (${m.reasonCode || 'NO_SAFE_MATCH'})`),
          candidates: cands.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: 0 })),
        });
        continue;
      }

      const leaf = tree.leafById.get(m.categoryId);
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
        const cands = candidatesByProduct.get(m.productId) || [];
        decisions.set(m.productId, {
          ...manualFor(p, `AI düşük güven (${m.confidence}) — MANUAL`),
          candidates: cands.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: 0 })),
        });
      }
    }

    for (const p of batch) {
      if (!decisions.has(p.id)) {
        const cands = candidatesByProduct.get(p.id) || [];
        decisions.set(p.id, {
          ...manualFor(p, 'AI eşleşme dönmedi (MANUAL)'),
          candidates: cands.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: 0 })),
        });
      }
    }
  };

  // FIX(F-04): sınırlı worker havuzu — asla sınırsız Promise.all() değil.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(AI_BATCH_CONCURRENCY, batches.length) }, async () => {
    while (cursor < batches.length) {
      const b = batches[cursor++];
      await processBatch(b);
    }
  });
  await Promise.all(workers);

  // Not: provider/model raporlaması son başarılı batch'ten gelir (öncekiyle aynı davranış).

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

  return {
    ok: !anyFailed,
    provider,
    model,
    decisions,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    errorCode: anyFailed ? 'PARTIAL_FAILURE' : undefined,
  };
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

// ==================== TOPLU UYGULAMA (FIX F-03) ====================
//
// applyVerifiedMatch ile BİREBİR AYNI gate sırasını ve reddedilme sebeplerini korur;
// fark yalnızca I/O katmanındadır:
//  - Category / CategoryMapping / Product doğrulamaları ürün başına 3 sorgu yerine
//    toplamda 3 preload sorgusu + Map lookup ile yapılır.
//  - product.update + auditLog yazımları chunk'lı transaction'larda toplanır.
//  - aIDecisionLog createMany ile yazılır (orijinalde .catch(()=>null) ile tolere
//    ediliyordu; aynı tolerans korunur).
// Karar mantığı, eşikler (0.95), state geçişleri ve audit anlamı DEĞİŞMEDİ.

export interface BatchApplySummary {
  results: ApplyResult[];
  applied: number;
}

const APPLY_CHUNK = 200;

export async function applyVerifiedMatchesBatch(
  decisions: MatchDecision[],
  marketplaceId: string,
): Promise<BatchApplySummary> {
  const results: ApplyResult[] = new Array(decisions.length);
  const passing: { index: number; decision: MatchDecision }[] = [];

  if (decisions.length === 0) return { results, applied: 0 };

  // Gate 1-2: karar-içi kontroller (DB'siz)
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (!d.categoryId || d.externalId === null || !d.isLeaf) {
      results[i] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: 'Hedef leaf değil veya externalId yok — yazılmadı' };
      continue;
    }
    if (d.confidence < 0.95) {
      results[i] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: `Düşük güven (${d.confidence}) — MANUAL bırakıldı` };
      continue;
    }
    passing.push({ index: i, decision: d });
  }

  // Preload (toplam 3 sorgu)
  const catIds = Array.from(new Set(passing.map((p) => p.decision.categoryId as string)));
  const productIds = Array.from(new Set(passing.map((p) => p.decision.productId)));

  const [cats, mappings, products] = await Promise.all([
    catIds.length > 0
      ? prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, externalId: true } })
      : Promise.resolve([] as { id: string; externalId: string | number | null }[]),
    catIds.length > 0
      ? prisma.categoryMapping.findMany({
          where: { categoryId: { in: catIds }, marketplaceId, active: true, externalId: { not: null } },
          select: { categoryId: true },
        })
      : Promise.resolve([] as { categoryId: string }[]),
    productIds.length > 0
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);

  const catExtById = new Map(cats.map((c) => [c.id, c.externalId]));
  const mappedCatIds = new Set(mappings.map((m) => m.categoryId));
  const existingProductIds = new Set(products.map((p) => p.id));

  // Gate 3-7: preload edilmiş veriyle aynı sıra ve aynı sebeplerle değerlendirme
  type VerifiedWrite = {
    index: number;
    decision: MatchDecision;
    categoryId: string;
  };
  const verified: VerifiedWrite[] = [];

  for (const p of passing) {
    const d = p.decision;
    const catId = d.categoryId as string;

    const catExt = catExtById.get(catId);
    if (catExt === undefined || catExt === null || Number(catExt) !== d.externalId) {
      results[p.index] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: 'Hedef kategori doğrulanamadı (externalId uyuşmuyor)' };
      continue;
    }

    if (!mappedCatIds.has(catId)) {
      results[p.index] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: 'Aktif tt CategoryMapping yok — categoryMatch yazılmadı' };
      continue;
    }

    if (!existingProductIds.has(d.productId)) {
      results[p.index] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: 'Ürün bulunamadı' };
      continue;
    }

    verified.push({ index: p.index, decision: d, categoryId: catId });
  }

  // Chunk'lı transaction yazımı
  for (let start = 0; start < verified.length; start += APPLY_CHUNK) {
    const chunk = verified.slice(start, start + APPLY_CHUNK);

    await prisma.$transaction(async (tx) => {
      for (const v of chunk) {
        await tx.product.update({
          where: { id: v.decision.productId },
          data: {
            categoryId: v.categoryId,
            categoryMatch: true,
            matchedBy: v.decision.method === 'ai' ? 'ai' : 'auto',
            lastMatchDate: new Date(),
            aiSuggestedCategoryId: v.categoryId,
            aiScore: v.decision.confidence,
          },
        });
      }

      await tx.auditLog.createMany({
        data: chunk.map((v) => ({
          action: v.decision.method === 'ai' ? 'CATEGORY_MATCH_AI' : 'CATEGORY_MATCH_AUTO',
          entity: 'category',
          entityId: v.categoryId,
          meta: JSON.stringify({
            productId: v.decision.productId,
            sourceCategory: v.decision.supplierCategory,
            targetCategory: v.decision.categoryName,
            externalId: v.decision.externalId,
            method: v.decision.method,
            confidence: v.decision.confidence,
          }),
          details: `Ürün ${v.decision.xmlKey} → "${v.decision.categoryName}" (externalId=${v.decision.externalId}, ${v.decision.method}, conf=${v.decision.confidence})`,
        })),
      });
    });

    await prisma.aIDecisionLog.createMany({
      data: chunk.map((v) => ({
        productId: v.decision.productId,
        module: 'category',
        suggestion: v.categoryId,
        confidence: v.decision.confidence,
        reason: v.decision.reason,
        autoApplied: true,
      })),
    }).catch(() => null);
  }

  for (const v of verified) {
    results[v.index] = { productId: v.decision.productId, applied: true, method: v.decision.method, externalId: v.decision.externalId, reason: 'OK' };
  }

  return { results, applied: verified.length };
}
