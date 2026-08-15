import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { READY_FILTER } from '../services/readiness.ts';

const router = Router();

// xmlSourceId query parametresi çiftlenirse (array) ilk değeri güvenle alır
function readQueryId(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  return value ? String(value) : null;
}

// ==================== KDV İŞ KURALI (STABLE mirror) ====================
// Kaynak: DG-STOK-V5-STABLE apps/server/src/routes/xmlSources.ts (pricing/preview):
//   basePrice = purchasePrice (yoksa STABLE fallback: purchasePrice || salePrice || 0)
//   vatStatus === 'haric'  → base * (1 + vat/100)
//   vatStatus === 'dahil'  → base
//   vat = product.vatRate ?? source.vatRate ?? 20
type PriceProduct = { purchasePrice: number | null; salePrice: number | null; vatRate: number | null };
type PriceSource = { vatRate: number | null; purchasePriceVatStatus: string | null } | null | undefined;

export function computeVatIncludedPurchasePrice(
  product: PriceProduct,
  source: PriceSource,
): number {
  const base = product.purchasePrice || product.salePrice || 0;
  const vat = product.vatRate ?? source?.vatRate ?? 20;
  const vatStatus = source?.purchasePriceVatStatus ?? 'dahil';
  const value = vatStatus === 'haric' ? base * (1 + vat / 100) : base;
  return Math.round(value * 100) / 100;
}

// ==================== ÜRÜN İSTATİSTİK (Cache'li, context-aware) ====================
let _productsStatsCache: Map<string, { data: unknown; timestamp: number }> = new Map();
const _PRODUCTS_STATS_CACHE_TTL = 30_000; // 30 saniye

export function invalidateProductsStatsCache() {
  _productsStatsCache.clear();
}

// GET /products/stats - Ürün Havuzu KPI istatistikleri (STABLE mirror)
// P0: Context zorunlu
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = readQueryId(req.query?.xmlSourceId);
    const cacheKey = `stats:${xmlSourceId ?? 'all'}`;
    const cached = _productsStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < _PRODUCTS_STATS_CACHE_TTL) {
      return res.json(cached.data);
    }

    const contextWhere: { xmlSourceId?: string } = {};
    if (xmlSourceId) contextWhere.xmlSourceId = xmlSourceId;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalProducts,
      activeProducts,
      passiveProducts,
      draftProducts,
      readyProducts,
      errorProducts,
      newToday,
      updatedToday,
      pendingCategory,    // categoryId IS NULL → Kategori Hazırlama ile tutarlı
      pendingBrand,       // brandMatch IS FALSE → Marka Hazırlama ile tutarlı
      pendingVariant,     // variantMatch IS FALSE → Varyant V1 ile tutarlı
      missingImages,
      missingBarcode,
      missingDescription,
      missingPrice,
      missingStock,
      missingSeo,
      templatePending,
      variantAnalysisPending, // V2 sistemi: manuel inceleme + hatalı
    ] = await Promise.all([
      prisma.product.count({ where: contextWhere }),
      prisma.product.count({ where: { ...contextWhere, status: 'READY' } }),
      prisma.product.count({ where: { ...contextWhere, status: 'PASSIVE' } }),
      prisma.product.count({ where: { ...contextWhere, status: 'DRAFT' } }),
      prisma.product.count({ where: { ...contextWhere, ...READY_FILTER } }),
      prisma.product.count({ where: { ...contextWhere, status: 'ERROR' } }),
      prisma.product.count({ where: { ...contextWhere, createdAt: { gte: todayStart } } }),
      prisma.product.count({ where: { ...contextWhere, updatedAt: { gte: todayStart } } }),
      prisma.product.count({ where: { ...contextWhere, categoryId: null } }),
      prisma.product.count({ where: { ...contextWhere, brandMatch: false } }),
      prisma.product.count({ where: { ...contextWhere, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } }),
      prisma.product.count({ where: { ...contextWhere, images: null } }),
      prisma.product.count({ where: { ...contextWhere, barcode: null } }),
      prisma.product.count({ where: { ...contextWhere, description: null } }),
      prisma.product.count({ where: { ...contextWhere, salePrice: null } }),
      prisma.product.count({ where: { ...contextWhere, stock: { lte: 0 } } }),
      prisma.product.count({ where: { ...contextWhere, seoTitle: null, seoDescription: null } }),
      prisma.product.count({ where: { ...contextWhere, templateMatch: false } }),
      prisma.variantAnalysis.count({ where: { status: { in: ['NEEDS_REVIEW', 'MANUAL_REQUIRED', 'ERROR'] } } }),
    ]);

    const responseData = {
      totalProducts,
      activeProducts,
      passiveProducts,
      draftProducts,
      newProducts: newToday,
      updatedCount: updatedToday,
      deletedCount: 0,
      readyForListing: readyProducts,
      missingInfo: totalProducts - readyProducts,
      pendingCategory,
      pendingBrand,
      pendingVariant,
      pendingTemplate: templatePending,
      variantAnalysisPending,
      missingImages,
      missingBarcode,
      missingDescription,
      missingPrice,
      missingStock,
      missingSeo,
      errorProducts,
    };

    _productsStatsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product stats' } });
  }
});

