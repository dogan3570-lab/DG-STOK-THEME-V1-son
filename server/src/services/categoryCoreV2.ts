/**
 * CATEGORY CORE V2 — PRODUCT-LEVEL ONLY
 * =====================================
 * INVARIANTS (ihlal = bug):
 *  1 ürün = 1 bağımsız karar. Karar YALNIZCA ürünün kendi verisinden üretilir.
 *  Hiçbir yerde updateMany / supplierCategory grubu / XML grubu propagation YOK.
 *  Batch yalnızca PERFORMANS içindir: PERFORMANCE_BATCH != DECISION_BATCH.
 *
 * Katmanlar:
 *  L1 EXACT_TAXONOMY_MATCH  : deterministik, normalize edilmiş XML kategori ↔
 *                             Trendyol LEAF eşleşmesi (conf=1.0, AI çağrılmaz)
 *  L2 CANONICAL CANDIDATE   : ürün başına resolveCategoryCandidates (title ağırlıklı)
 *  L3 AI PRODUCT MATCH      : ürün başına AI kararı (NO_SAFE_MATCH opsiyonlu)
 *  L4 STRICT VERIFIER       : YES/NO (fail-closed); UNCERTAIN/NO → MANUAL
 *  L5 GATES                 : leaf + mapping + confidence + margin + contradiction
 *  L6 PROVENANCE            : productId + categoryRunId + old/new + method + scope=PRODUCT
 *
 * FALSE_POSITIVE önceliği: coverage için threshold DÜŞÜRÜLMEZ.
 */
import { prisma } from '../db/prisma.ts';
import { loadTrendyolTree, verifyHighConfidence, type TreeIndex, type LeafInfo } from './categoryMatchEngine.ts';
import { resolveCategoryCandidates } from './categoryCanonical.ts';
import { matchCategoriesWithAI, type CategoryCandidate, type ProductForMatch } from './aiGateway.ts';
import { learnFromVerifiedDecision } from './categoryKnowledgeV2.ts';

// ==================== TYPES ====================

export type V2DecisionMethod =
  | 'EXACT_TAXONOMY_MATCH'
  | 'RULE_CANONICAL_SAFE'
  | 'AI_PRODUCT_VERIFIED'
  | 'MANUAL_USER_MATCH'
  | 'NO_SAFE_MATCH'
  | 'LOW_CONFIDENCE'
  | 'AMBIGUOUS_TAXONOMY';

export type V2Classification =
  | 'EXACT'
  | 'AI_SAFE'
  | 'CANONICAL_SAFE'
  | 'MANUAL_REVIEW'
  | 'NO_SAFE_MATCH'
  | 'PENDING_AI_VERIFICATION';

export interface V2Decision {
  productId: string;
  xmlKey: string;
  title: string | null;
  supplierCategory: string | null;
  oldCategoryId: string | null;
  newCategoryId: string | null;
  newCategoryName: string | null;
  decisionMethod: V2DecisionMethod | 'NEEDS_AI_VERIFICATION';
  decisionScope: 'PRODUCT';
  classification: V2Classification;
  isAuto: boolean;
  confidence: number;
  candidateRank: number;
  candidateScore: number;
  margin: number;
  verifierResult: 'YES' | 'NO' | 'UNCERTAIN' | 'DETERMINISTIC' | 'SKIPPED';
  model: string;
  taxonomyVersion: string;
  categoryRunId: string;
  reason: string;
}

interface ExactIndexEntry { leaf: LeafInfo }

interface V2Context {
  tree: TreeIndex;
  marketplaceId: string | null;
  marketplaceName: string | null;
  taxonomyVersion: string;
  categoryRunId: string;
  aiEnabled: boolean;
  exactByName: Map<string, LeafInfo[]>;
  genericLeafNames: Set<string>;
}

// ==================== HELPERS ====================

const GENERIC_LEAF_TOKENS = new Set([
  'diger', 'digerleri', 'genel', 'aksesuar', 'aksesuarlar', 'urun', 'urunler',
  'kozmetik', 'elektronik', 'hediye', 'tekstil', 'malzemeleri', 'seti',
]);

