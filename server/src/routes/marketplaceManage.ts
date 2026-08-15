import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';

const router = Router();

// GET / - List marketplaces with stats
router.get('/', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const items = await prisma.marketplace.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, key: true, name: true, apiStatus: true, active: true,
        apiKey: true, apiSecret: true, apiUrl: true, merchantId: true, storeId: true,
        settings: true, createdAt: true, updatedAt: true,
        _count: { select: { productMarketplaceStates: true, orders: true } },
      },
    });
    res.json({ items });
  } catch (error) {
    console.error('Error fetching marketplaces:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch marketplaces' } });
  }
});

// GET /stats - Marketplace stats
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [total, active, errorCount, productCount] = await Promise.all([
      prisma.marketplace.count(),
      prisma.marketplace.count({ where: { active: true } }),
      prisma.marketplace.count({ where: { apiStatus: 'error' } }),
      prisma.productMarketplaceState.count(),
    ]);
    res.json({ total, active, errorCount, productCount });
  } catch (error) {
    console.error('Error fetching marketplace stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch marketplace stats' } });
  }
});

// POST / - Create marketplace
router.post('/', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { key, name, apiUrl, apiKey, apiSecret, merchantId, sellerId, storeId, settings, active } = req.body || {};
    if (!key || !name) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'key ve name zorunludur' } });
    }
    const existing = await prisma.marketplace.findUnique({ where: { key } });
    if (existing) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Bu key ile zaten bir pazaryeri mevcut' } });
    }
    let finalSettings: Record<string, unknown> = {};
    try { finalSettings = JSON.parse(settings || '{}'); } catch(e) {}
    if (sellerId) finalSettings.sellerId = sellerId;
    const mp = await prisma.marketplace.create({
      data: {
        key, name,
        apiUrl: apiUrl || null,
        apiKey: apiKey || null,
        apiSecret: apiSecret || null,
        merchantId: merchantId || null,
        storeId: storeId || null,
        settings: JSON.stringify(finalSettings),
        active: active !== undefined ? active : true,
      },
    });
    res.json({ ok: true, item: mp });
  } catch (error) {
    console.error('Error creating marketplace:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create marketplace' } });
  }
});

// PUT /:id - Update marketplace
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz marketplace ID formatı' } });
    }
    const data: Record<string, unknown> = {};
    if (req.body?.name !== undefined) data.name = req.body.name;
    if (req.body?.apiUrl !== undefined) data.apiUrl = req.body.apiUrl;
    if (req.body?.apiKey !== undefined) data.apiKey = req.body.apiKey;
    if (req.body?.apiSecret !== undefined) data.apiSecret = req.body.apiSecret;
    if (req.body?.merchantId !== undefined) data.merchantId = req.body.merchantId;
    if (req.body?.storeId !== undefined) data.storeId = req.body.storeId;
    if (req.body?.active !== undefined) data.active = req.body.active;
    if (req.body?.apiStatus !== undefined) data.apiStatus = req.body.apiStatus;
    if (req.body?.settings !== undefined) data.settings = req.body.settings;
    if (req.body?.sellerId !== undefined) {
      const existing = await prisma.marketplace.findUnique({ where: { id }, select: { settings: true } });
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(String(existing?.settings || '{}')); } catch(e) {}
      settings.sellerId = req.body.sellerId;
      data.settings = JSON.stringify(settings);
    }

    const mp = await prisma.marketplace.update({ where: { id }, data });
    res.json({ ok: true, item: mp });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pazaryeri bulunamadı' } });
    }
    console.error('Error updating marketplace:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update marketplace' } });
  }
});

// DELETE /:id - Delete marketplace (ilişkili kayıtlarla birlikte)
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const existing = await prisma.marketplace.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pazaryeri bulunamadı' } });
    }

    // FK kısıtlarını aşmak için önce ilişkili kayıtları sil, sonra marketplace'i sil
    await prisma.$transaction(async (tx) => {
      await tx.productMarketplaceState.deleteMany({ where: { marketplaceId: id } });
      await tx.categoryMapping.deleteMany({ where: { marketplaceId: id } });
      await tx.listingTemplate.deleteMany({ where: { marketplaceId: id } });
      await tx.marketplacePricingRule.deleteMany({ where: { marketplaceId: id } });
      await tx.order.deleteMany({ where: { marketplaceId: id } });
      await tx.marketplace.delete({ where: { id } });
    });

    res.json({ ok: true, message: 'Pazaryeri silindi' });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pazaryeri bulunamadı' } });
    }
    console.error('Error deleting marketplace:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete marketplace' } });
  }
});

// POST /:id/test - Test connection
router.post('/:id/test', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    const mp = await prisma.marketplace.findUnique({ where: { id }, select: { id: true, name: true, apiUrl: true } });
    if (!mp) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pazaryeri bulunamadı' } });
    }
    // Gerçek pazaryeri API entegrasyonu bulunmuyor; bu uç simülasyon yapmaz,
    // yalnızca "yapılandırılmadı" durumunu dürüstçe bildirir.
    await prisma.marketplace.update({
      where: { id },
      data: { apiStatus: 'unknown' },
    });
    res.json({
      ok: false,
      simulated: true,
      message: 'Gerçek pazaryeri API entegrasyonu yapılandırılmadı (NOT CONFIGURED) — bu uç simülasyon değildir',
    });
  } catch (error) {
    console.error('Error testing marketplace:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Connection test failed' } });
  }
});

export default router;
