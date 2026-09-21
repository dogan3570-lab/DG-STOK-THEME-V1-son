// ============================================================
// PROFIT-V2 ROUTES — /api/profit-v2/*
// Mevcut /profit-engine route'una DOKUNMAZ. Additive.
// Gerçek veri DB'den (read-only); test verisi İZOLE in-memory.
// ============================================================

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../auth/authMiddleware.ts';
import { AnalyticsEngine } from '../profitV2/analytics.ts';
import { AnalyticsRecord, AnalyticsMetricKey, PeriodType } from '../profitV2/types.ts';
import { rangeForPeriod } from '../profitV2/analytics.ts';
import { calculateProfit } from '../profitV2/engine.ts';
import { LearningStore } from '../profitV2/learning.ts';
import { AiAnalysisService, MockAiProvider, buildFinancialFacts, renderInsight } from '../profitV2/ai.ts';
import { loadOrderRecords, searchCatalog, listMarketplaceKeys, dataCoverage } from '../profitV2/adapter.ts';
import { PROFIT_V2_PAGE } from '../profitV2/uiHtml.ts';

const router = Router();
const aiService = new AiAnalysisService(new MockAiProvider());

function jsonSafe(v: any): any {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = jsonSafe(v[k]); return o; }
  return v;
}
function sendJson(res: Response, status: number, obj: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(jsonSafe(obj)));
}
function toBig(v: unknown): bigint | null { if (v === null || v === undefined || v === '') return null; if (typeof v === 'bigint') return v; if (typeof v === 'number') return BigInt(Math.round(v)); if (typeof v === 'string') { try { return BigInt(v); } catch { return null; } } return null; }

// ---- İZOLE TEST verisi (DB'ye yazılmaz; production state'e karışmaz) ----
function testRecord(id: string, mp: string, over: Partial<AnalyticsRecord> = {}): AnalyticsRecord {
  return {
    id, orderId: 'test-' + id, marketplace: mp, categoryId: 'test-cat', productId: 'test-p' + id, productName: 'TEST Ürün ' + id,
    sku: 'TESTSKU' + id, barcode: 'TESTBC' + id, occurredAt: '2025-03-10T10:00:00.000Z', currency: 'TRY', returnsTracked: true, isSimulation: false,
    salePriceCents: 120000n, saleVatRate: 20, saleVatInclusive: true, discountCents: 0n,
    purchaseCostCents: 50000n, purchaseVatRate: 20, purchaseVatInclusive: false,
    commissionCents: 18000n, commissionVatRate: 20, commissionVatInclusive: true,
    serviceFeeCents: 2400n, serviceVatRate: 20, serviceVatInclusive: true, withholdingCents: 1000n,
    shippingCents: 7200n, shippingVatRate: 20, shippingVatInclusive: true,
    returnCostCents: 0n, returnVatRate: 0, advertisingCents: 0n, advertisingVatRate: 0, otherExpensesCents: 0n, otherVatRate: 0,
    ...over,
  };
}
let testRecords: AnalyticsRecord[] = [testRecord('1', 'tt'), testRecord('2', 'he'), testRecord('3', 'he')];

async function engineFor(dataset: string): Promise<AnalyticsEngine> {
  if (dataset === 'test') return new AnalyticsEngine(testRecords);
  return new AnalyticsEngine(await loadOrderRecords());
}

function resolveFilters(url: URL, dataset: string = 'real'): any {
  const tz = url.searchParams.get('tz') ?? 'Europe/Istanbul';
  const period = (url.searchParams.get('period') ?? 'MONTHLY') as PeriodType;
  let start = url.searchParams.get('start') ?? '';
  let end = url.searchParams.get('end') ?? '';
  if (!start || !end) {
    if (dataset === 'test') { start = start || '2020-01-01T00:00:00.000Z'; end = end || '2030-01-01T00:00:00.000Z'; }
    else { const r = rangeForPeriod(period === 'CUSTOM' ? 'DAILY' : period, new Date().toISOString(), tz); start = start || r.start; end = end || r.end; }
  }
  return { period, start, end, timeZone: tz, marketplace: url.searchParams.get('marketplace') || undefined, categoryId: url.searchParams.get('categoryId') || null, productId: url.searchParams.get('productId') || null, includeSimulation: url.searchParams.get('includeSimulation') === 'true' };
}