// ==================== ÜRÜN LİSTELEME (Gelişmiş Filtreleme) ====================

// GET /products - List products with advanced filtering (STABLE mirror, limit <= 1000)
// P0: Context zorunlu — xmlSourceId + marketplaceId olmadan ürün dönmez
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = readQueryId(req.query?.xmlSourceId);
    console.log('[products] GET / xmlSourceId:', xmlSourceId);
    const search = String(req.query?.search ?? '').trim();
    const searchField = String(req.query?.searchField ?? '').trim();
    const categoryId = req.query?.categoryId ? String(req.query.categoryId) : null;
    const brandId = req.query?.brandId ? String(req.query.brandId) : null;
    const company = req.query?.company ? String(req.query.company).trim() : null;
    const status = req.query?.status ? String(req.query.status) : null;
    const lowStock = req.query?.lowStock === 'true';
    const hasImage = req.query?.hasImage === 'true' ? true : req.query?.hasImage === 'false' ? false : null;
    const hasBarcode = req.query?.hasBarcode === 'true' ? true : req.query?.hasBarcode === 'false' ? false : null;
    const hasDescription = req.query?.hasDescription === 'true' ? true : req.query?.hasDescription === 'false' ? false : null;
    const categoryMatch = req.query?.categoryMatch === 'true' ? true : req.query?.categoryMatch === 'false' ? false : null;
    const brandMatch = req.query?.brandMatch === 'true' ? true : req.query?.brandMatch === 'false' ? false : null;
    const variantMatch = req.query?.variantMatch === 'true' ? true : req.query?.variantMatch === 'false' ? false : null;
    const minPrice = req.query?.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query?.maxPrice ? Number(req.query.maxPrice) : null;
    const minStock = req.query?.minStock ? Number(req.query.minStock) : null;
    const maxStock = req.query?.maxStock ? Number(req.query.maxStock) : null;
    const dateFrom = req.query?.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query?.dateTo ? new Date(String(req.query.dateTo)) : null;
    const sortBy = String(req.query?.sortBy ?? 'createdAt');
    const sortOrder = String(req.query?.sortOrder ?? 'desc');

    // MODÜL 04: gerçek 1000 kayıt desteği (STABLE'da 100; modül gereği 1000'e yükseltildi)
    let page = Number(req.query?.page ?? 1);
    let limit = Number(req.query?.limit ?? 50);

    // Validate pagination parameters - reject NaN/invalid
    if (!Number.isFinite(page) || page < 1) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz sayfa numarası' } });
    if (!Number.isFinite(limit) || limit < 1 || limit > 1000) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz limit değeri, 1-1000 arası olmalı' } });

    page = Math.max(1, page);
    limit = Math.min(1000, Math.max(10, limit));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // XML kaynağı seçilmişse o kaynağa ait ürünler filtrelenir; seçilmemişse genel havuz
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    console.log('[products] GET / where:', JSON.stringify(where));

    // Gelişmiş arama (STABLE mirror: title + description dahil)
    if (search) {
      if (searchField === 'title') {
        where.title = { contains: search };
      } else if (searchField === 'sku') {
        where.sku = { contains: search };
      } else if (searchField === 'barcode') {
        where.barcode = { contains: search };
      } else if (searchField === 'xmlKey') {
        where.xmlKey = { contains: search };
      } else if (searchField === 'description') {
        where.description = { contains: search };
      } else {
        where.OR = [
          { title: { contains: search } },
          { xmlKey: { contains: search } },
          { sku: { contains: search } },
          { barcode: { contains: search } },
          { description: { contains: search } },
        ];
      }
    }

    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (company) where.xmlSource = { company: { contains: company } };
    if (status) where.status = status;
    if (lowStock) where.stock = { lte: 0 };
    if (minStock != null) where.stock = { ...(where.stock as object), gte: minStock };
    if (maxStock != null) where.stock = { ...(where.stock as object), lte: maxStock };
    if (minPrice != null) where.salePrice = { ...(where.salePrice as object), gte: minPrice };
    if (maxPrice != null) where.salePrice = { ...(where.salePrice as object), lte: maxPrice };
    if (dateFrom) where.createdAt = { ...(where.createdAt as object), gte: dateFrom };
    if (dateTo) where.createdAt = { ...(where.createdAt as object), lte: dateTo };

    // Boolean filtreler
    if (hasImage === true) where.images = { not: null };
    if (hasImage === false) where.images = null;
    if (hasBarcode === true) where.barcode = { not: null };
    if (hasBarcode === false) where.barcode = null;
    if (hasDescription === true) where.description = { not: null };
    if (hasDescription === false) where.description = null;
    if (categoryMatch !== null) where.categoryMatch = categoryMatch;
    if (brandMatch !== null) where.brandMatch = brandMatch;
    if (variantMatch !== null) where.variantMatch = variantMatch;

    // Sıralama (STABLE whitelist)
    const orderBy: Record<string, string> = {};
    const validSortFields = ['createdAt', 'updatedAt', 'title', 'stock', 'salePrice', 'profitMargin', 'status'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    orderBy[sortField] = sortOrder === 'asc' ? 'asc' : 'desc';

    const includeVariants = req.query?.includeVariants === 'true';

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: where as never,
        orderBy: orderBy as never,
        skip,
        take: limit,
        select: {
          id: true, title: true, sku: true, barcode: true, xmlKey: true,
          salePrice: true, purchasePrice: true, stock: true, minStock: true, status: true,
          images: true, description: true, seoTitle: true, seoDescription: true,
          technicalSpecs: true, vatRate: true, profitMargin: true, aiScore: true,
          computedTitle: true, prefixEnabled: true, supplierCategory: true,
          customBrandName: true, unit: true, currency: true, errorMessage: true,
          categoryId: true, brandId: true, xmlSourceId: true,
          categoryMatch: true, brandMatch: true, variantMatch: true, templateMatch: true,
          createdAt: true, updatedAt: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          xmlSource: { select: { id: true, name: true, company: true, purchasePriceVatStatus: true, vatRate: true } },
          marketplaceStates: { select: { id: true, status: true, marketplace: { select: { id: true, name: true } } } },
          ...(includeVariants ? { variants: { select: { id: true, name: true, value: true } } } : {}),
        },
      }),
      prisma.product.count({ where: where as never }),
    ]);

    // KDV dahil alış fiyatı (STABLE iş kuralı — backend'de hesaplanır)
    const itemsWithPricing = items.map((item) => ({
      ...item,
      vatIncludedPurchasePrice: computeVatIncludedPurchasePrice(item, item.xmlSource),
    }));

    res.json({
      items: itemsWithPricing,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch products' } });
  }
});

