import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { READY_FILTER, isReady, isPrepComplete, isVariantComplete } from '../services/readiness.ts';

const router = Router();

// ==================== GÖNDERIME HAZIR İSTATİSTİK ====================
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    // CONTEXT-001: stats da xmlSourceId context'ine saygı duyar (UI KPI ile tablo aynı context'te kalır).
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const where: Record<string, unknown> = {};
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const [
      totalProducts,
      readyCount,
      notReadyCount,
      missingCategory,
      missingBrand,
      missingVariant,
      missingTemplate,
      missingImage,
      missingBarcode,
      missingPrice,
      missingStock,
      errorCount,
    ] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, ...READY_FILTER } }),
      prisma.product.count({ where: { ...where, NOT: READY_FILTER } }),
      prisma.product.count({ where: { ...where, categoryMatch: false } }),
      prisma.product.count({ where: { ...where, brandMatch: false } }),
      prisma.product.count({ where: { ...where, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } }),
      prisma.product.count({ where: { ...where, templateMatch: false } }),
      prisma.product.count({ where: { ...where, images: null } }),
      prisma.product.count({ where: { ...where, barcode: null } }),
      prisma.product.count({ where: { ...where, salePrice: null } }),
      prisma.product.count({ where: { ...where, stock: { lte: 0 } } }),
      prisma.product.count({ where: { ...where, status: 'ERROR' } }),
    ]);

    res.json({
      totalProducts,
      readyCount,
      notReadyCount,
      missingCategory,
      missingBrand,
      missingVariant,
      missingTemplate,
      missingImage,
      missingBarcode,
      missingPrice,
      missingStock,
      errorCount,
    });
  } catch (error) {
    console.error('Error fetching ready-to-ship stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' } });
  }
});

// ==================== GÖNDERIME HAZIR LİSTELEME ====================
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const filter = String(req.query?.filter ?? 'all'); // all | ready | not-ready
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const missingReason = req.query?.missingReason ? String(req.query.missingReason) : null;
    const sortBy = String(req.query?.sortBy ?? 'createdAt');
    const sortOrder = String(req.query?.sortOrder ?? 'desc');
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(500, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
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

    if (xmlSourceId) {
      where.xmlSourceId = xmlSourceId;
    }

    // Filter by readiness (tek authoritative READY_FILTER)
    if (filter === 'ready') {
      and.push(READY_FILTER);
    } else if (filter === 'not-ready') {
      and.push({ NOT: READY_FILTER });
    }

    // Missing reason filter
    if (missingReason) {
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
      if (reasonMap[missingReason]) {
        and.push(reasonMap[missingReason]);
      }
    }

    if (and.length > 0) {
      where.AND = and;
    }

    const orderBy: Record<string, string> = {};
    const validSortFields = ['createdAt', 'updatedAt', 'title', 'stock', 'salePrice', 'status'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    orderBy[sortField] = sortOrder === 'asc' ? 'asc' : 'desc';

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where: where as never,
        orderBy: orderBy as never,
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
          description: true,
          categoryMatch: true,
          brandMatch: true,
          variantMatch: true,
          variantStatus: true,
          templateMatch: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          xmlSource: { select: { id: true, name: true, company: true } },
        },
      }),
      prisma.product.count({ where: where as never }),
    ]);

    // Compute readiness and missing reasons for each product (tek authoritative kural)
    const itemsWithReadiness = items.map((item) => {
      const ready = isReady({
        status: item.status,
        categoryMatch: item.categoryMatch,
        brandMatch: item.brandMatch,
        templateMatch: item.templateMatch,
        variantMatch: item.variantMatch,
        variantStatus: item.variantStatus,
      });

      const missingReasons: string[] = [];
      if (!item.categoryMatch) missingReasons.push('Kategori');
      if (!item.brandMatch) missingReasons.push('Marka');
      if (!isVariantComplete({ variantMatch: item.variantMatch, variantStatus: item.variantStatus })) missingReasons.push('Varyant');
      if (!item.templateMatch) missingReasons.push('Şablon');
      if (!item.images) missingReasons.push('Görsel');
      if (!item.barcode) missingReasons.push('Barkod');
      if (item.salePrice == null) missingReasons.push('Fiyat');
      if (item.stock <= 0) missingReasons.push('Stok');
      if (item.status === 'ERROR') missingReasons.push('Hata');

      return {
        ...item,
        isReady: ready,
        missingReasons,
      };
    });

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
    console.error('Error fetching ready-to-ship products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch products' } });
  }
});

