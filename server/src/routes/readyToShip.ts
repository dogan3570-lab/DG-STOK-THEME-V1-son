import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// ==================== GÖNDERIME HAZIR İSTATİSTİK ====================
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [
      totalProducts,
      readyCount,
      notReadyCount,
      missingCategory,
      missingBrand,
      missingTemplate,
      missingImage,
      missingBarcode,
      missingPrice,
      missingStock,
      errorCount,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({
        where: {
          status: 'READY',
          categoryMatch: true,
          brandMatch: true,
          templateMatch: true,
        },
      }),
      prisma.product.count({
        where: {
          OR: [
            { status: { not: 'READY' } },
            { categoryMatch: false },
            { brandMatch: false },
            { templateMatch: false },
          ],
        },
      }),
      prisma.product.count({ where: { categoryMatch: false } }),
      prisma.product.count({ where: { brandMatch: false } }),
      prisma.product.count({ where: { templateMatch: false } }),
      prisma.product.count({ where: { images: null } }),
      prisma.product.count({ where: { barcode: null } }),
      prisma.product.count({ where: { salePrice: null } }),
      prisma.product.count({ where: { stock: { lte: 0 } } }),
      prisma.product.count({ where: { status: 'ERROR' } }),
    ]);

    res.json({
      totalProducts,
      readyCount,
      notReadyCount,
      missingCategory,
      missingBrand,
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

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { xmlKey: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ];
    }

    if (xmlSourceId) {
      where.xmlSourceId = xmlSourceId;
    }

    // Filter by readiness
    if (filter === 'ready') {
      where.status = 'READY';
      where.categoryMatch = true;
      where.brandMatch = true;
      where.templateMatch = true;
    } else if (filter === 'not-ready') {
      where.OR = [
        { status: { not: 'READY' } },
        { categoryMatch: false },
        { brandMatch: false },
        { templateMatch: false },
      ];
    }

    // Missing reason filter
    if (missingReason) {
      const reasonMap: Record<string, Record<string, unknown>> = {
        category: { categoryMatch: false },
        brand: { brandMatch: false },
        template: { templateMatch: false },
        image: { images: null },
        barcode: { barcode: null },
        price: { salePrice: null },
        stock: { stock: { lte: 0 } },
        error: { status: 'ERROR' },
      };
      if (reasonMap[missingReason]) {
        Object.assign(where, reasonMap[missingReason]);
      }
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

    // Compute readiness and missing reasons for each product
    const itemsWithReadiness = items.map((item) => {
      const isReady =
        item.status === 'READY' &&
        item.categoryMatch === true &&
        item.brandMatch === true &&
        item.templateMatch === true;

      const missingReasons: string[] = [];
      if (!item.categoryMatch) missingReasons.push('Kategori');
      if (!item.brandMatch) missingReasons.push('Marka');
      if (!item.templateMatch) missingReasons.push('Şablon');
      if (!item.images) missingReasons.push('Görsel');
      if (!item.barcode) missingReasons.push('Barkod');
      if (item.salePrice == null) missingReasons.push('Fiyat');
      if (item.stock <= 0) missingReasons.push('Stok');
      if (item.status === 'ERROR') missingReasons.push('Hata');

      return {
        ...item,
        isReady,
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
    const productIds = req.body?.productIds;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    // Only send products that are actually ready
    const readyProducts = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'READY',
        categoryMatch: true,
        brandMatch: true,
        templateMatch: true,
      },
      select: { id: true, title: true },
    });

    if (readyProducts.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Seçilen ürünlerin hiçbiri gönderime uygun değil' } });
    }

    const result = await prisma.product.updateMany({
      where: { id: { in: readyProducts.map((p) => p.id) } },
      data: { status: 'SENT' },
    });

    res.json({
      ok: true,
      message: `${result.count} ürün gönderime alındı`,
      sentCount: result.count,
      skippedCount: productIds.length - result.count,
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
        images: true,
        barcode: true,
        salePrice: true,
        stock: true,
        status: true,
      },
    });

    let updatedCount = 0;
    for (const p of products) {
      const allReady =
        p.status !== 'ERROR' &&
        p.categoryMatch &&
        p.brandMatch &&
        p.templateMatch;

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

    const isReady =
      product.status === 'READY' &&
      product.categoryMatch &&
      product.brandMatch &&
      product.templateMatch;

    const missingReasons: string[] = [];
    if (!product.categoryMatch) missingReasons.push('Kategori eşleştirilmemiş');
    if (!product.brandMatch) missingReasons.push('Marka eşleştirilmemiş');
    if (!product.templateMatch) missingReasons.push('Şablon eşleştirilmemiş');
    if (!product.images) missingReasons.push('Görsel eksik');
    if (!product.barcode) missingReasons.push('Barkod eksik');
    if (product.salePrice == null) missingReasons.push('Fiyat belirlenmemiş');
    if (product.stock <= 0) missingReasons.push('Stokta ürün yok');
    if (product.status === 'ERROR') missingReasons.push('Üründe hata var');

    res.json({
      ...product,
      isReady,
      missingReasons,
    });
  } catch (error) {
    console.error('Error fetching product detail:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product' } });
  }
});

export default router;