// GET /products/status-counts - Aggregated product counts by status
// P0: Context zorunlu
router.get('/status-counts', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = readQueryId(req.query?.xmlSourceId);
    const where: Record<string, unknown> = {};
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    const rows = await prisma.product.groupBy({
      by: ['status'],
      where: where as never,
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = row._count._all;
    }

    res.json({ counts });
  } catch (error) {
    console.error('Error fetching product status counts:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product status counts' } });
  }
});

// GET /products/:id - Tek ürün detayı (STABLE mirror)
// P0: Context zorunlu — yanlış context = 404
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const xmlSourceId = readQueryId(req.query?.xmlSourceId);

    const product = await prisma.product.findFirst({
      where: {
        id,
        ...(xmlSourceId ? { xmlSourceId } : {}),
      },
      select: {
        id: true, xmlKey: true, title: true, description: true, detail: true,
        images: true, sku: true, barcode: true, link: true, unit: true, currency: true,
        stock: true, minStock: true, status: true, errorMessage: true,
        purchasePrice: true, salePrice: true, vatRate: true, profitMargin: true, aiScore: true,
        seoTitle: true, seoDescription: true, technicalSpecs: true,
        supplierCategory: true, customBrandName: true, computedTitle: true, prefixEnabled: true,
        categoryMatch: true, brandMatch: true, variantMatch: true, templateMatch: true,
        categoryId: true, brandId: true, xmlSourceId: true,
        createdAt: true, updatedAt: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        variants: { select: { id: true, name: true, value: true } },
        xmlSource: { select: { id: true, name: true, company: true, purchasePriceVatStatus: true, vatRate: true } },
        marketplaceStates: {
          select: {
            id: true, status: true, price: true, stock: true, listingId: true,
            listingUrl: true, lastActionAt: true, errorMessage: true,
            marketplace: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });
    }

    return res.json({
      ...product,
      vatIncludedPurchasePrice: computeVatIncludedPurchasePrice(product, product.xmlSource),
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product' } });
  }
});

export default router;
