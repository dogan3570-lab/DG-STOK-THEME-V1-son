import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { sendProductToMarketplace } from '../services/marketplace/sendPipeline.ts';

const router = Router();

/**
 * Gerçek marketplace gönderim ucu.
 * Gönderim Merkezi (readyToShip) kilitli olduğu için bu uç ayrıdır;
 * backend authoritative 4/4 + context + credential + SSRF + retry + idempotency
 * zincirini çalıştırır. Sahte ACTIVE/SENT/listingId ÜRETİLMEZ.
 */
router.post('/send', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const productIds: string[] = (Array.isArray(req.body?.productIds) ? req.body.productIds : [])
      .map((x: unknown) => String(x))
      .filter(Boolean);
    const xmlSourceId = String(req.body?.xmlSourceId ?? req.query?.xmlSourceId ?? '');
    const marketplaceId = String(req.body?.marketplaceId ?? req.query?.marketplaceId ?? '');

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }
    if (!xmlSourceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId zorunludur' } });
    }
    if (!marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'marketplaceId zorunludur' } });
    }

    const results = [];
    for (const productId of productIds.slice(0, 100)) {
      try {
        results.push(await sendProductToMarketplace({ productId, marketplaceId, xmlSourceId }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Gönderim sırasında hata oluştu';
        results.push({
          productId,
          marketplaceId,
          ok: false,
          status: 'ERROR',
          duplicate: false,
          externalListingId: null,
          errorCode: 'INTERNAL_ERROR',
          errorMessage: msg,
        });
      }
    }

    return res.json({ ok: true, results });
  } catch (error) {
    console.error('Error in marketplace send:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to send products' } });
  }
});

export default router;
