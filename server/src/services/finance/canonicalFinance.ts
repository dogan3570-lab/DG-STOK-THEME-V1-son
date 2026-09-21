/**
 * CANONICAL FINANCE ENGINE — DG-STOK tek finans hesap kaynağı.
 *
 * KANITLANMIŞ VERİ MODELİ (XML → finans):
 *   - XML `PriceInclusiveVat` = tedarikçi (Atasan Global / yenitoptanci.com) B2B
 *     TOPTAN fiyatı = ALIŞ (KDV dahil maliyet). XML'de başka fiyat alanı YOKTUR.
 *   - İçe aktarımda bu değer `Product.salePrice` alanına yazılmıştır (importer bug).
 *     Kanonik maliyet: `Product.purchasePrice ?? Product.salePrice` (KDV dahil).
 *   - Pazaryeri satış (listeleme) fiyatı = resolveListingPrice(maliyet, MarketplacePricingRule)
 *     = alış × (1 + marj/100) + sabit. (Canlı gönderimde kullanılan gerçek formül.)
 *   - Gerçekleşen satış: `Order` (şu an 0 kayıt) → GERÇEK ciro yoktur.
 *
 * PARA: Tüm hesaplar INTEGER CENTS (BigInt) ile yapılır. Floating point ile para hesabı YOK.
 * KDV: Türk KDV mahsup modeli → ödenecek KDV = satış KDV − alış KDV.
 */

import { floatToCents, centsToFloat } from '../../shared/types/index.ts';
import { resolveListingPrice, type PriceRangeRule, type ListingPriceResult } from '../listingPriceResolver.ts';

export type MoneyStatus = 'REAL' | 'ESTIMATED' | 'UNAVAILABLE';

export interface RateSet {
  commission: number;   // %
  shipping: number;     // TL (sabit)
  serviceFee: number;   // TL (sabit)
  stopaj: number;       // %
  vatRate: number;      // %
}

/** Pazaryeri bazlı VARSAYILAN oranlar — DB'de gerçek komisyon/kargo YOK ise (ESTIMATED). */
export const DEFAULT_MARKETPLACE_RATES: Record<string, RateSet> = {
  trendyol: { commission: 12, shipping: 8, serviceFee: 2, stopaj: 1, vatRate: 20 },
  hepsiburada: { commission: 14, shipping: 10, serviceFee: 2, stopaj: 1, vatRate: 20 },
  n11: { commission: 10, shipping: 9, serviceFee: 2, stopaj: 1, vatRate: 20 },
  amazon: { commission: 15, shipping: 12, serviceFee: 3, stopaj: 1, vatRate: 20 },
  default: { commission: 12, shipping: 10, serviceFee: 2, stopaj: 1, vatRate: 20 },
};

export function getRatesForMarketplaceKey(key: string | null | undefined): RateSet {
  if (!key) return DEFAULT_MARKETPLACE_RATES.default;
  const k = String(key).toLowerCase().replace(/\s+/g, '');
  if (k.includes('trendyol') || k === 'tt') return DEFAULT_MARKETPLACE_RATES.trendyol;
  if (k.includes('hepsiburada') || k === 'hb' || k === 'he') return DEFAULT_MARKETPLACE_RATES.hepsiburada;
  if (k.includes('n11')) return DEFAULT_MARKETPLACE_RATES.n11;
  if (k.includes('amazon')) return DEFAULT_MARKETPLACE_RATES.amazon;
  return DEFAULT_MARKETPLACE_RATES.default;
}

function pct(base: bigint, rate: number): bigint {
  if (base <= 0n || rate <= 0) return 0n;
  const bps = BigInt(Math.round(rate * 100));
  return (base * bps) / 10000n;
}

/** KDV dahil fiyatı net + KDV olarak ayrıştırır (BigInt). */
export function splitInclusiveVat(incCents: bigint, vatRate: number): { netCents: bigint; vatCents: bigint } {
  if (incCents <= 0n || vatRate <= 0) return { netCents: incCents, vatCents: 0n };
  const bps = BigInt(Math.round(vatRate * 100));
  const netCents = (incCents * 10000n) / (10000n + bps);
  return { netCents, vatCents: incCents - netCents };
}

export interface UnitEconomics {
  costCents: bigint;
  saleCents: bigint;
  saleVatCents: bigint;
  costVatCents: bigint;
  vatPayableCents: bigint;
  commissionCents: bigint;
  shippingCents: bigint;
  serviceFeeCents: bigint;
  stopajCents: bigint;
  netProfitCents: bigint;
  marginPct: number;
  roiPct: number;
}

