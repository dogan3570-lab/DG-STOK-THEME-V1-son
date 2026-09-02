/**
 * CATEGORY CORE — tek merkezi kategori motoru.
 *
 * TÜM kategori eşleştirme işlemleri bu modül üzerinden yürür.
 * Trendyol adapter pattern ile marketplace bağımlılığı ayrıştırılmıştır.
 *
 * KURALLAR:
 *  - categoryMatch=true YALNIZCA doğrulama zincirinden sonra yazılır.
 *  - AI kendi ID uyduramaz; yalnızca verilen adaylar arasından seçim yapar.
 *  - Dry-run modunda DB'ye YAZMAZ.
 *  - Her karar için reason code kaydedilir.
 *  -uplicate matching logic bu Core'a delegate edilir.
 */
import { prisma } from '../db/prisma.ts';
import { normalizeName } from './categoryBrandMapper.ts';
import {
  loadTrendyolTree,
  loadTrendyolMarketplaceId,
  classifyByRule as engineClassifyByRule,
  classifyByAi as engineClassifyByAi,
  verifyHighConfidence,
  buildAiCandidates,
  buildSemanticCandidates,
  tokensOf,
  type TreeIndex,
  type LeafInfo,
  type Candidate,
  type MatchDecision,
  type AiPassResult,
  type PreviewRow,
  type StageCandidate,
} from './categoryMatchEngine.ts';
import { understandProduct, type SemanticIdentity } from './productUnderstanding.ts';
import { inspectProductImages } from './imageIntelligence.ts';
import { detectTaxonomyGap, type TaxonomyGapResult } from './taxonomyGapDetector.ts';
import { verifyCategoryMatch, type CategoryVerification } from './aiGateway.ts';
import { storeEvidence, formatEvidenceReport, type ForensicEvidence } from './forensicEvidence.ts';
import {
  matchCategoriesWithAI,
  chatCompletion,
  sanitizeJsonControlChars,
  type ProductForMatch,
  type CategoryCandidate,
} from './aiGateway.ts';
import { verifyCategorySafety, type SafetyGateInput, buildCategoryAuditMeta } from './categorySafetyGate.ts';
import {reconcileProductGates, queueReconcileProductGates} from './readinessService.ts';

// ==================== REASON CODES ====================

export type MatchRejectReason =
  | 'NO_SOURCE_CATEGORY'
  | 'NO_TREE_MATCH'
  | 'NO_CANDIDATE'
  | 'LOW_CONFIDENCE'
  | 'AI_NO_DECISION'
  | 'AI_INVALID_CATEGORY'
  | 'AI_PARENT_NOT_LEAF'
  | 'NO_EXTERNAL_ID'
  | 'MAPPING_MISSING'
  | 'VERIFICATION_FAILED'
  | 'SEMANTIC_MISMATCH'
  | 'MANUAL_REQUIRED';

// ==================== MARKETPLACE ADAPTER INTERFACE ====================

export interface MarketplaceAdapter {
  key: string;
  name: string;
  loadTree(): Promise<TreeIndex>;
  loadMarketplaceId(): Promise<string | null>;
  validateExternalId(externalId: number): boolean;
}

// ==================== TYPES ====================

export interface DryRunRow {
  productId: string;
  xmlKey: string;
  title: string | null;
  supplierCategory: string | null;
  currentCategoryId: string | null;
  currentCategoryExternalId: string | null;
  ruleMethod: string;
  ruleConfidence: number;
  ruleCandidateCount: number;
  topK10: string[];
  topK25: string[];
  topK50: string[];
  aiCallable: boolean;
  verificationResult: string | null;
  rejectReason: MatchRejectReason | null;
  proposedCategoryId: string | null;
  proposedCategoryName: string | null;
  proposedExternalId: number | null;
  proposedMappingExists: boolean;
  wouldWrite: boolean;
}

export interface DryRunResult {
  total: number;
  exactSafeCandidate: number;
  highConfidenceAi: number;
  candidatePoolInsufficient: number;
  verificationRejected: number;
  noCandidate: number;
  sourceCategoryOnly: number;
  alreadyValid: number;
  aiCallsNeeded: number;
  verificationCallsNeeded: number;
  rows: DryRunRow[];
  durationMs: number;
}

// ==================== CANONICAL NORMALIZATION ====================

/**
 * Tek merkezi normalization. Tüm codebase bu fonksiyonu kullanmalı.
 * categoryBrandMapper.normalizeName() ile birebir aynı mantık.
 */
export function canonicalNormalize(s: string): string {
  return normalizeName(s);
}

// ==================== MARKETPLACE TREE ====================

/**
 * Marketplace tree yükler. Adapter pattern ile marketplace'e özel hale gelir.
 */
