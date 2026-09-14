import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { isReady, isPrepComplete, isVariantComplete, READY_FILTER } from '../services/readiness.ts';
import { evaluateReadiness, autoTransitionReadiness, buildProductWhere, type DispatchContext, type DispatchStats } from '../services/dispatchEngine.ts';
import { getDispatchPricing, getBatchDispatchPricing } from '../services/dispatchPricing.ts';
import { createDispatchJob, startDispatchJob, populateMarketplaceNames, updateProgress, completeDispatchJob, getDispatchJob, listDispatchJobs, createProgressStream } from '../services/dispatchProgress.ts';
import { sendProductToMarketplace, sendBatchToMarketplace, updateMarketplaceProductInventory, checkMarketplaceHealth } from '../services/marketplaceAdapter.ts';
import { resolveListingTemplate, hasListingTemplate } from '../services/listingTemplateResolver.ts';
import { resolveListingPrice } from '../services/listingPriceResolver.ts';
import {reconcileReadiness, reconcileProductGates, queueReconcileProductGates, detectVariantFamily} from '../services/readinessService.ts';
import { invalidateProductsStatsCache } from './products.ts';
import { getOperationalMarketplaceIds, isMarketplaceOperational } from '../services/marketplaceTruth.ts';
import { requestTemplateSync, getTemplateSyncStatus } from '../services/templateSyncService.ts';
import { computeVatIncludedPurchasePrice } from './products.ts';
import { getPrepStockRange, isWithinPrepRange } from '../services/stockAutomation.ts';
import { fetchTrendyolCategoryAttributes } from '../services/trendyolCatalog.ts';
import { resolveTrendyolAttributes } from '../services/trendyolVariantResolver.ts';
import { normalizeName } from '../services/categoryBrandMapper.ts';

// SEND-CENTER: insan-okur kural açıklaması (değerler DB MarketplacePricingRule'dan gelir, hardcode YOK).
function describePricingRule(r?: { minPrice: number; maxPrice: number; profitMargin: number; fixedAmount: number } | null): string {
  if (!r) return 'Kural yok';
  const parts: string[] = [];
  if (r.profitMargin) parts.push(`%${String(r.profitMargin).replace(/\.0+$/, '')}`);
  if (r.fixedAmount) parts.push(`${String(r.fixedAmount).replace(/\.0+$/, '')} TL`);
  const band = r.maxPrice > 0 ? `${r.minPrice}-${r.maxPrice} bandı` : 'tüm fiyatlar';
  return parts.length > 0 ? `${parts.join(' + ')} · ${band}` : `Kâr kuralı tanımlı değil · ${band}`;
}

const router = Router();

// ==================== HELPERS ====================

function parseContext(req: Request): { xmlSourceIds: string[]; marketplaceIds: string[] } {
  const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
  const marketplaceId = req.query?.marketplaceId ? String(req.query.marketplaceId) : null;
  const xmlSourceIds = req.query?.xmlSourceIds ? String(req.query.xmlSourceIds).split(',').filter(Boolean) : (xmlSourceId ? [xmlSourceId] : []);
  const marketplaceIds = req.query?.marketplaceIds ? String(req.query.marketplaceIds).split(',').filter(Boolean) : (req.query?.marketplaceId ? [String(req.query.marketplaceId)] : []);

  return {
    xmlSourceIds: xmlSourceIds.filter(Boolean),
    marketplaceIds: marketplaceIds.filter(Boolean),
  };
}

// Use imported buildProductWhere from dispatchEngine.ts

// ==================== TEMPLATE MATCH SYNC ====================

/**
 * Sync templateMatch field for products based on actual template availability.
 * This corrects the stale templateMatch field using actual template resolution logic.
 *
 * Two modes:
 * 1. With marketplaceIds: resolve against specified marketplaces, include products with PMS
 * 2. Without marketplaceIds (no-context): resolve against ALL active marketplaces,
 *    include ALL products with templateMatch=false (even those without any PMS).
 *
 * Batched for safety (500 per batch).
 */
async function syncTemplateMatch(context: { xmlSourceIds?: string[]; marketplaceIds?: string[] }): Promise<number> {
  // Get operational marketplace IDs for resolution
  const operationalMpIds = await getOperationalMarketplaceIds();

  if (operationalMpIds.length === 0) return 0;

  // Resolve against specific marketplace(s) or all operational ones
  const resolveMpIds = context.marketplaceIds?.length
    ? context.marketplaceIds.filter(id => operationalMpIds.includes(id))
    : operationalMpIds;

  if (resolveMpIds.length === 0) return 0;

  let updated = 0;
  const BATCH = 500;

  // Build where clause:
  // - templateMatch=false (stale field)
  // - xmlSource filter if provided
  // - PMS filter: if marketplaceIds provided, require PMS for those; otherwise include ALL (including no-PMS)
  const baseWhere: Record<string, unknown> = {
    templateMatch: false,
    ...(context.xmlSourceIds?.length ? { xmlSourceId: { in: context.xmlSourceIds } } : {}),
  };

  if (context.marketplaceIds?.length) {
    // Context-aware: only products with PMS for specified marketplaces
    (baseWhere as any).marketplaceStates = { some: { marketplaceId: { in: context.marketplaceIds } } };
  }
  // else: no-context — include ALL products with templateMatch=false (no PMS filter)

  // Process in batches
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const products = await prisma.product.findMany({
      where: baseWhere,
      select: { id: true, categoryId: true },
      skip: offset,
      take: BATCH,
    });

    if (products.length === 0) {
      hasMore = false;
      break;
    }

    for (const p of products) {
      // Try each active marketplace until a template is found
      let resolved = false;
      for (const mpId of resolveMpIds) {
        const result = await resolveListingTemplate({
          productId: p.id,
          categoryId: p.categoryId,
          marketplaceId: mpId,
        });
        if (hasListingTemplate(result)) {
          resolved = true;
          break;
        }
      }
      if (resolved) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: true },
        });
        queueReconcileProductGates(p.id);
        updated++;
        // TASK313-R3: ürün havuzu KPI cache'i bayatlamasın
        invalidateProductsStatsCache();
      }
    }

    offset += products.length;
    if (products.length < BATCH) hasMore = false;
  }

  return updated;
}

/**
 * Batch reconcile stuck products: 4/4 gates PASS + hasPms + status=XML → READY.
 * This is the missing piece — reconcileReadiness() was only called in prepCategories,
 * not in brand/template/variant/PMS creation paths. 4,308 products stuck.
 * Runs on every product list request (same pattern as syncTemplateMatch).
 */
export async function syncReconcileStatus(context: { xmlSourceIds?: string[]; marketplaceIds?: string[] }): Promise<number> {
  const operationalMpIds = await getOperationalMarketplaceIds();
  if (operationalMpIds.length === 0) return 0;

  const resolveMpIds = context.marketplaceIds?.length
    ? context.marketplaceIds.filter(id => operationalMpIds.includes(id))
    : operationalMpIds;
  if (resolveMpIds.length === 0) return 0;

  // Find products that SHOULD be READY but aren't:
  // - 4/4 gates PASS
  // - hasPms for at least one active marketplace
  // - status != READY
  const BATCH = 500;
  let promoted = 0;

  // FIX(312-R2): promote kriterleri reconcileReadiness() ile birebir hizalandi.
  const prepRange = await getPrepStockRange();
  for (const mpId of resolveMpIds) {
    let hasMore = true;
    // FIX(OFFSET-DRIFT): eski kodda `skip: offset` vardi; updateMany promote ettigi urunleri
    // WHERE sonucundan cikardigi icin offset ilerledikce satirlar KAYAR ve binlerce urun
    // promote edilmeden atlanirdu (kanit: 1. backfill 5002 promote etti, 4959 kaldi).
    // Promoted urunler sonraki sorguda zaten gorunmez -> skip GEREKMEZ. Sonsuz dongu
    // korumasi icin progress guard eklendi (0 promote edilen tur = sonlan).
    let lastPromoted = -1;

    while (hasMore) {
      if (lastPromoted === 0) break; // progress guard — hic promote edilemedi, tur sonlandir
      const stuckProducts = await prisma.product.findMany({
        where: {
          status: { not: 'READY' },
          categoryMatch: true,
          brandMatch: true,
          templateMatch: true,
          OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }],
          marketplaceStates: { some: { marketplaceId: mpId } },
          // FIX(312-R2): promote kriterleri reconcileReadiness() ile birebir
          // (salePrice + stok araligi + aktif CategoryMapping). Aksi halde bu yol,
          // mapping'siz READY demote edilen urunleri sessizce geri READY yapar.
          salePrice: { not: null },
          stock: { gte: prepRange.min, lte: prepRange.max },
          category: { mappings: { some: { marketplaceId: mpId, active: true } } },
          // P0 TEK GERÇEK KAYNAK: resim/barkod/tanım eksik ürünler promote EDİLMEZ —
          // defective koşulu (Hatalı KPI/filtresi) ile birebir aynı gate.
          images: { not: null },
          barcode: { not: null },
          description: { not: null },
          ...(context.xmlSourceIds?.length ? { xmlSourceId: { in: context.xmlSourceIds } } : {}),
        },
        select: { id: true },
        take: BATCH,
      });

      if (stuckProducts.length === 0) { hasMore = false; break; }

      const ids = stuckProducts.map(p => p.id);
      const result = await prisma.product.updateMany({
        where: { id: { in: ids }, status: { not: 'READY' } },
        data: { status: 'READY' },
      });
      promoted += result.count;
      lastPromoted = result.count;

      if (stuckProducts.length < BATCH) hasMore = false;
    }
  }

  return promoted;
}

