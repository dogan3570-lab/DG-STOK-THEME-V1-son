import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { READY_FILTER } from '../services/readiness.ts';
import { searchByTitle } from '../services/titleSearchIndex.ts';

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
// TASK313-R3: cache services/productsStatsCache.ts'te — reconcile sonrası invalidate edilebilir
import { productsStatsGet as _psGet, productsStatsSet as _psSet, invalidateProductsStats as _psInvalidate } from '../services/productsStatsCache.ts';
let _productsStatsCache: { get(k: string): { data: unknown; timestamp: number } | undefined; set(k: string, v: { data: unknown; timestamp: number }): void; clear(): void } = {
  get: (k) => _psGet(k),
  set: (k, v) => _psSet(k, v),
  clear: () => _psInvalidate(),
};
const _PRODUCTS_STATS_CACHE_TTL = 30_000; // 30 saniye (servis tarafında da uygulanır)

// P2.1 FIX: Single-flight —同一 cache key için aynı anda yalnızca 1 ağır hesaplama çalışır.
// Diğer concurrent request'ler aynı Promise'i bekler, duplicate SQL execution engellenir.
const _statsInFlight = new Map<string, Promise<unknown>>();

export function invalidateProductsStatsCache() {
  _psInvalidate();
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

    // P2.1 FIX: Single-flight — cache miss'te aynı anda yalnızca 1 computation çalışır.
    // Diğer concurrent request'ler aynı promise'i bekler.
    const existing = _statsInFlight.get(cacheKey);
    if (existing) {
      const data = await existing;
      return res.json(data);
    }

    const computation = (async () => {

    const contextWhere: { xmlSourceId?: string } = {};
    if (xmlSourceId) contextWhere.xmlSourceId = xmlSourceId;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // P2.2→P3 FIX (SLOW): 21 ayrı UNION ALL taraması yerine TEK TARAMA SUM(CASE).
    // Ölçüm (25K ürün): 21 scan ~1510ms → tek scan ~190ms (~8x). SQLite'ta her
    // UNION kolu tüm satırı yeniden tarıyor; SUM(CASE) satırı bir kez okur.
    // P0 BUFFER FIX: ctxFilter (xmlSourceId) tek WHERE'e uygulanır.
    const ctxFilter = xmlSourceId
      ? Prisma.sql` AND xmlSourceId = ${xmlSourceId}`
      : Prisma.empty;
    const onePass = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'PASSIVE' THEN 1 ELSE 0 END) as passive,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) as draft,
        SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as ready,
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as error,
        SUM(CASE WHEN createdAt >= ${todayStart} THEN 1 ELSE 0 END) as newToday,
        SUM(CASE WHEN updatedAt >= ${todayStart} THEN 1 ELSE 0 END) as updatedToday,
        SUM(CASE WHEN categoryId IS NULL THEN 1 ELSE 0 END) as pendingCategory,
        SUM(CASE WHEN brandMatch = 0 THEN 1 ELSE 0 END) as pendingBrand,
        SUM(CASE WHEN variantMatch = 0 AND variantStatus != 'NOT_REQUIRED' THEN 1 ELSE 0 END) as pendingVariant,
        SUM(CASE WHEN images IS NULL THEN 1 ELSE 0 END) as missingImages,
        SUM(CASE WHEN barcode IS NULL THEN 1 ELSE 0 END) as missingBarcode,
        SUM(CASE WHEN description IS NULL THEN 1 ELSE 0 END) as missingDescription,
        SUM(CASE WHEN salePrice IS NULL THEN 1 ELSE 0 END) as missingPrice,
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as missingStock,
        SUM(CASE WHEN seoTitle IS NULL AND seoDescription IS NULL THEN 1 ELSE 0 END) as missingSeo,
        SUM(CASE WHEN templateMatch = 0 THEN 1 ELSE 0 END) as templatePending,
        SUM(CASE WHEN categoryMatch = 0 THEN 1 ELSE 0 END) as actionCategory,
        SUM(CASE WHEN categoryMatch = 0 AND aiSuggestedCategoryId IS NOT NULL THEN 1 ELSE 0 END) as aiSuggestedPending,
        SUM(CASE WHEN (categoryMatch = 0 OR brandMatch = 0 OR templateMatch = 0 OR (variantMatch = 0 AND variantStatus != 'NOT_REQUIRED')) THEN 1 ELSE 0 END) as actionUnique,
        SUM(CASE WHEN (images IS NULL OR barcode IS NULL OR salePrice IS NULL OR stock <= 0 OR description IS NULL) THEN 1 ELSE 0 END) as defective
      FROM Product WHERE status != 'DELETED'${ctxFilter}
    `;
    const row = onePass[0] ?? {};
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) m[k] = Number(v ?? 0);

    const variantAnalysisPending = await prisma.variantAnalysis.count({ where: { status: { in: ['NEEDS_REVIEW', 'MANUAL_REQUIRED', 'ERROR'] } } });

    // P2 FIX: actionCategory/aiSuggestedPending/actionUniqueProducts artık ana query'den geliyor (3 ayrı scan kaldırıldı)
    const notDeleted = { ...contextWhere, status: { not: PRODUCT_STATUS_DELETED } };
    const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
    let blockedCategory = 0;
    if (ttMp) {
      const catGroups = await prisma.product.groupBy({ by: ['categoryId'], where: { ...notDeleted, categoryMatch: true, categoryId: { not: null } }, _count: { id: true } });
      if (catGroups.length > 0) {
        const activeMaps = await prisma.categoryMapping.findMany({ where: { marketplaceId: ttMp.id, active: true, externalId: { not: null } }, select: { categoryId: true } });
        const mappedSet = new Set(activeMaps.map(ma => ma.categoryId));
        blockedCategory = catGroups.filter(g => !mappedSet.has(g.categoryId as string)).reduce((s, g) => s + g._count.id, 0);
      }
    }
    const lastRun = await prisma.xmlImportRun.findFirst({
      where: xmlSourceId ? { sourceId: xmlSourceId } : undefined,
      orderBy: { startedAt: 'desc' },
      select: { id: true, sourceId: true, startedAt: true, finishedAt: true, status: true, newProducts: true, updatedProducts: true, totalProducts: true },
    });

    const responseData = {
      totalProducts: m.total ?? 0,
      activeProducts: m.active ?? 0,
      passiveProducts: m.passive ?? 0,
      draftProducts: m.draft ?? 0,
      newProducts: m.newToday ?? 0,
      updatedCount: m.updatedToday ?? 0,
      deletedCount: 0,
      readyForListing: m.ready ?? 0,
      missingInfo: (m.total ?? 0) - (m.ready ?? 0),
      pendingCategory: m.pendingCategory ?? 0,
      pendingBrand: m.pendingBrand ?? 0,
      pendingVariant: m.pendingVariant ?? 0,
      pendingTemplate: m.templatePending ?? 0,
      variantAnalysisPending,
      missingImages: m.missingImages ?? 0,
      missingBarcode: m.missingBarcode ?? 0,
      missingDescription: m.missingDescription ?? 0,
      missingPrice: m.missingPrice ?? 0,
      missingStock: m.missingStock ?? 0,
      missingSeo: m.missingSeo ?? 0,
      errorProducts: m.error ?? 0,
      // P0 DEFECTIVE: resim/barkod/fiyat/stok/tanım eksik ürünler (tıkla→listele)
      defectiveProducts: m.defective ?? 0,
      // ---- TASK313 actionable ----
      actionCategory: m.actionCategory ?? 0,
      aiSuggestedPending: m.aiSuggestedPending ?? 0,
      blockedCategory,
      actionUniqueProducts: m.actionUnique ?? 0,
      lastImport: lastRun ? { id: lastRun.id, sourceId: lastRun.sourceId, startedAt: lastRun.startedAt, status: lastRun.status, newProducts: lastRun.newProducts, updatedProducts: lastRun.updatedProducts, totalProducts: lastRun.totalProducts } : null,
    };

    _productsStatsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    return responseData;
    })(); // P2.1: computation sonu

    // Single-flight: promise'i map'e ekle, herkes beklesin
    _statsInFlight.set(cacheKey, computation);
    try {
      const data = await computation;
      res.json(data);
    } finally {
      _statsInFlight.delete(cacheKey);
    }
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product stats' } });
  }
});

import { createManualOrExcelProduct, softDeleteProduct, PRODUCT_STATUS_DELETED, type ManualProductInput } from '../services/productLifecycle.ts';
import { previewImport, commitImportFile } from '../services/excelImport.ts';

// ==================== ÜRÜN OLUŞTURMA / SİLME / EXCEL IMPORT (TASK314) ====================

// POST /products — Manuel ürün oluştur (canonical pipeline'a girer)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const actorUserId = (req as unknown as { actor?: { userId?: string } }).actor?.userId ?? null;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const input: ManualProductInput = {
      title: typeof b.title === 'string' ? b.title : '',
      sku: typeof b.sku === 'string' && b.sku.trim() ? b.sku.trim() : null,
      barcode: typeof b.barcode === 'string' && b.barcode.trim() ? b.barcode.trim() : null,
      brand: typeof b.brand === 'string' && b.brand.trim() ? b.brand.trim() : null,
      category: typeof b.category === 'string' && b.category.trim() ? b.category.trim() : null,
      stock: b.stock != null && Number.isFinite(Number(b.stock)) ? Number(b.stock) : undefined,
      purchasePrice: b.purchasePrice != null && b.purchasePrice !== '' ? Number(b.purchasePrice) : null,
      salePrice: b.salePrice != null && b.salePrice !== '' ? Number(b.salePrice) : null,
      vatRate: b.vatRate != null && b.vatRate !== '' ? Number(b.vatRate) : null,
      description: typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null,
      source: 'MANUAL',
      actorUserId,
    };
    const result = await createManualOrExcelProduct(input);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error creating product:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ürün oluşturulamadı' } });
  }
});

// POST /products/import/preview — Excel/CSV dosyasını DOĞRULAR, yazma YAPMAZ
router.post('/import/preview', requireAuth, async (req: Request, res: Response) => {
  try {
    const file = typeof req.body?.file === 'string' ? req.body.file : '';
    if (!file) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'file (base64) zorunlu' } });
    const result = await previewImport(file);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Error in import preview:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Önizleme başarısız' } });
  }
});

// POST /products/import/commit — dosyayı yeniden çözümler ve upsert eder (tombstone korumalı)
router.post('/import/commit', requireAuth, async (req: Request, res: Response) => {
  try {
    const file = typeof req.body?.file === 'string' ? req.body.file : '';
    if (!file) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'file (base64) zorunlu' } });
    const result = await commitImportFile(file);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Error in import commit:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Import başarısız' } });
  }
});

// DELETE /products/:id — explicit kullanıcı silmesi (soft-delete tombstone; XML re-import geri getirmez)
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    if (!/^[0-9a-fA-F-]{10,40}$/.test(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz ürün kimliği' } });
    }
    const actorUserId = (req as unknown as { actor?: { userId?: string } }).actor?.userId ?? null;
    const result = await softDeleteProduct(id, actorUserId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error deleting product:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ürün silinemedi' } });
  }
});

// POST /products/bulk-delete — toplu ürün silme (soft-delete tombstone)
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body ?? {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds dizisi zorunlu ve boş olamaz' } });
    }
    if (productIds.length > 200) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Tek seferde en fazla 200 ürün silinebilir' } });
    }
    const invalidIds = productIds.filter((id: unknown) => typeof id !== 'string' || !/^[0-9a-fA-F-]{10,40}$/.test(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `${invalidIds.length} geçersiz ürün kimliği`, invalidIds } });
    }
    const uniqueIds = [...new Set(productIds)];
    const actorUserId = (req as unknown as { actor?: { userId?: string } }).actor?.userId ?? null;

    const results = await Promise.allSettled(
      uniqueIds.map((id: string) => softDeleteProduct(id, actorUserId))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const failed = results.length - succeeded;
    const errors = results
      .map((r, i) => ({ id: uniqueIds[i], ...(r.status === 'fulfilled' ? r.value : { ok: false, status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } } }) }))
      .filter(r => !r.ok)
      .map(r => {
        const body = r.body as Record<string, unknown>;
        const errObj = (body?.error ?? {}) as Record<string, string>;
        return { id: r.id, code: errObj.code || 'UNKNOWN', message: errObj.message || 'Bilinmeyen hata' };
      });

    return res.status(200).json({ deleted: succeeded, failed, errors, total: uniqueIds.length });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Toplu silme başarısız' } });
  }
});

// POST /products/barcode-suffix — Seçili XML kaynağındaki tüm ürünlerin barkodlarına son ek uygula
// FIX(2M): Cursor-based batch — tüm ürünleri RAM'e almaz (2M ürün için ~800MB → 0)
router.post('/barcode-suffix', requireAuth, async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, suffix } = req.body ?? {};
    if (!xmlSourceId || typeof xmlSourceId !== 'string') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'xmlSourceId zorunludur' } });
    }
    const rawSuffix = typeof suffix === 'string' ? suffix.trim() : '';
    if (!rawSuffix) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Suffix boş olamaz' } });
    }
    const normalizedSuffix = rawSuffix.startsWith('-') ? rawSuffix : '-' + rawSuffix;

    const BATCH_SIZE = 1000;
    let cursor: string | undefined;
    let total = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    while (true) {
      // Cursor-based: her seferinde 1000 ürün yükle (RAM bounded)
      const products = await prisma.product.findMany({
        where: {
          xmlSourceId,
          barcode: { not: null, notIn: [''] },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, barcode: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });

      if (products.length === 0) break;
      total += products.length;

      const toUpdate: { id: string; newBarcode: string }[] = [];
      for (const p of products) {
        const bc = (p.barcode || '').trim();
        if (!bc) { skipped++; continue; }
        if (bc.endsWith(normalizedSuffix)) { skipped++; continue; }
        const m = bc.match(/-[A-Za-z0-9_]+$/);
        const newBarcode = m ? bc.slice(0, bc.length - m[0].length) + normalizedSuffix : bc + normalizedSuffix;
        toUpdate.push({ id: p.id, newBarcode });
      }

      if (toUpdate.length > 0) {
        const esc = (s: string) => s.replace(/'/g, "''");
        const caseBody = toUpdate.map(u => `WHEN '${esc(u.id)}' THEN '${esc(u.newBarcode)}'`).join(' ');
        const ids = toUpdate.map(u => `'${esc(u.id)}'`).join(',');
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "Product" SET barcode = CASE id ${caseBody} ELSE barcode END WHERE id IN (${ids})`
          );
          updated += toUpdate.length;
        } catch (e) {
          console.error(`[barcode-suffix] batch failed:`, e);
          failed += toUpdate.length;
        }
      }

      cursor = products[products.length - 1].id;
      if (products.length < BATCH_SIZE) break;
    }

    return res.status(200).json({ total, updated, skipped, failed, suffix: normalizedSuffix });
  } catch (error) {
    console.error('Error in barcode suffix:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Barkod son ek uygulanamadı' } });
  }
});

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
    // TASK313: actionable filtreler — KPI -> ürün listesi -> çözüm zinciri için
    const gate = String(req.query?.gate ?? '').trim(); // category | brand | variant | template | anyMissing
    const blockedCategory = req.query?.blockedCategory === 'true'; // eslesmis AMA aktif Trendyol mapping yok
    const aiSuggestedOnly = req.query?.aiSuggested === 'true';     // oneri var, eslesme yok
    const integrityOnly = req.query?.integrity === 'true';        // categoryId var, categoryMatch=false
    const insufficientOnly = req.query?.insufficient === 'true';  // tedarikçi kategori bilgisi yok
    const newQueue = req.query?.newQueue === 'true';              // TASK313-R3: son import ile gelen VE hâlâ READY olmayanlar
    // P0 DEFECTIVE: resim/barkod/fiyat/stok/tanım eksik ürünler — "Hatalı" kartı bu listeyi açar
    const defectiveOnly = req.query?.defective === 'true';

    // MODÜL 04: gerçek 1000 kayıt desteği (STABLE'da 100; modül gereği 1000'e yükseltildi)
    let page = Number(req.query?.page ?? 1);
    let limit = Number(req.query?.limit ?? 50);
    const cursor = req.query?.cursor as string | undefined; // FIX(2M): keyset pagination desteği

    // FIX(F-08): validasyon ARTIK gerçek sınırlarla yapılır; sessiz clamp kaldırıldı.
    const MIN_LIMIT = 10;
    const MAX_LIMIT = 100;
    if (!cursor) {
      if (!Number.isFinite(page) || page < 1) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz sayfa numarası' } });
    }
    if (!Number.isFinite(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Geçersiz limit değeri, ${MIN_LIMIT}-${MAX_LIMIT} arası olmalı` } });

    // FIX(2M): cursor varsa keyset pagination (OFFSET yok), yoksa klasik OFFSET
    const skip = cursor ? 0 : (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // FIX(2M): cursor-based WHERE ekle
    if (cursor) {
      where.id = { gt: cursor };
    }

    // XML kaynağı seçilmişse o kaynağa ait ürünler filtrelenir; seçilmemişse genel havuz
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    console.log('[products] GET / where:', JSON.stringify(where));

    // Gelişmiş arama (STABLE mirror: title + description dahil)
    // FIX(2M): title araması bellek içi index kullanır (LIKE '%...%' ~40s → ~50ms)
    let titleSearchIds: string[] | null = null;
    if (search) {
      if (searchField === 'title') {
        titleSearchIds = await searchByTitle(search);
        if (titleSearchIds.length === 0) {
          return res.json({ items: [], pagination: { page, limit, total: 0, totalPages: 0, nextCursor: null, hasMore: false } });
        }
        where.id = { in: titleSearchIds };
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

    // ---- TASK313 actionable filtreler ----
    if (gate === 'category') where.categoryMatch = false;
    else if (gate === 'brand') where.brandMatch = false;
    else if (gate === 'variant') { where.variantMatch = false; where.variantStatus = { not: 'NOT_REQUIRED' }; }
    else if (gate === 'template') where.templateMatch = false;
    else if (gate === 'anyMissing') {
      where.OR = [
        { categoryMatch: false },
        { brandMatch: false },
        { templateMatch: false },
        { AND: [{ variantMatch: false }, { NOT: { variantStatus: 'NOT_REQUIRED' } }] },
      ];
    }
    if (aiSuggestedOnly) { where.categoryMatch = false; where.aiSuggestedCategoryId = { not: null }; }
    if (integrityOnly) { where.categoryMatch = false; where.categoryId = { not: null }; }
    if (insufficientOnly) {
      where.categoryMatch = false;
      where.AND = [{ matchedBy: null }, { OR: [{ supplierCategory: null }, { supplierCategory: '' }] }];
    }
    // P0 DEFECTIVE: eksik alanlı ürünler (resim/barkod/fiyat/stok/tanım) — stats'taki
    // defective metric'i ile birebir aynı koşul (DB=API=UI parity)
    if (defectiveOnly) {
      where.AND = [...(((where.AND as unknown[]) ?? [])), {
        OR: [
          { images: null },
          { barcode: null },
          { salePrice: null },
          { stock: { lte: 0 } },
          { description: null },
        ],
      }];
    }
    if (newQueue) {
      // TASK313-R3 canonical NEW: son import run'ında gelen VE operasyonel olarak hâlâ bitmemiş ürün.
      // READY olan ürün "yeni" listesinde sonsuza kadar bekletilmez; yeni import gelirse pencere güncellenir.
      // P0 BUFFER FIX: lastRun artık seçili xmlSourceId context'ine göre — başka kaynağın run'ı
      // bu kaynağın "yeni" penceresini belirlemesin (xmlSourceId where'ine zaten bağlı, tutarlılık için).
      const lastRunQ = await prisma.xmlImportRun.findFirst({
        where: xmlSourceId ? { sourceId: xmlSourceId } : undefined,
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      if (lastRunQ) {
        where.createdAt = { gte: lastRunQ.startedAt };
        where.status = { not: 'READY' };
      } else {
        where.id = '__none__';
      }
    }
    if (blockedCategory) {
      // TASK313: eslesmis ama aktif Trendyol CategoryMapping'i olmayan kategoriler.
      // groupBy + kucuk IN listesi (SQLite param limiti guvenli).
      const ttMpForFilter = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
      if (ttMpForFilter) {
        const catGroups = await prisma.product.groupBy({ by: ['categoryId'], where: { categoryMatch: true, categoryId: { not: null } }, _count: { id: true } });
        const activeMaps = await prisma.categoryMapping.findMany({ where: { marketplaceId: ttMpForFilter.id, active: true, externalId: { not: null } }, select: { categoryId: true } });
        const mappedSet = new Set(activeMaps.map(m => m.categoryId));
        const blockedCatIds = catGroups.filter(g => !mappedSet.has(g.categoryId as string)).map(g => g.categoryId as string);
        where.categoryMatch = true;
        where.categoryId = blockedCatIds.length > 0 ? { in: blockedCatIds } : '__none__'; // bos liste -> hicbir urun
      }
    }
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

    // TASK314: silinmiş ürünler (tombstone) listede GÖRÜNMEZ; yalnızca ?status=DELETED ile açıkça istenirse döner
    if (status !== PRODUCT_STATUS_DELETED) {
      where.AND = [...(((where.AND as unknown[]) ?? [])), { status: { not: PRODUCT_STATUS_DELETED } }];
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: where as never,
        orderBy: orderBy as never,
        skip,
        take: limit,
        select: {
          id: true, title: true, sku: true, barcode: true, xmlKey: true,
          salePrice: true, purchasePrice: true, stock: true, minStock: true, status: true,
          images: true, seoTitle: true,
          vatRate: true, profitMargin: true, aiScore: true,
          computedTitle: true, prefixEnabled: true, supplierCategory: true,
          customBrandName: true, unit: true, currency: true, errorMessage: true,
          categoryId: true, brandId: true, xmlSourceId: true,
          categoryMatch: true, brandMatch: true, variantMatch: true, templateMatch: true,
          matchedBy: true, aiSuggestedCategoryId: true, variantStatus: true,
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
        page: cursor ? undefined : page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        // FIX(2M): keyset pagination cursor bilgisi
        nextCursor: items.length === limit ? items[items.length - 1].id : null,
        hasMore: items.length === limit,
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
    // TASK314: tombstone hariç (silinmiş ürün sayıları bozmasın)
    where.status = { not: PRODUCT_STATUS_DELETED };
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
    // TASK314: silinmiş ürün detayı açılmaz
    if ((product as { status?: string }).status === PRODUCT_STATUS_DELETED) {
      return res.status(404).json({ error: { code: 'PRODUCT_DELETED', message: 'Bu ürün kalıcı olarak silindi' } });
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