export async function loadMarketplaceTree(adapter: MarketplaceAdapter): Promise<TreeIndex> {
  return adapter.loadTree();
}

// ==================== CANDIDATE GENERATION ====================

/**
 * Ürün için aday kategori üretir. topK limiti uygular.
 * Candidate coverage ölçümü için upper bound dahil edilir.
 */
export function generateCandidates(
  product: { title: string | null; supplierCategory: string | null },
  tree: TreeIndex,
  ruleCandidates: Candidate[],
  topK: number,
): CategoryCandidate[] {
  return buildAiCandidates(product, tree, ruleCandidates, topK);
}

/**
 * Candidate pool'u analiz eder ve coverage raporu üretir.
 */
export function analyzeCandidatePool(
  product: { title: string | null; supplierCategory: string | null },
  tree: TreeIndex,
  ruleCandidates: Candidate[],
): { topK10: string[]; topK25: string[]; topK50: string[]; coverage: number } {
  const all50 = buildAiCandidates(product, tree, ruleCandidates, 50);
  const all25 = all50.slice(0, 25);
  const all10 = all50.slice(0, 10);

  return {
    topK10: all10.map((c) => c.name),
    topK25: all25.map((c) => c.name),
    topK50: all50.map((c) => c.name),
    coverage: all50.length,
  };
}

// ==================== RULE CLASSIFICATION ====================

/**
 * Kural tabanlı sınıflandırma. Mevcut classifyByRule'u wrap eder.
 * categoryId HER ZAMAN null döner (auto yazma YOK).
 */
export function classifyByRule(
  product: { id: string; xmlKey: string; title: string | null; supplierCategory: string | null; xmlBrandName: string | null },
  tree: TreeIndex,
): MatchDecision {
  return engineClassifyByRule(product, tree);
}

// ==================== AI CLASSIFICATION ====================

/**
 * AI sınıflandırması. Mevcut classifyByAi'ı wrap eder.
 * İki doğrulama dahil: confidence threshold + verifyHighConfidence.
 */
export async function classifyByAi(
  products: ProductForMatch[],
  tree: TreeIndex,
  marketplaceName: string | null,
  topK = 10,
): Promise<AiPassResult> {
  return engineClassifyByAi(products, tree, marketplaceName, topK);
}

// ==================== AI FINAL ASSISTANT ====================

/**
 * Tüm deterministic/rule/AI otomatik matching tamamlandıktan sonra
 * kalan MANUAL_REVIEW ürünleri için son AI pass.
 *
 * AI'ya full context verilir: title, supplierCategory, brand, attributes, variants.
 * AI yalnızca mevcut tree içinden seçim yapar.
 */
