import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import {
  loadTrendyolTree,
  loadTrendyolMarketplaceId,
  previewProducts,
  applyVerifiedMatch,
  classifyByRule,
  classifyByAi,
  type MatchDecision,
} from '../services/categoryMatchEngine.ts';

const router = Router();

function readBodyValue(v: unknown): string | null {
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : null;
  return v ? String(v) : null;
}

// ==================== DRY-RUN PREVIEW (YAZMA YOK) ====================
router.post('/preview', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const productIds = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
    const xmlSourceId = readBodyValue(body.xmlSourceId);
    const limit = Math.min(200, Math.max(1, Number(body.limit ?? 10)));
    const withAi = body.withAi !== false;

    let ids = productIds;
    if (ids.length === 0) {
      const products = await prisma.product.findMany({
        where: { categoryMatch: false, ...(xmlSourceId ? { xmlSourceId } : {}) },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      ids = products.map((p) => p.id);
    }

    if (ids.length === 0) {
      return res.json({ ok: true, tree: { total: 0, leaf: 0 }, rows: [], ai: null });
    }

    const result = await previewProducts(ids, withAi);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[category-engine] preview error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Önizleme çalıştırılamadı' } });
  }
});

// ==================== KONTROLLÜ UYGULAMA (VERIFIED WRITE) ====================
router.post('/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const productIds = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    const tree = await loadTrendyolTree();
    const marketplaceId = await loadTrendyolMarketplaceId();
    if (!marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Trendyol marketplace bulunamadı' } });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, categoryMatch: false },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
    });

    const decisions = new Map<string, MatchDecision>();
    const aiNeeded = [];
    for (const p of products) {
      const d = classifyByRule(p, tree);
      decisions.set(p.id, d);
      if (d.categoryId === null) aiNeeded.push(p);
    }

    if (aiNeeded.length > 0) {
      const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { name: true } });
      const ai = await classifyByAi(aiNeeded, tree, mp?.name ?? 'Trendyol');
      for (const [k, v] of ai.decisions) decisions.set(k, v);
    }

    const results = [];
    let applied = 0;
    for (const d of decisions.values()) {
      const r = await applyVerifiedMatch(d, marketplaceId);
      if (r.applied) applied++;
      results.push(r);
    }

    return res.json({ ok: true, scanned: results.length, applied, results });
  } catch (error) {
    console.error('[category-engine] run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Eşleştirme uygulanamadı' } });
  }
});

export default router;
