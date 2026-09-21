// ============================================================
// PROFIT-V2 (VENDORED) — ANALYTICS ENGINE (timezone + aggregation)
// Missing data != 0. Marketplace/category/product izolasyonu.
// ============================================================

import {
  AnalyticsRecord, AggregateFilters, AggregateResult, MetricVal, RatioVal, DataQuality,
  AnalyticsMetricKey, PeriodType, BucketedPoint, ComparisonResult, ProductSummaryRow,
} from './types.ts';
import { splitInclusive, addVat } from './money.ts';

// ---------- time ----------
export interface YMD { y: number; m: number; d: number }
function dtf(tz: string): Intl.DateTimeFormat { return new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
export function localParts(date: Date, tz: string): YMD & { h: number; mi: number; s: number } {
  const map: Record<string, string> = {}; for (const p of dtf(tz).formatToParts(date)) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day), h: Number(map.hour) % 24, mi: Number(map.minute), s: Number(map.second) };
}
function tzOffsetMs(date: Date, tz: string): number { const p = localParts(date, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime(); }
export function zonedMidnightUtc(y: number, m: number, d: number, tz: string): Date { const g = Date.UTC(y, m - 1, d, 0, 0, 0); return new Date(g - tzOffsetMs(new Date(g), tz)); }
function addDaysYmd(y: number, m: number, d: number, n: number): YMD { const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; }
const pad = (n: number) => (n < 10 ? '0' + n : String(n));
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dn = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - dn + 3);
  const iy = date.getUTCFullYear(); const ft = new Date(Date.UTC(iy, 0, 4));
  const fdn = (ft.getUTCDay() + 6) % 7; ft.setUTCDate(ft.getUTCDate() - fdn + 3);
  return { year: iy, week: 1 + Math.round((date.getTime() - ft.getTime()) / (7 * 24 * 3600 * 1000)) };
}
export function bucketKey(date: Date, period: PeriodType, tz: string): string {
  const p = localParts(date, tz);
  switch (period) {
    case 'YEARLY': return `${p.y}`;
    case 'MONTHLY': return `${p.y}-${pad(p.m)}`;
    case 'WEEKLY': { const w = isoWeek(p.y, p.m, p.d); return `${w.year}-W${pad(w.week)}`; }
    default: return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
}
export function inRange(iso: string, startIso: string, endIso: string): boolean { const t = Date.parse(iso); return t >= Date.parse(startIso) && t < Date.parse(endIso); }
export function rangeForPeriod(period: PeriodType, refIso: string, tz: string): { start: string; end: string } {
  const p = localParts(new Date(refIso), tz);
  if (period === 'DAILY' || period === 'CUSTOM') { const n = addDaysYmd(p.y, p.m, p.d, 1); return { start: zonedMidnightUtc(p.y, p.m, p.d, tz).toISOString(), end: zonedMidnightUtc(n.y, n.m, n.d, tz).toISOString() }; }
  if (period === 'WEEKLY') { const dn = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7; const mon = addDaysYmd(p.y, p.m, p.d, -dn); const nm = addDaysYmd(mon.y, mon.m, mon.d, 7); return { start: zonedMidnightUtc(mon.y, mon.m, mon.d, tz).toISOString(), end: zonedMidnightUtc(nm.y, nm.m, nm.d, tz).toISOString() }; }
  if (period === 'MONTHLY') { const ny = p.m === 12 ? p.y + 1 : p.y; const nm = p.m === 12 ? 1 : p.m + 1; return { start: zonedMidnightUtc(p.y, p.m, 1, tz).toISOString(), end: zonedMidnightUtc(ny, nm, 1, tz).toISOString() }; }
  return { start: zonedMidnightUtc(p.y, 1, 1, tz).toISOString(), end: zonedMidnightUtc(p.y + 1, 1, 1, tz).toISOString() };
}
export function previousRange(period: PeriodType, startIso: string, endIso: string, tz: string): { start: string; end: string } {
  if (period === 'CUSTOM') { const dur = Date.parse(endIso) - Date.parse(startIso); return { start: new Date(Date.parse(startIso) - dur).toISOString(), end: startIso }; }
  const p = localParts(new Date(startIso), tz);
  if (period === 'DAILY') { const pr = addDaysYmd(p.y, p.m, p.d, -1); const nx = addDaysYmd(pr.y, pr.m, pr.d, 1); return { start: zonedMidnightUtc(pr.y, pr.m, pr.d, tz).toISOString(), end: zonedMidnightUtc(nx.y, nx.m, nx.d, tz).toISOString() }; }
  if (period === 'WEEKLY') { const pm = addDaysYmd(p.y, p.m, p.d, -7); return { start: zonedMidnightUtc(pm.y, pm.m, pm.d, tz).toISOString(), end: zonedMidnightUtc(p.y, p.m, p.d, tz).toISOString() }; }
  if (period === 'MONTHLY') { const py = p.m === 1 ? p.y - 1 : p.y; const pmn = p.m === 1 ? 12 : p.m - 1; return { start: zonedMidnightUtc(py, pmn, 1, tz).toISOString(), end: zonedMidnightUtc(p.y, p.m, 1, tz).toISOString() }; }
  return { start: zonedMidnightUtc(p.y - 1, 1, 1, tz).toISOString(), end: zonedMidnightUtc(p.y, 1, 1, tz).toISOString() };
}
export function enumerateBuckets(period: PeriodType, startIso: string, endIso: string, tz: string): Array<{ key: string; start: string; end: string }> {
  const out: Array<{ key: string; start: string; end: string }> = []; let cur = startIso, guard = 0;
  while (Date.parse(cur) < Date.parse(endIso) && guard < 100000) {
    guard++; const lp = localParts(new Date(cur), tz); let next: string, key: string;
    if (period === 'YEARLY') { key = `${lp.y}`; next = zonedMidnightUtc(lp.y + 1, 1, 1, tz).toISOString(); }
    else if (period === 'MONTHLY') { key = `${lp.y}-${pad(lp.m)}`; const ny = lp.m === 12 ? lp.y + 1 : lp.y; const nm = lp.m === 12 ? 1 : lp.m + 1; next = zonedMidnightUtc(ny, nm, 1, tz).toISOString(); }
    else if (period === 'WEEKLY') { const dn = (new Date(Date.UTC(lp.y, lp.m - 1, lp.d)).getUTCDay() + 6) % 7; const mon = addDaysYmd(lp.y, lp.m, lp.d, -dn); const w = isoWeek(mon.y, mon.m, mon.d); key = `${w.year}-W${pad(w.week)}`; const nm = addDaysYmd(mon.y, mon.m, mon.d, 7); next = zonedMidnightUtc(nm.y, nm.m, nm.d, tz).toISOString(); }
    else { key = `${lp.y}-${pad(lp.m)}-${pad(lp.d)}`; const n = addDaysYmd(lp.y, lp.m, lp.d, 1); next = zonedMidnightUtc(n.y, n.m, n.d, tz).toISOString(); }
    out.push({ key, start: cur, end: Date.parse(next) > Date.parse(endIso) ? endIso : next }); cur = next;
  }
  return out;
}

// ---------- aggregation ----------
const known = (v: bigint): MetricVal => ({ valueCents: v, status: 'KNOWN', dataQuality: 'complete' });
const unknown = (): MetricVal => ({ valueCents: null, status: 'UNKNOWN', dataQuality: 'missing' });
function ratioFrom(ok: boolean, v: number): RatioVal { return ok ? { value: v, status: 'KNOWN', dataQuality: 'complete' } : { value: null, status: 'UNKNOWN', dataQuality: 'missing' }; }
interface CompVal { net: bigint | null; vat: bigint | null }
function comp(amount: bigint | null | undefined, rate: number | null | undefined, inclusiveDefault: boolean): CompVal {
  if (amount === null || amount === undefined) return { net: null, vat: null };
  const a = amount < 0n ? 0n : amount;
  if (inclusiveDefault) { if (rate === null || rate === undefined) return { net: null, vat: null }; const s = splitInclusive(a, rate); return { net: s.netCents, vat: s.vatCents }; }
  if (rate === null || rate === undefined) return { net: a, vat: null };
  const s = addVat(a, rate); return { net: a, vat: s.vatCents };
}
function sumNullable(vs: Array<bigint | null>): bigint | null { let s = 0n; for (const v of vs) { if (v === null) return null; s += v; } return s; }

interface Computed extends Record<AnalyticsMetricKey, MetricVal> {
  id: string; marketplace: string; categoryId: string | null; productId: string; productName: string | null; sku: string | null; barcode: string | null;
  occurredAt: string; isReturn: boolean; isSimulation: boolean; returnsTracked: boolean; marginValue: number | null; roiValue: number | null;
  outputVatCents: bigint | null; discountGrossCents: bigint | null; learning?: AnalyticsRecord['learning'];
}
function computeRecord(r: AnalyticsRecord): Computed {
  const sale = comp(r.salePriceCents, r.saleVatRate, r.saleVatInclusive ?? true);
  const discount = comp(r.discountCents ?? 0n, r.saleVatRate ?? 0, true);
  const netRevenue = sumNullable([sale.net, discount.net === null ? null : -discount.net]);
  const outputVat = sumNullable([sale.vat, discount.vat === null ? null : -discount.vat]);
  const cost = comp(r.purchaseCostCents, r.purchaseVatRate, r.purchaseVatInclusive ?? false);
  const commission = comp(r.commissionCents, r.commissionVatRate, r.commissionVatInclusive ?? true);
  const service = comp(r.serviceFeeCents ?? 0n, r.serviceVatRate ?? 0, r.serviceVatInclusive ?? true);
  const shipping = comp(r.shippingCents, r.shippingVatRate, r.shippingVatInclusive ?? true);
  const returnCost = comp(r.returnCostCents ?? 0n, r.returnVatRate ?? 0, true);
  const advertising = comp(r.advertisingCents ?? 0n, r.advertisingVatRate ?? 0, false);
  const other = comp(r.otherExpensesCents ?? 0n, r.otherVatRate ?? 0, false);
  const withholding = r.withholdingCents === null || r.withholdingCents === undefined ? 0n : r.withholdingCents;
  const inputVat = sumNullable([cost.vat, commission.vat, service.vat, shipping.vat, returnCost.vat, advertising.vat, other.vat]);
  const netVat = sumNullable([outputVat, inputVat === null ? null : -inputVat]);
  const expenseSum = sumNullable([cost.net, commission.net, service.net, shipping.net, withholding, returnCost.net, advertising.net, other.net]);
  const netProfit = (netRevenue !== null && expenseSum !== null) ? netRevenue - expenseSum : null;
  const mv = (v: bigint | null): MetricVal => (v === null ? unknown() : known(v));
  return {
    id: r.id, marketplace: r.marketplace, categoryId: r.categoryId ?? null, productId: r.productId, productName: r.productName ?? null, sku: r.sku ?? null, barcode: r.barcode ?? null,
    occurredAt: r.occurredAt, isReturn: r.isReturn === true, isSimulation: r.isSimulation === true, returnsTracked: r.returnsTracked === true, learning: r.learning,
    revenue: mv(r.salePriceCents === null || r.salePriceCents === undefined ? null : r.salePriceCents),
    discount: mv(discount.net),
    netSales: mv(netRevenue),
    purchaseCost: mv(cost.net),
    commission: mv(commission.net),
    commissionVat: mv(commission.vat),
    shipping: mv(shipping.net),
    shippingVat: mv(shipping.vat),
    serviceFee: mv(service.net),
    serviceFeeVat: mv(service.vat),
    withholding: mv(withholding),
    returnCost: mv(returnCost.net),
    advertising: mv(advertising.net),
    otherExpenses: mv(other.net),
    inputVat: mv(inputVat),
    netVat: mv(netVat),
    netProfit: mv(netProfit),
    marginValue: (netProfit !== null && netRevenue !== null && netRevenue !== 0n) ? Number(netProfit) / Number(netRevenue) * 100 : null,
    roiValue: (netProfit !== null && cost.net !== null && cost.net !== 0n) ? Number(netProfit) / Number(cost.net) * 100 : null,
    outputVatCents: outputVat,
    discountGrossCents: (discount.net !== null && discount.vat !== null) ? discount.net + discount.vat : null,
  };
}

const CENTS_KEYS: AnalyticsMetricKey[] = ['revenue', 'discount', 'netSales', 'purchaseCost', 'commission', 'commissionVat', 'shipping', 'shippingVat', 'serviceFee', 'serviceFeeVat', 'withholding', 'returnCost', 'advertising', 'otherExpenses', 'inputVat', 'netVat', 'netProfit'];
interface Acc { sum: bigint; known: number; unknown: number }

export class AnalyticsEngine {
  private records: AnalyticsRecord[];
  private cache = new Map<string, Computed>();
  private includeSimDefault: boolean;
  constructor(records: AnalyticsRecord[] = [], opts: { includeSimulationByDefault?: boolean } = {}) { this.records = [...records]; this.includeSimDefault = opts.includeSimulationByDefault ?? false; }
  addRecords(records: AnalyticsRecord[]): void { for (const r of records) { this.records.push(r); this.cache.delete(r.id); } }
  get count(): number { return this.records.length; }
  private computed(): Computed[] { return this.records.map(r => { let c = this.cache.get(r.id); if (!c) { c = computeRecord(r); this.cache.set(r.id, c); } return c; }); }
  private filter(f: AggregateFilters): Computed[] {
    const inc = f.includeSimulation ?? this.includeSimDefault;
    return this.computed().filter(c => {
      if (!inc && c.isSimulation) return false;
      if (!inRange(c.occurredAt, f.start, f.end)) return false;
      if (f.marketplace && c.marketplace !== f.marketplace) return false;
      if (f.categoryId !== undefined && f.categoryId !== null && (c.categoryId ?? null) !== f.categoryId) return false;
      if (f.productId !== undefined && f.productId !== null && c.productId !== f.productId) return false;
      return true;
    });
  }
  private aggregateList(list: Computed[], f: AggregateFilters): AggregateResult {
    const acc: Record<AnalyticsMetricKey, Acc> = {} as any;
    for (const k of CENTS_KEYS) acc[k] = { sum: 0n, known: 0, unknown: 0 };
    let orderCount = 0, returnCount = 0, returnsTracked = false;
    const learningMap = new Map<string, { officialValueCents: bigint | null; learnedValueCents: bigint | null; confidence: number; sampleCount: number }>();
    for (const c of list) {
      if (c.isReturn) returnCount++; else orderCount++;
      if (c.returnsTracked) returnsTracked = true;
      for (const k of CENTS_KEYS) { const v = c[k]; if (v.valueCents === null) acc[k].unknown++; else { acc[k].sum += v.valueCents; acc[k].known++; } }
      if (c.learning && !learningMap.has(c.learning.metric)) learningMap.set(c.learning.metric, { officialValueCents: c.learning.officialValueCents ?? null, learnedValueCents: c.learning.learnedValueCents ?? null, confidence: c.learning.confidence ?? 0, sampleCount: c.learning.sampleCount ?? 0 });
    }
    const toMetric = (k: AnalyticsMetricKey): MetricVal => { const a = acc[k]; if (a.known === 0 && a.unknown === 0) return known(0n); if (a.unknown === 0) return known(a.sum); if (a.known === 0) return unknown(); return { valueCents: a.sum, status: 'PARTIAL', dataQuality: 'partial' }; };
    const metrics = {} as Record<AnalyticsMetricKey, MetricVal>;
    for (const k of CENTS_KEYS) metrics[k] = toMetric(k);
    const np = metrics.netProfit, ns = metrics.netSales, pc = metrics.purchaseCost;
    let margin: RatioVal;
    if (np.valueCents !== null && ns.valueCents !== null && ns.valueCents !== 0n && np.status === 'KNOWN' && ns.status === 'KNOWN') margin = ratioFrom(true, Number(np.valueCents) / Number(ns.valueCents) * 100);
    else if (list.length === 0) margin = ratioFrom(false, 0);
    else margin = np.valueCents === null ? ratioFrom(false, 0) : { value: null, status: 'PARTIAL', dataQuality: 'partial' };
    const roi = (np.valueCents !== null && pc.valueCents !== null && pc.valueCents !== 0n && np.status === 'KNOWN' && pc.status === 'KNOWN') ? ratioFrom(true, Number(np.valueCents) / Number(pc.valueCents) * 100) : ratioFrom(false, 0);
    let returnRate: RatioVal;
    if (!returnsTracked) returnRate = ratioFrom(false, 0);
    else if (orderCount === 0) returnRate = { value: null, status: 'INSUFFICIENT_DATA', dataQuality: 'insufficient_sample' };
    else returnRate = ratioFrom(true, returnCount / orderCount * 100);
    const dq: DataQuality = list.length === 0 ? 'missing' : (CENTS_KEYS.every(k => metrics[k].dataQuality === 'complete') ? 'complete' : 'partial');
    return {
      period: f.period, start: f.start, end: f.end, timeZone: f.timeZone,
      filters: { marketplace: f.marketplace, categoryId: f.categoryId ?? null, productId: f.productId ?? null },
      recordCount: list.length, orderCount, returnCount, metrics, margin, roi, returnRate, dataQuality: dq,
      learning: Array.from(learningMap.entries()).map(([metric, v]) => ({ metric, ...v })),
    };
  }
  aggregate(f: AggregateFilters): AggregateResult { return this.aggregateList(this.filter(f), f); }
  byMarketplace(f: AggregateFilters): Array<{ marketplace: string; result: AggregateResult }> {
    const list = this.filter({ ...f, marketplace: undefined });
    const keys = Array.from(new Set(list.map(c => c.marketplace))).sort();
    return keys.map(mp => ({ marketplace: mp, result: this.aggregateList(list.filter(c => c.marketplace === mp), { ...f, marketplace: mp }) }));
  }
  byCategory(f: AggregateFilters): Array<{ categoryId: string; result: AggregateResult }> {
    const list = this.filter({ ...f, categoryId: null });
    const keys = Array.from(new Set(list.map(c => c.categoryId ?? 'UNCATEGORIZED'))).sort();
    return keys.map(cat => ({ categoryId: cat, result: this.aggregateList(list.filter(c => (c.categoryId ?? 'UNCATEGORIZED') === cat), { ...f, categoryId: cat === 'UNCATEGORIZED' ? null : cat }) }));
  }
  byProduct(f: AggregateFilters): Array<{ productId: string; result: AggregateResult }> {
    const list = this.filter({ ...f, productId: null });
    const keys = Array.from(new Set(list.map(c => c.productId))).sort();
    return keys.map(pid => ({ productId: pid, result: this.aggregateList(list.filter(c => c.productId === pid), { ...f, productId: pid }) }));
  }
  trend(f: AggregateFilters, metric: AnalyticsMetricKey): BucketedPoint[] {
    const list = this.filter(f);
    return enumerateBuckets(f.period, f.start, f.end, f.timeZone).map(b => {
      const inB = list.filter(c => inRange(c.occurredAt, b.start, b.end));
      const agg = this.aggregateList(inB, { ...f, start: b.start, end: b.end });
      return { key: b.key, start: b.start, end: b.end, metric: agg.metrics[metric] };
    });
  }
  compare(f: AggregateFilters): ComparisonResult {
    const current = this.aggregate(f);
    const prev = previousRange(f.period, f.start, f.end, f.timeZone);
    const pl = this.filter({ ...f, start: prev.start, end: prev.end });
    if (pl.length === 0) return { current, previous: null, delta: { revenueCents: null, netProfitCents: null, orderCount: null }, hasPrevious: false };
    const previous = this.aggregateList(pl, { ...f, start: prev.start, end: prev.end });
    const d = (a: MetricVal, b: MetricVal): bigint | null => (a.valueCents !== null && b.valueCents !== null ? a.valueCents - b.valueCents : null);
    return { current, previous, delta: { revenueCents: d(current.metrics.revenue, previous.metrics.revenue), netProfitCents: d(current.metrics.netProfit, previous.metrics.netProfit), orderCount: current.orderCount - previous.orderCount }, hasPrevious: true };
  }
  searchProducts(query: string | null, page: number, pageSize: number, f: AggregateFilters): { items: ProductSummaryRow[]; total: number; page: number; pageSize: number } {
    const list = this.filter({ ...f, productId: null });
    const q = (query ?? '').trim().toLowerCase();
    const matches = q ? list.filter(c => (c.productName ?? '').toLowerCase().includes(q) || (c.sku ?? '').toLowerCase().includes(q) || (c.barcode ?? '').toLowerCase().includes(q)) : list;
    const ids = Array.from(new Set(matches.map(c => c.productId))).sort();
    const sp = Math.max(1, Math.floor(page) || 1), ss = Math.max(1, Math.floor(pageSize) || 20);
    const slice = ids.slice((sp - 1) * ss, sp * ss);
    const items = slice.map(pid => { const sub = matches.filter(c => c.productId === pid); const agg = this.aggregateList(sub, { ...f, productId: pid }); const first = sub[0]; return { productId: pid, productName: first.productName, sku: first.sku, barcode: first.barcode, orderCount: agg.orderCount, returnCount: agg.returnCount, aggregate: agg }; });
    return { items, total: ids.length, page: sp, pageSize: ss };
  }
  waterfallForRecord(recordId: string): Array<{ key: string; label: string; valueCents: bigint | null }> {
    const c = this.computed().find(x => x.id === recordId);
    if (!c) return [];
    const steps: Array<{ key: string; label: string; valueCents: bigint | null }> = [
      { key: 'revenue', label: 'Satış', valueCents: c.revenue.valueCents },
      { key: 'discount', label: 'İndirim', valueCents: c.discountGrossCents === null ? null : -c.discountGrossCents },
      { key: 'saleVat', label: 'Satış KDV', valueCents: c.outputVatCents === null ? null : -c.outputVatCents },
      { key: 'purchaseCost', label: 'Ürün Maliyeti', valueCents: c.purchaseCost.valueCents === null ? null : -c.purchaseCost.valueCents },
      { key: 'commission', label: 'Komisyon', valueCents: c.commission.valueCents === null ? null : -c.commission.valueCents },
      { key: 'shipping', label: 'Kargo', valueCents: c.shipping.valueCents === null ? null : -c.shipping.valueCents },
      { key: 'serviceFee', label: 'Hizmet', valueCents: c.serviceFee.valueCents === null ? null : -c.serviceFee.valueCents },
      { key: 'withholding', label: 'Stopaj', valueCents: c.withholding.valueCents === null ? null : -c.withholding.valueCents },
      { key: 'returnCost', label: 'İade', valueCents: c.returnCost.valueCents === null ? null : -c.returnCost.valueCents },
      { key: 'advertising', label: 'Reklam', valueCents: c.advertising.valueCents === null ? null : -c.advertising.valueCents },
      { key: 'otherExpenses', label: 'Diğer', valueCents: c.otherExpenses.valueCents === null ? null : -c.otherExpenses.valueCents },
    ];
    steps.push({ key: 'netProfit', label: 'Net Kâr', valueCents: c.netProfit.valueCents });
    return steps;
  }
  aggregateWaterfall(f: AggregateFilters): Array<{ key: string; label: string; valueCents: bigint | null }> {
    const list = this.filter(f);
    if (!list.length) return [];
    const template = this.waterfallForRecord(list[0].id);
    const sums = template.map(s => (s.valueCents === null ? null : 0n as bigint | null));
    const unk = new Set<string>();
    for (const c of list) { this.waterfallForRecord(c.id).forEach((s, i) => { if (i >= sums.length) return; if (s.valueCents === null) unk.add(s.key); else if (sums[i] !== null) sums[i] = (sums[i] as bigint) + s.valueCents; }); }
    return template.map((s, i) => ({ key: s.key, label: s.label, valueCents: unk.has(s.key) ? null : sums[i] }));
  }
}
