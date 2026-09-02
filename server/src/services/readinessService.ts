import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { isPrepComplete, isVariantComplete } from './readiness.ts';
import { invalidateProductsStats } from './productsStatsCache.ts';
import { getPrepStockRange, isWithinPrepRange } from './stockAutomation.ts';
import { invalidateTitleIndex } from './titleSearchIndex.ts';
import { detectVariantAttributes } from './readiness.ts';
import { fetchTrendyolBrands } from './trendyolCatalog.ts';
import { normalizeName } from './categoryBrandMapper.ts';

export interface ReconcileContext {
  xmlSourceId: string | null;
  marketplaceId: string;
  tx?: Prisma.TransactionClient;
}

/**
 * FIX(F-10): Route/service'lerdeki `reconcileProductGates(id).catch(...)` çağrıları
 * sınırsız sayıda paralel Prisma bağlantısı/promise üretebiliyordu (ör. 13K ürünlük
 * toplu işlemler). Bu kuyruk aynı ürün için mükerrer girişi tekilleştirir ve
 * eşzamanlılığı RECONCILE_CONCURRENCY ile sınırlar. Çağrı semantiği aynıdır:
 * non-blocking, hatalar yutulur, sonuç idempotent.
 */
const RECONCILE_CONCURRENCY = 4;
const _reconcileQueue: string[] = [];
const _reconcileQueued = new Map<string, number>(); // productId → timestamp (TTL cooldown)
const RECONCILE_COOLDOWN_MS = 30_000; // 30s cooldown before re-queue allowed
let _reconcileActive = 0;

function pumpReconcileQueue(): void {
  while (_reconcileActive < RECONCILE_CONCURRENCY && _reconcileQueue.length > 0) {
    const productId = _reconcileQueue.shift() as string;
    // Cooldown entry is NOT deleted here — it persists for RECONCILE_COOLDOWN_MS
    // to prevent rapid re-queueing. TTL cleanup happens in isReconcileCooldownActive().
    _reconcileActive++;
    reconcileProductGates(productId)
      .catch(() => null)
      .finally(() => {
        _reconcileActive--;
        // TASK313-R3: reconcile sonrası ürün havuzu KPI cache'i tazele (DB=API=UI parity)
        try { invalidateProductsStats(); } catch { /* noop */ }
        invalidateTitleIndex().catch(() => null); // non-blocking title index refresh
        pumpReconcileQueue();
      });
  }
}

function isReconcileCooldownActive(productId: string): boolean {
  const ts = _reconcileQueued.get(productId);
  if (ts === undefined) return false;
  if (Date.now() - ts < RECONCILE_COOLDOWN_MS) return true;
  // Cooldown expired — allow re-queue
  _reconcileQueued.delete(productId);
  return false;
}

export function queueReconcileProductGates(productId: string): void {
  if (!productId || isReconcileCooldownActive(productId)) return;
  _reconcileQueued.set(productId, Date.now());
  _reconcileQueue.push(productId);
  pumpReconcileQueue();
}

export function queueReconcileProductGatesBulk(productIds: string[]): void {
  if (!productIds || productIds.length === 0) return;
  let hasNew = false;
  for (const pid of productIds) {
    if (!pid || isReconcileCooldownActive(pid)) continue;
    _reconcileQueued.set(pid, Date.now());
    _reconcileQueue.push(pid);
    hasNew = true;
  }
  if (hasNew) pumpReconcileQueue();
}

// ==================== P1-1: BRAND EXTERNAL ID CACHE ====================
const TRENDYOL_BRANDS_CACHE_TTL_MS = 300_000; // 5 minutes
const TRENDYOL_BRANDS_PAGE_SIZE = 1000;
const TRENDYOL_BRANDS_MAX_PAGES = 100; // safety guard: 100 × 1000 = 100K brands max
let _trendyolBrandsCache: { data: Array<{ id: number; name: string }>; ts: number } | null = null;