// ==================== TOPLU GÖNDERIME ALMA ====================
router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const productIds = (Array.isArray(req.body?.productIds) ? req.body.productIds : []).map((x: unknown) => String(x)).filter(Boolean);
    const xmlSourceId = String(req.query?.xmlSourceId ?? req.body?.xmlSourceId ?? '');
    const marketplaceId = String(req.query?.marketplaceId ?? req.body?.marketplaceId ?? '');

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }
    if (!xmlSourceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId zorunludur' } });
    }
    if (!marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceId zorunludur' } });
    }

    const marketplace = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { id: true, key: true, name: true, active: true } });
    if (!marketplace) {
      return res.status(404).json({ ok: false, error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Pazaryeri bulunamadı' } });
    }

    // Backend authoritative: DB'den yeniden oku, READY'yi sunucuda hesapla (frontend'e güvenme)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true, xmlSourceId: true, status: true, title: true,
        categoryMatch: true, brandMatch: true, templateMatch: true,
        variantMatch: true, variantStatus: true,
      },
    });

    const invalid: Array<{ productId: string; reason: string; missing?: string[] }> = [];
    const ready: Array<{ id: string; title: string | null }> = [];
    const foundIds = new Set(products.map((p) => p.id));

    for (const id of productIds) {
      if (!foundIds.has(id)) invalid.push({ productId: id, reason: 'NOT_FOUND' });
    }

    for (const p of products) {
      if (p.xmlSourceId !== xmlSourceId) {
        invalid.push({ productId: p.id, reason: 'WRONG_XML_CONTEXT' });
        continue;
      }
      const okReady = isReady({
        status: p.status,
        categoryMatch: p.categoryMatch,
        brandMatch: p.brandMatch,
        templateMatch: p.templateMatch,
        variantMatch: p.variantMatch,
        variantStatus: p.variantStatus,
      });
      if (!okReady) {
        const missing: string[] = [];
        if (!p.categoryMatch) missing.push('Kategori');
        if (!p.brandMatch) missing.push('Marka');
        if (!p.templateMatch) missing.push('Listeleme');
        if (!isVariantComplete({ variantMatch: p.variantMatch, variantStatus: p.variantStatus })) missing.push('Varyant');
        if (p.status !== 'READY') missing.push('Status=' + p.status);
        invalid.push({ productId: p.id, reason: 'NOT_READY', missing });
        continue;
      }
      ready.push(p);
    }

    if (ready.length === 0) {
      return res.status(400).json({
        ok: false,
        error: { code: 'NO_READY_PRODUCTS', message: 'Seçilen ürünlerin hiçbiri bu context için gönderime uygun değil' },
        invalid,
      });
    }

    // Bu fazda gerçek marketplace API YOK → sahte SENT/ACTIVE/listingId YAZILMAZ.
    // Durum dürüstçe NOT_CONFIGURED olarak işaretlenir; idempotent (unique productId+marketplaceId).
    const now = new Date();
    const results: Array<{ productId: string; status: string; duplicate: boolean }> = [];
    for (const p of ready) {
      const existing = await prisma.productMarketplaceState.findUnique({
        where: { productId_marketplaceId: { productId: p.id, marketplaceId } },
        select: { id: true, status: true },
      });
      if (existing && ['SENDING', 'ACTIVE'].includes(existing.status)) {
        results.push({ productId: p.id, status: existing.status, duplicate: true });
        continue;
      }
      const data = {
        status: 'NOT_CONFIGURED',
        errorMessage: 'Gerçek marketplace API entegrasyonu henüz yapılmadı (sonraki faz)',
        lastActionAt: now,
      };
      if (existing) {
        await prisma.productMarketplaceState.update({ where: { id: existing.id }, data });
      } else {
        await prisma.productMarketplaceState.create({ data: { productId: p.id, marketplaceId, ...data } });
      }
      results.push({ productId: p.id, status: 'NOT_CONFIGURED', duplicate: false });
    }

    res.json({
      ok: false,
      code: 'MARKETPLACE_NOT_CONFIGURED',
      message: 'Gerçek marketplace API entegrasyonu yapılmadı — hiçbir ürün gönderilmedi (NOT_CONFIGURED)',
      readyCount: ready.length,
      invalidCount: invalid.length,
      invalid,
      results,
    });
  } catch (error) {
    console.error('Error sending products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send products' } });
  }
});

// ==================== TEKRAR KONTROL ====================
router.post('/recheck', requireAuth, async (req: Request, res: Response) => {
  try {
    const productIds = req.body?.productIds;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    // Re-evaluate readiness by checking all conditions
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
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
        await prisma.product.update({
          where: { id: p.id },
          data: { status: 'READY' },
        });
        updatedCount++;
      } else if (!allReady && p.status === 'READY') {
        await prisma.product.update({
          where: { id: p.id },
          data: { status: 'XML' },
        });
        updatedCount++;
      }
    }

    res.json({
      ok: true,
      message: `${updatedCount} ürün durumu güncellendi`,
      updatedCount,
      checkedCount: products.length,
    });
  } catch (error) {
    console.error('Error rechecking products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to recheck products' } });
  }
});

// ==================== ÜRÜN DETAY ====================
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
            marketplace: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });
    }

    const ready = isReady({
      status: product.status,
      categoryMatch: product.categoryMatch,
      brandMatch: product.brandMatch,
      templateMatch: product.templateMatch,
      variantMatch: product.variantMatch,
      variantStatus: product.variantStatus,
    });

    const missingReasons: string[] = [];
    if (!product.categoryMatch) missingReasons.push('Kategori eşleştirilmemiş');
    if (!product.brandMatch) missingReasons.push('Marka eşleştirilmemiş');
    if (!isVariantComplete({ variantMatch: product.variantMatch, variantStatus: product.variantStatus })) missingReasons.push('Varyant eşleştirilmemiş');
    if (!product.templateMatch) missingReasons.push('Şablon eşleştirilmemiş');
    if (!product.images) missingReasons.push('Görsel eksik');
    if (!product.barcode) missingReasons.push('Barkod eksik');
    if (product.salePrice == null) missingReasons.push('Fiyat belirlenmemiş');
    if (product.stock <= 0) missingReasons.push('Stokta ürün yok');
    if (product.status === 'ERROR') missingReasons.push('Üründe hata var');

    res.json({
      ...product,
      isReady: ready,
      missingReasons,
    });
  } catch (error) {
    console.error('Error fetching product detail:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product' } });
  }
});

export default router;