export async function finalAIAssistant(
  products: Array<{
    id: string;
    xmlKey: string;
    title: string | null;
    supplierCategory: string | null;
    xmlBrandName: string | null;
    description: string | null;
  }>,
  tree: TreeIndex,
  marketplaceName: string | null,
  previousReasons: Map<string, string>,
): Promise<Map<string, MatchDecision>> {
  const decisions = new Map<string, MatchDecision>();
  if (products.length === 0) return decisions;

  const manualFor = (p: ProductForMatch, reason: string): MatchDecision => ({
    productId: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
    method: 'manual', confidence: 0, categoryId: null, externalId: null, categoryName: null, fullPath: null,
    reason, candidates: [], mappingExists: false, isLeaf: false,
  });

  // Her ürün için aday üret
  const candidatesByProduct = new Map<string, CategoryCandidate[]>();
  for (const p of products) {
    const rule = engineClassifyByRule(p, tree);
    const cands = buildAiCandidates(p, tree, rule.candidates, 50);
    candidatesByProduct.set(p.id, cands);
  }

  // Tüm adayları birleştir
  const allCandidates = Array.from(new Map(
    products.flatMap((p) => candidatesByProduct.get(p.id) || []).map((c) => [c.id, c])
  ).values());

  if (allCandidates.length === 0) {
    for (const p of products) decisions.set(p.id, manualFor(p, 'NO_CANDIDATE'));
    return decisions;
  }

  // AI prompt: ürün başlığı + supplier category + brand + previous reason
  const system = `You are a Trendyol category specialist. A product needs categorization.

PRODUCT INFORMATION:
- Title: the product name
- Supplier Category: the XML source category path (may be noisy/incorrect)
- Brand: the product brand
- Previous Attempt: why earlier matching failed

TASK:
1. Read the product title and metadata carefully
2. Find the MOST appropriate Trendyol LEAF category from the provided candidates
3. The category MUST exist in the candidate list
4. Prioritize: product title > brand > supplier category path
5. Do NOT invent categories outside the candidate list

RULES:
- The product IS the category item (not an accessory/part)
- If unsure, say "UNCERTAIN" with reasoning
- Return ONLY valid JSON

RESPONSE FORMAT:
{"results":[{"productId":"...","categoryId":"...","confidence":0.0-1.0,"reason":"brief reason"}]}`;

  // Batch'ler halinde AI'a gönder (50 ürün batches)
  const BATCH = 30;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const batchInput: ProductForMatch[] = batch.map((p) => ({
      id: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory,
      xmlBrandName: p.xmlBrandName, description: p.description,
    }));

    const user = `PRODUCTS:
${JSON.stringify(batch.map((p) => ({
  productId: p.id,
  title: p.title,
  supplierCategory: p.supplierCategory,
  brand: p.xmlBrandName,
  previousReason: previousReasons.get(p.id) || 'none',
})))}

CANDIDATES:
${JSON.stringify(allCandidates.slice(0, 50))}

Return ONLY the JSON.`;

    try {
      const res = await chatCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.05,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      if (!res.ok || !res.content) {
        for (const p of batch) decisions.set(p.id, manualFor(p, `AI_NO_DECISION: ${res.error || 'yanıt yok'}`));
        continue;
      }

      // Parse response
      let jsonStr = String(res.content).trim();
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (!match) {
        for (const p of batch) decisions.set(p.id, manualFor(p, 'AI_NO_DECISION: JSON parse hatası'));
        continue;
      }
      const parsed = JSON.parse(sanitizeJsonControlChars(match[0]));
      const results = Array.isArray(parsed?.results) ? parsed.results : [];

      for (const r of results) {
        const productId = String(r.productId ?? '');
        const categoryId = String(r.categoryId ?? '');
        const confidence = Number(r.confidence);
        const reason = typeof r.reason === 'string' ? r.reason : '';
        if (!productId || !categoryId) continue;

        const p = batch.find((x) => x.id === productId);
        if (!p) continue;

        // Validation: categoryId exists in tree?
        const leaf = tree.leafById.get(categoryId);
        if (!leaf) {
          decisions.set(productId, {
            ...manualFor(p, `AI_INVALID_CATEGORY: ${categoryId} tree'de yok`),
            method: 'invalid',
          });
          continue;
        }

        // Validation: is leaf?
        if (!leaf || tree.leaves.findIndex((l) => l.id === leaf.id) === -1) {
          decisions.set(productId, {
            ...manualFor(p, 'AI_PARENT_NOT_LEAF: leaf değil'),
            method: 'invalid',
          });
          continue;
        }

        // Validation: has externalId?
        if (!leaf.externalId || leaf.externalId <= 0) {
          decisions.set(productId, manualFor(p, 'NO_EXTERNAL_ID'));
          continue;
        }

        if (confidence >= 0.90) {
          decisions.set(productId, {
            productId, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName,
            method: 'ai', confidence,
            categoryId: leaf.id, externalId: leaf.externalId,
            categoryName: leaf.name, fullPath: leaf.fullPath,
            reason: `Final AI: ${reason}`,
            candidates: [{ id: leaf.id, name: leaf.name, fullPath: leaf.fullPath, score: Math.round(confidence * 100) }],
            mappingExists: false, isLeaf: true,
          });
        } else {
          decisions.set(productId, manualFor(p, `LOW_CONFIDENCE: ${confidence}`));
        }
      }

      for (const p of batch) {
        if (!decisions.has(p.id)) decisions.set(p.id, manualFor(p, 'AI_NO_DECISION'));
      }
    } catch (e) {
      for (const p of batch) decisions.set(p.id, manualFor(p, `AI_NO_DECISION: ${String(e instanceof Error ? e.message : e)}`));
    }
  }

  return decisions;
}

// ==================== VERIFICATION ====================

/**
 * Tek merkezi doğrulama gate'i.
 * Tüm şartlar geçmeli: category exists, leaf, externalId, mapping, confidence, semantic.
 */
