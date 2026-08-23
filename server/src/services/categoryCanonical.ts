/**
 * CATEGORY CANONICAL ENGINE — hem AI hem UI tarafından kullanılan tek eşleştirme motoru.
 *
 * KURALLAR:
 *  - normalizeProductCore() → deterministik ürün adı normalizasyonu
 *  - resolveCategoryCandidates() → tek canonical candidate üretici
 *  - Kullanıcı seçimi > AI önerisi
 *  - User mapping XML re-import ile EZİLEMEZ
 *  - categoryMatch=true YALNIZCA verified Trendyol leaf + CategoryMapping ile yazılır
 *  - Düşük confidence → kullanıcı review (asla auto)
 */
import { prisma } from '../db/prisma.ts';
import { normalizeName } from './categoryBrandMapper.ts';
import { loadTrendyolTree, classifyByRule, buildAiCandidates, tokensOf, type TreeIndex, type LeafInfo, type MatchDecision } from './categoryMatchEngine.ts';
import { type CategoryCandidate } from './aiGateway.ts';

// ==================== NOISE / MEANING LISTS ====================

const NOISE_WORDS = new Set([
  'yeni', 'orijinal', 'enucuzsatan', 'enuygunfiyat', 'profesyonel', 'premium',
  'kaliteli', 'dayanikli', 'sağlam', 'gorunum', 'mukemmel', 'essiz', 'ozel',
  'kampanya', 'firsat', 'indirim', 'sonfiyat', 'bedavakargo', 'kargoucretsiz',
  'taksitsecenekli', 'avantajli', 'ekonomik', 'butcedostu', 'super', 'harika',
  'muhtesem', 'fevkalade', 'nadir', 'benzersiz', 'istikrar',
  'sektor', 'endustriyel', 'sanayi', 'ticari', 'toptan', 'perakende',
  '2024', '2025', '2026', '2023', '2022', 'sezon',
  'farkli', 'farkli', 'cesit', 'adet',
  'parca', 'lik', 'li', 'lu', 'lu', 'dir', 'dir', 'dur', 'dur',
  'dir', 'tir', 'tir', 'olarak', 'icin', 'icin', 'ile', 've', 'veya',
  'boyut', 'olculu', 'olculu', 'boyutlu', 'ebat', 'genislik', 'yukseklik',
  'derinlik', 'agirlik', 'agirlik', 'gram', 'kg', 'lt', 'ml', 'cm', 'mm',
  'adedi', 'tane', 'tanesi',
  'acik', 'acik', 'koyu', 'krem', 'beyaz',
  'siyah', 'kirmizi', 'kirmizi', 'mavi', 'yesil', 'yesil', 'sari', 'sari',
  'mor', 'pembe', 'turuncu', 'gri', 'kahverengi', 'lacivert', 'bej',
  'altin', 'altin', 'gumus', 'bronz', 'bakir', 'gumus', 'rose',
]);

export interface ProductCoreMeaning {
  normalizedName: string;
  tokens: string[];
  preservedMeaning: string[];
  removedNoise: string[];
}

/**
 * Deterministik ürün adı normalizasyonu.
 * Gereksiz pazarlama / SEO / satış kelimelerini ayıklayıp gerçek ürün çekirdeğini çıkarır.
 * Anlam belirleyen kelimeleri KORUR (çocuk, kadın, erkek, bebek, kablosuz, vb.).
 * Deterministik ve test edilebilir: aynı input → her zaman aynı output.
 */