async function getTrendyolBrandsCached(): Promise<Array<{ id: number; name: string }>> {
  if (_trendyolBrandsCache && Date.now() - _trendyolBrandsCache.ts < TRENDYOL_BRANDS_CACHE_TTL_MS) {
    return _trendyolBrandsCache.data;
  }
  try {
    const all: Array<{ id: number; name: string }> = [];
    for (let page = 0; page < TRENDYOL_BRANDS_MAX_PAGES; page++) {
      const chunk = await fetchTrendyolBrands(page, TRENDYOL_BRANDS_PAGE_SIZE);
      if (chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < TRENDYOL_BRANDS_PAGE_SIZE) break;
    }
    _trendyolBrandsCache = { data: all, ts: Date.now() };
    return all;
  } catch {
    return _trendyolBrandsCache?.data ?? [];
  }
}

async function ensureBrandExternalId(brandId: string, tx: Prisma.TransactionClient = prisma): Promise<void> {
  const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, externalId: true } });
  if (!brand || brand.externalId) return; // already set or not found
  const trendyolBrands = await getTrendyolBrandsCached();
  if (trendyolBrands.length === 0) return; // API unavailable
  const normalizedName = normalizeName(brand.name);
  if (!normalizedName) return;
  const match = trendyolBrands.find(b => normalizeName(b.name) === normalizedName);
  if (!match) return; // no exact match found
  await tx.brand.update({ where: { id: brandId }, data: { externalId: String(match.id) } });
}

/**
 * Lifecycle reconcile: call after any gate-write (category, brand, variant, template, PMS, price).
 * Automatically resolves xmlSourceId + marketplaceId from the product's PMS.
 * Idempotent — safe to call multiple times for the same product.
 * Uses global prisma (non-transactional). For transactional paths, use reconcileReadiness() directly.
 */
export async function reconcileProductGates(productId: string): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      xmlSourceId: true,
      brandId: true,
      marketplaceStates: { select: { marketplaceId: true }, take: 1 },
    },
  });
  // P1 FIX: marketplaceStates boş olsa da reconcileReadiness çalışmalı (aile tespiti için).
  // reconcileReadiness kendi içinde hasPms kontrolünü yapıyor.
  if (!product) return false;

  // P1-1: Brand.externalId population — Trendyol send gate requires numeric brandId
  if (product.brandId) {
    ensureBrandExternalId(product.brandId).catch(() => null); // non-blocking
  }

  return reconcileReadiness(productId, {
    xmlSourceId: product.xmlSourceId,
    marketplaceId: product.marketplaceStates[0]?.marketplaceId,
  });
}

/**
 * P1: Variant aile tespiti.
 * Aynı brand + yüksek title benzerliği + bilinen SKU suffix → aile kanıtı.
 * Solo ürün title'dan variant tespiti yeterli değilse (ör: "Beden X" pattern) kardeş ürünleri kontrol eder.
 */
const KNOWN_ATTR_SUFFIXES = new Set([
  'XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL','5XL',
  'BLK','BLU','RED','WHT','GRN','YEL','PRP','ORG','PNK','GRY','BRN','NVY',
  'STANDART','KRAL',
]);

interface FamilyEvidence {
  isFamily: boolean;
  confidence: number;
  reason: string;
}