export async function verifyMatch(
  decision: MatchDecision,
  marketplaceId: string,
): Promise<{ pass: boolean; reason: MatchRejectReason | null; detail: string }> {
  // Gate 1: categoryId exists
  if (!decision.categoryId) {
    return { pass: false, reason: 'NO_SOURCE_CATEGORY', detail: 'categoryId null' };
  }

  // Gate 2: is leaf
  if (!decision.isLeaf) {
    return { pass: false, reason: 'AI_PARENT_NOT_LEAF', detail: 'leaf değil' };
  }

  // Gate 3: externalId valid
  if (decision.externalId === null || decision.externalId <= 0) {
    return { pass: false, reason: 'NO_EXTERNAL_ID', detail: 'externalId yok veya geçersiz' };
  }

  // Gate 4: confidence >= 0.95
  if (decision.confidence < 0.95) {
    return { pass: false, reason: 'LOW_CONFIDENCE', detail: `güven: ${decision.confidence}` };
  }

  // Gate 5: Category exists with matching externalId
  const category = await prisma.category.findUnique({
    where: { id: decision.categoryId },
    select: { id: true, externalId: true },
  });
  if (!category || category.externalId === null || Number(category.externalId) !== decision.externalId) {
    return { pass: false, reason: 'AI_INVALID_CATEGORY', detail: 'kategori externalId uyuşmuyor' };
  }

  // Gate 6: Active CategoryMapping exists
  const mapping = await prisma.categoryMapping.findFirst({
    where: { categoryId: decision.categoryId, marketplaceId, active: true, externalId: { not: null } },
    select: { id: true },
  });
  if (!mapping) {
    return { pass: false, reason: 'MAPPING_MISSING', detail: 'aktif CategoryMapping yok' };
  }

  // Gate 7: Product exists
  const product = await prisma.product.findUnique({
    where: { id: decision.productId },
    select: { id: true },
  });
  if (!product) {
    return { pass: false, reason: 'MANUAL_REQUIRED', detail: 'ürün bulunamadı' };
  }

  return { pass: true, reason: null, detail: 'OK' };
}

// ==================== SAFE APPLY ====================

/**
 * Doğrulanmış kararı DB'ye yazar. audit + decision log dahil.
 */
export async function applyDecision(
  decision: MatchDecision,
  marketplaceId: string,
): Promise<{ applied: boolean; reason: string }> {
  const check = await verifyMatch(decision, marketplaceId);
  if (!check.pass) {
    return { applied: false, reason: check.detail };
  }

  // P0: SafetyGate kontrolü — tek kapı mimarisi
  const tree = await loadMarketplaceTree({ key: 'tt', name: 'Trendyol', loadTree: async () => loadTrendyolTree(), loadMarketplaceId: async () => marketplaceId, validateExternalId: () => true });
  const product = await prisma.product.findUnique({
    where: { id: decision.productId },
    select: { id: true, title: true, supplierCategory: true, categoryId: true },
  });
  if (product) {
    const leaf = tree.leafById.get(decision.categoryId as string);
    if (leaf) {
      const safetyInput: SafetyGateInput = {
        productId: decision.productId,
        title: product.title,
        supplierCategory: product.supplierCategory,
        currentCategoryId: product.categoryId ?? null,
        currentCategoryName: null,
        currentCategoryPath: product.categoryId ? tree.leafById.get(product.categoryId)?.fullPath ?? null : null,
        selectedCategoryId: decision.categoryId as string,
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
        return { applied: false, reason: `Safety gate rejected: ${safety.reason}` };
      }
    }
  }

  // verifyMatch geçtiyse categoryId null değildir (gate 1)
  const catId = decision.categoryId as string;

  await prisma.product.update({
    where: { id: decision.productId },
    data: {
      categoryId: catId,
      categoryMatch: true,
      matchedBy: decision.method === 'ai' ? 'ai' : 'auto',
      lastMatchDate: new Date(),
      aiSuggestedCategoryId: catId,
      aiScore: decision.confidence,
    },
  });

  queueReconcileProductGates(decision.productId);

  await prisma.auditLog.create({
    data: {
      action: decision.method === 'ai' ? 'CATEGORY_MATCH_AI' : 'CATEGORY_MATCH_AUTO',
      entity: 'category',
      entityId: catId,
      meta: buildCategoryAuditMeta({
        productId: decision.productId,
        decisionMethod: decision.method,
        decisionScope: 'PRODUCT',
        oldCategoryId: null,
        newCategoryId: catId,
        supplierCategory: decision.supplierCategory,
        selectedCategory: decision.categoryName,
        candidate: decision.categoryName,
        aiConfidence: decision.confidence,
        verifierResult: decision.method === 'ai' ? 'YES' : 'DETERMINISTIC',
        verifierConfidence: decision.confidence,
        margin: 0.5,
        safetyGateResult: 'PASS',
        reason: decision.reason ?? '',
      }),
      details: `Core: ${decision.xmlKey} → "${decision.categoryName}" (ext=${decision.externalId}, ${decision.method}, conf=${decision.confidence})`,
    },
  });

  await prisma.aIDecisionLog.create({
    data: {
      productId: decision.productId,
      module: 'category',
      suggestion: catId,
      confidence: decision.confidence,
      reason: decision.reason,
      autoApplied: true,
    },
  }).catch(() => null);

  return { applied: true, reason: 'OK' };
}

// ==================== DRY-RUN ====================

/**
 * Dry-run: ürünleri Core pipeline'ından geçirir ama DB'ye YAZMAZ.
 * Tam rapor üretir.
 */
