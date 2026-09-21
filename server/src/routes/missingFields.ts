/**
 * MISSING FIELDS ROUTES — Pazaryeri zorunlu alan eksiklikleri için API
 *
 * GET  /missing-fields/stats     → Kullanıcı müdahalesi gereken ürün sayısı
 * GET  /missing-fields           → Çözülemeyen kayıtların listesi
 * POST /missing-fields/auto-resolve → Toplu otomatik çözüm
 * POST /missing-fields/:id/resolve  → Tekil manuel eşleştirme
 */
import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/authMiddleware.ts';
import { scanMissingFields, scanMissingFieldsQuick, resolveManually, autoResolveMissingFields, getAutoResolveMetrics } from '../services/missingFieldsService.ts';
import { prisma } from '../db/prisma.ts';

const router = Router();

// ─── GET /missing-fields/stats ──────────────────────────────────────────────
// Sadece sayıları döndür (hızlı). cache: 30sn.
let statsCache: { data: any; at: number } | null = null;
const STATS_CACHE_TTL = 30_000;

router.get('/stats', requireAuth, async (_req, res: Response) => {
  try {
    if (statsCache && Date.now() - statsCache.at < STATS_CACHE_TTL) {
      return res.json({ ok: true, data: statsCache.data });
    }

    const stats = await scanMissingFieldsQuick({ limit: 500 });

    // GERÇEK auto-resolve sonucunu göster (sabit 0 değil).
    const am = getAutoResolveMetrics();
    const data: any = { ...stats };
    if (am) { data.autoResolved = Math.max(0, (am.baselineMissing || 0) - stats.totalMissing); data.autoResolveMetrics = am; }

    statsCache = { data, at: Date.now() };
    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('[missing-fields][stats]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Stats alınamadı' });
  }
});

// ─── GET /missing-fields ────────────────────────────────────────────────────
// Çözülemeyen kayıtları listele (sayfalı)
router.get('/', requireAuth, async (req, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(req.query?.limit ?? 50)));
    const xmlSourceId = typeof req.query?.xmlSourceId === 'string' ? req.query.xmlSourceId : undefined;
    const field = typeof req.query?.field === 'string' ? req.query.field : undefined;

    const result = await scanMissingFields({ useAI: false, applyAutoResolve: false, xmlSourceId, limit: 20, page });

    let items = result.items;

    // Alan filtresi (DB seviyesinde yapılamıyorsa, uygulama içinde filtrele)
    if (field && field !== 'all') {
      items = items.filter(item =>
        item.missingAttributes.some(m => {
          const n = m.attributeName.toLowerCase();
          if (field === 'model') return n.includes('model');
          if (field === 'beden') return n.includes('beden') || n.includes('size');
          if (field === 'boyut') return n.includes('boyut') || n.includes('ebat');
          if (field === 'duy') return n.includes('duy');
          if (field === 'calisma') return n.includes('çalışma') || n.includes('calisma');
          if (field === 'kamera') return n.includes('kamera');
          if (field === 'uyari') return n.includes('uyarı') || n.includes('uyari');
          if (field === 'hacim') return n.includes('hacim');
          if (field === 'voltaj') return n.includes('voltaj');
          if (field === 'frekans') return n.includes('frekans');
          return false;
        })
      );
    }

    // Cache'i temizle
    statsCache = null;

    return res.json({
      ok: true,
      data: {
        items,
        total: result.stats.needsUser,
        page,
        limit: 20,
        totalPages: Math.ceil(result.stats.needsUser / 20),
        stats: result.stats,
      },
    });
  } catch (error: any) {
    console.error('[missing-fields][list]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Liste alınamadı' });
  }
});

// ─── POST /missing-fields/auto-resolve ──────────────────────────────────────
// Toplu otomatik çözüm
router.post('/auto-resolve', requireAuth, async (req, res: Response) => {
  try {
    const useAI = req.body?.useAI === true; // güvenli varsayılan: önce deterministik
    const limit = Math.min(1200, Math.max(1, Number(req.body?.limit ?? 60)));
    const batchSize = Math.min(50, Math.max(1, Number(req.body?.batchSize ?? 15)));
    const waitMs = Math.min(10000, Math.max(0, Number(req.body?.waitMs ?? 1200)));

    const result = await autoResolveMissingFields({ useAI, maxProducts: limit, batchSize, waitMs });

    statsCache = null;
    return res.json({ ok: true, data: result });
  } catch (error: any) {
    console.error('[missing-fields][auto-resolve]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Otomatik çözüm başarısız' });
  }
});

// ─── POST /missing-fields/:id/resolve ───────────────────────────────────────
// Tekil manuel eşleştirme
router.post('/:id/resolve', requireAuth, async (req, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { attributeId, valueId, value, categoryExternalId, marketplaceId } = req.body ?? {};

    if (!attributeId || !valueId || !categoryExternalId || !marketplaceId) {
      return res.status(400).json({
        ok: false,
        error: 'attributeId, valueId, categoryExternalId ve marketplaceId zorunludur',
      });
    }

    const result = await resolveManually(
      productId,
      marketplaceId,
      Number(attributeId),
      Number(valueId),
      String(value || ''),
      Number(categoryExternalId)
    );

    // Cache temizle
    statsCache = null;

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    return res.json({ ok: true, data: result });
  } catch (error: any) {
    console.error('[missing-fields][resolve]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Eşleştirme başarısız' });
  }
});

// ─── GET /missing-fields/attribute-values ──────────────────────────────────
// Belirli bir attribute için geçerli Trendyol değerlerini döndür (manuel seçim için)
router.get('/attribute-values', requireAuth, async (req, res: Response) => {
  try {
    const attributeId = Number(req.query.attributeId);
    const categoryExternalId = Number(req.query.categoryExternalId);

    if (!attributeId || !categoryExternalId) {
      return res.status(400).json({ ok: false, error: 'attributeId ve categoryExternalId zorunludur' });
    }

    const { fetchTrendyolAttributeValues } = await import('../services/trendyolCatalog.ts');
    const values = await fetchTrendyolAttributeValues(categoryExternalId, attributeId, 300);

    return res.json({ ok: true, data: values });
  } catch (error: any) {
    console.error('[missing-fields][attr-values]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Değerler alınamadı' });
  }
});

// ─── GET /missing-fields/:id/gate-detail ────────────────────────────────────
// Ürünün gate detayını göster (hangi adımda başarısız, eksik attribute'lar)
router.get('/:id/gate-detail', requireAuth, async (req, res: Response) => {
  try {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const marketplaceId = typeof req.query.marketplaceId === 'string' ? req.query.marketplaceId : undefined;

    if (!marketplaceId) {
      return res.status(400).json({ ok: false, error: 'marketplaceId zorunludur' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { xmlSourceId: true },
    });
    if (!product?.xmlSourceId) {
      return res.status(404).json({ ok: false, error: 'Ürün bulunamadı' });
    }

    const { evaluateTrendyolSendGate } = await import('../services/sendReadiness.ts');
    const gate = await evaluateTrendyolSendGate({
      productId,
      marketplaceId,
      xmlSourceId: product.xmlSourceId,
    });

    return res.json({ ok: true, data: gate });
  } catch (error: any) {
    console.error('[missing-fields][gate-detail]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Gate detayı alınamadı' });
  }
});

export default router;