export async function detectVariantFamily(
  productId: string,
  brandId: string | null,
  title: string | null,
  sku: string | null,
  client: Prisma.TransactionClient = prisma,
): Promise<FamilyEvidence> {
  if (!brandId || !title) return { isFamily: false, confidence: 0, reason: 'NO_BRAND_OR_TITLE' };

  // TITLE KEYWORD PATTERN: Title'dan marka ve ortak kelimeleri çıkar, ürün adını bul
  // "HOBİBAHÇEM ® Coremed Bimel S Beden Pudrali Muayene Eldiveni 100LU"
  // → keywords: "coremed", "bimel", "beden", "pudrali", "muayene", "eldiveni"
  const STOP_WORDS = new Set(['hobi','bahcem','bahçem','hobibahçem','®','ob','modül','standart','klral','100lu','100','adet','li','lik','lu','lü','model','yeni','nesil']);
  const words = title.toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, ' ').trim().split(/\s+/);
  const keywords = words.filter(w => w.length >= 3 && !STOP_WORDS.has(w)).slice(0, 8);

  if (keywords.length >= 2) {
    // En az 2 keyword ile kardeş ürün ara
    const keywordConditions = keywords.map(k => ({ title: { contains: k } }));
    const siblingsByKey = await client.product.findMany({
      where: {
        brandId,
        id: { not: productId },
        AND: keywordConditions.slice(0, 3), // İlk 3 keyword'ü kullan
      },
      select: { id: true, title: true, sku: true },
      take: 20,
    });

    if (siblingsByKey.length > 0) {
      // Keyword eşleşmesi var → title benzerliği hesapla
      const normTitle = title.toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, ' ').trim().slice(0, 50);
      let bestKeywordScore = 0;
      let bestKeywordReason = '';

      for (const sib of siblingsByKey) {
        if (!sib.title) continue;
        const normSib = sib.title.toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, ' ').trim().slice(0, 50);

        let match = 0;
        const maxLen = Math.max(normTitle.length, normSib.length);
        for (let i = 0; i < Math.min(normTitle.length, normSib.length); i++) {
          if (normTitle[i] === normSib[i]) match++;
        }
        const sim = maxLen > 0 ? match / maxLen : 0;

        if (sim < 0.6) continue;

        let score = 0;
        const reasons: string[] = [];

        if (sim > 0.85) { score += 30; reasons.push('HIGH_TITLE_SIM(' + sim.toFixed(2) + ')'); }
        else if (sim > 0.7) { score += 20; reasons.push('MED_TITLE_SIM(' + sim.toFixed(2) + ')'); }

        // SKU suffix kontrolü
        if (sku && sib.sku) {
          const mySuffix = sku.split(/[-_\s]+/).pop()?.toUpperCase() || '';
          const sibSuffix = sib.sku.split(/[-_\s]+/).pop()?.toUpperCase() || '';
          if (mySuffix !== sibSuffix && KNOWN_ATTR_SUFFIXES.has(mySuffix) && KNOWN_ATTR_SUFFIXES.has(sibSuffix)) {
            score += 30;
            reasons.push('KNOWN_SUFFIX(' + mySuffix + '/' + sibSuffix + ')');
          } else if (mySuffix !== sibSuffix && /^\d+$/.test(mySuffix) && /^\d+$/.test(sibSuffix)) {
            const myPrefix = sku.split(/[-_\s]+/).slice(0, -1).join('-');
            const sibPrefix = sib.sku.split(/[-_\s]+/).slice(0, -1).join('-');
            if (myPrefix === sibPrefix) {
              score += 30;
              reasons.push('NUMERIC_SUFFIX(' + mySuffix + '/' + sibSuffix + ')');
            }
          }
        }

        // Title'da attribute keyword
        const attrKeywords = ['beden', 'renk', 'numara', 'boyut'];
        const hasKeyword = attrKeywords.some(k => normTitle.includes(k) || normSib.includes(k));
        if (hasKeyword) { score += 15; reasons.push('ATTR_KEYWORD'); }

        // Solo ürün variant kanıtı yoksa ama benzer yüksekse
        const soloAttrs = detectVariantAttributes(title);
        const sibAttrs = detectVariantAttributes(sib.title ?? '');
        if (soloAttrs.length === 0 && sibAttrs.length === 0 && sim > 0.8) {
          score += 15;
          reasons.push('BOTH_NO_SOLO_ATTR');
        }

        if (score > bestKeywordScore) {
          bestKeywordScore = score;
          bestKeywordReason = reasons.join('+');
        }
      }

      const confidence = Math.min(bestKeywordScore, 100);
      if (confidence >= 50) {
        return { isFamily: true, confidence, reason: 'TITLE_KEYWORD:' + bestKeywordReason };
      }
    }
  }

  // FALLBACK: SKU prefix alone (bilinen suffix varsa)
  if (sku) {
    const parts = sku.split(/[-_\s]+/);
    if (parts.length >= 2) {
      const prefix = parts.slice(0, -1).join('-');
      const siblingsByPrefix = await client.product.findMany({
        where: {
          brandId,
          id: { not: productId },
          sku: { startsWith: prefix },
        },
        select: { id: true, title: true, sku: true },
        take: 20,
      });

      if (siblingsByPrefix.length > 0) {
        let score = 30;
        const reasons: string[] = ['SKU_PREFIX(' + prefix + ')'];

        const mySuffix = parts[parts.length - 1].toUpperCase();
        const suffixDiffs = siblingsByPrefix.filter(s => {
          const sibParts = (s.sku || '').split(/[-_\s]+/);
          const sibSuffix = sibParts[sibParts.length - 1]?.toUpperCase() || '';
          return sibSuffix !== mySuffix && KNOWN_ATTR_SUFFIXES.has(sibSuffix);
        });

        if (suffixDiffs.length > 0) {
          score += 30;
          reasons.push('KNOWN_SUFFIX(' + mySuffix + '/' + suffixDiffs[0].sku?.split(/[-_\s]+/).pop() + ')');
        } else {
          const numericSuffixDiffs = siblingsByPrefix.filter(s => {
            const sibParts = (s.sku || '').split(/[-_\s]+/);
            const sibSuffix = sibParts[sibParts.length - 1] || '';
            return sibSuffix !== mySuffix && /^\d+$/.test(sibSuffix) && /^\d+$/.test(mySuffix);
          });
          if (numericSuffixDiffs.length > 0) {
            score += 30;
            reasons.push('NUMERIC_SUFFIX(' + mySuffix + '/' + numericSuffixDiffs[0].sku?.split(/[-_\s]+/).pop() + ')');
          }
        }

        const attrKeywords = ['beden', 'renk', 'numara', 'boyut'];
        if (attrKeywords.some(k => title.toLowerCase().includes(k))) {
          score += 15;
          reasons.push('ATTR_KEYWORD');
        }

        const confidence = Math.min(score, 100);
        if (confidence >= 50) {
          return { isFamily: true, confidence, reason: reasons.join('+') };
        }
      }
    }
  }

  // Son çare: Geniş title benzerliği (max 200)
  const siblings = await client.product.findMany({
    where: {
      brandId,
      id: { not: productId },
      variantStatus: 'NOT_REQUIRED',
    },
    select: { id: true, title: true, sku: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  if (siblings.length === 0) return { isFamily: false, confidence: 0, reason: 'NO_SIBLINGS' };

  const normTitle = title.toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, ' ').trim().slice(0, 50);
  let bestScore = 0;
  let bestReason = '';

  for (const sib of siblings) {
    if (!sib.title) continue;
    const normSib = sib.title.toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, ' ').trim().slice(0, 50);

    let match = 0;
    const maxLen = Math.max(normTitle.length, normSib.length);
    for (let i = 0; i < Math.min(normTitle.length, normSib.length); i++) {
      if (normTitle[i] === normSib[i]) match++;
    }
    const sim = maxLen > 0 ? match / maxLen : 0;

    if (sim < 0.6) continue;

    let score = 0;
    const reasons: string[] = [];

    if (sim > 0.85) { score += 30; reasons.push('HIGH_TITLE_SIM(' + sim.toFixed(2) + ')'); }
    else if (sim > 0.7) { score += 20; reasons.push('MED_TITLE_SIM(' + sim.toFixed(2) + ')'); }

    if (sku && sib.sku) {
      const mySuffix = sku.split(/[-_\s]+/).pop()?.toUpperCase() || '';
      const sibSuffix = sib.sku.split(/[-_\s]+/).pop()?.toUpperCase() || '';
      if (mySuffix !== sibSuffix && KNOWN_ATTR_SUFFIXES.has(mySuffix) && KNOWN_ATTR_SUFFIXES.has(sibSuffix)) {
        score += 30;
        reasons.push('KNOWN_SUFFIX(' + mySuffix + '/' + sibSuffix + ')');
      }
    }

    const attrKeywords = ['beden', 'renk', 'numara', 'boyut'];
    const hasKeyword = attrKeywords.some(k => normTitle.includes(k) || normSib.includes(k));
    if (hasKeyword) { score += 15; reasons.push('ATTR_KEYWORD'); }

    const soloAttrs = detectVariantAttributes(title);
    const sibAttrs = detectVariantAttributes(sib.title ?? '');
    if (soloAttrs.length === 0 && sibAttrs.length === 0 && sim > 0.8) {
      score += 15;
      reasons.push('BOTH_NO_SOLO_ATTR');
    }

    if (score > bestScore) {
      bestScore = score;
      bestReason = reasons.join('+');
    }
  }

  const confidence = Math.min(bestScore, 100);
  return {
    isFamily: confidence >= 50,
    confidence,
    reason: bestReason || 'NO_MATCH',
  };
}