export function normalizeProductCore(title: string | null): ProductCoreMeaning {
  const raw = (title || '').trim();
  if (!raw) return { normalizedName: '', tokens: [], preservedMeaning: [], removedNoise: [] };

  const words = raw
    .split(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2);

  const preserved: string[] = [];
  const removed: string[] = [];
  const keptTokens: string[] = [];

  for (const w of words) {
    const nw = normalizeName(w);
    if (nw.length < 2) continue;

    if (NOISE_WORDS.has(nw)) {
      removed.push(w);
      continue;
    }

    // Numeric-only after removing year patterns → likely noise
    if (/^\d{4}$/.test(nw)) { removed.push(w); continue; }

    keptTokens.push(nw);
    preserved.push(w);
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const uniqueTokens: string[] = [];
  for (const t of keptTokens) {
    if (!seen.has(t)) { seen.add(t); uniqueTokens.push(t); }
  }

  return {
    normalizedName: uniqueTokens.join(' '),
    tokens: uniqueTokens,
    preservedMeaning: preserved,
    removedNoise: removed,
  };
}

// ==================== CANDIDATE RESOLUTION ====================

export interface CandidateResult {
  productId: string;
  xmlKey: string;
  title: string | null;
  supplierCategory: string | null;
  normalizedProduct: ProductCoreMeaning;
  candidates: CategoryCandidate[];
  topCandidate: CategoryCandidate | null;
  confidence: number;
  method: 'exact_leaf' | 'exact_path' | 'rule_similarity' | 'no_source' | 'no_candidate' | 'manual_required';
  isLeaf: boolean;
  hasMapping: boolean;
  mappingVerified: boolean;
}

/**
 * Tek canonical candidate üretici. Hem AI hem UI tarafından kullanılır.
 * Trendyol leaf-only + CategoryMapping verified eşleştirme.
 *
 * @param product - Ürün bilgileri (id, xmlKey, title, supplierCategory, xmlBrandName)
 * @param tree - Yüklenmiş Trendyol kategori ağacı
 * @param marketplaceId - Aktif Trendyol marketplace ID (CategoryMapping doğrulaması için)
 * @returns CandidateResult - Aday listesi, güven skoru, yöntem
 */
export function resolveCategoryCandidates(
  product: { id: string; xmlKey: string; title: string | null; supplierCategory: string | null; xmlBrandName: string | null },
  tree: TreeIndex,
  marketplaceId: string | null,
): CandidateResult {
  const normalizedProduct = normalizeProductCore(product.title);

  // Step 1: Rule-based classification → candidates
  const ruleDecision = classifyByRule(product, tree);

  // Step 2: Build AI-ready candidates (top 15)
  // If supplier category is wrong (rule_similarity with low conf), try TITLE-only matching too
  const aiCandidates = buildAiCandidates(product, tree, ruleDecision.candidates, 15);

  // Step 2b: TITLE-only candidates for comparison (when supplier category is unreliable)
  const isSupplierUnreliable = ruleDecision.method === 'rule_similarity' && ruleDecision.confidence < 0.6;
  let titleOnlyCandidates = aiCandidates;
  if (isSupplierUnreliable) {
    const titleOnly = buildAiCandidates(
      { title: product.title, supplierCategory: '' },
      tree,
      [],
      15,
    );
    // If title-only produces different/better top candidate, prefer it
    if (titleOnly.length > 0 && titleOnly[0].id !== aiCandidates[0]?.id) {
      titleOnlyCandidates = titleOnly;
    }
  }

  // Step 3: Filter to only leaves with valid externalId
  // Use titleOnlyCandidates when supplier is unreliable
  const sourceCandidates = isSupplierUnreliable ? titleOnlyCandidates : aiCandidates;
  const validCandidates: CategoryCandidate[] = [];
  for (const c of sourceCandidates) {
    const leaf = tree.leafById.get(c.id);
    if (leaf && leaf.externalId > 0) {
      validCandidates.push(c);
    }
  }

  // Step 4: Determine method and confidence
  let method: CandidateResult['method'] = 'manual_required';
  let confidence = 0;
  let topCandidate: CategoryCandidate | null = null;
  let isLeaf = false;
  let hasMapping = false;
  let mappingVerified = false;

  if (!product.supplierCategory || product.supplierCategory.trim() === '') {
    method = 'no_source';
    confidence = 0;
  } else if (validCandidates.length === 0) {
    method = 'no_candidate';
    confidence = 0;
  } else {
    topCandidate = validCandidates[0];
    isLeaf = true;

    // Check if top candidate has a verified CategoryMapping
    if (marketplaceId && topCandidate) {
      // We'll check mapping in the async version; for sync, set hasMapping based on rule decision
      hasMapping = ruleDecision.mappingExists;
    }

    // Set method and confidence based on rule decision
    if (ruleDecision.method === 'exact_leaf') {
      method = 'exact_leaf';
      confidence = ruleDecision.confidence;
    } else if (ruleDecision.method === 'exact_path') {
      method = 'exact_path';
      confidence = ruleDecision.confidence;
    } else if (isSupplierUnreliable && sourceCandidates !== aiCandidates) {
      // Title-only matching: compute confidence from title-to-candidate name overlap
      const titleTokens = new Set(normalizedProduct.tokens);
      const leafTokens = new Set(
        (topCandidate.name || '').split(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]+/)
          .map(t => normalizeName(t.trim()))
          .filter(t => t.length >= 2)
      );
      let titleOverlap = 0;
      for (const t of titleTokens) if (leafTokens.has(t)) titleOverlap++;
      method = 'rule_similarity';
      confidence = titleOverlap >= 3 ? Math.min(0.85, 0.6 + titleOverlap * 0.08) :
                   titleOverlap >= 2 ? Math.min(0.75, 0.5 + titleOverlap * 0.08) :
                   titleOverlap >= 1 ? Math.min(0.6, 0.35 + titleOverlap * 0.1) : 0.25;
    } else {
      method = 'rule_similarity';
      confidence = ruleDecision.confidence;
    }
  }

  return {
    productId: product.id,
    xmlKey: product.xmlKey,
    title: product.title,
    supplierCategory: product.supplierCategory,
    normalizedProduct,
    candidates: validCandidates,
    topCandidate,
    confidence,
    method,
    isLeaf,
    hasMapping,
    mappingVerified,
  };
}

