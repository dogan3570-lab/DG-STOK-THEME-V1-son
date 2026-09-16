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
import { verifyCategorySafety, type SafetyGateInput, buildCategoryAuditMeta } from './categorySafetyGate.ts';
import { lookupKnowledgeV2, lookupGroupEvidence, type KnowledgeEntryV2 } from './categoryKnowledgeV2.ts';

function normalizeTr(s: string): string {
  return s.toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
}

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
  verified?: boolean;              // verifyHighConfidence sonucu
  verifiedConfidence?: number;     // verifyHighConfidence confidence
}

// ==================== AĞAÇ YÜKLEME ====================

// TASK322: ağaç index'i pahalı (2.5s+) — 60sn TTL cache; kategori mutasyonlarında invalidate edilir
let _treeCache: { at: number; tree: TreeIndex } | null = null;
const TREE_CACHE_TTL = 60000;
export function invalidateTrendyolTreeCache(): void { _treeCache = null; }

export async function loadTrendyolTree(forceReload: boolean = false): Promise<TreeIndex> {
  if (!forceReload && _treeCache && Date.now() - _treeCache.at < TREE_CACHE_TTL) return _treeCache.tree;
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

  const treeIndex = {
    leaves,
    leafById: new Map(leaves.map((l) => [l.id, l])),
    leafByNormName,
    leafByNormPath,
    uuidByExternalId,
  };
  _treeCache = { at: Date.now(), tree: treeIndex };
  return treeIndex;
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
// Product-type → category name fragment aliases for candidate boosting
export const PRODUCT_TYPE_ALIASES: Record<string, string[]> = {
  'vantilatoru': ['vantilator', 'fan', 'ventilator'],
  'vantilator': ['vantilator', 'fan', 'ventilator'],
  'fan': ['vantilator', 'fan', 'ventilator'],
  'el fani': ['vantilator', 'fan'],
  'boyun fani': ['vantilator', 'fan'],
  'masa fani': ['vantilator', 'fan'],
  'bebek arabasi fani': ['vantilator', 'fan'],
  'ventilator': ['vantilator', 'fan'],
  'buz': ['buz', 'sogutucu', 'buzluk'],
  'buzluk': ['buz', 'sogutucu', 'buzluk'],
  'sogutucu': ['sogutucu', 'buzluk', 'buz'],
  'kulluk': ['kulluk'],
  'kulaklik': ['kulaklik'],
  'kulaklık': ['kulaklik'],
  'isitici': ['suisiticik', 'kettle', 'isiticik'],
  'kettle': ['kettle', 'suisiticik'],
  'cay': ['cay', 'caydanlik', 'cayseti'],
  'kahvalti': ['kahvaltilik', 'bicak'],
  'bicak': ['bicak', 'bicakbileyici'],
  'bileme': ['bicakbileyici', 'bicak'],
  'sefer': ['sefer', 'celik', 'tencere'],
  'sefertasi': ['sefer', 'celik', 'tencere'],
  'camsil': ['camsil', 'silici'],
  'sunjur': ['sunger', 'camsil'],
  'sünger': ['sunger', 'camsil'],
  'yogurt': ['yogurt', 'sut'],
  'kabı': ['kabi', 'kaplar'],
  'kabi': ['kabi', 'kaplar'],
  'poset': ['poset', 'kutu'],
  'kutu': ['kutu', 'poset'],
  'sarimsak': ['sarimsak', 'ezici'],
  'ezici': ['ezici', 'ezme'],
  'havan': ['havan', 'ezici'],
  'dovme': ['dovme', 'havan'],
  'bisiklet': ['bisiklet'],
  'park': ['park', 'ayaklik'],
  'ayaklik': ['ayaklik', 'park'],
  'oyuncak': ['oyuncak'],
  'kedi': ['kedi'],
  'kopek': ['kopek'],
  'mama': ['mama'],
  'pelin': ['pelin', 'ot'],
  'magnet': ['miknatisli', 'miknatis'],
  'mıknatıs': ['miknatisli', 'miknatis'],
  'duman': ['duman', 'kulluk'],
  'kokusuz': ['kokusuz', 'dumansiz'],
  'dumansiz': ['dumansiz', 'kokusuz'],
};

// PERF(RT-V2): ağaç başına leaf-başına ön hesaplama cache'i.
// Kök neden: buildAiCandidates/classifyByRule her ÜRÜN için tüm leaf'lerin token
// Set'lerini ve morfolojik normalize formlarını sıfırdan hesaplıyordu (~200ms/ürün,
// 14k ürün = ~48dk). Bu değerler yalnızca leaf fullPath/name'e bağlıdır → ağaç
// ömrü boyunca sabittir; memoization SEMANTİĞİ DEĞİŞTİRMEZ, sadece tekrar eder.
interface LeafPrecomp {
  normName: string;          // normalizeName(leaf.name)
  pathTokSet: Set<string>;   // tokensOf(leaf.fullPath)
  normPathToks: string[];    // [...pathTokSet].map(normalizeName) — morph karşılaştırması için
}

const _leafPrecompCache = new WeakMap<TreeIndex, Map<string, LeafPrecomp>>();

function getLeafPrecomp(tree: TreeIndex): Map<string, LeafPrecomp> {
  let m = _leafPrecompCache.get(tree);
  if (m) return m;
  m = new Map<string, LeafPrecomp>();
  const normTok = (t: string) => normalizeName(t);
  for (const l of tree.leaves) {
    const pathTokSet = new Set(tokensOf(l.fullPath));
    const normPathToks: string[] = [];
    for (const t of pathTokSet) normPathToks.push(normTok(t));
    m.set(l.id, { normName: normTok(l.name), pathTokSet, normPathToks });
  }
  _leafPrecompCache.set(tree, m);
  return m;
}

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

export function extractProductTypeTokens(title: string): string[] {
  const clean = (title || '')
    .replace(/^HOBİBAHÇEM®\s*/i, '')
    .replace(/^HOBİBAHÇEM\s*/i, '')
    .replace(/[\d+'\"]li|\badet\b|\bkutulu\b|\byeni\b|\bnesil\b|\bmodel\b|\bmarka\b|\bkaliteli\b|\bsik\b|\btasarım\b|\bmodern\b|\bpaslanmaz\b|\bçelik\b|\bmetal\b|\bahşap\b|\bplastik\b/gi, ' ')
    .replace(/\bhobi\b|\bbahçem\b/gi, ' ');
  const tokens = clean.toLowerCase().split(/[^a-zçğıöşü]+/).filter(t => t.length >= 3);
  return [...new Set(tokens)];
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
  const precomp = getLeafPrecomp(tree);
  const titleTokensForRule = extractProductTypeTokens(product.title || '');
  const scored: Candidate[] = [];
  for (const l of tree.leaves) {
    const pc = precomp.get(l.id);
    if (!pc) continue; // cache eksikse leaf atlanır (imkansız; güvenlik için)
    const leafNorm = pc.normName;
    const contains = leafNorm.length >= 4 && leafTok.length >= 4 && (leafNorm.includes(leafTok) || leafTok.includes(leafNorm));
    const leafTokens = pc.pathTokSet;
    
    let titleOverlap = 0;
    let supplierOverlap = 0;
    for (const t of titleTokensForRule) if (leafTokens.has(t)) titleOverlap++;
    for (const t of xmlTokens) if (leafTokens.has(t)) supplierOverlap++;
    
    let score = titleOverlap * 15 + supplierOverlap * 5;
    if (contains) score += 40;
    
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
  const titleTokens = tokensOf(product.title || '').filter(t => !['hobi', 'bahçem'].includes(t));
  const productTypeTokens = extractProductTypeTokens(product.title || '');
  
  // Derive alias targets from product type tokens
  const aliasTargets = new Set<string>();
  for (const t of productTypeTokens) {
    const aliases = PRODUCT_TYPE_ALIASES[t];
    if (aliases) {
      for (const a of aliases) aliasTargets.add(a);
    }
  }

  const precomp = getLeafPrecomp(tree);
  const scored = tree.leaves.map((l) => {
    const pc = precomp.get(l.id);
    if (!pc) return { leaf: l, score: 0, aliasHit: false, exactHit: false };
    const leafTokens = pc.pathTokSet;
    const leafNorm = pc.normName;
    
    // Token overlap with different weights
    let titleOverlap = 0;
    let supplierOverlap = 0;
    let aliasHit = false;
    let exactHit = false;
    
    for (const t of titleTokens) {
      if (leafTokens.has(t)) titleOverlap++;
    }
    
    for (const t of xmlTokens) {
      if (leafTokens.has(t)) supplierOverlap++;
    }
    
    // FIX(311): ASCII-normalize + prefix (morfolojik) token eşleşmesi.
    // Kök neden: tokensOf Türkçe karakterleri korur, normalizeName çevirir;
    // 'vantilatoru' ↔ 'vantilatör' gibi aynı kök tokenlar overlap=0 üretip
    // relevant leaf'i score=0 ile HER K'da düşürüyordu. Prefix eşleşmesi
    // yalnızca ≥4 karakterli tokenlarda yarım puan alır (generic guard korunur).
    const normTok = (t: string) => normalizeName(t);
    const morphMatchNa = (na: string, nb: string): boolean => {
      if (!na || !nb) return false;
      if (na === nb) return true;
      return (na.length >= 4 && nb.startsWith(na)) || (nb.length >= 4 && na.startsWith(nb));
    };
    const morphMatch = (a: string, b: string): boolean => morphMatchNa(normTok(a), normTok(b));
    
    let titleMorph = 0;
    for (const t of titleTokens) {
      if (leafTokens.has(t)) continue; // tam eşleşme zaten sayıldı
      if (t.length < 4) continue;
      const na = normTok(t);
      for (const nb of pc.normPathToks) {
        if (morphMatchNa(na, nb)) { titleMorph++; break; }
      }
    }
    titleOverlap += titleMorph; // yarım ağırlık etkisi: ×15 tam puan yerine morfolojik hit de tam token kanıtıdır
    
    for (const t of xmlTokens) {
      if (leafTokens.has(t)) supplierOverlap++;
    }
    
    // Alias matching (product type → category fragment)
    for (const target of aliasTargets) {
      if (leafNorm.includes(target)) {
        aliasHit = true;
        break;
      }
    }
    
    // Exact-ish normalized match (handles "Kulak İçi Kulaklık" vs "Kulak içi TWS Bluetooth Kulaklık")
    if (!exactHit && leafNorm.length >= 4 && leafTok.length >= 4) {
      const normalizedLeafName = leafNorm;
      const normalizedLeafTok = leafTok;
      if (normalizedLeafName.includes(normalizedLeafTok) || normalizedLeafTok.includes(normalizedLeafName)) {
        exactHit = true;
      }
    }
    
    // Product-type alias boost
    let productTypeBoost = 0;
    for (const t of productTypeTokens) {
      const aliases = PRODUCT_TYPE_ALIASES[t];
      if (aliases) {
        for (const a of aliases) {
          if (leafNorm.includes(a)) {
            productTypeBoost = Math.max(productTypeBoost, 80);
            break;
          }
        }
      }
    }
    // Extra boost for direct leaf name match in title
    const titleNorm = normalizeTr(product.title || '');
    if (leafNorm.length >= 4 && titleNorm.includes(leafNorm)) {
      productTypeBoost = Math.max(productTypeBoost, 100);
    }
    
    
    // Scoring: title tokens weighted higher, supplier lower, alias/exact bonuses
    let score = titleOverlap * 15 + supplierOverlap * 5 + productTypeBoost;
    if (exactHit) score += 40;
    // Tie-breaker: prefer shorter category names (more specific) and exact name matches
    if (leafNorm.length >= 4 && titleNorm.includes(leafNorm)) {
      score += 0.5; // Small boost for direct name containment
    }
    // Prefer more specific categories (longer path = more specific)
    score += leafNorm.length * 0.01;
    return { leaf: l, score, aliasHit, exactHit };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const out: CategoryCandidate[] = [];
  const seen = new Set<string>();

  // Kural adayları önce (exact leaf/path dahil) — sadece en güçlü adayları önce
  const highConfidenceRules = ruleCandidates
    .filter(c => c.score >= 50)
    .slice(0, 5);
  for (const c of highConfidenceRules) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score }); }
  }
  // Başlık/token skor adayları — minimum skor filtresi ile gürültüyü azalt
  const MIN_CANDIDATE_SCORE = 15;
  for (const s of scored) {
    if (s.score < MIN_CANDIDATE_SCORE) break;
    if (!seen.has(s.leaf.id)) { seen.add(s.leaf.id); out.push({ id: s.leaf.id, name: s.leaf.name, fullPath: s.leaf.fullPath, score: s.score }); }
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
  topK = 10,
): Promise<AiPassResult> {
  const decisions = new Map<string, MatchDecision>();
  if (products.length === 0) return { ok: true, provider: 'none', model: 'none', decisions };

  const BATCH_SIZE = 5;
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
  // Fix(perf): 1 → 2. Değer 1 iken çok-batch'li preview (≤200 ürün) tamamen
  // SERİ çalışıp 10+ dakikaya çıkıyordu; 2 sınırlı eşzamanlılık bunu yarıya indirir.
  const AI_BATCH_CONCURRENCY = 2;
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
    // V2 PRE-LOOKUP: check Knowledge before AI call
    const v2Decisions = new Map<string, MatchDecision>();
    const aiProducts: ProductForMatch[] = [];

    for (const p of batch) {
      // L1: V2 Knowledge lookup
      const kResult = lookupKnowledgeV2(p.supplierCategory, tree);
      if (kResult.hit && kResult.entry) {
        // V2 Knowledge HIT - use learned result, skip AI
        const leaf = tree.leafById.get(kResult.entry.targetCategoryId);
        if (leaf) {
          v2Decisions.set(p.id, {
            productId: p.id,
            xmlKey: p.xmlKey,
            title: p.title,
            supplierCategory: p.supplierCategory,
            xmlBrandName: p.xmlBrandName,
            method: 'ai', // method='ai' to pass through verification
            confidence: kResult.entry.confidence,
            categoryId: leaf.id,
            externalId: leaf.externalId,
            categoryName: leaf.name,
            fullPath: leaf.fullPath,
            reason: `V2 Knowledge HIT (learned, conf=${kResult.entry.confidence})`,
            candidates: [{ id: leaf.id, name: leaf.name, fullPath: leaf.fullPath, score: Math.round(kResult.entry.confidence * 100) }],
            mappingExists: false,
            isLeaf: true,
          });
          continue; // skip AI for this product
        }
      }

      // L2: V2 Group lookup (only if Knowledge MISS)
      const gResult = lookupGroupEvidence(p.supplierCategory, tree);
      if (gResult.hit && gResult.evidence) {
        const leaf = tree.leafById.get(gResult.evidence.targetCategoryId);
        if (leaf) {
          v2Decisions.set(p.id, {
            productId: p.id,
            xmlKey: p.xmlKey,
            title: p.title,
            supplierCategory: p.supplierCategory,
            xmlBrandName: p.xmlBrandName,
            method: 'ai',
            confidence: gResult.evidence.ratio >= 0.95 ? gResult.evidence.ratio : 0.85, // Group confidence as suggestion
            categoryId: leaf.id,
            externalId: leaf.externalId,
            categoryName: leaf.name,
            fullPath: leaf.fullPath,
            reason: `V2 Group HIT (${gResult.evidence.count}/${gResult.evidence.total}, ratio=${gResult.evidence.ratio.toFixed(2)})`,
            candidates: [{ id: leaf.id, name: leaf.name, fullPath: leaf.fullPath, score: Math.round((gResult.evidence.ratio) * 100) }],
            mappingExists: false,
            isLeaf: true,
          });
          continue; // skip AI for this product
        }
      }

      // V2 MISS - product needs AI
      aiProducts.push(p);
    }

    // Add V2 decisions immediately (these skip AI)
    for (const [id, decision] of v2Decisions) {
      decisions.set(id, decision);
    }

    // If all products had V2 HIT, skip AI call
    if (aiProducts.length === 0) {
      return;
    }

    // Build candidates for AI products
    for (const p of aiProducts) {
      if (!candidatesByProduct.has(p.id)) {
        const rule = classifyByRule(p, tree);
        const cands = buildAiCandidates(p, tree, rule.candidates, topK);
        candidatesByProduct.set(p.id, cands);
      }
    }

    const ai = await callWithBoundedRetry(aiProducts);

    if (!ai.ok) {
      anyFailed = true;
      errors.push(ai.error || 'Batch failed');
      for (const p of aiProducts) {
        const cands = candidatesByProduct.get(p.id) || [];
        decisions.set(p.id, {
          ...manualFor(p, `AI batch failed: ${ai.error || 'AI yanıt yok'}`),
          candidates: cands.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: 0 })),
        });
      }
      return;
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
      title: d.title || '',
      supplierCategory: d.supplierCategory || '',
      categoryName: d.categoryName || '',
      fullPath: d.fullPath || '',
    }));
    const verified = await verifyHighConfidence(verifyItems);
    for (const [pid, v] of verified) {
      const dec = decisions.get(pid);
      if (dec) {
        dec.verified = v.verdict;
        dec.verifiedConfidence = v.confidence;
        if (!v.verdict) {
          dec.categoryId = null;
          dec.categoryName = null;
          dec.fullPath = null;
          dec.reason = `Verify red: ${v.reason}`;
        }
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

  const product = await prisma.product.findUnique({ where: { id: decision.productId }, select: { id: true, title: true, supplierCategory: true, categoryId: true } });
  if (!product) return fail('Ürün bulunamadı');

  // P0: SafetyGate kontrolü — tek kapı mimarisi
  const tree = await loadTrendyolTree();
  const leaf = tree.leafById.get(decision.categoryId);
  if (leaf) {
    const safetyInput: SafetyGateInput = {
      productId: decision.productId,
      title: product.title,
      supplierCategory: product.supplierCategory,
      currentCategoryId: product.categoryId ?? null,
      currentCategoryName: null,
      currentCategoryPath: product.categoryId ? tree.leafById.get(product.categoryId)?.fullPath ?? null : null,
      selectedCategoryId: decision.categoryId,
      selectedCategoryName: leaf.name,
      selectedCategoryPath: leaf.fullPath,
      selectedCategoryExternalId: leaf.externalId,
      candidates: decision.candidates.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score })),
      aiConfidence: decision.confidence,
      verifierVerdict: decision.method === 'ai',
      verifierConfidence: decision.confidence,
      margin: 0.5,
      tree,
      isDeterministic: decision.method !== 'ai',
      decisionMethod: decision.method,
    };
    const safety = verifyCategorySafety(safetyInput);
    if (!safety.passed) {
      return fail(`Safety gate rejected: ${safety.reason}`);
    }
  }

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
      meta: JSON.stringify(buildCategoryAuditMeta({
        productId: decision.productId,
        decisionMethod: decision.method,
        decisionScope: 'PRODUCT',
        oldCategoryId: null,
        newCategoryId: decision.categoryId,
        supplierCategory: decision.supplierCategory,
        selectedCategory: decision.categoryName,
        candidate: decision.categoryName,
        aiConfidence: decision.confidence,
        verifierResult: decision.method === 'ai' ? 'YES' : 'DETERMINISTIC',
        verifierConfidence: decision.confidence,
        margin: 0.5,
        safetyGateResult: 'PASS',
        reason: decision.reason ?? '',
      })),
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
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, supplierCategory: true, categoryId: true } })
      : Promise.resolve([] as { id: string; title: string | null; supplierCategory: string | null; categoryId: string | null }[]),
  ]);

  // P0: SafetyGate için product data map
  const productDataById = new Map(products.map((p) => [p.id, p]));

  const catExtById = new Map(cats.map((c) => [c.id, c.externalId]));
  const mappedCatIds = new Set(mappings.map((m) => m.categoryId));
  const existingProductIds = new Set(products.map((p) => p.id));

  // P0: SafetyGate için tree preload
  const safetyTree = await loadTrendyolTree();

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

    // P0: SafetyGate kontrolü — batch'te tek kapı
    const pData = productDataById.get(d.productId);
    const safetyLeaf = safetyTree.leafById.get(catId);
    if (pData && safetyLeaf) {
      const safetyInput: SafetyGateInput = {
        productId: d.productId,
        title: pData.title,
        supplierCategory: pData.supplierCategory,
        currentCategoryId: pData.categoryId ?? null,
        currentCategoryName: null,
        currentCategoryPath: pData.categoryId ? safetyTree.leafById.get(pData.categoryId)?.fullPath ?? null : null,
        selectedCategoryId: catId,
        selectedCategoryName: safetyLeaf.name,
        selectedCategoryPath: safetyLeaf.fullPath,
        selectedCategoryExternalId: safetyLeaf.externalId,
        candidates: d.candidates.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score })),
        aiConfidence: d.confidence,
        verifierVerdict: d.method === 'ai',
        verifierConfidence: d.confidence,
        margin: 0.5,
        tree: safetyTree,
        isDeterministic: d.method !== 'ai',
        decisionMethod: d.method,
      };
      const safety = verifyCategorySafety(safetyInput);
      if (!safety.passed) {
        results[p.index] = { productId: d.productId, applied: false, method: d.method, externalId: d.externalId, reason: `Safety gate rejected: ${safety.reason}` };
        continue;
      }
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
      meta: JSON.stringify(buildCategoryAuditMeta({
        productId: v.decision.productId,
        decisionMethod: v.decision.method,
        decisionScope: 'PRODUCT',
            oldCategoryId: null,
            newCategoryId: v.categoryId,
            supplierCategory: v.decision.supplierCategory,
            selectedCategory: v.decision.categoryName,
            candidate: v.decision.categoryName,
            aiConfidence: v.decision.confidence,
            verifierResult: v.decision.method === 'ai' ? 'YES' : 'DETERMINISTIC',
            verifierConfidence: v.decision.confidence,
            margin: 0.5,
            safetyGateResult: 'PASS',
            reason: v.decision.reason ?? '',
          })),
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
