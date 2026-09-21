// ============================================================
// PROFIT-V2 (VENDORED) — DETERMINISTIC ENGINE + RULE SETS
// BigInt cents. Finansal matematik burada; AI'ya verilmez.
// ============================================================

import {
  FinLine, FinSource, LineMeta, ProfitCalculationInput, ProfitCalculationResult,
  VatBreakdownLine, VatSummary, WaterfallStep, ExpenseInput,
  MarketplaceRule, ResolvedMarketplaceRule, ShippingTariff, ResolvedShipping,
} from './types.ts';
import { normalizeLine, nonNeg, rateBps, ratioPercent, clampInt64, divRound } from './money.ts';

export const DETERMINISTIC_VERSION = 'det-v1.0.0';

function meta(input: LineMeta | undefined, fallback: FinSource): LineMeta { return input ?? { source: fallback }; }

function buildExpense(key: string, label: string, amountCents: bigint | undefined, inclusiveDefault: boolean, rate: number | undefined, inclusive: boolean | undefined, deductible: boolean | undefined, m: LineMeta): FinLine | null {
  if (amountCents === undefined) return null;
  const amount = nonNeg(amountCents);
  const inc = inclusive ?? inclusiveDefault;
  const { netCents, vatCents, grossCents } = normalizeLine(amount, inc, rate ?? 0);
  return { key, label, netCents, vatCents, grossCents, vatRate: rate ?? 0, inclusive: inc, deductible: deductible ?? true, meta: m };
}

export function calculateProfit(input: ProfitCalculationInput): ProfitCalculationResult {
  const currency = input.currency ?? 'TRY';
  const saleVatRate = input.saleVatRate ?? 0;
  const saleInclusive = input.saleVatInclusive ?? true;
  const saleGrossInput = nonNeg(input.salePriceCents);
  const saleNorm = normalizeLine(saleGrossInput, saleInclusive, saleVatRate);
  const sale: FinLine = { key: 'sale', label: 'Satış', ...saleNorm, vatRate: saleVatRate, inclusive: saleInclusive, deductible: false, meta: meta(input.meta?.sale, FinSource.ORDER) };

  const discountNorm = normalizeLine(nonNeg(input.discountCents), true, saleVatRate);
  const discount: FinLine = { key: 'discount', label: 'İndirim', ...discountNorm, vatRate: saleVatRate, inclusive: true, deductible: false, meta: meta(input.meta?.discount, FinSource.ORDER) };

  const effectiveGross = saleNorm.grossCents - discountNorm.grossCents < 0n ? 0n : saleNorm.grossCents - discountNorm.grossCents;
  const eff = normalizeLine(effectiveGross, true, saleVatRate);
  const netSalesCents = eff.netCents;
  const outputVatCents = eff.vatCents;

  const expenses: FinLine[] = [];
  const push = (l: FinLine | null) => { if (l) expenses.push(l); };
  push(buildExpense('purchase', 'Ürün Maliyeti', input.purchaseCostCents, false, input.purchaseVatRate, input.purchaseVatInclusive, input.purchaseVatDeductible, meta(input.meta?.purchase, FinSource.XML)));
  push(buildExpense('commission', 'Pazaryeri Komisyonu', input.commissionCents, false, input.commissionVatRate, input.commissionVatInclusive, input.commissionVatDeductible, meta(input.meta?.commission, FinSource.MARKETPLACE)));
  push(buildExpense('service', 'Hizmet Ücreti', input.serviceFeeCents, false, input.serviceVatRate, input.serviceVatInclusive, input.serviceVatDeductible, meta(input.meta?.service, FinSource.MARKETPLACE)));
  push(buildExpense('withholding', 'Stopaj', input.withholdingCents, false, 0, false, true, meta(input.meta?.withholding, FinSource.MARKETPLACE)));
  push(buildExpense('shipping', 'Kargo', input.shippingCents, true, input.shippingVatRate, input.shippingVatInclusive, input.shippingVatDeductible, meta(input.meta?.shipping, FinSource.SHIPPING_TARIFF)));
  push(buildExpense('return', 'İade Maliyeti', input.returnCostCents, true, input.returnVatRate, input.returnVatInclusive, input.returnVatDeductible, meta(input.meta?.return, FinSource.SETTLEMENT)));
  push(buildExpense('advertising', 'Reklam', input.advertisingCents, false, input.advertisingVatRate, input.advertisingVatInclusive, input.advertisingVatDeductible, meta(input.meta?.advertising, FinSource.USER)));
  push(buildExpense('other', 'Diğer Giderler', input.otherExpensesCents, false, input.otherVatRate, input.otherVatInclusive, input.otherVatDeductible, meta(input.meta?.other, FinSource.USER)));
  if (input.extraExpenses) for (const e of input.extraExpenses) {
    const amount = e.grossCents ?? e.netCents ?? 0n;
    const inc = e.inclusive ?? (e.grossCents !== undefined);
    push(buildExpense(e.key, e.label, amount, inc, e.vatRate, inc, e.deductible, e.meta));
  }

  const vatLines: VatBreakdownLine[] = [{ key: 'sale', label: 'Satış KDV', baseCents: netSalesCents, vatCents: outputVatCents, rate: saleVatRate, direction: 'output', deductible: false, source: sale.meta.source }];
  let inputVatCents = 0n, nonDeductibleVatCents = 0n, totalExpenseNetCents = 0n;
  for (const exp of expenses) {
    totalExpenseNetCents += exp.netCents;
    if (exp.vatCents > 0n) vatLines.push({ key: exp.key, label: exp.label + ' KDV', baseCents: exp.netCents, vatCents: exp.vatCents, rate: exp.vatRate, direction: 'input', deductible: exp.deductible, source: exp.meta.source });
    if (exp.deductible) inputVatCents += exp.vatCents; else nonDeductibleVatCents += exp.vatCents;
  }
  const vatDiff = outputVatCents - inputVatCents;
  const vat: VatSummary = { outputVatCents, inputVatCents, nonDeductibleVatCents, netVatPayableCents: vatDiff > 0n ? vatDiff : 0n, vatCreditCents: vatDiff < 0n ? -vatDiff : 0n, lines: vatLines };

  const netProfitCents = netSalesCents - totalExpenseNetCents - nonDeductibleVatCents;
  const purchaseNet = expenses.find(e => e.key === 'purchase')?.netCents ?? 0n;
  const baseNeeded = totalExpenseNetCents + nonDeductibleVatCents;
  const qBps = rateBps(saleVatRate);
  const breakEvenPriceCents = clampInt64(divRound(baseNeeded * (10000n + qBps), 10000n) + discountNorm.grossCents);
  let targetProfitPriceCents: bigint | null = null;
  if (input.targetProfitCents !== undefined && input.targetProfitCents !== null) {
    targetProfitPriceCents = clampInt64(divRound((baseNeeded + input.targetProfitCents) * (10000n + qBps), 10000n) + discountNorm.grossCents);
  }

  const waterfall: WaterfallStep[] = [];
  let running = 0n;
  const step = (key: string, label: string, amountCents: bigint, source: FinSource) => { running += amountCents; waterfall.push({ key, label, amountCents, runningCents: running, source }); };
  step('sale', 'Satış', saleNorm.grossCents, sale.meta.source);
  step('discount', 'İndirim', -discountNorm.grossCents, discount.meta.source);
  step('saleVat', 'Satış KDV', -outputVatCents, FinSource.CALCULATED);
  const order: Array<[string, string]> = [['purchase', 'Ürün Maliyeti'], ['commission', 'Pazaryeri Komisyonu'], ['service', 'Hizmet Ücreti'], ['withholding', 'Stopaj'], ['shipping', 'Kargo'], ['return', 'İade Maliyeti'], ['advertising', 'Reklam'], ['other', 'Diğer Giderler']];
  for (const [key, label] of order) { const exp = expenses.find(e => e.key === key); if (exp && exp.netCents !== 0n) step(key, label, -exp.netCents, exp.meta.source); }
  if (nonDeductibleVatCents !== 0n) step('nonDeductibleVat', 'İndirilemeyen KDV', -nonDeductibleVatCents, FinSource.CALCULATED);

  return {
    currency, sale, discount, expenses, vat, netSalesCents, totalExpenseNetCents, nonDeductibleVatCents,
    netProfitCents, netMarginPercent: ratioPercent(netProfitCents, netSalesCents), roiPercent: ratioPercent(netProfitCents, purchaseNet),
    breakEvenPriceCents, targetProfitPriceCents, waterfall, calculationVersion: DETERMINISTIC_VERSION, computedAt: new Date().toISOString(),
  };
}