/**
 * Evaluate a single product and promote/demote its status atomically.
 * Returns true if status changed.
 */
export async function reconcileReadiness(productId: string, ctx: ReconcileContext): Promise<boolean> {
  const client = ctx.tx ?? prisma;

  // Fetch product with needed fields, PMS existence, and salePrice
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      status: true,
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantMatch: true,
      variantStatus: true,
      xmlSourceId: true,
      salePrice: true,
      categoryId: true,
      stock: true,
      title: true,
      sku: true,
      brandId: true,
      marketplaceStates: {
        where: { marketplaceId: ctx.marketplaceId },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!product) return false;

  // Context isolation: ensure product belongs to the requested xmlSource
  // FIX(R-C2): xmlSourceId NULL ürünlerde de mapping gate'i uygulanmalı;
  // null kaynakta context-isolation anlamsızdır.
  if (product.xmlSourceId && product.xmlSourceId !== ctx.xmlSourceId) return false;

  // P1: Variant aile tespiti — NOT_REQUIRED ise kardeş ürünleri kontrol et
  if (product.variantStatus === 'NOT_REQUIRED' && !product.variantMatch && product.brandId && product.title) {
    const family = await detectVariantFamily(product.id, product.brandId, product.title, product.sku ?? null, client);
    if (family.isFamily && family.confidence >= 50) {
      // DB'ye yaz (state change Persist)
      await client.product.update({
        where: { id: productId },
        data: { variantStatus: 'WAITING_AI' },
      });
      // variantStatus değişti, allGates'i yeniden hesapla
      product.variantStatus = 'WAITING_AI';
    }
  }

  // P1-1: Brand.externalId population — Trendyol send gate requires numeric brandId.
  // Promote'dan önce garanti altına al.
  if (product.brandId) {
    await ensureBrandExternalId(product.brandId, client).catch(() => null);
  }

  const hasPms = product.marketplaceStates.length > 0;
  const allGates = isPrepComplete({
    status: product.status,
    categoryMatch: product.categoryMatch,
    brandMatch: product.brandMatch,
    templateMatch: product.templateMatch,
    variantMatch: product.variantMatch,
    variantStatus: product.variantStatus,
  });

  const currentlyReady = product.status === 'READY';
  const prepRange = await getPrepStockRange();
  // FIX(R-C): READY ⇔ aktif Trendyol CategoryMapping zorunlu (state drift kapanışı).
  // FIX(313-R3): categoryId NULL ise mapping ARANMAZ (Prisma validation error fırlatıyordu ve
  // queue hatayı yuttuğu için unmatch sonrası READY ürünler havuzda kalıyordu — fail-open).
  const hasActiveMapping = !!(
    product.categoryId &&
    (await client.categoryMapping.findFirst({ where: { categoryId: product.categoryId, marketplaceId: ctx.marketplaceId, active: true }, select: { id: true } }))
  );
  const stockEligible = isWithinPrepRange(product.stock ?? 0, prepRange.min, prepRange.max);
  const shouldBeReady = hasPms && allGates && product.salePrice != null && stockEligible && hasActiveMapping;

  if (currentlyReady && !shouldBeReady) {
    // Demote
    await client.product.update({
      where: { id: productId, status: 'READY' },
      data: { status: 'XML' },
    });
    return true;
  }

  if (!currentlyReady && shouldBeReady && product.status === 'XML') {
    // Promote
    await client.product.update({
      where: { id: productId, status: 'XML' },
      data: { status: 'READY' },
    });
    return true;
  }

  return false;
}