/**
 * Toplu candidate çözümü. 342 ürün için tek seferde çalıştırılır.
 * Async: CategoryMapping doğrulaması dahil.
 */
export async function resolveCategoryCandidatesBatch(
  products: Array<{ id: string; xmlKey: string; title: string | null; supplierCategory: string | null; xmlBrandName: string | null }>,
  tree: TreeIndex,
  marketplaceId: string | null,
): Promise<CandidateResult[]> {
  const results: CandidateResult[] = [];

  // Step 1: Rule-based classification for all
  const ruleDecisions = new Map<string, MatchDecision>();
  for (const p of products) {
    ruleDecisions.set(p.id, classifyByRule(p, tree));
  }

  // Step 2: Collect all unique target category IDs for mapping check
  const targetCategoryIds = new Set<string>();
  for (const p of products) {
    const rule = ruleDecisions.get(p.id)!;
    for (const c of rule.candidates) {
      if (tree.leafById.has(c.id)) targetCategoryIds.add(c.id);
    }
  }

  // Step 3: Batch-check CategoryMapping existence
  const mappingCategoryIds = new Set<string>();
  if (marketplaceId && targetCategoryIds.size > 0) {
    const mappings = await prisma.categoryMapping.findMany({
      where: {
        categoryId: { in: Array.from(targetCategoryIds) },
        marketplaceId,
        active: true,
        externalId: { not: null },
      },
      select: { categoryId: true },
    });
    for (const m of mappings) mappingCategoryIds.add(m.categoryId);
  }

  // Step 4: Build results
  for (const p of products) {
    const rule = ruleDecisions.get(p.id)!;
    const aiCandidates = buildAiCandidates(p, tree, rule.candidates, 15);

    // TITLE-only comparison when supplier category is unreliable
    const isSupplierUnreliable = rule.method === 'rule_similarity' && rule.confidence < 0.6;
    let sourceCandidates = aiCandidates;
    if (isSupplierUnreliable) {
      const titleOnly = buildAiCandidates(
        { title: p.title, supplierCategory: '' },
        tree,
        [],
        15,
      );
      if (titleOnly.length > 0 && titleOnly[0].id !== aiCandidates[0]?.id) {
        sourceCandidates = titleOnly;
      }
    }

    const validCandidates: CategoryCandidate[] = [];
    for (const c of sourceCandidates) {
      const leaf = tree.leafById.get(c.id);
      if (leaf && leaf.externalId > 0) validCandidates.push(c);
    }

    const normalizedProduct = normalizeProductCore(p.title);
    let method: CandidateResult['method'] = 'manual_required';
    let confidence = 0;
    let topCandidate: CategoryCandidate | null = null;
    let isLeaf = false;
    let hasMapping = false;

    const hasSupplier = p.supplierCategory && p.supplierCategory.trim() !== '';

    if (validCandidates.length === 0) {
      method = hasSupplier ? 'no_candidate' : 'no_source';
    } else {
      topCandidate = validCandidates[0];
      isLeaf = true;
      hasMapping = mappingCategoryIds.has(topCandidate.id);

      if (rule.method === 'exact_leaf') {
        method = 'exact_leaf';
        confidence = rule.confidence;
      } else if (rule.method === 'exact_path') {
        method = 'exact_path';
        confidence = rule.confidence;
      } else if (isSupplierUnreliable && sourceCandidates !== aiCandidates) {
        // Title-only matching: use title-based confidence
        // Check title-to-candidate name overlap for confidence
        const titleTokens = new Set(normalizedProduct.tokens);
        const leafTokens = new Set(
          (topCandidate.name || '').split(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]+/)
            .map(t => normalizeName(t.trim()))
            .filter(t => t.length >= 2)
        );
        let titleOverlap = 0;
        for (const t of titleTokens) if (leafTokens.has(t)) titleOverlap++;
        method = 'rule_similarity';
        confidence = titleOverlap >= 2 ? Math.min(0.8, 0.5 + titleOverlap * 0.1) :
                     titleOverlap >= 1 ? Math.min(0.65, 0.4 + titleOverlap * 0.1) : 0.3;
      } else {
        method = 'rule_similarity';
        confidence = rule.confidence;
      }
    }

    results.push({
      productId: p.id,
      xmlKey: p.xmlKey,
      title: p.title,
      supplierCategory: p.supplierCategory,
      normalizedProduct,
      candidates: validCandidates,
      topCandidate,
      confidence,
      method,
      isLeaf,
      hasMapping,
      mappingVerified: hasMapping,
    });
  }

  return results;
}