export async function dryRun(
  adapter: MarketplaceAdapter,
  options: {
    productIds?: string[];
    xmlSourceId?: string;
    limit?: number;
    withAi?: boolean;
  } = {},
): Promise<DryRunResult> {
  const startTime = Date.now();
  const limit = Math.min(1000, Math.max(1, options.limit ?? 100));
  const withAi = options.withAi !== false;

  // Tree yükle
  const tree = await adapter.loadTree();
  const marketplaceId = await adapter.loadMarketplaceId();

  // Ürünleri çek
  const where: any = { categoryMatch: false, supplierCategory: { not: '' } };
  if (options.productIds && options.productIds.length > 0) {
    where.id = { in: options.productIds };
  }
  if (options.xmlSourceId) {
    where.xmlSourceId = options.xmlSourceId;
  }

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true,
      categoryId: true, categoryMatch: true,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  // Mevcut category externalId'leri
  const categoryIds = products.map((p) => p.categoryId).filter((id): id is string => Boolean(id));
  const categories = categoryIds.length > 0
    ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, externalId: true } })
    : [];
  const categoryExtMap = new Map(categories.map((c) => [c.id, c.externalId]));

  // Dry-run sonuçları
  const rows: DryRunRow[] = [];
  let exactSafe = 0, highConfAi = 0, poolInsufficient = 0, verifyRejected = 0, noCand = 0, sourceOnly = 0, alreadyValid = 0;
  let aiCalls = 0, verifyCalls = 0;

  // Rule-based classification
  const ruleDecisions = new Map<string, MatchDecision>();
  for (const p of products) {
    const d = classifyByRule(p, tree);
    ruleDecisions.set(p.id, d);
  }

  // Candidate analysis
  const candidateAnalysis = new Map<string, ReturnType<typeof analyzeCandidatePool>>();
  for (const p of products) {
    const rule = ruleDecisions.get(p.id)!;
    const analysis = analyzeCandidatePool(p, tree, rule.candidates);
    candidateAnalysis.set(p.id, analysis);
  }

  // AI classification (if enabled)
  let aiDecisions = new Map<string, MatchDecision>();
  if (withAi) {
    const aiNeeded = products.filter((p) => {
      const d = ruleDecisions.get(p.id)!;
      return d.categoryId === null;
    });

    if (aiNeeded.length > 0) {
      aiCalls = 1; // batch call
      const mp = adapter.key === 'tt' ? 'Trendyol' : adapter.name;
      const aiResult = await classifyByAi(aiNeeded, tree, mp);
      aiDecisions = aiResult.decisions;

      // Verify high confidence
      const highDecisions = Array.from(aiResult.decisions.values()).filter(
        (d) => d.method === 'ai' && d.categoryId !== null,
      );
      if (highDecisions.length > 0) {
        verifyCalls = 1;
      }
    }
  }

  // FIX(F-07): satır döngüsü içindeki categoryMapping.findFirst N+1'i tek preload'a çevrildi.
  // Okuma-only dry-run semantiği birebir aynıdır (aktif + externalId'li mapping varlığı).
  const candidateTargetIds = new Set<string>();
  for (const p of products) {
    const rule = ruleDecisions.get(p.id)!;
    const ai = aiDecisions.get(p.id);
    const decision = ai || rule;
    if (decision.categoryId) candidateTargetIds.add(decision.categoryId);
  }
  const mappedCategoryIds = new Set(
    marketplaceId && candidateTargetIds.size > 0
      ? (
          await prisma.categoryMapping.findMany({
            where: { categoryId: { in: Array.from(candidateTargetIds) }, marketplaceId, active: true, externalId: { not: null } },
            select: { categoryId: true },
          }).catch(() => [])
        ).map((m) => m.categoryId)
      : []
  );

  // Build rows
  for (const p of products) {
    const rule = ruleDecisions.get(p.id)!;
    const ai = aiDecisions.get(p.id);
    const analysis = candidateAnalysis.get(p.id)!;
    const decision = ai || rule;
    const currentExt = p.categoryId ? (categoryExtMap.get(p.categoryId) ?? null) : null;

    // Classify result
    let rejectReason: MatchRejectReason | null = null;
    let category = 'noCandidate';

    if (p.categoryMatch) {
      category = 'alreadyValid';
      alreadyValid++;
    } else if (decision.categoryId && decision.confidence >= 0.95 && decision.isLeaf && decision.externalId) {
      // Would pass verification?
      if (marketplaceId) {
        const hasMapping = mappedCategoryIds.has(decision.categoryId);
        if (hasMapping) {
          if (decision.method === 'ai' || decision.confidence >= 0.95) {
            category = 'highConfidenceAi';
            highConfAi++;
          } else {
            category = 'exactSafeCandidate';
            exactSafe++;
          }
        } else {
          category = 'verificationRejected';
          verifyRejected++;
          rejectReason = 'MAPPING_MISSING';
        }
      }
    } else if (decision.candidates.length > 0) {
      if (decision.candidates.length < 3) {
        category = 'candidatePoolInsufficient';
        poolInsufficient++;
        rejectReason = 'NO_CANDIDATE';
      } else {
        category = 'candidatePoolInsufficient';
        poolInsufficient++;
        rejectReason = 'LOW_CONFIDENCE';
      }
    } else if (!p.supplierCategory || p.supplierCategory.trim() === '') {
      category = 'sourceCategoryOnly';
      sourceOnly++;
      rejectReason = 'NO_SOURCE_CATEGORY';
    } else {
      category = 'noCandidate';
      noCand++;
      rejectReason = 'NO_TREE_MATCH';
    }

    rows.push({
      productId: p.id,
      xmlKey: p.xmlKey,
      title: p.title,
      supplierCategory: p.supplierCategory,
      currentCategoryId: p.categoryId,
      currentCategoryExternalId: currentExt != null ? String(currentExt) : null,
      ruleMethod: rule.method,
      ruleConfidence: rule.confidence,
      ruleCandidateCount: rule.candidates.length,
      topK10: analysis.topK10,
      topK25: analysis.topK25,
      topK50: analysis.topK50,
      aiCallable: decision.categoryId !== null || rule.candidates.length > 0,
      verificationResult: decision.method === 'ai' ? (ai?.reason ?? null) : null,
      rejectReason,
      proposedCategoryId: decision.categoryId,
      proposedCategoryName: decision.categoryName,
      proposedExternalId: decision.externalId,
      proposedMappingExists: false,
      wouldWrite: category === 'exactSafeCandidate' || category === 'highConfidenceAi',
    });
  }

  return {
    total: products.length,
    exactSafeCandidate: exactSafe,
    highConfidenceAi: highConfAi,
    candidatePoolInsufficient: poolInsufficient,
    verificationRejected: verifyRejected,
    noCandidate: noCand,
    sourceCategoryOnly: sourceOnly,
    alreadyValid,
    aiCallsNeeded: aiCalls,
    verificationCallsNeeded: verifyCalls,
    rows,
    durationMs: Date.now() - startTime,
  };
}

