/**
 * CATEGORY CORE V2 ROUTES — PRODUCT-LEVEL ONLY
 * POST /category-core-v2/run       → dry-run (default) veya apply; ürün başına bağımsız karar
 * POST /category-core-v2/evaluate  → frontend grup-aksiyonlarının ÜRÜN-BAZLI替代i
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { runCategoryCoreV2, evaluateProductsIndividually, type V2RunMetrics } from '../services/categoryCoreV2.ts';

const router = Router();

router.post('/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, limit, apply, aiLimit, includeMatched } = (req.body || {}) as {
      xmlSourceId?: string | null; limit?: number; apply?: boolean; aiLimit?: number; includeMatched?: boolean;
    };
    const metrics = await runCategoryCoreV2({
      xmlSourceId: xmlSourceId || null,
      limit,
      apply: !!apply,
      aiLimit: aiLimit ?? 0,
      includeMatched: !!includeMatched,
    });
    const { decisions, ...summary } = metrics;
    return res.json({ ok: true, summary, decisions: decisions.slice(0, 200) });
  } catch (error) {
    console.error('[category-core-v2] run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'V2 run basarisiz' } });
  }
});

router.post('/evaluate', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds, apply } = (req.body || {}) as { productIds?: unknown; apply?: boolean };
    if (!Array.isArray(productIds) || productIds.length === 0 || !productIds.every((x) => typeof x === 'string' && x.trim())) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds (string[]) gerekli' } });
    }
    // Her productId AYRI degerlendirilir; ayni kategori ciksa bile tek mutation/karar yayilmasi soz konusu degil.
    const result = await evaluateProductsIndividually(productIds as string[], !!apply);
    return res.json({ ok: true, ...result, groupMutations: 0, note: 'Her urun ayri karar aldi (PRODUCT-LEVEL)' });
  } catch (error) {
    console.error('[category-core-v2] evaluate error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'V2 evaluate basarisiz' } });
  }
});

export default router;
