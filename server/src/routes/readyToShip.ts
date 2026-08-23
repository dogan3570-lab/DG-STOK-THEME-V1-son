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
import {reconcileReadiness, reconcileProductGates, queueReconcileProductGates} from '../services/readinessService.ts';
import { getOperationalMarketplaceIds, isMarketplaceOperational } from '../services/marketplaceTruth.ts';

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
async function syncReconcileStatus(context: { xmlSourceIds?: string[]; marketplaceIds?: string[] }): Promise<number> {
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

  for (const mpId of resolveMpIds) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const stuckProducts = await prisma.product.findMany({
        where: {
          status: { not: 'READY' },
          categoryMatch: true,
          brandMatch: true,
          templateMatch: true,
          OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }],
          marketplaceStates: { some: { marketplaceId: mpId } },
          ...(context.xmlSourceIds?.length ? { xmlSourceId: { in: context.xmlSourceIds } } : {}),
        },
        select: { id: true },
        skip: offset,
        take: BATCH,
      });

      if (stuckProducts.length === 0) { hasMore = false; break; }

      const ids = stuckProducts.map(p => p.id);
      const result = await prisma.product.updateMany({
        where: { id: { in: ids }, status: { not: 'READY' } },
        data: { status: 'READY' },
      });
      promoted += result.count;

      offset += stuckProducts.length;
      if (stuckProducts.length < BATCH) hasMore = false;
    }
  }

  return promoted;
}

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

    // Sync templateMatch using canonical resolver before computing stats.
    // Always runs — syncTemplateMatch handles both context and no-context cases.
    await syncTemplateMatch({ xmlSourceIds, marketplaceIds });

    const universeCount = await prisma.product.count({
      where: xmlSourceIds.length ? { xmlSourceId: { in: xmlSourceIds } } : {},
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
      WHERE 1=1
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

    // Sync templateMatch before listing to ensure accurate filter/stats
    await syncTemplateMatch({ xmlSourceIds, marketplaceIds });

    // NOTE: syncReconcileStatus removed from page-load — lifecycle reconcile now happens
    // at each gate-write point (category, brand, variant, template, PMS, price).
    // For one-time backfill of existing stuck products, run: npx tsx src/scripts/backfill-reconcile.ts

    const primaryMarketplaceId = marketplaceIds[0] || null;
    const missingReason = req.query?.missingReason ? String(req.query.missingReason) : null;
    const sortBy = String(req.query?.sortBy ?? 'createdAt');
    const sortOrder = String(req.query?.sortOrder ?? 'desc');
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(250, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;

    const context = { xmlSourceIds, marketplaceIds };
    const where = buildProductWhere({ xmlSourceIds, marketplaceIds });
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
          xmlSource: { select: { id: true, name: true, company: true } },
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

    // TRENDYOL SATIS FIYATI (canonical): Product.salePrice + aktif MarketplacePricingRule
    // bantlari -> resolveListingPrice. Send gate ile AYNI fonksiyon/sonuc; UI bu degeri
    // gosterir, boylece UI == API == payload.price invarianti saglanir.
    // purchasePrice satis hesabina girmez; yalnizca UI bilgilendirme icin donebilir.
    const ttMp = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
    let ttRulesAll: { id: string; xmlSourceId: string | null; minPrice: number; maxPrice: number; profitMargin: number; fixedAmount: number; rounding: string | null }[] = [];
    if (ttMp) {
      ttRulesAll = await prisma.marketplacePricingRule.findMany({
        where: { marketplaceId: ttMp.id, active: true },
        orderBy: { minPrice: 'asc' },
      });
    }

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

      // UNIFIED READINESS: status=READY + 4/4 gate + PMS + salePrice
      // All conditions must pass for isReady=true.
      // This is consistent with reconcileReadiness() which requires hasPms && allGates.
      const ready = isReady({
        status: item.status,
        categoryMatch: item.categoryMatch,
        brandMatch: item.brandMatch,
        templateMatch: authoritativeTemplateMatch,
        variantMatch: item.variantMatch,
        variantStatus: item.variantStatus,
      }) && hasPms && item.salePrice != null;

      const missingReasons: string[] = [];
      if (!item.categoryMatch) missingReasons.push('Kategori');
      if (!item.brandMatch) missingReasons.push('Marka');
      if (!isVariantComplete({ variantMatch: item.variantMatch, variantStatus: item.variantStatus })) missingReasons.push('Varyant');
      if (!authoritativeTemplateMatch) missingReasons.push('Şablon');
      if (!hasPms) missingReasons.push('Pazaryeri');
      if (!item.images) missingReasons.push('Görsel');
      if (!item.barcode) missingReasons.push('Barkod');
      if (item.salePrice == null) missingReasons.push('Fiyat');
      if (item.stock <= 0) missingReasons.push('Stok');
      if (item.status === 'ERROR') missingReasons.push('Hata');

      // Canonical Trendyol fiyat hesabi (send gate ile ayni resolver):
      // BASE = Product.salePrice; bant = MarketplacePricingRule (xmlSource uyumlu).
      const itemRules = ttRulesAll
        .filter(r => !r.xmlSourceId || r.xmlSourceId === item.xmlSourceId)
        .map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
      const tyPrice = resolveListingPrice(item.salePrice, itemRules);
      const trendyolListPrice = tyPrice.status === 'OK' ? tyPrice.listingPrice : null;

      return {
        ...item,
        isReady: ready,
        hasPms,
        trendyolListPrice,
        trendyolPriceStatus: tyPrice.status,
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

    // Sync templateMatch before computing graph counts
    await syncTemplateMatch({ xmlSourceIds, marketplaceIds });

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

// ==================== PRODUCT DETAIL ====================

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
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        xmlSource: { select: { id: true, name: true, company: true } },
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

    // Ensure status is reconciled before computing readiness
    if (product.xmlSourceId && primaryMarketplaceId) {
      const promoted = await reconcileReadiness(product.id, { xmlSourceId: product.xmlSourceId, marketplaceId: primaryMarketplaceId });
      if (promoted) {
        const refreshed = await prisma.product.findUnique({ where: { id }, select: { status: true } });
        if (refreshed) product.status = refreshed.status;
      }
    }
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
    if (product.status === 'ERROR') missingReasons.push('Üründe hata var');

    res.json({
      ...product,
      isReady: ready,
      hasPms,
      missingReasons,
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

// ==================== SEND (DISPATCH) ====================

router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const productIds = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((x: unknown) => String(x)).filter(Boolean);
    const bodyXmlSourceIds = req.body?.xmlSourceIds ? (Array.isArray(req.body.xmlSourceIds) ? req.body.xmlSourceIds : [req.body.xmlSourceIds]).map(String) : [];
    const bodyMarketplaceIds = req.body?.marketplaceIds ? (Array.isArray(req.body.marketplaceIds) ? req.body.marketplaceIds : [req.body.marketplaceIds]).map(String) : (req.body.marketplaceId ? [String(req.body.marketplaceId)] : []);

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
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
      },
    });

    const productMap = new Map(products.map(p => [p.id, p]));

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
      const gateStatus = {
        category: product.categoryMatch === true,
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
      const stockValid = product.stock != null && product.stock > 0;

      const missingGates = Object.entries(gateStatus)
        .filter(([_, v]) => !v)
        .map(([k]) => k.toUpperCase());
      if (!marketplaceEligible) missingGates.push('MARKETPLACE_ELIGIBLE');
      if (alreadySent) missingGates.push('ALREADY_ACTIVE');
      if (alreadySending) missingGates.push('ALREADY_SENDING');
      if (!priceValid) missingGates.push('PRICE_INVALID');
      if (!stockValid) missingGates.push('STOCK_INVALID');

      return {
        productId,
        ok: allGatesPass && marketplaceEligible && !alreadySent && !alreadySending && priceValid && stockValid,
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
    const productIds = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((x: unknown) => String(x)).filter(Boolean);
    const bodyXmlSourceIds = req.body?.xmlSourceIds ? (Array.isArray(req.body.xmlSourceIds) ? req.body.xmlSourceIds : [req.body.xmlSourceIds]).map(String) : [];
    const bodyMarketplaceIds = req.body?.marketplaceIds ? (Array.isArray(req.body.marketplaceIds) ? req.body.marketplaceIds : [req.body.marketplaceIds]).map(String) : (req.body.marketplaceId ? [String(req.body.marketplaceId)] : []);

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
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

      const gateStatus = {
        category: product.categoryMatch === true,
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

      if (!marketplaceEligible) missingGates.push('MARKETPLACE_ELIGIBLE');
      if (alreadySent) missingGates.push('ALREADY_ACTIVE');
      if (duplicate) missingGates.push('ALREADY_SENDING');

      // Price validation
      if (product.salePrice == null || product.salePrice <= 0) {
        missingGates.push('PRICE_INVALID');
      }

      // Stock validation
      if (product.stock == null || product.stock <= 0) {
        missingGates.push('STOCK_INVALID');
      }

      const eligible = allGatesPass && marketplaceEligible && !alreadySent && !duplicate && product.salePrice != null && product.salePrice > 0 && product.stock != null && product.stock > 0;

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
    const concurrency = 5;

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

          const gateStatus = {
            category: product.categoryMatch === true,
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
          if (product.stock == null || product.stock <= 0) {
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

    // Sync templateMatch before recheck to ensure accurate gate evaluation
    await syncTemplateMatch({ xmlSourceIds: bodyXmlSourceIds, marketplaceIds: bodyMarketplaceIds });

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
    }

    if (ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
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
      },
    });

    let updatedCount = 0;
    for (const p of products) {
      const allReady = isPrepComplete({
        status: p.status,
        categoryMatch: p.categoryMatch,
        brandMatch: p.brandMatch,
        templateMatch: p.templateMatch,
        variantMatch: p.variantMatch,
        variantStatus: p.variantStatus,
      });

      if (allReady && p.status !== 'READY') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'READY' } });
        updatedCount++;
      } else if (!allReady && p.status === 'READY') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'XML' } });
        updatedCount++;
      }
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

export default router;