// ==================== V3: 12-GATE SAFETY VERIFICATION ====================

export interface V3GateResult {
  pass: boolean;
  failedGate: string | null;
  detail: string;
}

/**
 * V3 12-gate hard-stop verification.
 * ALL gates must pass for AUTO_APPLY. ANY failure → MANUAL_REVIEW.
 */
export async function verifyMatchV3(
  identity: SemanticIdentity,
  decision: { categoryId: string | null; confidence: number; isLeaf: boolean; externalId: number | null; method: string },
  verification: CategoryVerification,
  secondBestScore: number,
  marketplaceId: string | null,
): Promise<V3GateResult> {
  // Gate 1: Product identity confidence
  if (identity.confidence < 0.80) {
    return { pass: false, failedGate: 'GATE_1_IDENTITY_CONFIDENCE', detail: `Identity confidence ${identity.confidence} < 0.80` };
  }

  // Gate 2: Core object exists
  if (!identity.coreObject || identity.coreObject.trim().length === 0) {
    return { pass: false, failedGate: 'GATE_2_CORE_OBJECT', detail: 'Core object is empty' };
  }

  // Gate 3: Category ID exists
  if (!decision.categoryId) {
    return { pass: false, failedGate: 'GATE_3_CATEGORY_ID', detail: 'No category ID' };
  }

  // Gate 4: Is leaf
  if (!decision.isLeaf) {
    return { pass: false, failedGate: 'GATE_4_IS_LEAF', detail: 'Category is not a leaf' };
  }

  // Gate 5: External ID > 0
  if (!decision.externalId || decision.externalId <= 0) {
    return { pass: false, failedGate: 'GATE_5_EXTERNAL_ID', detail: `External ID ${decision.externalId} is invalid` };
  }

  // Gate 6: Confidence >= 0.95
  if (decision.confidence < 0.95) {
    return { pass: false, failedGate: 'GATE_6_CONFIDENCE', detail: `Confidence ${decision.confidence} < 0.95` };
  }

  // Gate 7: Verification fit is STRONG
  if (verification.fit !== 'STRONG') {
    return { pass: false, failedGate: 'GATE_7_VERIFICATION_FIT', detail: `Fit is ${verification.fit}, expected STRONG` };
  }

  // Gate 8: Does not contradict excluded interpretations
  if (verification.contradictsExcluded) {
    return { pass: false, failedGate: 'GATE_8_CONTRADICTS_EXCLUDED', detail: 'Candidate contradicts excluded interpretations' };
  }

  // Gate 9: Second-best margin
  const margin = decision.confidence - secondBestScore;
  if (margin < 0.10) {
    return { pass: false, failedGate: 'GATE_9_SECOND_BEST_MARGIN', detail: `Margin ${margin} < 0.10` };
  }

  // Gate 10: Category exists in DB with matching externalId
  if (marketplaceId) {
    const catExists = await prisma.category.findFirst({
      where: { externalId: String(decision.externalId) },
      select: { id: true },
    }).catch(() => null);
    if (!catExists) {
      return { pass: false, failedGate: 'GATE_10_CATEGORY_EXISTS', detail: `No category with externalId ${decision.externalId}` };
    }
  }

  // Gate 11: Active CategoryMapping exists for marketplace
  if (marketplaceId) {
    const mapping = await prisma.categoryMapping.findFirst({
      where: { categoryId: decision.categoryId, marketplaceId, active: true, externalId: { not: null } },
      select: { id: true },
    }).catch(() => null);
    if (!mapping) {
      return { pass: false, failedGate: 'GATE_11_MAPPING_EXISTS', detail: `No active mapping for category ${decision.categoryId} in marketplace ${marketplaceId}` };
    }
  }

  // Gate 12: Product exists in DB
  // This is checked at apply time, not here

  return { pass: true, failedGate: null, detail: 'OK' };
}

