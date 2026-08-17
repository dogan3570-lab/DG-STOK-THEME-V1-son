import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import {
  mapTrendyolCategories,
  mapTrendyolBrands,
  mapTrendyolVariants,
  runTrendyolMappingPipeline,
  getTrendyolMappingStatus,
} from '../services/trendyolMapping.ts';
import { evaluateTrendyolSendGate } from '../services/sendReadiness.ts';
import { trendyolAdapter } from '../services/marketplace/adapters.ts';
import type { MarketplaceListingPayload } from '../services/marketplace/types.ts';

const router = Router();

function readContext(req: Request): { xmlSourceId: string; marketplaceId: string } {
  const xmlSourceId = String(req.query?.xmlSourceId ?? req.body?.xmlSourceId ?? '');
  const marketplaceId = String(req.query?.marketplaceId ?? req.body?.marketplaceId ?? '');
  return { xmlSourceId, marketplaceId };
}

// ==================== 3 SANİYE UX: CONTEXT + 4/4 GATE DURUMU ====================
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }
    const status = await getTrendyolMappingStatus({ xmlSourceId, marketplaceId });
    return res.json(status);
  } catch (error) {
    console.error('[trendyol-mapping] status error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Durum alınamadı' } });
  }
});

// ==================== KONTROLLÜ MAPPING PIPELINE (10/10/10) ====================
router.post('/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    const result = await runTrendyolMappingPipeline({ xmlSourceId, marketplaceId, limit });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[trendyol-mapping] run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Mapping çalıştırılamadı' } });
  }
});

router.post('/category/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    return res.json(await mapTrendyolCategories({ xmlSourceId, marketplaceId, limit }));
  } catch (error) {
    console.error('[trendyol-mapping] category run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Kategori mapping çalıştırılamadı' } });
  }
});

router.post('/brand/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    return res.json(await mapTrendyolBrands({ xmlSourceId, marketplaceId, limit }));
  } catch (error) {
    console.error('[trendyol-mapping] brand run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Marka mapping çalıştırılamadı' } });
  }
});

router.post('/variant/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit ?? 10)));
    return res.json(await mapTrendyolVariants({ xmlSourceId, marketplaceId, limit }));
  } catch (error) {
    console.error('[trendyol-mapping] variant run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Varyant mapping çalıştırılamadı' } });
  }
});

// ==================== AŞAMA 5: MOCK SEND TEST (ağ isteği YOK) ====================
router.post('/mock-send-test', requireAuth, async (req: Request, res: Response) => {
  try {
    const productId = String(req.body?.productId ?? '');
    const { xmlSourceId, marketplaceId } = readContext(req);
    if (!productId || !xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'productId, xmlSourceId ve marketplaceId zorunludur' } });
    }

    const gate = await evaluateTrendyolSendGate({ productId, marketplaceId, xmlSourceId });
    if (!gate.ok) {
      return res.json({
        ok: false,
        liveSend: 'BLOCKED',
        gate: {
          ok: false,
          firstFailureCode: gate.firstFailureCode,
          firstFailureMessage: gate.firstFailureMessage,
          steps: gate.steps,
        },
        providerRequest: null,
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { barcode: true, sku: true, title: true, description: true, stock: true, vatRate: true, images: true, brand: { select: { name: true } } },
    });
    if (!product) {
      return res.status(404).json({ ok: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı' } });
    }

    const payload: MarketplaceListingPayload = {
      barcode: product.barcode,
      sku: product.sku,
      title: product.title ?? '',
      description: product.description ?? '',
      price: gate.listingPrice ?? 0,
      stock: product.stock,
      vatRate: product.vatRate,
      categoryExternalId: gate.categoryId !== null ? String(gate.categoryId) : null,
      brandName: product.brand?.name ?? null,
      images: product.images ? product.images.split(',').map((s) => s.trim()).filter(Boolean) : [],
      brandId: gate.brandId,
      categoryId: gate.categoryId,
      attributes: gate.attributes,
    };

    // Gerçek adapter body şeklini ÜRETİR ama istek GÖNDERMEZ (mock).
    const request = trendyolAdapter.buildRequest(
      { apiKey: 'mock', apiSecret: 'mock', refreshToken: null, merchantId: null, sellerId: '12345', storeId: null },
      payload,
      'https://apigw.trendyol.com/integration'
    );

    let parsedBody: unknown = null;
    try { parsedBody = JSON.parse(request.body ?? '{}'); } catch { /* ignore */ }

    const body = (parsedBody ?? {}) as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items : [];
    const firstItem = items[0] as Record<string, unknown> | undefined;

    return res.json({
      ok: true,
      liveSend: 'BLOCKED',
      gate: { ok: true, steps: gate.steps, listingPrice: gate.listingPrice },
      providerRequest: {
        method: request.method,
        url: request.url,
        userAgent: request.headers['User-Agent'] ?? null,
        itemsCount: items.length,
        firstItem: {
          barcode: firstItem?.barcode ?? null,
          productMainId: firstItem?.productMainId ?? null,
          brandId: firstItem?.brandId ?? null,
          categoryId: firstItem?.categoryId ?? null,
          salePrice: firstItem?.salePrice ?? null,
          listPrice: firstItem?.listPrice ?? null,
          images: Array.isArray(firstItem?.images) ? firstItem.images : [],
          attributes: Array.isArray(firstItem?.attributes) ? firstItem.attributes : [],
        },
      },
    });
  } catch (error) {
    console.error('[trendyol-mapping] mock-send-test error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Mock send testi çalıştırılamadı' } });
  }
});

export default router;