// ==================== SYNC STATUS ====================

router.get('/sync-status', requireAuth, (_req: Request, res: Response) => {
  try {
    const status = getTemplateSyncStatus();
    res.json(status);
  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sync status' } });
  }
});

// ==================== CONTEXT ENDPOINT ====================

// GET /ready-to-ship/context — XML source + operational marketplace listelerini getir
router.get('/context', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [xmlSources, allMarketplaces] = await Promise.all([
      prisma.xmlSource.findMany({
        where: { active: true },
        select: { id: true, name: true, company: true },
        orderBy: { name: 'asc' },
      }),
      prisma.marketplace.findMany({
        where: { active: true },
        select: { id: true, key: true, name: true, apiStatus: true, apiKey: true, apiSecret: true, apiUrl: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Only return operational marketplaces in context
    const marketplaces = allMarketplaces
      .filter(mp => isMarketplaceOperational(mp))
      .map(m => ({ id: m.id, key: m.key, name: m.name, apiStatus: m.apiStatus }));

    res.json({
      xmlSources: xmlSources.map(s => ({
        id: s.id,
        name: s.name,
        company: s.company,
      })),
      marketplaces,
    });
  } catch (error) {
    console.error('Error fetching dispatch context:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch context' } });
  }
});

// ==================== STATS ENDPOINT ====================

router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const context = parseContext(req);
    const xmlSourceIds = context.xmlSourceIds;
    const marketplaceIds = context.marketplaceIds;

    // FIX(2M): syncTemplateMatch request path'ten çıkarıldı → background'a taşındı.
    // Response artık DB'deki mevcut templateMatch değerlerini kullanır.
    // FIX(M9/BULGU-2): GET /stats salt-okunur — background sync (state-mutating reconcile)
    // tetikleyemez. Write yalnız açık uçlardan (template CRUD, POST /recheck) gelir.
    requestTemplateSync({ xmlSourceIds, marketplaceIds }, { fromReadPath: true });

    const universeCount = await prisma.product.count({
      where: { ...(xmlSourceIds.length ? { xmlSourceId: { in: xmlSourceIds } } : {}), status: { not: 'DELETED' } },
    });

    // Build context-aware stats query

    const stats = await prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT
        COUNT(*) as "totalProducts",
        SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "readyCount",
        SUM(CASE WHEN status != 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "waitingCount",
        SUM(CASE WHEN status = 'ERROR' OR categoryMatch = 0 OR brandMatch = 0 OR templateMatch = 0 OR (variantMatch = 0 AND variantStatus != 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "blockedCount",
        SUM(CASE WHEN categoryMatch = 0 THEN 1 ELSE 0 END) as "missingCategory",
        SUM(CASE WHEN brandMatch = 0 THEN 1 ELSE 0 END) as "missingBrand",
        SUM(CASE WHEN variantMatch = 0 AND variantStatus != 'NOT_REQUIRED' THEN 1 ELSE 0 END) as "missingVariant",
        SUM(CASE WHEN templateMatch = 0 THEN 1 ELSE 0 END) as "missingTemplate",
        SUM(CASE WHEN images IS NULL THEN 1 ELSE 0 END) as "missingImage",
        SUM(CASE WHEN barcode IS NULL THEN 1 ELSE 0 END) as "missingBarcode",
        SUM(CASE WHEN salePrice IS NULL THEN 1 ELSE 0 END) as "missingPrice",
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as "missingStock",
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as "errorCount"
      FROM Product
      WHERE status != 'DELETED'
      ${xmlSourceIds.length ? Prisma.sql`AND xmlSourceId IN (${Prisma.join(xmlSourceIds.map(id => Prisma.sql`${id}`), ', ')})` : Prisma.empty}
      ${marketplaceIds.length ? Prisma.sql`AND id IN (SELECT productId FROM ProductMarketplaceState WHERE marketplaceId IN (${Prisma.join(marketplaceIds.map(id => Prisma.sql`${id}`), ', ')}) )` : Prisma.empty}
    `;

    const row = (stats as any)[0] || {};

    // Marketplace eligible / missing counts
    let marketplaceEligibleCount = 0;
    let marketplaceStateMissingCount = 0;
    let marketplaceActive = true;
    let marketplaceName: string | null = null;

    if (marketplaceIds.length) {
      const mp = await prisma.marketplace.findUnique({
        where: { id: marketplaceIds[0] },
        select: { active: true, name: true },
      });
      marketplaceActive = mp?.active ?? false;
      marketplaceName = mp?.name ?? null;

      let eligible: Array<{ c: bigint }>;
      if (xmlSourceIds.length) {
        eligible = await prisma.$queryRaw<Array<{ c: bigint }>>`
          SELECT COUNT(DISTINCT p.id) c FROM Product p
          JOIN ProductMarketplaceState s ON p.id = s.productId
          WHERE p.xmlSourceId IN (${Prisma.join(xmlSourceIds.map(id => Prisma.sql`${id}`), ', ')})
          AND s.marketplaceId IN (${Prisma.join(marketplaceIds.map(id => Prisma.sql`${id}`), ', ')})
        `;
      } else {
        eligible = await prisma.$queryRaw<Array<{ c: bigint }>>`
          SELECT COUNT(DISTINCT p.id) c FROM Product p
          JOIN ProductMarketplaceState s ON p.id = s.productId
          WHERE s.marketplaceId IN (${Prisma.join(marketplaceIds.map(id => Prisma.sql`${id}`), ', ')})
        `;
      }
      marketplaceEligibleCount = Number(eligible[0]?.c ?? 0);
      
      const universeForMp = xmlSourceIds.length
        ? await prisma.product.count({ where: { xmlSourceId: { in: xmlSourceIds } } })
        : await prisma.product.count();
      marketplaceStateMissingCount = Math.max(0, universeForMp - marketplaceEligibleCount);
    }

    const productUniverseCount = universeCount;
    const readyCount = Number(row?.readyCount ?? 0);
    const waitingCount = Number(row?.waitingCount ?? 0);
    const blockedCount = Number(row?.blockedCount ?? 0);

    res.json({
      productUniverseCount,
      readyCount,
      waitingCount,
      blockedCount,
      notReadyCount: waitingCount + blockedCount, // backward compat
      missingCategory: Number((row as any)?.missingCategory ?? 0),
      missingBrand: Number((row as any)?.missingBrand ?? 0),
      missingVariant: Number((row as any)?.missingVariant ?? 0),
      missingTemplate: Number((row as any)?.missingTemplate ?? 0),
      missingImage: Number((row as any)?.missingImage ?? 0),
      missingBarcode: Number((row as any)?.missingBarcode ?? 0),
      missingPrice: Number((row as any)?.missingPrice ?? 0),
      missingStock: Number((row as any)?.missingStock ?? 0),
      errorCount: Number((row as any)?.errorCount ?? 0),
      marketplaceEligibleCount,
      marketplaceStateMissingCount,
      marketplaceActive,
      marketplaceName,
    });
  } catch (error) {
    console.error('Error fetching dispatch stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' } });
  }
});

// ==================== PRODUCTS LIST ====================

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const filter = String(req.query?.filter ?? 'all'); // all | ready | waiting | blocked
    const xmlSourceIds = req.query?.xmlSourceIds ? String(req.query.xmlSourceIds).split(',').filter(Boolean) : [];
    const marketplaceIds = req.query?.marketplaceIds ? String(req.query.marketplaceIds).split(',').filter(Boolean) : [];

    // FIX(2M): syncTemplateMatch request path'ten çıkarıldı → background'a taşındı.
    // FIX(M9/BULGU-2): GET / (liste) salt-okunur — background sync tetikleyemez (no-op).
    requestTemplateSync({ xmlSourceIds, marketplaceIds }, { fromReadPath: true });

    const primaryMarketplaceId = marketplaceIds[0] || null;
    const missingReason = req.query?.missingReason ? String(req.query.missingReason) : null;
    const sortBy = String(req.query?.sortBy ?? 'createdAt');
    const sortOrder = String(req.query?.sortOrder ?? 'desc');
    const page = Math.max(1, Number(req.query?.page ?? 1));
    // SEND-CENTER: operasyon ekranı page-size 50/100/500/1000 destekler (server-side pagination;
    // take üst sınırı 1000 — istemci tüm dataset'i asla tek istekte çekemez).
    const limit = Math.min(1000, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;

    const context = { xmlSourceIds, marketplaceIds };
    const where = buildProductWhere({ xmlSourceIds, marketplaceIds });
    // FIX(MIN-STOCK): Ürün Hazırlama "Minimum Stok" ayarı (stockAuto.prepMin, canonical
    // getPrepStockRange) RTS eligibility'nin ZORUNLU parçasıdır. stock < prepMin ürün
    // bu havuza GİRMEZ. Kural yalnızca backend'de uygulanır (authoritative).
    const prepRange = await getPrepStockRange();
    where.stock = {
      ...(where.stock as object),
      gte: prepRange.min,
      lte: prepRange.max,
    };
    // pms_missing filter needs products WITHOUT PMS — remove the base marketplaceStates {some} filter
    // which restricts to products WITH PMS (contradicts the {none} filter below)
    if (missingReason === 'pms_missing' && where.marketplaceStates) {
      delete where.marketplaceStates;
    }
    const and: Record<string, unknown>[] = [];

    if (search) {
      and.push({
        OR: [
          { title: { contains: search } },
          { xmlKey: { contains: search } },
          { sku: { contains: search } },
          { barcode: { contains: search } },
        ],
      });
    }

    // Filter by readiness
    if (filter === 'ready') {
      and.push({
        status: 'READY',
        categoryMatch: true,
        brandMatch: true,
        templateMatch: true,
        OR: [
          { variantMatch: true },
          { variantStatus: 'NOT_REQUIRED' },
        ],
      });
    } else if (filter === 'waiting') {
      and.push({
        NOT: {
          status: 'READY',
          categoryMatch: true,
          brandMatch: true,
          templateMatch: true,
          OR: [
            { variantMatch: true },
            { variantStatus: 'NOT_REQUIRED' },
          ],
        },
      });
    } else if (filter === 'blocked') {
      // Blocked: status ERROR or missing required gates
    }

    // Missing reason filter
    if (missingReason === 'pms_missing') {
      // Gercek PMS yoklugu filtresi (baglam seciliyse O pazaryeri icin)
      and.push(primaryMarketplaceId
        ? { marketplaceStates: { none: { marketplaceId: primaryMarketplaceId } } }
        : { marketplaceStates: { none: {} } });
    } else if (missingReason) {
      const reasonMap: Record<string, Record<string, unknown>> = {
        category: { categoryMatch: false },
        brand: { brandMatch: false },
        template: { templateMatch: false },
        variant: { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } },
        image: { images: null },
        barcode: { barcode: null },
        price: { salePrice: null },
        stock: { stock: { lte: 0 } },
        error: { status: 'ERROR' },
      };
      if (missingReason in { category: 1, brand: 1, template: 1, variant: 1, image: 1, barcode: 1, price: 1, stock: 1, error: 1 }) {
        and.push((reasonMap as any)[missingReason]);
      }
    }

    if (Object.keys(where).length > 0 && and.length > 0) {
      (where as any).AND = [...((where as any).AND || []), ...and];
    } else if (and.length > 0) {
      (where as any).AND = and;
    }

    const validSortFields = ['createdAt', 'updatedAt', 'title', 'stock', 'salePrice', 'status'];
    const sortField = ['createdAt', 'updatedAt', 'title', 'stock', 'salePrice', 'status'].includes(sortBy) ? sortBy : 'createdAt';
    const orderBy: Record<string, string> = { [sortField]: sortOrder === 'asc' ? 'asc' : 'desc' };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: where as any,
        orderBy: orderBy as any,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          sku: true,
          barcode: true,
          xmlKey: true,
          salePrice: true,
          purchasePrice: true,
          stock: true,
          status: true,
          images: true,
          categoryMatch: true,
          brandMatch: true,
          variantMatch: true,
          variantStatus: true,
          templateMatch: true,
          createdAt: true,
          updatedAt: true,
          xmlSourceId: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          xmlSource: { select: { id: true, name: true, company: true, vatRate: true, purchasePriceVatStatus: true } },
        },
      }),
      prisma.product.count({ where: where as any }),
    ]);

    // Compute readiness for each product with authoritative template resolution
    const itemIds = items.map(i => i.id);
    const pmsRows = itemIds.length ? await prisma.productMarketplaceState.findMany({
      where: {
        productId: { in: itemIds },
        ...(primaryMarketplaceId ? { marketplaceId: primaryMarketplaceId } : {}),
      },
      select: { productId: true },
      distinct: ['productId'],
    }) : [];
    const pmsSet = new Set(pmsRows.map(r => r.productId));

    // FIX(312-R2): liste missingReasons icin aktif CategoryMapping seti (validate ile ayni semantik).
    const listCatIds = Array.from(new Set(items.map(i => i.category?.id).filter((x): x is string => !!x)));
    const listMpIds = primaryMarketplaceId ? [primaryMarketplaceId] : marketplaceIds;
    const listActiveMappingSet = new Set((listCatIds.length > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: listCatIds }, marketplaceId: { in: listMpIds }, active: true },
      select: { categoryId: true, marketplaceId: true },
    }) : []).map(m => `${m.categoryId}|${m.marketplaceId}`));

    // SEND-CENTER: TÜM aktif pazaryerleri için canonical fiyat (resolveListingPrice — send gate
    // ile AYNI fonksiyon). Trendyol'a özgü eski davranış geriye uyumlu 'trendyolListPrice' olarak korunur.
    const activeMps = await prisma.marketplace.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true, active: true, apiKey: true, apiSecret: true, apiUrl: true },
      orderBy: { createdAt: 'asc' },
    });
    let rulesAll: { marketplaceId: string; xmlSourceId: string | null; minPrice: number; maxPrice: number; profitMargin: number; fixedAmount: number; rounding: string | null }[] = [];
    if (activeMps.length > 0) {
      rulesAll = await prisma.marketplacePricingRule.findMany({
        where: { active: true, marketplaceId: { in: activeMps.map(m => m.id) } },
        orderBy: { minPrice: 'asc' },
      });
    }
    const mpMeta = activeMps.map(m => ({
      id: m.id, key: m.key, name: m.name,
      operational: isMarketplaceOperational(m),
      reason: m.active === false ? 'PASIF' : (isMarketplaceOperational(m) ? null : 'API bağlantısı yapılandırılmamış'),
    }));
    const ttMpId = activeMps.find(m => m.key === 'tt')?.id ?? null;

    const itemsWithReadiness = await Promise.all(items.map(async (item) => {
      // Resolve template authoritatively
      let templateReady = false;
      let templateId = null;
      let templateName = null;
      let templateScope = null;
      let templateSource = null;
      let templateReason = null;

      if (primaryMarketplaceId) {
        const resolved = await resolveListingTemplate({
          productId: item.id,
          categoryId: item.category?.id ?? null,
          marketplaceId: primaryMarketplaceId,
        });
        if (hasListingTemplate(resolved)) {
          templateReady = true;
          templateId = resolved.id;
          templateName = resolved.name;
          templateScope = resolved.source; // 'PRODUCT' | 'CATEGORY' | 'GENERAL'
          templateSource = resolved.source;
          templateReason = null;
        } else {
          templateReady = false;
          templateReason = 'TEMPLATE_NOT_FOUND';
        }
      } else {
        // Pazaryeri baglami secilmediyse otoriter cozumleme yok:
        // kayitli templateMatch alanina guven (stats endpoint'i ile tutarli).
        templateReady = item.templateMatch === true;
        templateReason = 'NO_MARKETPLACE';
      }

      // Determine readiness using authoritative template readiness
      const authoritativeTemplateMatch = templateReady;
      const hasPms = pmsSet.has(item.id);

      // UNIFIED READINESS: status=READY + 4/4 gate + PMS + salePrice + categoryMapping
      // All conditions must pass for isReady=true.
      // FIX(BULGU-2): categoryMapping check eklendi — send endpoint gate'iyle birebir aynı.
      // Pazar yeri bağlamı varsa mapping zorunlu; yoksa mapping kontrolü atlanır.
      const hasCatMapping = (marketplaceIds.length > 0 && item.category?.id)
        ? marketplaceIds.some(mp => listActiveMappingSet.has(`${item.category!.id}|${mp}`))
        : true; // bağlam yoksa mapping kontrolü atla (tutarlı)
      const ready = isReady({
        status: item.status,
        categoryMatch: item.categoryMatch,
        brandMatch: item.brandMatch,
        templateMatch: authoritativeTemplateMatch,
        variantMatch: item.variantMatch,
        variantStatus: item.variantStatus,
      }) && hasPms && item.salePrice != null && hasCatMapping;

      const missingReasons: string[] = [];
      if (!item.categoryMatch) missingReasons.push('Kategori');
      else {
        // FIX(BULGU-2): Pazar yeri bağlamı yokken mapping kontrolü yapılmaz (tutarlı).
        // Sadece bağlam varsa ve mapping eksikse "Kategori eşlemesi" gösterilir.
        if (marketplaceIds.length > 0) {
          const listCatId = item.category?.id ?? null;
          if (!listCatId || !marketplaceIds.some(mp => listActiveMappingSet.has(`${listCatId}|${mp}`))) missingReasons.push('Kategori eşlemesi');
        }
      }
      if (!item.brandMatch) missingReasons.push('Marka');
      if (!isVariantComplete({ variantMatch: item.variantMatch, variantStatus: item.variantStatus })) missingReasons.push('Varyant');
      if (!authoritativeTemplateMatch) missingReasons.push('Şablon');
      if (!hasPms) missingReasons.push('Pazaryeri');
      if (!item.images) missingReasons.push('Görsel');
      if (!item.barcode) missingReasons.push('Barkod');
      if (item.salePrice == null) missingReasons.push('Fiyat');
      if (item.stock <= 0) missingReasons.push('Stok');
      if (item.status === 'ERROR') missingReasons.push('Hata');

      // SEND-CENTER fiyat zinciri (ürün × aktif pazaryeri):
      //   purchasePrice → KDV (XmlSource.purchasePriceVatStatus) → vatIncluded
      //   salePrice → MarketplacePricingRule bandı → resolveListingPrice (send gate == UI)
      // DOUBLE-VAT YOK: kaynak 'dahil' ise vatIncluded = purchasePrice (tekrar KDV eklenmez).
      const vatIncluded = computeVatIncludedPurchasePrice(
        { purchasePrice: item.purchasePrice, salePrice: item.salePrice, vatRate: null },
        { vatRate: item.xmlSource?.vatRate ?? null, purchasePriceVatStatus: item.xmlSource?.purchasePriceVatStatus ?? 'dahil' },
      );

      const marketplacePrices = activeMps.map((m) => {
        const rulesForMp = rulesAll
          .filter(r => r.marketplaceId === m.id && (!r.xmlSourceId || r.xmlSourceId === item.xmlSourceId))
          .map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
        const ruleUsed = rulesForMp.find(r => !r.maxPrice || (item.salePrice != null && item.salePrice >= r.minPrice && item.salePrice <= r.maxPrice)) ?? rulesForMp[0] ?? null;
        const res = resolveListingPrice(item.salePrice, rulesForMp);
        return {
          marketplaceId: m.id,
          key: m.key,
          name: m.name,
          operational: mpMeta.find(x => x.id === m.id)?.operational ?? false,
          price: res.status === 'OK' ? res.listingPrice : null,
          status: res.status,
          ruleDesc: describePricingRule(ruleUsed),
        };
      });
      const trendyolListPrice = marketplacePrices.find(p => p.marketplaceId === ttMpId)?.price ?? null;

      return {
        ...item,
        isReady: ready,
        hasPms,
        trendyolListPrice,
        trendyolPriceStatus: marketplacePrices.find(p => p.marketplaceId === ttMpId)?.status ?? 'NO_MARKETPLACE',
        // PARITY FIX: Product Pool (products.ts computeVatIncludedPurchasePrice) ile BİREBİR aynı
        // çağrı — fallback semantiği (purchasePrice || salePrice || 0) korunur; strict null-gate YOK.
        purchasePriceVatIncluded: vatIncluded,
        sourceVatRate: item.xmlSource?.vatRate ?? null,
        sourceVatStatus: item.xmlSource?.purchasePriceVatStatus ?? null,
        marketplacePrices,
        missingReasons,
        templateReady,
        templateId,
        templateName,
        templateScope,
        templateSource,
        templateReason,
      };
    }));

    res.json({
      items: itemsWithReadiness,
      marketplaces: mpMeta,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching dispatch products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch products' } });
  }
});

// ==================== GRAPH ENDPOINT ====================

router.get('/graph', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceIds = req.query?.xmlSourceIds ? String(req.query.xmlSourceIds).split(',').filter(Boolean) : [];
    const marketplaceIds = req.query?.marketplaceIds ? String(req.query.marketplaceIds).split(',').filter(Boolean) : [];

    if (marketplaceIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'marketplaceIds required for graph' } });
    }

    // FIX(2M): syncTemplateMatch request path'ten çıkarıldı → background'a taşındı.
    // FIX(M9/BULGU-2): GET /graph salt-okunur — background sync tetikleyemez (no-op).
    requestTemplateSync({ xmlSourceIds, marketplaceIds }, { fromReadPath: true });

    const graphData = await Promise.all(marketplaceIds.map(async (mpId) => {
      const mp = await prisma.marketplace.findUnique({ where: { id: mpId }, select: { id: true, name: true, key: true } });
      if (!mp) return null;

      const where = xmlSourceIds.length
        ? { xmlSourceId: { in: xmlSourceIds }, marketplaceStates: { some: { marketplaceId: mpId } } }
        : { marketplaceStates: { some: { marketplaceId: mpId } } };

      const [ready, sent, failed, waiting] = await Promise.all([
        prisma.product.count({ where: { ...where, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] } }),
        prisma.productMarketplaceState.count({ where: { marketplaceId: mpId, status: 'ACTIVE' } }),
        prisma.productMarketplaceState.count({ where: { marketplaceId: mpId, status: 'ERROR' } }),
        prisma.product.count({ where: { ...where, NOT: { status: 'READY' } } }),
      ]);

      return {
        marketplaceId: mp.id,
        marketplaceName: mp.name,
        marketplaceKey: mp.key,
        ready: ready,
        sent: sent,
        failed: failed,
        waiting: waiting,
      };
    }));

    res.json({ graph: graphData.filter(Boolean) });
  } catch (error) {
    console.error('Error fetching graph data:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch graph data' } });
  }
});

// ==================== PRICING ====================

router.get('/pricing', requireAuth, async (req: Request, res: Response) => {
  try {
    const productIds = req.query?.productIds ? String(req.query.productIds).split(',').filter(Boolean) : [];
    const marketplaceId = req.query?.marketplaceId ? String(req.query.marketplaceId) : null;

    if (!marketplaceId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'marketplaceId required' } });
    }

    if (productIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds required' } });
    }

    const pricing = await getBatchDispatchPricing(productIds, marketplaceId);
    res.json({ pricing });
  } catch (error) {
    console.error('Error fetching pricing:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pricing' } });
  }
});

// ==================== MARKETPLACE HEALTH ====================

router.get('/marketplace-health', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplaceIds = req.query?.marketplaceIds ? String(req.query.marketplaceIds).split(',').filter(Boolean) : [];

    const health = await Promise.all(marketplaceIds.map(async (id) => {
      const { checkMarketplaceHealth } = await import('../services/marketplaceAdapter.ts');
      return checkMarketplaceHealth(id);
    }));

    res.json({ health });
  } catch (error) {
    console.error('Error checking marketplace health:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to check marketplace health' } });
  }
});

// ==================== SEND (DISPATCH) ====================

router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {

    const prepRange = await getPrepStockRange();    const productIds = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((x: unknown) => String(x)).filter(Boolean);
    const bodyXmlSourceIds = req.body?.xmlSourceIds ? (Array.isArray(req.body.xmlSourceIds) ? req.body.xmlSourceIds : [req.body.xmlSourceIds]).map(String) : [];
    const bodyMarketplaceIds = req.body?.marketplaceIds ? (Array.isArray(req.body.marketplaceIds) ? req.body.marketplaceIds : [req.body.marketplaceIds]).map(String) : (req.body.marketplaceId ? [String(req.body.marketplaceId)] : []);

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }
    // HARDENING(F-22): ustsinirsiz productIds -> sinirsiz paralel gate degerlendirmesi
    // mumkundu. Gonderim mantigi DEGISMEDi; yalnizca giris dogrulamasi (proje konvansiyonu 500).
    if (productIds.length > 500) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Tek istekte en fazla 500 urun gonderilebilir' } });
    }
    if (bodyXmlSourceIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceIds zorunludur' } });
    }
    if (req.body.marketplaceIds === undefined && req.body.marketplaceId === undefined) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceIds zorunludur' } });
    }

    const marketplaceIds = bodyMarketplaceIds;

    if (marketplaceIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceIds zorunludur' } });
    }

    // Validate marketplace IDs exist and are active
    const marketplaces = await prisma.marketplace.findMany({
      where: { id: { in: marketplaceIds } },
      select: { id: true, key: true, name: true, active: true },
    });

    if (marketplaces.length !== marketplaceIds.length) {
      return res.status(400).json({ ok: false, error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Bazı pazaryerler bulunamadı' } });
    }

    // Pre-validate: check for duplicates, price, stock before creating job
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        xmlSourceId: true,
        categoryId: true,
        salePrice: true,
        stock: true,
        status: true,
        categoryMatch: true,
        brandMatch: true,
        variantMatch: true,
        variantStatus: true,
        templateMatch: true,
        variants: { select: { name: true, value: true } },
      },
    });

    const productMap = new Map(products.map(p => [p.id, p]));

    // FIX(312-R2): /send de operational match gate'i uygular (validate ile ayni semantik).
    const sendCatIds = Array.from(new Set(products.map(p => p.categoryId).filter((x): x is string => !!x)));
    const sendActiveMappingSet = new Set((sendCatIds.length > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: sendCatIds }, marketplaceId: { in: marketplaceIds }, active: true },
      select: { categoryId: true, marketplaceId: true },
    }) : []).map(m => `${m.categoryId}|${m.marketplaceId}`));

    // Pre-fetch marketplace states for duplicate/eligibility check
    const marketplaceStates = await prisma.productMarketplaceState.findMany({
      where: {
        productId: { in: productIds },
        marketplaceId: { in: marketplaceIds },
      },
      select: { productId: true, marketplaceId: true, status: true },
    });
    const mpStateMap = new Map<string, { productId: string; marketplaceId: string; status: string }>();
    for (const state of marketplaceStates) {
      mpStateMap.set(`${state.productId}:${state.marketplaceId}`, state);
    }

    const preValidationResults = await Promise.all(productIds.map(async (productId: string) => {
      const product = productMap.get(productId);
      if (!product) {
        return { productId, ok: false, reason: 'PRODUCT_NOT_FOUND' };
      }

      // XML context isolation
      if (product.xmlSourceId && bodyXmlSourceIds.length && !bodyXmlSourceIds.includes(product.xmlSourceId)) {
        return { productId, ok: false, reason: 'WRONG_XML_CONTEXT' };
      }

      // Template gate: use canonical resolver
      const primaryMpId = marketplaceIds[0];
      const resolvedTpl = await resolveListingTemplate({
        productId: product.id,
        categoryId: product.categoryId,
        marketplaceId: primaryMpId,
      });
      const templateOk = hasListingTemplate(resolvedTpl);

      // 4/4 gate + status
      // FIX(312-R2): kategori gate'i artik operational match ile birebir
      // (aktif CategoryMapping yoksa CATEGORY/MAPPING BLOCK — READY semantigiyle ayni).
      const valHasMapping = !!product.categoryId && marketplaceIds.some((mp: string) => sendActiveMappingSet.has(`${product.categoryId}|${mp}`));
      const gateStatus = {
        category: product.categoryMatch === true && valHasMapping,
        brand: product.brandMatch === true,
        variant: product.variantMatch === true || product.variantStatus === 'NOT_REQUIRED',
        template: templateOk,
        status: product.status === 'READY',
      };
      const allGatesPass = Object.values(gateStatus).every(v => v === true);

      // Marketplace eligibility + duplicate check
      let marketplaceEligible = true;
      let alreadySent = false;
      let alreadySending = false;
      for (const mpId of marketplaceIds) {
        const mpStateKey = `${productId}:${mpId}`;
        const mpState = mpStateMap.get(mpStateKey);
        if (!mpState) {
          marketplaceEligible = false;
        } else if (mpState.status === 'ACTIVE') {
          alreadySent = true;
        } else if (mpState.status === 'SENDING') {
          alreadySending = true;
        }
      }

      // Price validation
      const priceValid = product.salePrice != null && product.salePrice > 0;
      // Stock validation
      const stockValid = product.stock != null && isWithinPrepRange(product.stock, prepRange.min, prepRange.max);

      const missingGates = Object.entries(gateStatus)
        .filter(([_, v]) => !v)
        .map(([k]) => k.toUpperCase());

      // FIX(INV10): Trendyol-specific required attribute validation (send endpoint).
      if (gateStatus.variant && product.categoryId) {
        const ttMarketplace = marketplaces.find((m: { key: string }) => m.key === 'tt');
        if (ttMarketplace && marketplaceIds.includes(ttMarketplace.id)) {
          try {
            const mapping = await prisma.categoryMapping.findFirst({
              where: { categoryId: product.categoryId, marketplaceId: ttMarketplace.id, active: true },
              select: { externalId: true },
              orderBy: { createdAt: 'desc' },
            });
            const categoryExternalId = parseInt(String(mapping?.externalId ?? ''), 10);
            if (Number.isFinite(categoryExternalId) && categoryExternalId > 0) {
              const attrDefs = await fetchTrendyolCategoryAttributes(categoryExternalId);
              if (Array.isArray(attrDefs) && attrDefs.length > 0) {
                const requiredVarianter = attrDefs.filter((a: { varianter?: boolean; slicer?: boolean; required?: boolean }) => a.varianter && (a.required || a.slicer));
                if (requiredVarianter.length > 0) {
                  const productVariants = (product as { variants?: Array<{ name: string; value: string }> }).variants || [];
                  const valuesByAttribute = new Map();
                  const resolution = resolveTrendyolAttributes(attrDefs, valuesByAttribute, productVariants.map((v: { name: string; value: string }) => ({ name: v.name, value: v.value })));
                  if (resolution.status === 'REQUIRED_ATTRIBUTE_MISSING') {
                    missingGates.push('REQUIRED_ATTRIBUTE_MISSING');
                    gateStatus.variant = false;
                  }
                }
              }
            }
          } catch {
            missingGates.push('ATTRIBUTE_CHECK_FAILED');
            gateStatus.variant = false;
          }
        }
      }

      if (!marketplaceEligible) missingGates.push('MARKETPLACE_ELIGIBLE');
      if (alreadySent) missingGates.push('ALREADY_ACTIVE');
      if (alreadySending) missingGates.push('ALREADY_SENDING');
      if (!priceValid) missingGates.push('PRICE_INVALID');
      if (!stockValid) missingGates.push('STOCK_INVALID');

      const attributeGatesPass = !missingGates.includes('REQUIRED_ATTRIBUTE_MISSING') && !missingGates.includes('ATTRIBUTE_CHECK_FAILED');
      return {
        productId,
        ok: allGatesPass && attributeGatesPass && marketplaceEligible && !alreadySent && !alreadySending && priceValid && stockValid,
        missingGates: missingGates.length > 0 ? missingGates : undefined,
      };
    }));

    const blockedProducts = preValidationResults.filter((r: { ok: boolean }) => !r.ok);
    if (blockedProducts.length > 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'PRE_VALIDATION_FAILED',
          message: 'Bazı ürünler gönderim için uygun değil',
          blockedProducts,
        },
      });
    }

    // Create dispatch job
    const job = createDispatchJob({
      xmlSourceIds: bodyXmlSourceIds,
      marketplaceIds: bodyMarketplaceIds,
      productIds,
      userId: '', // TODO: get from auth
    });

    await populateMarketplaceNames(job.id);
    startDispatchJob(job.id);

    // Fire and forget — process in background
    processDispatchJob(job.id, productIds, bodyXmlSourceIds, bodyMarketplaceIds).catch(err => {
      console.error(`[SEND ENDPOINT] Dispatch job ${job.id} failed:`, err);
      completeDispatchJob(job.id, err.message);
    });

    res.json({
      ok: true,
      jobId: job.id,
      message: 'Gönderim işlemi başlatıldı',
      totalCount: productIds.length,
    });
  } catch (error) {
    console.error('Error creating dispatch job:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create dispatch job' } });
  }
});

// ==================== SEND VALIDATE (DRY-RUN) ====================

router.post('/send/validate', requireAuth, async (req: Request, res: Response) => {
  try {

    const prepRange = await getPrepStockRange();    const productIds = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((x: unknown) => String(x)).filter(Boolean);
    const bodyXmlSourceIds = req.body?.xmlSourceIds ? (Array.isArray(req.body.xmlSourceIds) ? req.body.xmlSourceIds : [req.body.xmlSourceIds]).map(String) : [];
    const bodyMarketplaceIds = req.body?.marketplaceIds ? (Array.isArray(req.body.marketplaceIds) ? req.body.marketplaceIds : [req.body.marketplaceIds]).map(String) : (req.body.marketplaceId ? [String(req.body.marketplaceId)] : []);

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }
    // HARDENING(F-22): ustsinirsiz productIds -> sinirsiz paralel gate degerlendirmesi
    // mumkundu. Gonderim mantigi DEGISMEDi; yalnizca giris dogrulamasi (proje konvansiyonu 500).
    if (productIds.length > 500) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Tek istekte en fazla 500 urun gonderilebilir' } });
    }
    if (bodyXmlSourceIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceIds zorunludur' } });
    }
    if (req.body.marketplaceIds === undefined && req.body.marketplaceId === undefined) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceIds zorunludur' } });
    }

    const marketplaceIds = bodyMarketplaceIds;

    if (marketplaceIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceIds zorunludur' } });
    }

    // Validate marketplace IDs exist and are active
    const marketplaces = await prisma.marketplace.findMany({
      where: { id: { in: marketplaceIds } },
      select: { id: true, key: true, name: true, active: true },
    });

    if (marketplaces.length !== marketplaceIds.length) {
      return res.status(400).json({ ok: false, error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Bazı pazaryerler bulunamadı' } });
    }

    // Fetch products with all gate fields
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        xmlSourceId: true,
        title: true,
        sku: true,
        barcode: true,
        salePrice: true,
        purchasePrice: true,
        stock: true,
        status: true,
        categoryMatch: true,
        brandMatch: true,
        variantMatch: true,
        variantStatus: true,
        templateMatch: true,
        images: true,
        categoryId: true,
        variants: { select: { name: true, value: true } },
      },
    });

    const productMap = new Map(products.map(p => [p.id, p]));

    // Pre-fetch marketplace states for eligibility check
    const marketplaceStates = await prisma.productMarketplaceState.findMany({
      where: {
        productId: { in: productIds },
        marketplaceId: { in: marketplaceIds },
      },
      select: { productId: true, marketplaceId: true, status: true },
    });
    const mpStateMap = new Map<string, { productId: string; marketplaceId: string; status: string }>();
    for (const state of marketplaceStates) {
      mpStateMap.set(`${state.productId}:${state.marketplaceId}`, state);
    }

    // FIX(312-R2): validate aktif CategoryMapping gate'ini raporlar
    // (READY semantigi ile birebir parity — mapping yoksa CATEGORY/MAPPING BLOCK).
    const valCatIds = Array.from(new Set(products.map(p => p.categoryId).filter((x): x is string => !!x)));
    const validateActiveMappingSet = new Set((valCatIds.length > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: valCatIds }, marketplaceId: { in: marketplaceIds }, active: true },
      select: { categoryId: true, marketplaceId: true },
    }) : []).map(m => `${m.categoryId}|${m.marketplaceId}`));

    const results = await Promise.all(productIds.map(async (productId: string) => {
      const product = productMap.get(productId);
      if (!product) {
        return {
          productId,
          eligible: false,
          missingGates: ['product_not_found'],
          marketplaceEligible: false,
          duplicate: false,
          reason: 'Product not found',
        };
      }

      // XML context isolation
      if (product.xmlSourceId && bodyXmlSourceIds.length && !bodyXmlSourceIds.includes(product.xmlSourceId)) {
        return {
          productId,
          eligible: false,
          missingGates: ['wrong_xml_context'],
          marketplaceEligible: false,
          duplicate: false,
          reason: 'Product does not belong to selected XML source',
        };
      }

      // 4/4 GATE + STATUS + MARKETPLACE ELIGIBILITY (authoritative template resolver)
      let templateReady = false;
      let templateId = null;
      let templateName = null;
      let templateScope = null;
      let templateSource = null;
      let templateReason = null;

      if (marketplaceIds.length) {
        const primaryMpId = marketplaceIds[0];
        const resolved = await resolveListingTemplate({
          productId: productId,
          categoryId: product.categoryId,
          marketplaceId: primaryMpId,
        });
        if (hasListingTemplate(resolved)) {
          templateReady = true;
          templateId = resolved.id;
          templateName = resolved.name;
          templateScope = resolved.source;
          templateSource = resolved.source;
          templateReason = null;
        } else {
          templateReady = false;
          templateReason = 'TEMPLATE_NOT_FOUND';
        }
      } else {
        templateReady = false;
        templateReason = 'NO_MARKETPLACE';
      }

      // FIX(312-R2): validate kategori gate'i operational match ile birebir
      // (aktif CategoryMapping yoksa CATEGORY/MAPPING BLOCK — READY semantigiyle ayni).
      const valHasMapping = !!product.categoryId && marketplaceIds.some((mp: string) => validateActiveMappingSet.has(`${product.categoryId}|${mp}`));
      const gateStatus = {
        category: product.categoryMatch === true && valHasMapping,
        brand: product.brandMatch === true,
        variant: product.variantMatch === true || product.variantStatus === 'NOT_REQUIRED',
        template: templateReady,
        status: product.status === 'READY',
      };

      const allGatesPass = Object.values(gateStatus).every(v => v === true);

      // Marketplace eligibility: product must have PMS record for this marketplace
      let marketplaceEligible = true;
      let duplicate = false;
      let alreadySent = false;

      for (const mpId of marketplaceIds) {
        const mpStateKey = `${productId}:${mpId}`;
        const mpState = mpStateMap.get(mpStateKey);
        if (!mpState) {
          marketplaceEligible = false;
        } else if (mpState.status === 'ACTIVE') {
          alreadySent = true;
        } else if (mpState.status === 'SENDING') {
          duplicate = true;
        }
      }

      const missingGates = Object.entries(gateStatus)
        .filter(([_, v]) => !v)
        .map(([k]) => k.toUpperCase());
      if (product.categoryMatch === true && !valHasMapping) missingGates.push('MAPPING');

      // FIX(INV10): Trendyol-specific required attribute validation.
      // variantStatus='NOT_REQUIRED' yalnızca XML perspektifiyledir;
      // Trendyol kategorisi Renk/Beden gibi required attribute gerektirebilir.
      if (gateStatus.variant && product.categoryId) {
        const ttMarketplace = marketplaces.find((m: { key: string }) => m.key === 'tt');
        if (ttMarketplace && marketplaceIds.includes(ttMarketplace.id)) {
          try {
            const mapping = await prisma.categoryMapping.findFirst({
              where: { categoryId: product.categoryId, marketplaceId: ttMarketplace.id, active: true },
              select: { externalId: true },
              orderBy: { createdAt: 'desc' },
            });
            const categoryExternalId = parseInt(String(mapping?.externalId ?? ''), 10);
            if (Number.isFinite(categoryExternalId) && categoryExternalId > 0) {
              const attrDefs = await fetchTrendyolCategoryAttributes(categoryExternalId);
              if (Array.isArray(attrDefs) && attrDefs.length > 0) {
                const requiredVarianter = attrDefs.filter((a: { varianter?: boolean; slicer?: boolean; required?: boolean }) => a.varianter && (a.required || a.slicer));
                if (requiredVarianter.length > 0) {
                  const productVariants = (product as { variants?: Array<{ name: string; value: string }> }).variants || [];
                  const valuesByAttribute = new Map();
                  const resolution = resolveTrendyolAttributes(attrDefs, valuesByAttribute, productVariants.map((v: { name: string; value: string }) => ({ name: v.name, value: v.value })));
                  if (resolution.status === 'REQUIRED_ATTRIBUTE_MISSING') {
                    const names = resolution.requiredMissing.map((m: { attributeName: string }) => m.attributeName).join(', ');
                    missingGates.push('REQUIRED_ATTRIBUTE_MISSING');
                    gateStatus.variant = false;
                  }
                }
              }
            }
          } catch {
            // Trendyol API hatası: fail-closed, ürünü blokla
            missingGates.push('ATTRIBUTE_CHECK_FAILED');
            gateStatus.variant = false;
          }
        }
      }

      if (!marketplaceEligible) missingGates.push('MARKETPLACE_ELIGIBLE');
      if (alreadySent) missingGates.push('ALREADY_ACTIVE');
      if (duplicate) missingGates.push('ALREADY_SENDING');

      // Price validation
      if (product.salePrice == null || product.salePrice <= 0) {
        missingGates.push('PRICE_INVALID');
      }

      // Stock validation
      if (product.stock == null || !isWithinPrepRange(product.stock, prepRange.min, prepRange.max)) {
        missingGates.push('STOCK_INVALID');
      }

      // FIX(MIN-STOCK): eligible hesabı prep-range (minimum stok) gate'ini DAHİL eder.
      const stockEligible = product.stock != null && isWithinPrepRange(product.stock, prepRange.min, prepRange.max);
      const attributeGatesPass = !missingGates.includes('REQUIRED_ATTRIBUTE_MISSING') && !missingGates.includes('ATTRIBUTE_CHECK_FAILED');
      const eligible = allGatesPass && attributeGatesPass && marketplaceEligible && !alreadySent && !duplicate && product.salePrice != null && product.salePrice > 0 && stockEligible;

      return {
        productId,
        eligible,
        missingGates,
        marketplaceEligible,
        duplicate,
        alreadySent,
        reason: missingGates.length > 0 ? missingGates.join(', ') : 'OK',
        templateReady,
        templateId,
        templateName,
        templateScope,
        templateSource,
        templateReason,
      };
    }));
    const eligibleCount = results.filter((r: { eligible: boolean }) => r.eligible).length;
    const blockedCount = results.filter((r: { eligible: boolean }) => !r.eligible).length;
    const alreadySentCount = results.filter((r: { alreadySent: boolean }) => r.alreadySent).length;

    res.json({
      ok: true,
      eligibleCount,
      blockedCount,
      alreadySentCount,
      products: results,
    });
  } catch (error) {
    console.error('Error validating send:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to validate send' } });
  }
});

// Background job processor
async function processDispatchJob(jobId: string, productIds: string[], xmlSourceIds: string[], marketplaceIds: string[]) {
  try {

    const prepRange = await getPrepStockRange();    const concurrency = 5;

    for (const marketplaceId of marketplaceIds) {
      const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { id: true, key: true, name: true } });
      if (!mp) continue;

      // Build payload for each product
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          xmlSourceId: true,
          xmlKey: true,
          title: true,
          sku: true,
          barcode: true,
          salePrice: true,
          purchasePrice: true,
          stock: true,
          vatRate: true,
          description: true,
          images: true,
          link: true,
          unit: true,
          status: true,
          categoryMatch: true,
          brandMatch: true,
          variantMatch: true,
          variantStatus: true,
          templateMatch: true,
          categoryId: true,
          category: { select: { externalId: true } },
          brand: { select: { name: true } },
          xmlSource: { select: { vatRate: true } },
        },
      });

      // Process in chunks
      const productIdsToSend = productIds;
      const chunkSize = 5;
      
      // Pre-fetch marketplace states for eligibility check
      const marketplaceStates = await prisma.productMarketplaceState.findMany({
        where: {
          productId: { in: productIdsToSend },
          marketplaceId: { in: marketplaceIds },
        },
        select: { productId: true, marketplaceId: true, status: true },
      });
    const mpStateMap = new Map<string, { productId: string; marketplaceId: string; status: string }>();
    for (const state of marketplaceStates) {
      mpStateMap.set(`${state.productId}:${state.marketplaceId}`, state);
    }

    // FIX(312-R2): /send execution artik aktif CategoryMapping gate'i uygular.
    const execCatIds = Array.from(new Set(products.map(p => p.categoryId).filter((x): x is string => !!x)));
    const activeMappingSet = new Set((execCatIds.length > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: execCatIds }, marketplaceId: { in: marketplaceIds }, active: true },
      select: { categoryId: true, marketplaceId: true },
    }) : []).map(m => `${m.categoryId}|${m.marketplaceId}`));

      for (let i = 0; i < productIdsToSend.length; i += 5) {
        const chunk = productIdsToSend.slice(i, i + 5);
        const promises = chunk.map(async (productId) => {
          const product = products.find(p => p.id === productId);
          if (!product) {
            updateProgress({ jobId, marketplaceId: mp.id, productId, success: false, error: 'Product not found' });
            return;
          }

          // === 4/4 GATE + MARKETPLACE ELIGIBILITY VALIDATION ===
          // Template gate: use canonical resolver, NOT stale DB field
          const resolvedTpl = await resolveListingTemplate({
            productId: product.id,
            categoryId: product.categoryId,
            marketplaceId: mp.id,
          });
          const templateOk = hasListingTemplate(resolvedTpl);

          // FIX(312-R2): /send execution da operational match gate'i uygular.
          const execHasMapping = !!product.categoryId && activeMappingSet.has(`${product.categoryId}|${mp.id}`);
          const gateStatus = {
            category: product.categoryMatch === true && execHasMapping,
            brand: product.brandMatch === true,
            variant: product.variantMatch === true || product.variantStatus === 'NOT_REQUIRED',
            template: templateOk,
            status: product.status === 'READY',
          };

          const allGatesPass = Object.values(gateStatus).every(v => v === true);
          
          // Marketplace eligibility: product must have PMS record for this marketplace
          const mpStateKey = `${productId}:${mp.id}`;
          const mpState = mpStateMap.get(mpStateKey);
          const marketplaceEligible = !!mpState;
          
          // Duplicate protection: check for ACTIVE/SENDING status
          const alreadySent = mpState?.status === 'ACTIVE';
          const alreadySending = mpState?.status === 'SENDING';

          if (!allGatesPass || !marketplaceEligible || alreadySent || alreadySending) {
            const missingGates = Object.entries(gateStatus)
              .filter(([_, v]) => !v)
              .map(([k]) => k.toUpperCase());
            if (product.categoryMatch === true && !execHasMapping) missingGates.push('MAPPING');
            if (!marketplaceEligible) missingGates.push('MARKETPLACE_ELIGIBLE');
            if (alreadySent) missingGates.push('ALREADY_ACTIVE');
            if (alreadySending) missingGates.push('ALREADY_SENDING');
            
            updateProgress({
              jobId,
              marketplaceId: mp.id,
              productId,
              success: false,
              error: `GÖNDERİLEMEZ: eksik kapılar: ${missingGates.join(', ')}`,
            });
            return;
          }

          // Price validation
          if (product.salePrice == null || product.salePrice <= 0) {
            updateProgress({
              jobId,
              marketplaceId: mp.id,
              productId,
              success: false,
              error: 'GÖNDERİLEMEZ: PRICE_INVALID',
            });
            return;
          }

          // Stock validation
          if (product.stock == null || !isWithinPrepRange(product.stock, prepRange.min, prepRange.max)) {
            updateProgress({
              jobId,
              marketplaceId: mp.id,
              productId,
              success: false,
              error: 'GÖNDERİLEMEZ: STOCK_INVALID',
            });
            return;
          }

          // Build payload for marketplace — resolve Trendyol price via canonical resolver
          const mpPricingRules = await prisma.marketplacePricingRule.findMany({
            where: { marketplaceId: mp.id, active: true },
            orderBy: { minPrice: 'asc' },
          });
          const priceRules = mpPricingRules
            .filter(r => !r.xmlSourceId || r.xmlSourceId === product.xmlSourceId)
            .map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
          const resolvedPrice = resolveListingPrice(product.salePrice, priceRules);
          const trendyolPrice = resolvedPrice.status === 'OK' ? resolvedPrice.listingPrice : null;

          const payload = buildMarketplacePayload(product, trendyolPrice);

          try {
            const result = await sendProductToMarketplace({
              marketplaceId: mp.id,
              productId: productId,
              xmlSourceId: product.xmlSourceId!,
              payload,
            });

            updateProgress({
              jobId,
              marketplaceId: mp.id,
              productId,
              success: result.ok,
              error: result.errorMessage ?? undefined,
            });
          } catch (e) {
            updateProgress({
              jobId,
              marketplaceId: mp.id,
              productId,
              success: false,
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        });

        await Promise.all(promises);
      }
    }

    completeDispatchJob(jobId);
  } catch (error) {
    console.error(`[processDispatchJob] Dispatch job ${jobId} error:`, error);
    completeDispatchJob(jobId, error instanceof Error ? error.message : 'Unknown error');
  }
}

function buildMarketplacePayload(product: any, trendyolPrice: number | null): any {
  // Build payload based on product data
  // price = canonical resolver result (Trendyol-specific computed price), NOT product.salePrice directly
  return {
    barcode: product.barcode,
    sku: product.sku,
    title: product.title ?? '',
    description: product.description ?? '',
    price: trendyolPrice ?? product.salePrice ?? 0,
    stock: product.stock,
    vatRate: product.vatRate,
    categoryExternalId: product.category?.externalId ?? null,
    brandName: product.brand?.name ?? null,
    images: product.images ? product.images.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
  };
}

// ==================== JOB STATUS & PROGRESS ====================

router.get('/jobs', requireAuth, async (_req: Request, res: Response) => {
  try {
    const jobs = listDispatchJobs(50);
    res.json({ jobs });
  } catch (error) {
    console.error('Error listing dispatch jobs:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list jobs' } });
  }
});

router.get('/jobs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const job = getDispatchJob(jobId);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    res.json({ job });
  } catch (error) {
    console.error('Error fetching dispatch job:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch job' } });
  }
});

router.get('/progress/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const job = getDispatchJob(jobId);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }

    // SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = createProgressStream(jobId);
    for (const chunk of stream) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    console.error('Error streaming progress:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to stream progress' } });
  }
});

// ==================== RECHECK (AUTO-READY) ====================

router.post('/recheck', requireAuth, async (req: Request, res: Response) => {
  try {
    const productIds = req.body?.productIds;
    const auto = req.body?.auto === true;
    const bodyXmlSourceIds = req.body?.xmlSourceIds ? (Array.isArray(req.body.xmlSourceIds) ? req.body.xmlSourceIds : [req.body.xmlSourceIds]).map(String) : [];
    const bodyMarketplaceIds = req.body?.marketplaceIds ? (Array.isArray(req.body.marketplaceIds) ? req.body.marketplaceIds : [req.body.marketplaceIds]).map(String) : [];

    // FIX(2M): syncTemplateMatch request path'ten çıkarıldı → background'a taşındı.
    // /recheck zaten templateMatch=true filtresi kullanıyor; background sync tamamlandığında
    // templateMatch güncellenmiş olur.
    requestTemplateSync({ xmlSourceIds: bodyXmlSourceIds, marketplaceIds: bodyMarketplaceIds });

    let ids: string[];

    if (auto && (!Array.isArray(productIds) || productIds.length === 0)) {
      const baseWhere = buildProductWhere({ xmlSourceIds: bodyXmlSourceIds, marketplaceIds: bodyMarketplaceIds });
      const candidates = await prisma.product.findMany({
        where: {
          ...baseWhere,
          status: { not: 'READY' },
          categoryMatch: true,
          brandMatch: true,
          templateMatch: true,
          OR: [
            { variantMatch: true },
            { variantStatus: 'NOT_REQUIRED' },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      });
      ids = candidates.map((p) => p.id);
    } else {
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
      }
      ids = (Array.isArray(productIds) ? productIds : []).map((x: unknown) => String(x)).filter(Boolean);
      // HARDENING(F-22): auto mod zaten take:1000 ile sınırlı; manuel yol aynı üst sınıra bağlandı.
      if (ids.length > 1000) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Tek istekte en fazla 1000 ürün recheck edilebilir' } });
      }
    }

    if (ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        categoryId: true,
        categoryMatch: true,
        brandMatch: true,
        templateMatch: true,
        variantMatch: true,
        variantStatus: true,
        images: true,
        barcode: true,
        salePrice: true,
        stock: true,
        status: true,
        brandId: true,
        title: true,
        sku: true,
        description: true,
      },
    });

    // Aktif mapping'leri toplu yükle (N+1 engelleme)
    const categoryIds = [...new Set(products.filter(p => p.categoryId).map(p => p.categoryId as string))];
    const targetMarketplaceIds = bodyMarketplaceIds.length > 0 ? bodyMarketplaceIds : await getOperationalMarketplaceIds();
    const activeMappings = await prisma.categoryMapping.findMany({
      where: { categoryId: { in: categoryIds }, marketplaceId: { in: targetMarketplaceIds }, active: true },
      select: { categoryId: true },
    });
    const activeMappingSet = new Set(activeMappings.map(m => m.categoryId));

    let updatedCount = 0;
    for (const p of products) {
      // P0-3: Variant aile tespiti — NOT_REQUIRED ise kardeş ürünleri kontrol et
      let effectiveVariantStatus = p.variantStatus;
      if (effectiveVariantStatus === 'NOT_REQUIRED' && !p.variantMatch && p.brandId && p.title) {
        const family = await detectVariantFamily(p.id, p.brandId, p.title, p.sku ?? null);
        if (family.isFamily && family.confidence >= 50) {
          await prisma.product.update({ where: { id: p.id }, data: { variantStatus: 'WAITING_AI' } });
          effectiveVariantStatus = 'WAITING_AI';
        }
      }

      const readiness = evaluateReadiness({
        id: p.id,
        status: p.status,
        categoryMatch: p.categoryMatch,
        brandMatch: p.brandMatch,
        templateMatch: p.templateMatch,
        variantMatch: p.variantMatch,
        variantStatus: effectiveVariantStatus ?? null,
        images: p.images,
        barcode: p.barcode,
        salePrice: p.salePrice,
        stock: p.stock ?? 0,
      });
      const activeMapping = p.categoryId ? activeMappingSet.has(p.categoryId) : false;
      // P0 TEK GERÇEK KAYNAK: recheck gate'i defective koşuluyla birebir aynı —
      // resim/barkod/fiyat/stok/TANIM (description) eksikse READY olamaz
      const allReady = readiness.isPrepComplete && p.salePrice != null && (p.stock ?? 0) > 0 && p.images != null && p.barcode != null && p.description != null && activeMapping;

      if (allReady && p.status !== 'READY') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'READY' } });
        updatedCount++;
      } else if (!allReady && p.status === 'READY') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'XML' } });
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await prisma.auditLog.create({
        data: { action: 'RECHECK_STATUS', entity: 'product', details: `/recheck: ${updatedCount} urun durumu guncellendi (${ids.length} kontrol edildi, auto=${auto})`, actorUserId: (req as any).actor?.userId || null },
      });
    }

    res.json({
      ok: true,
      message: `${updatedCount} ürün durumu güncellendi`,
      updatedCount,
      checkedCount: products.length,
      auto: auto === true,
    });
  } catch (error) {
    console.error('Error rechecking products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to recheck products' } });
  }
});

// ==================== BACKGROUND RECONCILE ====================
// BULGU-4 FIX: syncReconcileStatus sadece backfill script'inde çağrılıyordu.
// 6.832 ürün tüm READY koşullarını sağlıyor ama status=XML kalıyordu.
// Bu timer, sunucu başladığında arka planda çalışır ve stuck ürünleri promote eder.
// GET endpointlerine write eklemez, mevcut per-product reconcile'u bozmaz.

const RECONCILE_INTERVAL_MS = 60_000; // 60 saniye aralıkla
const RECONCILE_BATCH_LIMIT = 500; // her turda en fazla 500 ürün
let _reconcileTimerActive = false;
let _reconcileLastRun = 0;
let _reconcileTotalPromoted = 0;

async function _backgroundReconcileTick(): Promise<void> {
  if (_reconcileTimerActive) return; // zaten çalışıyor
  _reconcileTimerActive = true;
  try {
    // Boş context = tüm operational marketplace'ler için çalıştır
    const promoted = await syncReconcileStatus({ xmlSourceIds: [], marketplaceIds: [] });
    if (promoted > 0) {
      _reconcileTotalPromoted += promoted;
      console.log(`[background-reconcile] ${promoted} ürün READY'e promote edildi (toplam: ${_reconcileTotalPromoted})`);
      invalidateProductsStatsCache();
    }
    _reconcileLastRun = Date.now();
  } catch (err) {
    console.error('[background-reconcile] Hata:', err);
  } finally {
    _reconcileTimerActive = false;
  }
}

// Sunucu başladığında ilk reconcile'ı başlat ve periyodik timer kur
function startBackgroundReconcile(): void {
  // İlk çalıştırma: 10 saniye gecikme (sunucu start'ını engellememek için)
  setTimeout(() => {
    _backgroundReconcileTick().catch(() => null);
    // Periyodik timer
    setInterval(() => {
      _backgroundReconcileTick().catch(() => null);
    }, RECONCILE_INTERVAL_MS);
  }, 10_000);
  console.log(`[background-reconcile] Timer başlatıldı (ilk çalıştırma: 10s, aralık: ${RECONCILE_INTERVAL_MS / 1000}s)`);
}

// Router yüklendiğinde timer'ı başlat
startBackgroundReconcile();

// Export: durum bilgisi için
export function getReconcileStatus() {
  return {
    lastRun: _reconcileLastRun,
    totalPromoted: _reconcileTotalPromoted,
    running: _reconcileTimerActive,
  };
}

// ==================== PRODUCT DETAIL (GENERIC - MUST BE LAST) ====================
// Bu route spesifik route'lardan (/jobs, /progress/:id, vb.) SONRA gelmelidir
// yoksa /jobs, /progress/:id gibi yollar yakalanır.

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        sku: true,
        barcode: true,
        xmlKey: true,
        salePrice: true,
        purchasePrice: true,
        stock: true,
        status: true,
        images: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
        categoryMatch: true,
        brandMatch: true,
        variantMatch: true,
        variantStatus: true,
        templateMatch: true,
        xmlSourceId: true,
        supplierCategory: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        xmlSource: { select: { id: true, name: true, company: true, vatRate: true, purchasePriceVatStatus: true } },
        variants: { select: { id: true, name: true, value: true } },
        marketplaceStates: {
          select: {
            id: true,
            status: true,
            price: true,
            stock: true,
            listingUrl: true,
            marketplaceId: true,
            marketplace: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });
    }

    // Resolve template authoritatively
    const primaryMarketplaceId = (product.marketplaceStates[0] as any)?.marketplaceId || null;

    // FIX(M9/BULGU-2): GET /:id salt-okunurdur — "read önce reconcile" kalıbı
    // (reconcileReadiness) variant aile tespiti üzerinden variantStatus/status yazıp
    // GET'le DB mutation üretiyordu. Detay artık DB'deki mevcut değerleri olduğu gibi
    // döndürür; promote/demote yalnız WRITE uçlarında (recheck POST, gate CRUD) olur.
    // (Not: product.status zaten yukarıdaki taze findUnique okumasından gelir.)
    let templateReady = false;
    let templateId = null;
    let templateName = null;
    let templateScope = null;
    let templateSource = null;
    let templateReason = null;

    if (primaryMarketplaceId) {
      const resolved = await resolveListingTemplate({
        productId: product.id,
        categoryId: product.category?.id ?? null,
        marketplaceId: primaryMarketplaceId,
      });
      if (hasListingTemplate(resolved)) {
        templateReady = true;
        templateId = resolved.id;
        templateName = resolved.name;
        templateScope = resolved.source;
        templateSource = resolved.source;
        templateReason = null;
      } else {
        templateReady = false;
        templateReason = 'TEMPLATE_NOT_FOUND';
      }
    } else {
      // Pazaryeri baglami yok: kayitli templateMatch alanina guven (liste endpoint'i ile tutarli).
      templateReady = product.templateMatch === true;
      templateReason = 'NO_MARKETPLACE';
    }

    const authoritativeTemplateMatch = templateReady;
    const hasPms = product.marketplaceStates.length > 0;

    // UNIFIED READINESS: status=READY + 4/4 gate + PMS + salePrice
    const ready = isReady({
      status: product.status,
      categoryMatch: product.categoryMatch,
      brandMatch: product.brandMatch,
      templateMatch: authoritativeTemplateMatch,
      variantMatch: product.variantMatch,
      variantStatus: product.variantStatus,
    }) && hasPms && product.salePrice != null;

    const missingReasons: string[] = [];
    if (!product.categoryMatch) missingReasons.push('Kategori eşleştirilmemiş');
    if (!product.brandMatch) missingReasons.push('Marka eşleştirilmemiş');
    if (!isVariantComplete({ variantMatch: product.variantMatch, variantStatus: product.variantStatus })) missingReasons.push('Varyant eşleştirilmemiş');
    if (!authoritativeTemplateMatch) missingReasons.push('Şablon eşleştirilmemiş');
    if (!hasPms) missingReasons.push('Pazaryeri');
    if (!product.images) missingReasons.push('Görsel eksik');
    if (!product.barcode) missingReasons.push('Barkod eksik');
    if (product.salePrice == null) missingReasons.push('Fiyat belirlenmemiş');
    if (product.stock <= 0) missingReasons.push('Stokta ürün yok');
    if (product.status === 'ERROR') missingReasons.push('Ürününde hata var');

    // SEND-CENTER detay: liste endpoint'iyle AYNI canonical fiyat zinciri (double-VAT yok,
    // resolveListingPrice == send gate motoru). Yeni hesaplama motoru YAZILMADI.
    const activeMpsDetail = await prisma.marketplace.findMany({
      where: { active: true },
      select: { id: true, key: true, name: true, active: true, apiKey: true, apiSecret: true, apiUrl: true, apiStatus: true },
      orderBy: { createdAt: 'asc' },
    });
    const rulesDetail = activeMpsDetail.length > 0 ? await prisma.marketplacePricingRule.findMany({
      where: { active: true, marketplaceId: { in: activeMpsDetail.map(m => m.id) } },
      orderBy: { minPrice: 'asc' },
    }) : [];
    const vatIncludedDetail = computeVatIncludedPurchasePrice(
      { purchasePrice: product.purchasePrice, salePrice: product.salePrice, vatRate: null },
      { vatRate: product.xmlSource?.vatRate ?? null, purchasePriceVatStatus: product.xmlSource?.purchasePriceVatStatus ?? 'dahil' },
    );
    const marketplacePricesDetail = activeMpsDetail.map((m) => {
      const rulesForMp = rulesDetail
        .filter(r => r.marketplaceId === m.id && (!r.xmlSourceId || r.xmlSourceId === product.xmlSourceId))
        .map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
      const ruleUsed = rulesForMp.find(r => !r.maxPrice || (product.salePrice != null && product.salePrice >= r.minPrice && product.salePrice <= r.maxPrice)) ?? rulesForMp[0] ?? null;
      const res = resolveListingPrice(product.salePrice, rulesForMp);
      const pmsRow = product.marketplaceStates.find(s => s.marketplaceId === m.id);
      return {
        marketplaceId: m.id,
        key: m.key,
        name: m.name,
        operational: isMarketplaceOperational(m),
        apiStatus: m.apiStatus,
        price: res.status === 'OK' ? res.listingPrice : null,
        status: res.status,
        ruleDesc: describePricingRule(ruleUsed),
        eligibility: pmsRow ? pmsRow.status : 'NO_STATE',
        blockedReason: !isMarketplaceOperational(m) ? 'API bağlantısı yapılandırılmamış'
          : (res.status !== 'OK' ? res.status
            : (!product.categoryMatch ? 'Kategori eksik'
              : (!product.brandMatch ? 'Marka eksik'
                : (!isVariantComplete({ variantMatch: product.variantMatch, variantStatus: product.variantStatus }) ? 'Varyant eksik'
                  : (pmsRow ? null : 'Pazaryeri state yok'))))),
      };
    });

    res.json({
      ...product,
      isReady: ready,
      hasPms,
      missingReasons,
      // PARITY FIX: Product Pool ile birebir aynı canonical değer (fallback dahil).
      purchasePriceVatIncluded: vatIncludedDetail,
      sourceVatRate: product.xmlSource?.vatRate ?? null,
      sourceVatStatus: product.xmlSource?.purchasePriceVatStatus ?? null,
      marketplacePrices: marketplacePricesDetail,
      templateReady,
      templateId,
      templateName,
      templateScope,
      templateSource,
      templateReason,
    });
  } catch (error) {
    console.error('Error fetching product detail:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product' } });
  }
});

export default router;