function foldTr(s: string): string {
  return s
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildExactIndexes(tree: TreeIndex): { byName: Map<string, LeafInfo[]>; generics: Set<string> } {
  const byName = new Map<string, LeafInfo[]>();
  const generics = new Set<string>();
  for (const leaf of tree.leaves) {
    if (!(leaf.externalId > 0)) continue; // sadece gerçek Trendyol leaf'leri
    const n = foldTr(leaf.name);
    if (!n) continue;
    const tokens = n.split(' ').filter(Boolean);
    // Jenerik/tek-kelime adlar exact-match için uygun değil (false-positive koruması)
    const isGeneric = tokens.length === 0 || GENERIC_LEAF_TOKENS.has(n.replace(/\s+/g, '')) || (tokens.length === 1 && n.length <= 4);
    if (isGeneric) generics.add(n);
    const arr = byName.get(n) || [];
    arr.push(leaf);
    byName.set(n, arr);
  }
  return { byName, generics };
}

/**
 * L1 — EXACT TAXONOMY MATCH (deterministik).
 * Ürünün XML kategorisinin EN SON segmenti (gerçek yaprak adı), normalize edilmiş
 * Trendyol leaf adlarından TAM BİR TANE ile birebir eşleşmeli.
 * - Birden fazla farklı leaf aynı ada sahipse → AMBIGUOUS (null + ambiguous=true)
 * - Jenerik/kısa tek-kelime adlar kabul edilmez (ör. "Diğer", "Seti")
 * - Parent kategori ASLA döndürülmez (sadece leaf havuzu kullanılır)
 */
function exactTaxonomyMatch(
  supplierCategory: string | null | undefined,
  ctx: V2Context,
): { leaf: LeafInfo | null; ambiguous: boolean } {
  const raw = (supplierCategory || '').trim();
  if (!raw) return { leaf: null, ambiguous: false };
  const segments = raw.split(/[>»]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return { leaf: null, ambiguous: false };
  const leafSegment = foldTr(segments[segments.length - 1]);
  if (!leafSegment) return { leaf: null, ambiguous: false };
  if (ctx.genericLeafNames.has(leafSegment)) return { leaf: null, ambiguous: false }; // jenerik → manual
  const hits = ctx.exactByName.get(leafSegment);
  if (!hits || hits.length === 0) return { leaf: null, ambiguous: false };
  const distinctIds = new Set(hits.map((h) => h.id));
  if (distinctIds.size > 1) return { leaf: null, ambiguous: true }; // çelişki → manual
  return { leaf: hits[0], ambiguous: false };
}

// ==================== CORE DECISION (1 PRODUCT = 1 DECISION) ====================

async function decideProductV2(
  p: { id: string; xmlKey: string; title: string | null; supplierCategory: string | null; xmlBrandName: string | null },
  ctx: V2Context,
): Promise<V2Decision> {
  const base: V2Decision = {
    productId: p.id,
    xmlKey: p.xmlKey,
    title: p.title,
    supplierCategory: p.supplierCategory,
    oldCategoryId: null,
    newCategoryId: null,
    newCategoryName: null,
    decisionMethod: 'NO_SAFE_MATCH',
    decisionScope: 'PRODUCT',
    classification: 'MANUAL_REVIEW',
    isAuto: false,
    confidence: 0,
    candidateRank: 0,
    candidateScore: 0,
    margin: 0,
    verifierResult: 'SKIPPED',
    model: 'rule-exact-v2',
    taxonomyVersion: ctx.taxonomyVersion,
    categoryRunId: ctx.categoryRunId,
    reason: '',
  };

  try {
    // ---------- L1: EXACT ----------
    const ex = exactTaxonomyMatch(p.supplierCategory, ctx);
    if (ex.ambiguous) {
      return { ...base, decisionMethod: 'AMBIGUOUS_TAXONOMY', classification: 'MANUAL_REVIEW', reason: 'XML kategori adi birden fazla Trendyol leaf ile eslesiyor (ambiguous)' };
    }
    if (ex.leaf) {
      return {
        ...base,
        newCategoryId: ex.leaf.id,
        newCategoryName: ex.leaf.name,
        decisionMethod: 'EXACT_TAXONOMY_MATCH',
        classification: 'EXACT',
        isAuto: true,
        confidence: 1.0,
        candidateRank: 1,
        candidateScore: 1.0,
        margin: 1.0,
        verifierResult: 'DETERMINISTIC',
        reason: `Normalize edilmis XML leaf adi "${foldTr(segmentsOf(p.supplierCategory))}" Trendyol leaf "${ex.leaf.name}" ile birebir eslesti`,
      };
    }

    // ---------- L2: PRODUCT-LEVEL CANDIDATES ----------
    const r = resolveCategoryCandidates(p, ctx.tree, ctx.marketplaceId);
    if (!r.topCandidate) {
      return { ...base, decisionMethod: 'NO_SAFE_MATCH', classification: r.method === 'no_source' ? 'NO_SAFE_MATCH' : 'MANUAL_REVIEW', reason: `Aday uretilemedi (${r.method})` };
    }
    const scores = r.candidates.map((c) => (c as unknown as { score?: number }).score ?? 0);
    const margin = scores.length > 1 ? scores[0] - scores[1] : 1;

    // ---------- L5a: deterministik guvenli oto (AI'siz, yalniz cok yuksek kesinlik) ----------
    // Kural motorunun tam-path/tam-leaf eslesmesi + aktif mapping + yuksek guven + belirgin margin
    if (
      (r.method === 'exact_leaf' || r.method === 'exact_path') &&
      r.mappingVerified &&
      r.confidence >= 0.95 &&
      margin >= 0.2
    ) {
      return {
        ...base,
        newCategoryId: r.topCandidate.id,
        newCategoryName: r.topCandidate.name,
        decisionMethod: 'RULE_CANONICAL_SAFE',
        classification: 'CANONICAL_SAFE',
        isAuto: true,
        confidence: r.confidence,
        candidateRank: 1,
        candidateScore: scores[0] ?? r.confidence,
        margin,
        verifierResult: 'DETERMINISTIC',
        reason: `Kural motoru tam eslesme (${r.method}), conf=${r.confidence.toFixed(2)}, margin=${margin.toFixed(2)}, mapping dogrulu`,
      };
    }

    // Guven/margin esigi alti → AUTO YASAK
    if (r.confidence < 0.6 || margin < 0.05) {
      return {
        ...base,
        decisionMethod: r.confidence < 0.6 ? 'LOW_CONFIDENCE' : 'AMBIGUOUS_TAXONOMY',
        classification: 'MANUAL_REVIEW',
        confidence: r.confidence,
        candidateRank: 1,
        candidateScore: scores[0] ?? r.confidence,
        margin,
        reason: `Guven/margin esigi alti (conf=${r.confidence.toFixed(2)}, margin=${margin.toFixed(2)})`,
      };
    }

    // ---------- L3/L4: AI (opsiyonel) ----------
    if (!ctx.aiEnabled) {
      return {
        ...base,
        decisionMethod: 'NEEDS_AI_VERIFICATION',
        classification: 'PENDING_AI_VERIFICATION',
        confidence: r.confidence,
        candidateRank: 1,
        candidateScore: scores[0] ?? r.confidence,
        margin,
        reason: 'Aday var; AI dogrulamasi bekliyor (bu koşuda AI kapali)',
      };
    }

    const cands: CategoryCandidate[] = r.candidates.slice(0, 15);
    const aiRes = await matchCategoriesWithAI(
      [{ id: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName ?? null, description: null } as ProductForMatch],
      new Map([[p.id, cands]]),
      ctx.marketplaceName,
    );
    if (!aiRes.ok || aiRes.matches.length === 0) {
      return { ...base, classification: 'MANUAL_REVIEW', decisionMethod: 'NO_SAFE_MATCH', confidence: r.confidence, margin, reason: `AI karar veremedi: ${aiRes.errorCode || aiRes.error || 'bos yanit'}` };
    }
    const m = aiRes.matches.find((x) => x.productId === p.id) || aiRes.matches[0];
    if (!m || !m.categoryId || m.decision === 'NO_SAFE_MATCH') {
      return { ...base, decisionMethod: 'NO_SAFE_MATCH', classification: 'NO_SAFE_MATCH', confidence: m?.confidence ?? r.confidence, margin, reason: 'AI guvenli eslesme bulamadi (NO_SAFE_MATCH)' };
    }
    const chosen = ctx.tree.leafById.get(m.categoryId);
    if (!chosen || !(chosen.externalId > 0)) {
      // AI gecerli bir leaf secmedi → asla otomatik yazilmaz
      return { ...base, decisionMethod: 'NO_SAFE_MATCH', classification: 'MANUAL_REVIEW', confidence: m.confidence, margin, reason: 'AI adayi gecerli Trendyol leaf degil (INVALID_LEAF)' };
    }
    // Margin kontrolu: AI secimi ilk aday degilse ve yakinsa → manual
    const rankIdx = cands.findIndex((c) => c.id === m.categoryId);
    const candRank = rankIdx >= 0 ? rankIdx + 1 : cands.length + 1;
    if (rankIdx > 0 && m.confidence < 0.95) {
      return { ...base, classification: 'MANUAL_REVIEW', decisionMethod: 'AMBIGUOUS_TAXONOMY', confidence: m.confidence, candidateRank: candRank, margin, reason: `AI ilk aday yerine #${candRank} adayi secti ve emin degil` };
    }
    // ---------- L4: STRICT VERIFIER ----------
    const vres = await verifyHighConfidence([{
      productId: p.id,
      title: p.title,
      supplierCategory: p.supplierCategory,
      categoryName: chosen.name,
      fullPath: chosen.fullPath,
    }]);
    const v = vres.get(p.id);
    if (!v || v.verdict !== true || v.confidence < 0.9) {
      return {
        ...base,
        classification: 'MANUAL_REVIEW',
        decisionMethod: 'NO_SAFE_MATCH',
        confidence: m.confidence,
        candidateRank: candRank,
        margin,
        verifierResult: v ? (v.verdict ? 'UNCERTAIN' : 'NO') : 'UNCERTAIN',
        model: aiRes.provider + ':' + aiRes.model,
        reason: `Verifier onaylamadi (${v ? v.reason : 'fail-closed'})`,
      };
    }
    return {
      ...base,
      newCategoryId: m.categoryId,
      newCategoryName: chosen.name,
      decisionMethod: 'AI_PRODUCT_VERIFIED',
      classification: 'AI_SAFE',
      isAuto: true,
      confidence: Math.min(m.confidence, v.confidence),
      candidateRank: candRank,
      candidateScore: scores[candIdxSafe(cands, m.categoryId)] ?? 0,
      margin,
      verifierResult: 'YES',
      model: aiRes.provider + ':' + aiRes.model,
      reason: `AI secim + STRICT verifier YES (v-conf=${v.confidence.toFixed(2)})`,
    };
  } catch (e) {
    return { ...base, classification: 'MANUAL_REVIEW', decisionMethod: 'NO_SAFE_MATCH', reason: `Hata (fail-closed): ${String(e).slice(0, 160)}` };
  }
}

function segmentsOf(s: string | null | undefined): string {
  const seg = (s || '').split(/[>»]+/).map((x) => x.trim()).filter(Boolean);
  return seg[seg.length - 1] || '';
}
function candIdxSafe(cands: CategoryCandidate[], id: string): number {
  const i = cands.findIndex((c) => c.id === id);
  return i;
}

// ==================== RUNNER ====================

export interface V2RunOptions {
  xmlSourceId?: string | null;
  limit?: number;
  apply?: boolean;          // false => DRY RUN (Product mutation YASAK)
  aiLimit?: number;         // kac urune AI calissin (maliyet kontrolu)
  includeMatched?: boolean; // true => legacy dahil tum urunler yeniden degerlendirilir
}

export interface V2RunMetrics {
  ok: boolean;
  categoryRunId: string;
  dryRun: boolean;
  totalEvaluated: number;
  exactTaxonomy: number;
  canonicalSafe: number;
  aiVerified: number;
  pendingAiVerification: number;
  manualReview: number;
  noSafeMatch: number;
  error: number;
  productLevelDecisions: number;
  groupDecisions: number;         // her zaman 0 olmali
  productMutations: number;       // apply modunda gerceklesen update sayisi
  groupMutations: number;         // her zaman 0 olmali
  noOpSkipped: number;            // idempotent atlama (ayni karar zaten mevcut)
  provenanceWritten: number;
  durationMs: number;
  decisions: V2Decision[];
}

export async function runCategoryCoreV2(opts: V2RunOptions): Promise<V2RunMetrics> {
  const t0 = Date.now();
  const categoryRunId = `CATEGORY_RUN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metrics: V2RunMetrics = {
    ok: true, categoryRunId, dryRun: !opts.apply, totalEvaluated: 0,
    exactTaxonomy: 0, canonicalSafe: 0, aiVerified: 0, pendingAiVerification: 0,
    manualReview: 0, noSafeMatch: 0, error: 0,
    productLevelDecisions: 0, groupDecisions: 0, productMutations: 0, groupMutations: 0,
    noOpSkipped: 0, provenanceWritten: 0, durationMs: 0, decisions: [],
  };

  const tree = await loadTrendyolTree();
  const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true, name: true } });
  const { byName, generics } = buildExactIndexes(tree);
  const ctx: V2Context = {
    tree,
    marketplaceId: ttMp?.id ?? null,
    marketplaceName: ttMp?.name ?? null,
    taxonomyVersion: `tt-leaves-${tree.leaves.length}`,
    categoryRunId,
    aiEnabled: false,
    exactByName: byName,
    genericLeafNames: generics,
  };

  const where: Record<string, unknown> = { status: { not: 'DELETED' } };
  if (opts.xmlSourceId) where.xmlSourceId = opts.xmlSourceId;
  if (!opts.includeMatched) where.categoryMatch = false;

  const products = await prisma.product.findMany({
    where,
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, categoryId: true, categoryMatch: true },
    take: Math.min(Math.max(opts.limit ?? 500, 1), 20000),
    orderBy: { createdAt: 'asc' },
  });

  let aiBudget = opts.aiLimit ?? 0;
  for (const p of products) {
    metrics.totalEvaluated++;
    const useAi = aiBudget > 0;
    if (useAi) { ctx.aiEnabled = true; aiBudget--; } else { ctx.aiEnabled = false; }
    const d = await decideProductV2(p, ctx);
    d.oldCategoryId = p.categoryId;
    metrics.decisions.push(d);

    // metrikler
    switch (d.classification) {
      case 'EXACT': metrics.exactTaxonomy++; break;
      case 'CANONICAL_SAFE': metrics.canonicalSafe++; break;
      case 'AI_SAFE': metrics.aiVerified++; break;
      case 'PENDING_AI_VERIFICATION': metrics.pendingAiVerification++; break;
      case 'NO_SAFE_MATCH': metrics.noSafeMatch++; break;
      default: metrics.manualReview++; break;
    }
    if (d.reason.startsWith('Hata')) metrics.error++;
    metrics.productLevelDecisions++; // HER karar ürün bazında üretildi

    // ---------- MUTATION (yalnız apply modunda; her zaman where:{id:productId}) ----------
    if (opts.apply && d.isAuto && d.newCategoryId) {
      if (p.categoryId === d.newCategoryId && p.categoryMatch === true) {
        metrics.noOpSkipped++; // idempotency: ayni karar → mutation yok
      } else {
        await prisma.product.update({
          where: { id: p.id }, // PRODUCT-LEVEL MUTATION (tek invariant)
          data: {
            categoryId: d.newCategoryId,
            categoryMatch: true,
            matchedBy: 'auto',
            lastMatchDate: new Date(),
            aiSuggestedCategoryId: d.newCategoryId,
            aiScore: d.confidence,
          },
        });
        metrics.productMutations++;
        // SELF-LEARNING: Learn from verified decision (confidence >= 0.95)
        if (d.confidence >= 0.95) {
          console.log(`[SELF-LEARN] runCategoryCoreV2 productId=${p.id} confidence=${d.confidence} method=${d.decisionMethod} targetCat=${d.newCategoryId}`);
          learnFromVerifiedDecision({
            productId: p.id,
            supplierCategory: p.supplierCategory ?? '',
            targetCategoryId: d.newCategoryId,
            targetCategoryName: d.newCategoryName ?? '',
            targetCategoryPath: '',
            targetExternalId: 0,
            categoryFamily: '',
            taxonomyVersion: ctx.taxonomyVersion,
            decisionMethod: d.decisionMethod as 'AI_PRODUCT_VERIFIED' | 'GROUP_MATCH' | 'RULE_CANONICAL_SAFE' | 'EXACT_TAXONOMY_MATCH',
            confidence: d.confidence,
          }, ctx.tree);
        }
      }
      // ---------- PROVENANCE (append-only, her AUTO karar icin) ----------
      await prisma.auditLog.create({
        data: {
          action: 'CATEGORY_CORE_V2_DECISION',
          entity: 'product',
          entityId: p.id,
          meta: JSON.stringify({
            categoryRunId: d.categoryRunId,
            productId: p.id,
            oldCategoryId: p.categoryId,
            newCategoryId: d.newCategoryId,
            decisionMethod: d.decisionMethod,
            decisionScope: 'PRODUCT',
            confidence: d.confidence,
            candidateRank: d.candidateRank,
            candidateScore: d.candidateScore,
            margin: d.margin,
            verifierResult: d.verifierResult,
            model: d.model,
            taxonomyVersion: d.taxonomyVersion,
          }),
          details: `V2 ${d.decisionMethod} -> ${d.newCategoryName}${metrics.dryRun ? ' [DRYRUN]' : ''}`,
        },
      });
      await prisma.aIDecisionLog.create({
        data: {
          productId: p.id,
          module: 'category_v2',
          suggestion: d.newCategoryId || '',
          confidence: d.confidence,
          reason: `${d.categoryRunId}|${d.decisionMethod}|verifier:${d.verifierResult}`,
          autoApplied: d.isAuto && !metrics.dryRun,
        },
      }).catch(() => null);
      metrics.provenanceWritten++;
    }
  }

  metrics.durationMs = Date.now() - t0;
  return metrics;
}

/** Frontend grup-aksiyonlarının yerini alan ürün-bazlı değerlendirme:
 *  her productId AYRI karar alır; aynı kategori çıkabilir ama karar granülaritesi PRODUCT'tır. */
export async function evaluateProductsIndividually(productIds: string[], apply: boolean) {
  const tree = await loadTrendyolTree();
  const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true, name: true } });
  const { byName, generics } = buildExactIndexes(tree);
  const ctx: V2Context = {
    tree,
    marketplaceId: ttMp?.id ?? null,
    marketplaceName: ttMp?.name ?? null,
    taxonomyVersion: `tt-leaves-${tree.leaves.length}`,
    categoryRunId: `CATEGORY_RUN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    aiEnabled: false,
    exactByName: byName,
    genericLeafNames: generics,
  };
  const out: V2Decision[] = [];
  let applied = 0;
  for (const pid of productIds.slice(0, 300)) {
    const p = await prisma.product.findUnique({
      where: { id: pid },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, categoryId: true, categoryMatch: true },
    });
    if (!p) continue;
    const d = await decideProductV2(p, ctx);
    d.oldCategoryId = p.categoryId;
    out.push(d);
    if (apply && d.isAuto && d.newCategoryId && !(p.categoryId === d.newCategoryId && p.categoryMatch === true)) {
      await prisma.product.update({
        where: { id: p.id },
        data: { categoryId: d.newCategoryId, categoryMatch: true, matchedBy: 'auto', lastMatchDate: new Date(), aiSuggestedCategoryId: d.newCategoryId, aiScore: d.confidence },
      });
      applied++;
      // SELF-LEARNING: Learn from verified decision (confidence >= 0.95)
      if (d.confidence >= 0.95) {
        const leafCheck = ctx.tree.leafById.get(d.newCategoryId);
        console.log(`[SELF-LEARN] productId=${p.id} confidence=${d.confidence} method=${d.decisionMethod} targetCat=${d.newCategoryId} leafExists=${!!leafCheck}`);
        learnFromVerifiedDecision({
          productId: p.id,
          supplierCategory: p.supplierCategory ?? '',
          targetCategoryId: d.newCategoryId,
          targetCategoryName: d.newCategoryName ?? '',
          targetCategoryPath: '',
          targetExternalId: 0,
          categoryFamily: '',
          taxonomyVersion: ctx.taxonomyVersion,
          decisionMethod: d.decisionMethod as 'AI_PRODUCT_VERIFIED' | 'GROUP_MATCH' | 'RULE_CANONICAL_SAFE' | 'EXACT_TAXONOMY_MATCH',
          confidence: d.confidence,
        }, ctx.tree);
      }
      await prisma.auditLog.create({
        data: {
          action: 'CATEGORY_CORE_V2_DECISION',
          entity: 'product',
          entityId: p.id,
          meta: JSON.stringify({
            categoryRunId: ctx.categoryRunId, productId: p.id, oldCategoryId: p.categoryId,
            newCategoryId: d.newCategoryId, decisionMethod: d.decisionMethod, decisionScope: 'PRODUCT',
            confidence: d.confidence, verifierResult: d.verifierResult, model: d.model, taxonomyVersion: ctx.taxonomyVersion,
          }),
          details: `V2(evaluate) ${d.decisionMethod} -> ${d.newCategoryName}`,
        },
      });
    }
  }
  const distinctCategories = new Set(out.filter((d) => d.isAuto).map((d) => d.newCategoryId)).size;
  return { categoryRunId: ctx.categoryRunId, decisions: out, applied, distinctCategories, groupMutations: 0 };
}