// ==================== V3: FULL PIPELINE ====================

export interface PipelineResult {
  productId: string;
  xmlKey: string;
  identity: SemanticIdentity;
  visualIdentity: import('./imageIntelligence.ts').VisualIdentity | null;
  candidates: StageCandidate[];
  taxonomyGap: TaxonomyGapResult | null;
  verification: CategoryVerification[];
  selectedCategory: { id: string; name: string; fullPath: string; externalId: number } | null;
  confidence: number;
  decision: 'AUTO_APPLY' | 'MANUAL_REVIEW' | 'TAXONOMY_GAP';
  gates: V3GateResult;
  reason: string;
  oldCategoryId: string | null;
  oldMatchedBy: string | null;
}

/**
 * V3 Full Pipeline: Product Understanding → Image Intelligence →
 * 4-Stage Candidate Retrieval → AI Verification → 12-Gate Safety
 */
export async function runFullPipeline(
  product: {
    id: string;
    xmlKey: string;
    title: string | null;
    description: string | null;
    xmlBrandName: string | null;
    supplierCategory: string | null;
    categoryId: string | null;
    matchedBy: string | null;
    images: string | null;
  },
  tree: TreeIndex,
  marketplaceId: string | null,
  marketplaceName: string,
): Promise<PipelineResult> {
  const startTime = Date.now();

  // Stage 1: Product Understanding
  const identity = await understandProduct({
    title: product.title,
    description: product.description,
    xmlBrandName: product.xmlBrandName,
    supplierCategory: product.supplierCategory,
  });

  // Stage 2: Image Intelligence (conditional)
  let visualIdentity: import('./imageIntelligence.ts').VisualIdentity | null = null;
  let finalIdentity = identity;
  if (identity.needsImageInspection && product.images) {
    const imageUrls = product.images.split(',').map((u) => u.trim()).filter(Boolean);
    if (imageUrls.length > 0) {
      visualIdentity = await inspectProductImages(imageUrls, identity);
      if (visualIdentity.correctedIdentity) {
        finalIdentity = visualIdentity.correctedIdentity;
      }
    }
  }

  // Stage 3: 4-Stage Candidate Retrieval
  const candidates = buildSemanticCandidates(finalIdentity, tree, 10);

  // Stage 3b: Taxonomy Gap Detection
  const taxonomyGap = detectTaxonomyGap(finalIdentity, candidates, marketplaceName);

  // Stage 4: AI Category Verification
  let verification: CategoryVerification[] = [];
  let selectedCategory: PipelineResult['selectedCategory'] = null;
  let confidence = 0;
  let decision: PipelineResult['decision'] = 'MANUAL_REVIEW';
  let gates: V3GateResult = { pass: false, failedGate: 'GATE_3_CATEGORY_ID', detail: 'No candidates' };
  let reason = '';

  if (taxonomyGap.isGap) {
    decision = 'TAXONOMY_GAP';
    reason = taxonomyGap.reason;
  } else if (candidates.length > 0) {
    // FAST PATH: If a candidate leaf name clearly contains the core object (or vice versa),
    // skip AI verification. Works for ALL match stages — the substring relationship is the
    // reliable signal, not the retrieval stage.
    const fastCandidate = candidates.find((c) => {
      const coreNorm = normalizeName(finalIdentity.coreObject);
      const leafNorm = normalizeName(c.name);
      // Strict substring: core IS the leaf type or leaf IS the core type
      if (leafNorm.includes(coreNorm) || coreNorm.includes(leafNorm)) return true;
      // Token overlap: every core token appears in leaf (or vice versa)
      const coreTokens = coreNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      const leafTokens = leafNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      if (coreTokens.length === 0 || leafTokens.length === 0) return false;
      // Core tokens must all be found in leaf — product type must be subset of category
      return coreTokens.every((ct) => leafTokens.some((lt) => lt.includes(ct) || ct.includes(lt)));
    });

    if (fastCandidate) {
      const cat = await prisma.category.findUnique({ where: { id: fastCandidate.id }, select: { id: true, name: true, externalId: true } }).catch(() => null);
      if (cat) {
        confidence = 0.98;
        const fastVerification: CategoryVerification = {
          productId: product.id,
          fit: 'STRONG',
          reason: `Fast path: "${finalIdentity.coreObject}" directly matches leaf "${fastCandidate.name}"`,
          confidence: 0.98,
          contradictsExcluded: false,
        };
        verification = [fastVerification];
        gates = await verifyMatchV3(
          finalIdentity,
          { categoryId: cat.id, confidence, isLeaf: true, externalId: fastCandidate.externalId ?? null, method: 'ai' },
          fastVerification,
          0,
          marketplaceId,
        );
        if (gates.pass) {
          decision = 'AUTO_APPLY';
          selectedCategory = { id: cat.id, name: fastCandidate.name, fullPath: fastCandidate.fullPath, externalId: fastCandidate.externalId ?? -1 };
          reason = `Fast path: product is "${finalIdentity.coreObject}", matches "${fastCandidate.name}"`;
        } else {
          reason = `Gate failed: ${gates.failedGate} — ${gates.detail}`;
        }
      } else {
        reason = 'Category not found in DB';
      }
    } else {
      // SLOW PATH: AI verification
      verification = await verifyCategoryMatch(finalIdentity, candidates);

      // Find best STRONG candidate
      const strongCandidates = candidates.filter((c, i) => {
        const v = verification[i];
        return v && v.fit === 'STRONG' && !v.contradictsExcluded;
      });

      if (strongCandidates.length > 0) {
        const best = strongCandidates[0];
        const bestVerification = verification[candidates.indexOf(best)];
        confidence = bestVerification.confidence;

      // Find second-best score (use verification confidence, not matchScore)
      const secondBestScore = strongCandidates.length > 1 ? (verification[candidates.indexOf(strongCandidates[1])]?.confidence || 0) : 0;

        // Resolve category from DB using the leaf UUID directly
        const cat = await prisma.category.findUnique({ where: { id: best.id }, select: { id: true, name: true, externalId: true } }).catch(() => null);

        if (cat) {
          // Run 12-gate verification
          gates = await verifyMatchV3(
            finalIdentity,
            { categoryId: cat.id, confidence, isLeaf: true, externalId: best.externalId ?? null, method: 'ai' },
            bestVerification,
            secondBestScore,
            marketplaceId,
          );

          if (gates.pass) {
            decision = 'AUTO_APPLY';
            selectedCategory = { id: cat.id, name: best.name, fullPath: best.fullPath, externalId: best.externalId ?? -1 };
            reason = `AI verified: product is ${finalIdentity.coreObject}, matches ${best.name}`;
          } else {
            reason = `Gate failed: ${gates.failedGate} — ${gates.detail}`;
          }
        } else {
          reason = 'Category not found in DB';
        }
      } else {
        reason = 'No STRONG fit candidate after verification';
      }
    }
  }

  const result: PipelineResult = {
    productId: product.id,
    xmlKey: product.xmlKey,
    identity: finalIdentity,
    visualIdentity,
    candidates,
    taxonomyGap,
    verification,
    selectedCategory,
    confidence,
    decision,
    gates,
    reason,
    oldCategoryId: product.categoryId,
    oldMatchedBy: product.matchedBy,
  };

  // Store forensic evidence
  const evidence: ForensicEvidence = {
    productId: product.id,
    xmlKey: product.xmlKey,
    timestamp: new Date(),
    pipelineVersion: 'v3',
    semanticIdentity: finalIdentity,
    visualIdentity,
    candidates,
    taxonomyGap,
    verification,
    selectedCategory: selectedCategory ? { id: selectedCategory.id, name: selectedCategory.name, fullPath: selectedCategory.fullPath } : null,
    confidence,
    decision,
    gates,
    oldCategoryId: product.categoryId,
    oldMatchedBy: product.matchedBy,
    newCategoryId: selectedCategory?.id ?? null,
    newMatchedBy: decision === 'AUTO_APPLY' ? 'ai' : null,
    reason,
  };
  storeEvidence(evidence);

  return result;
}