// ---------------- Marketplace / Shipping rules ----------------
function isEffectiveOn(rule: MarketplaceRule, atMs: number): boolean {
  const from = Date.parse(rule.effectiveFrom);
  if (Number.isFinite(from) && atMs < from) return false;
  if (rule.effectiveTo) { const to = Date.parse(rule.effectiveTo); if (Number.isFinite(to) && atMs > to) return false; }
  return true;
}

export class MarketplaceRuleSet {
  private rules: MarketplaceRule[] = [];
  add(rule: MarketplaceRule): void { this.rules.push(rule); }
  addAll(rules: MarketplaceRule[]): void { for (const r of rules) this.add(r); }
  list(): MarketplaceRule[] { return [...this.rules]; }
  resolve(marketplaceKey: string, categoryId: string | null | undefined, at: Date): ResolvedMarketplaceRule | null {
    const atMs = at.getTime();
    const candidates = this.rules.filter(r => r.marketplaceKey === marketplaceKey && isEffectiveOn(r, atMs)).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
    if (candidates.length === 0) return null;
    const rule = candidates[0];
    let commissionRate = rule.commissionRate;
    let usedCategoryOverride = false;
    if (categoryId && rule.categoryOverrides) {
      const applicable = rule.categoryOverrides.filter(o => o.categoryId === categoryId).sort((a, b) => Date.parse(b.effectiveFrom ?? rule.effectiveFrom) - Date.parse(a.effectiveFrom ?? rule.effectiveFrom));
      if (applicable.length > 0) { commissionRate = applicable[0].commissionRate; usedCategoryOverride = true; }
    }
    return { rule, commissionRate, usedCategoryOverride };
  }
}

export class ShippingTariffSet {
  private tariffs: ShippingTariff[] = [];
  add(t: ShippingTariff): void { this.tariffs.push(t); }
  addAll(ts: ShippingTariff[]): void { for (const t of ts) this.add(t); }
  resolve(marketplaceKey: string, desi: number, at: Date): ResolvedShipping | null {
    const atMs = at.getTime();
    const candidates = this.tariffs.filter(t => {
      if (t.marketplaceKey !== marketplaceKey) return false;
      const from = Date.parse(t.effectiveFrom);
      if (Number.isFinite(from) && atMs < from) return false;
      if (t.effectiveTo) { const to = Date.parse(t.effectiveTo); if (Number.isFinite(to) && atMs > to) return false; }
      return true;
    }).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
    if (candidates.length === 0) return null;
    const tariff = candidates[0];
    const bracket = tariff.brackets.slice().sort((a, b) => a.maxDesi - b.maxDesi).find(b => desi <= b.maxDesi);
    if (!bracket) return null;
    return { priceCents: bracket.priceCents, bracketMaxDesi: bracket.maxDesi, tariff };
  }
}
