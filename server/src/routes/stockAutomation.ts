import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import {
  STOCK_AUTO_KEYS,
  DEFAULT_STOCK_AUTO_CONFIG,
  getStockAutomationConfig,
  runStockAutomation,
} from '../services/stockAutomation.ts';

const router = Router();

function parseConfigField(body: unknown, field: string): number | null {
  if (body && typeof body === 'object' && field in (body as Record<string, unknown>)) {
    const n = Number((body as Record<string, unknown>)[field]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// GET /stock-automation — config + durum özeti
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await getStockAutomationConfig();
    const [openCount, closedCount] = await Promise.all([
      prisma.productMarketplaceState.count({ where: { status: { in: ['ACTIVE', 'SENDING'] } } }),
      prisma.productMarketplaceState.count({ where: { status: 'CLOSED' } }),
    ]);
    res.json({ config, summary: { open: openCount, closed: closedCount } });
  } catch (e) {
    console.error('[stock-automation] GET error:', e);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Stok otomasyonu durumu alınamadı' } });
  }
});

// PUT /stock-automation — eşikleri kaydet
router.put('/', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const enabled = body.enabled === true || body.enabled === 'true';
    const closeAt = parseConfigField(body, 'closeAt');
    const openAt = parseConfigField(body, 'openAt');
    const prepMin = parseConfigField(body, 'prepMin');
    const prepMax = parseConfigField(body, 'prepMax');

    if (closeAt === null || openAt === null || prepMin === null || prepMax === null) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'closeAt, openAt, prepMin, prepMax sayısal olmalıdır' } });
    }
    if (closeAt < 0 || openAt < 0 || prepMin < 0 || prepMax < 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Eşikler negatif olamaz' } });
    }
    if (closeAt >= openAt) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Satışı kapatma stoğu, açma stoğundan küçük olmalıdır (closeAt < openAt)' } });
    }
    if (prepMin > prepMax) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Hazırlama min stoğu, max stoğundan büyük olamaz' } });
    }

    const entries: Array<[string, string]> = [
      [STOCK_AUTO_KEYS.enabled, enabled ? 'true' : 'false'],
      [STOCK_AUTO_KEYS.closeAt, String(Math.floor(closeAt))],
      [STOCK_AUTO_KEYS.openAt, String(Math.floor(openAt))],
      [STOCK_AUTO_KEYS.prepMin, String(Math.floor(prepMin))],
      [STOCK_AUTO_KEYS.prepMax, String(Math.floor(prepMax))],
    ];
    for (const [key, value] of entries) {
      await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }

    const config = await getStockAutomationConfig();
    res.json({ ok: true, config });
  } catch (e) {
    console.error('[stock-automation] PUT error:', e);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Stok otomasyonu ayarları kaydedilemedi' } });
  }
});

// POST /stock-automation/run — motoru manuel çalıştır
router.post('/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (_req: Request, res: Response) => {
  try {
    const stats = await runStockAutomation();
    res.json({ ok: true, stats });
  } catch (e) {
    console.error('[stock-automation] run error:', e);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Stok otomasyonu çalıştırılamadı' } });
  }
});

export default router;

/** Varsayılan config — UI başlangıç değerleri için dışa aktarılır. */
export { DEFAULT_STOCK_AUTO_CONFIG };
