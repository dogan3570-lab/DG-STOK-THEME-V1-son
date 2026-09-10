/**
 * LISTING PRICE RESOLVER — KDV dahil XML alış fiyatından pazaryeri listeleme fiyatı.
 *
 * KESİN FORMÜL (KDV ikinci kez EKLENMEZ):
 *   listingPrice = vatIncludedPurchasePrice × (1 + profitMargin/100) + fixedAmount
 *   (yuvarlama kuralı varsa uygulanır)
 *
 * FAIL-CLOSED:
 *   - geçersiz alış fiyatı (null/undefined/0/negative/NaN/Infinity) → PRICE_DATA_MISSING
 *   - kural yok / boş                          → PRICE_RULE_NOT_FOUND
 *   - uygun bant yok                           → PRICE_RULE_NOT_FOUND
 *   - birden fazla bant çakışıyor (belirsiz)   → PRICE_RULE_AMBIGUOUS
 *   - hesaplanan fiyat geçersiz                → PRICE_DATA_MISSING
 *
 * Rastgele bant seçimi YASAKTIR. Sahte 1 TL fallback YOKTUR.
 */

export type ListingPriceStatus =
  | 'OK'
  | 'PRICE_DATA_MISSING'
  | 'PRICE_RULE_NOT_FOUND'
  | 'PRICE_RULE_AMBIGUOUS';

export interface PriceRangeRule {
  minPrice: number;
  maxPrice: number; // 0 = üst sınır yok (sınırsız bant)
  profitMargin: number; // yüzde
  fixedAmount: number;
  rounding?: string;
}

export interface ListingPriceResult {
  status: ListingPriceStatus;
  listingPrice: number | null;
  rule: PriceRangeRule | null;
  reason: string | null;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ListingTemplate.priceRangeRules JSON'unu güvenli parse eder; geçersiz/boşsa null. */
export function parsePriceRangeRules(raw: string | null | undefined): PriceRangeRule[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const rules: PriceRangeRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const min = toFiniteNumber((item as Record<string, unknown>).minPrice);
    const max = toFiniteNumber((item as Record<string, unknown>).maxPrice);
    const profitMargin = toFiniteNumber((item as Record<string, unknown>).profitMargin);
    const fixedAmount = toFiniteNumber((item as Record<string, unknown>).fixedAmount);
    if (min === null || max === null || profitMargin === null || fixedAmount === null) return null;
    if (min < 0 || max < 0 || profitMargin < 0 || fixedAmount < 0) return null;
    rules.push({
      minPrice: min,
      maxPrice: max,
      profitMargin,
      fixedAmount,
      rounding: typeof (item as Record<string, unknown>).rounding === 'string'
        ? String((item as Record<string, unknown>).rounding)
        : undefined,
    });
  }
  return rules;
}

function applyRounding(price: number, rounding: string | undefined): number {
  switch (rounding) {
    case 'nearest': return Math.round(price);
    case 'floor': return Math.floor(price);
    case 'ceil': return Math.ceil(price);
    case '0.90': return Math.floor(price) + 0.90;
    case '0.95': return Math.floor(price) + 0.95;
    case '0.99': return Math.floor(price) + 0.99;
    case '9.90': return Math.floor(price / 10) * 10 + 9.90;
    case '49.90': return Math.floor(price / 50) * 50 + 49.90;
    case '99.90': return Math.floor(price / 100) * 100 + 99.90;
    default: return price;
  }
}

export function resolveListingPrice(
  vatIncludedPurchasePrice: unknown,
  rules: PriceRangeRule[] | null
): ListingPriceResult {
  if (!isPositiveFinite(vatIncludedPurchasePrice)) {
    return {
      status: 'PRICE_DATA_MISSING',
      listingPrice: null,
      rule: null,
      reason: 'KDV dahil alış fiyatı geçersiz (0, negatif, null, NaN veya Infinity)',
    };
  }

  if (!rules || rules.length === 0) {
    return { status: 'PRICE_RULE_NOT_FOUND', listingPrice: null, rule: null, reason: 'Fiyat kuralı tanımlanmamış' };
  }

  const matches = rules.filter((r) => {
    const inLower = vatIncludedPurchasePrice >= r.minPrice;
    const inUpper = r.maxPrice === 0 || vatIncludedPurchasePrice <= r.maxPrice;
    return inLower && inUpper;
  });

  if (matches.length === 0) {
    return { status: 'PRICE_RULE_NOT_FOUND', listingPrice: null, rule: null, reason: 'Uygun fiyat bandı bulunamadı' };
  }

  if (matches.length > 1) {
    return {
      status: 'PRICE_RULE_AMBIGUOUS',
      listingPrice: null,
      rule: null,
      reason: 'Birden fazla fiyat bandı çakışıyor (belirsiz)',
    };
  }

  const rule = matches[0];
  const rawPrice = vatIncludedPurchasePrice * (1 + rule.profitMargin / 100) + rule.fixedAmount;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { status: 'PRICE_DATA_MISSING', listingPrice: null, rule: null, reason: 'Hesaplanan listeleme fiyatı geçersiz' };
  }

  const rounded = Math.round(applyRounding(rawPrice, rule.rounding) * 100) / 100;
  return { status: 'OK', listingPrice: rounded, rule, reason: null };
}
