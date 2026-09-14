import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import {
  loadTrendyolTree,
  loadTrendyolMarketplaceId,
  previewProducts,
  applyVerifiedMatch,
  applyVerifiedMatchesBatch,
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
  console.log('[PREVIEW-01] ENTER /preview', new Date().toISOString(), 'rss=' + Math.round(process.memoryUsage().rss/1024/1024) + 'MB');
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
process.on('uncaughtException', (err: any) => {
  const fs = require('fs');
  try {
    fs.appendFileSync('C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/crash.log', JSON.stringify({
      time: new Date().toISOString(), pid: process.pid,
      name: err?.name, message: err?.message?.substring(0, 500),
      stack: err?.stack?.substring(0, 500),
      source: 'categoryMatchEngine-run-uncaught'
    }) + '\n');
  } catch {}
  console.error('[GLOBAL-UNCATCH] uncaughtException', new Date().toISOString(), err?.name, err?.message?.substring(0, 200), 'pid:', process.pid);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[GLOBAL-REJECT] unhandledRejection', new Date().toISOString(), reason?.message || reason);
});

router.post('/run', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
    const memBefore = process.memoryUsage();
    console.log('[RUN-01] ENTER /run rss=' + Math.round(memBefore.rss/1024/1024) + 'MB heap=' + Math.round(memBefore.heapUsed/1024/1024) + '/' + Math.round(memBefore.heapTotal/1024/1024) + 'MB ext=' + Math.round(memBefore.external/1024/1024) + 'MB', new Date().toISOString());
    try {
    const body = (req.body || {}) as Record<string, unknown>;
    const productIds = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'productIds zorunludur' } });
    }

    let tree;
    try {
      tree = await loadTrendyolTree();
    } catch (treeErr: any) {
      console.error('[DEBUG-RUN] loadTrendyolTree ERROR', new Date().toISOString(), 'msg:', treeErr?.message, 'file:', treeErr?.stack?.split('\n').slice(1,2).join('|'));
      return res.status(500).json({ ok: false, error: { code: 'TREE_LOAD_ERROR', message: 'Kategori ağacı yüklenemedi: ' + (treeErr?.message || 'bilinmiyor') } });
    }
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

    console.log('[RUN-06] BEFORE classifyByAi', new Date().toISOString(), 'aiNeeded:', aiNeeded.length);
    if (aiNeeded.length > 0) {
      const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { name: true } });
      console.log('[AI_CALL_START] classifyByAi begin', new Date().toISOString());
      const ai = await classifyByAi(aiNeeded, tree, mp?.name ?? 'Trendyol');
      console.log('[AI_CALL_END] classifyByAi done', new Date().toISOString());
      for (const [k, v] of ai.decisions) decisions.set(k, v);
    }
    console.log('[RUN-07] AFTER classifyByAi', new Date().toISOString());


    // FIX(F-03): ürün başına sıralı ~6 DB roundtrip yerine tek preload + chunk'lı
    // transaction. Gate mantığı ve sonuç şeması (results/applied) birebir korunur.
    console.log('[RUN-10] BEFORE applyVerifiedMatchesBatch', new Date().toISOString());
    console.log('[RUN-11] BEFORE Prisma write', new Date().toISOString());
    const batch = await applyVerifiedMatchesBatch(Array.from(decisions.values()), marketplaceId);
    console.log('[RUN-12] AFTER Prisma write', new Date().toISOString());
    console.log('[RUN-13] AFTER applyVerifiedMatchesBatch', new Date().toISOString());

    console.log('[RUN-14] BEFORE HTTP response', new Date().toISOString());
    return res.json({ ok: true, scanned: batch.results.length, applied: batch.applied, results: batch.results });
  } catch (error: any) {
    console.error('[RC-CATCH] error.name=', error?.name, 'msg=', error?.message?.substring(0,200) || '', 'time=', new Date().toISOString());
    console.error('[category-engine] run error:', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Eşleştirme uygulanamadı' } });
  }
});

export default router;