// ---- UI (ayrı Profit/Loss sayfası; baseline'a dokunmaz) ----
router.get('/ui', (req: Request, res: Response) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PROFIT_V2_PAGE);
});

// ---- state / coverage ----
router.get('/state', requireAuth, async (req: Request, res: Response) => {
  try {
    const dataset = String(req.query.dataset ?? 'real');
    const cov = await dataCoverage();
    const eng = await engineFor(dataset);
    return sendJson(res, 200, { ok: true, data: { dataset, realRecords: cov.orders, testRecords: testRecords.length, engineRecords: eng.count, coverage: cov } });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});

// ---- test-data import (İZOLE; DB'ye yazılmaz) ----
router.post('/import-test-data', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as any;
    if (Array.isArray(body.records)) {
      testRecords = body.records.map((j: any, i: number) => ({
        id: String(j.id ?? 'imp-' + i), orderId: String(j.orderId ?? 'imp-' + i), marketplace: String(j.marketplace ?? 'tt'),
        categoryId: j.categoryId ?? null, productId: String(j.productId ?? 'p' + i), productName: j.productName ?? null, sku: j.sku ?? null, barcode: j.barcode ?? null,
        occurredAt: String(j.occurredAt ?? '2025-03-10T10:00:00.000Z'), currency: 'TRY', returnsTracked: true, isSimulation: false,
        salePriceCents: toBig(j.salePriceCents), saleVatRate: j.saleVatRate ?? 20, saleVatInclusive: j.saleVatInclusive ?? true, discountCents: toBig(j.discountCents) ?? 0n,
        purchaseCostCents: toBig(j.purchaseCostCents), purchaseVatRate: j.purchaseVatRate ?? 20, purchaseVatInclusive: j.purchaseVatInclusive ?? false,
        commissionCents: toBig(j.commissionCents), commissionVatRate: j.commissionVatRate ?? 20, commissionVatInclusive: j.commissionVatInclusive ?? true,
        serviceFeeCents: toBig(j.serviceFeeCents), serviceVatRate: j.serviceVatRate ?? 20, serviceVatInclusive: j.serviceVatInclusive ?? true,
        withholdingCents: toBig(j.withholdingCents), shippingCents: toBig(j.shippingCents), shippingVatRate: j.shippingVatRate ?? 20, shippingVatInclusive: j.shippingVatInclusive ?? true,
        returnCostCents: toBig(j.returnCostCents) ?? 0n, returnVatRate: j.returnVatRate ?? 0, advertisingCents: toBig(j.advertisingCents) ?? 0n, otherExpensesCents: toBig(j.otherExpensesCents) ?? 0n,
      }));
    }
    return sendJson(res, 200, { ok: true, testRecords: testRecords.length });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});