/**
 * Bir birim ürün için tam kâr zinciri (hepsi KDV dahil tutarlar üzerinden).
 * netProfit = satış − maliyet − komisyon − kargo − hizmet − stopaj − ödenecekKDV
 */
export function computeUnitEconomics(costCents: bigint, saleCents: bigint, rates: RateSet): UnitEconomics {
  const { vatCents: saleVatCents } = splitInclusiveVat(saleCents, rates.vatRate);
  const { vatCents: costVatCents } = splitInclusiveVat(costCents, rates.vatRate);
  const vatPayableCents = saleVatCents - costVatCents;
  const commissionCents = pct(saleCents, rates.commission);
  const shippingCents = floatToCents(rates.shipping);
  const serviceFeeCents = floatToCents(rates.serviceFee);
  const stopajCents = pct(saleCents, rates.stopaj);
  const netProfitCents = saleCents - costCents - commissionCents - shippingCents - serviceFeeCents - stopajCents - vatPayableCents;
  const marginPct = saleCents > 0n ? Number((netProfitCents * 10000n) / saleCents) / 100 : 0;
  const roiPct = costCents > 0n ? Number((netProfitCents * 10000n) / costCents) / 100 : 0;
  return {
    costCents, saleCents, saleVatCents, costVatCents, vatPayableCents,
    commissionCents, shippingCents, serviceFeeCents, stopajCents,
    netProfitCents, marginPct, roiPct,
  };
}

/** netProfit = S·(1 − c − st − vf) − C·(1 − vf) − ship − svc  (vf = vatRate/(100+vatRate)) */
function netFactor(rates: RateSet): { sFactor: number; cFactor: number; fixed: number; vf: number } {
  const vf = rates.vatRate / (100 + rates.vatRate);
  const sFactor = 1 - rates.commission / 100 - rates.stopaj / 100 - vf;
  const cFactor = 1 - vf;
  const fixed = rates.shipping + rates.serviceFee;
  return { sFactor, cFactor, fixed, vf };
}

/** Başabaş (net kâr = 0) KDV-dahil satış fiyatı. Maliyet bilinmiyorsa null. */
export function breakEvenPrice(costCents: bigint | null, rates: RateSet): number | null {
  if (costCents == null || costCents <= 0n) return null;
  const { sFactor, cFactor, fixed } = netFactor(rates);
  if (sFactor <= 0) return null;
  const s = (Number(costCents) / 100) * cFactor + fixed;
  return Math.round((s / sFactor) * 100) / 100;
}

/** Hedef net marj (%) için gereken KDV-dahil satış fiyatı. */
export function targetPriceForMargin(costCents: bigint | null, targetMarginPct: number, rates: RateSet): number | null {
  if (costCents == null || costCents <= 0n) return null;
  const { sFactor, cFactor, fixed } = netFactor(rates);
  const denom = sFactor - targetMarginPct / 100;
  if (denom <= 0) return null;
  const s = (Number(costCents) / 100) * cFactor + fixed;
  return Math.round((s / denom) * 100) / 100;
}

export interface ProductPriceChain {
  costCents: bigint | null;
  costSource: string;
  listing: ListingPriceResult;
  economics: UnitEconomics | null;
}

/**
 * Ürün + pazaryeri kuralı için kanonik zincir.
 * cost = purchasePrice ?? salePrice (KDV dahil ALIŞ).
 */
export function resolveProductPriceChain(
  product: { purchasePrice: number | null; salePrice: number | null; vatRate: number | null },
  rules: PriceRangeRule[] | null,
  rates: RateSet,
): ProductPriceChain {
  const costRaw = product.purchasePrice ?? product.salePrice ?? null;
  const costSource = product.purchasePrice != null
    ? 'purchasePrice (KDV dahil alış)'
    : (product.salePrice != null ? 'salePrice → XML PriceInclusiveVat (KDV dahil alış, purchasePrice boş)' : 'yok');
  const costCents = costRaw != null && Number.isFinite(Number(costRaw)) && Number(costRaw) > 0 ? floatToCents(Number(costRaw)) : null;

  const listing = resolveListingPrice(costRaw, rules);
  if (costCents == null || listing.status !== 'OK' || listing.listingPrice == null) {
    return { costCents, costSource, listing, economics: null };
  }
  const effectiveRates: RateSet = { ...rates, vatRate: product.vatRate && product.vatRate > 0 ? product.vatRate : rates.vatRate };
  const economics = computeUnitEconomics(costCents, floatToCents(listing.listingPrice), effectiveRates);
  return { costCents, costSource, listing, economics };
}

export function centsToTL(v: bigint | null | undefined): number | null {
  return v == null ? null : centsToFloat(v);
}