/**
 * Batch reconcile for a context (used by /recheck endpoint and recovery script).
 * Processes in batches, each batch inside its own transaction.
 */
export async function reconcileBatch(ctx: ReconcileContext, batchSize = 500): Promise<{ promoted: number; demoted: number; checked: number }> {
  let promoted = 0;
  let demoted = 0;
  let checked = 0;
  let cursor: string | undefined;

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        xmlSourceId: ctx.xmlSourceId,
        marketplaceStates: { some: { marketplaceId: ctx.marketplaceId } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        categoryId: true,
        id: true,
        status: true,
        categoryMatch: true,
        brandMatch: true,
        templateMatch: true,
        variantMatch: true,
        variantStatus: true,
        salePrice: true,
      stock: true,
      brandId: true,
      title: true,
      sku: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    if (products.length === 0) break;

    // Process this batch inside a transaction
    // FIX(2M): prepRange batch başına 1 kez yüklenir (N+1 kaldırıldı)
    const prepRange = await getPrepStockRange();
    // FIX(2M): Aktif mapping'leri toplu yükle (N+1 kaldırıldı)
    const categoryIds = [...new Set(products.filter(p => p.categoryId).map(p => p.categoryId as string))];
    const activeMappings = await prisma.categoryMapping.findMany({
      where: { categoryId: { in: categoryIds }, marketplaceId: ctx.marketplaceId, active: true },
      select: { categoryId: true },
    });
    const activeMappingSet = new Set(activeMappings.map(m => m.categoryId));

    await prisma.$transaction(async (tx) => {
      for (const p of products) {
        // P0-3 FIX: Detect variant family for products without resolved variant status
        const RESOLVED_VARIANT_STATES = ['WAITING_AI', 'MANUAL_REVIEW', 'COMPLETED', 'AI_MATCH', 'AUTO_MATCH', 'FAILED'];
        const needsFamilyDetection = !p.variantMatch && !RESOLVED_VARIANT_STATES.includes(p.variantStatus ?? '');

        let variantOk: boolean;
        if (needsFamilyDetection) {
          const family = await detectVariantFamily(p.id, p.brandId ?? null, p.title ?? null, p.sku ?? null, tx);
          if (family.isFamily) {
            variantOk = false;
            await tx.product.update({ where: { id: p.id }, data: { variantStatus: 'WAITING_AI' } });
          } else {
            variantOk = true;
            await tx.product.update({ where: { id: p.id }, data: { variantStatus: 'NOT_REQUIRED' } });
          }
        } else {
          variantOk = p.variantMatch === true || p.variantStatus === 'NOT_REQUIRED';
        }

        const activeMapping = p.categoryId ? activeMappingSet.has(p.categoryId) : false;
        const allGates = p.categoryMatch && p.brandMatch && p.templateMatch && variantOk;
        const currentlyReady = p.status === 'READY';
        const stockEligible = isWithinPrepRange(p.stock ?? 0, prepRange.min, prepRange.max);
        const shouldBeReady = allGates && p.salePrice != null && stockEligible && activeMapping; // PMS already guaranteed by the query

        if (currentlyReady && !shouldBeReady) {
          await tx.product.update({ where: { id: p.id, status: 'READY' }, data: { status: 'XML' } });
          demoted++;
        } else if (!currentlyReady && shouldBeReady && p.status === 'XML') {
          await tx.product.update({ where: { id: p.id, status: 'XML' }, data: { status: 'READY' } });
          promoted++;
        }
        checked++;
      }
    });

    cursor = products[products.length - 1].id;
    if (products.length < batchSize) break;
  }

  return { promoted, demoted, checked };
}