router.get('/aggregate', requireAuth, async (req: Request, res: Response) => {
  try { const eng = await engineFor(String(req.query.dataset ?? 'real')); return sendJson(res, 200, { ok: true, data: eng.aggregate(resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real'))) }); }
  catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/trend', requireAuth, async (req: Request, res: Response) => {
  try { const url = new URL(req.url ?? '/', 'http://x'); const eng = await engineFor(String(req.query.dataset ?? 'real')); return sendJson(res, 200, { ok: true, data: eng.trend(resolveFilters(url), (url.searchParams.get('metric') ?? 'netProfit') as AnalyticsMetricKey) }); }
  catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/marketplaces', requireAuth, async (req: Request, res: Response) => {
  try {
    const dataset = String(req.query.dataset ?? 'real');
    const eng = await engineFor(dataset);
    const f = resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real'));
    const byMp = eng.byMarketplace(f);
    if (dataset === 'real') {
      const keys = await listMarketplaceKeys();
      const map = new Map(byMp.map(x => [x.marketplace, x.result]));
      const merged = keys.map(k => ({ marketplace: k, result: map.get(k) ?? eng.aggregate({ ...f, marketplace: k }) }));
      return sendJson(res, 200, { ok: true, data: merged });
    }
    return sendJson(res, 200, { ok: true, data: byMp });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/categories', requireAuth, async (req: Request, res: Response) => {
  try { const eng = await engineFor(String(req.query.dataset ?? 'real')); return sendJson(res, 200, { ok: true, data: eng.byCategory(resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real'))) }); }
  catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/waterfall', requireAuth, async (req: Request, res: Response) => {
  try { const eng = await engineFor(String(req.query.dataset ?? 'real')); return sendJson(res, 200, { ok: true, data: eng.aggregateWaterfall(resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real'))) }); }
  catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const dataset = String(req.query.dataset ?? 'real');
    const query = req.query.query as string | undefined;
    const page = Number(req.query.page ?? '1'); const pageSize = Number(req.query.pageSize ?? '20');
    if (dataset === 'test') { const eng = await engineFor('test'); return sendJson(res, 200, { ok: true, data: eng.searchProducts(query ?? null, page, pageSize, resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real'))), source: 'test' }); }
    const cat = await searchCatalog(query ?? null, page, pageSize);
    return sendJson(res, 200, { ok: true, data: { items: cat.items.map(r => ({ ...r, profit: 'VERİ YOK', dataQuality: 'missing' })), total: cat.total, page: cat.page, pageSize: cat.pageSize }, source: 'catalog-real', note: 'Maliyet/satış actual verisi yok; kâr VERİ YOK.' });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/learning', requireAuth, async (_req: Request, res: Response) => {
  try {
    const store = new LearningStore();
    const obs = store.getObservations();
    const keys = new Map<string, { metric: string; marketplace: string; categoryId: string | null; productId: string | null }>();
    for (const o of obs) { const k = `${o.metric}|${o.marketplace}|${o.scope.categoryId ?? '*'}|${o.scope.productId ?? '*'}`; if (!keys.has(k)) keys.set(k, { metric: o.metric, marketplace: o.marketplace, categoryId: o.scope.categoryId ?? null, productId: o.scope.productId ?? null }); }
    const estimates = Array.from(keys.values()).map(k => { const e = store.estimate(k.metric as any, { marketplace: k.marketplace, categoryId: k.categoryId, productId: k.productId }); return { ...k, learnedValueCents: e.learnedValueCents, sampleCount: e.sampleCount, confidence: e.confidence, status: e.status, method: e.method, lastObservedAt: e.lastObservedAt }; });
    return sendJson(res, 200, { ok: true, data: { observations: obs.length, estimates } });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.post('/simulate', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as any;
    const result = calculateProfit({
      currency: 'TRY', salePriceCents: toBig(b.salePriceCents) ?? 0n, saleVatInclusive: b.saleVatInclusive ?? true, saleVatRate: Number(b.saleVatRate ?? 20), discountCents: toBig(b.discountCents) ?? 0n,
      purchaseCostCents: toBig(b.purchaseCostCents) ?? 0n, purchaseVatRate: Number(b.purchaseVatRate ?? 20), purchaseVatInclusive: b.purchaseVatInclusive ?? false,
      commissionCents: toBig(b.commissionCents) ?? 0n, commissionVatRate: Number(b.commissionVatRate ?? 20), commissionVatInclusive: b.commissionVatInclusive ?? true,
      serviceFeeCents: toBig(b.serviceFeeCents) ?? 0n, serviceVatRate: Number(b.serviceVatRate ?? 20), serviceVatInclusive: b.serviceVatInclusive ?? true,
      withholdingCents: toBig(b.withholdingCents) ?? 0n, shippingCents: toBig(b.shippingCents) ?? 0n, shippingVatRate: Number(b.shippingVatRate ?? 20), shippingVatInclusive: b.shippingVatInclusive ?? true,
      returnCostCents: toBig(b.returnCostCents) ?? 0n, returnVatRate: Number(b.returnVatRate ?? 0), advertisingCents: toBig(b.advertisingCents) ?? 0n, otherExpensesCents: toBig(b.otherExpensesCents) ?? 0n,
      targetProfitCents: toBig(b.targetProfitCents) ?? undefined,
    });
    return sendJson(res, 200, { ok: true, data: result, simulation: true });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});
router.get('/ai/insights', requireAuth, async (req: Request, res: Response) => {
  try {
    const eng = await engineFor(String(req.query.dataset ?? 'real'));
    const agg = eng.aggregate(resolveFilters(new URL(req.url ?? '/', 'http://x'), String(req.query.dataset ?? 'real')));
    const facts = buildFinancialFacts(agg);
    const result = await aiService.analyze(facts);
    return sendJson(res, 200, { ok: true, data: { ai: result, rendered: result.insights.map(i => ({ ...i, rendered: renderInsight(i.text, facts) })) } });
  } catch (e) { return sendJson(res, 500, { ok: false, error: (e as Error).message }); }
});

export default router;
