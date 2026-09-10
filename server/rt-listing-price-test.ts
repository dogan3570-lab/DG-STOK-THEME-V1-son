import 'dotenv/config';
import { resolveListingPrice, parsePriceRangeRules } from './src/services/listingPriceResolver.ts';

/**
 * LISTING PRICE RESOLVER testi — KDV dahil formül + boundary + fail-closed matrix.
 */
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

function approx(a: number | null, b: number): boolean {
  return a !== null && Math.abs(a - b) < 0.001;
}

// KDV dahil; KDV ikinci kez eklenmez. Bantlar: 0-500 %20 +30 ; 501-1000 %25 +30
const rules = [
  { minPrice: 0, maxPrice: 500, profitMargin: 20, fixedAmount: 30 },
  { minPrice: 501, maxPrice: 1000, profitMargin: 25, fixedAmount: 30 },
];

// Kullanıcının verdiği örnek: 500 × 1.20 + 30 = 630
let r = resolveListingPrice(500, rules);
check('500 → 630 (KDV dahil formül)', r.status === 'OK' && approx(r.listingPrice, 630), r.status + ' ' + r.listingPrice);

r = resolveListingPrice(100, rules);
check('100 → 150', r.status === 'OK' && approx(r.listingPrice, 150), String(r.listingPrice));

r = resolveListingPrice(500.01, rules);
check('500.01 bant dışı → PRICE_RULE_NOT_FOUND', r.status === 'PRICE_RULE_NOT_FOUND', r.status);

// Boundary matrix (rounding yok; 2 ondalık yuvarlama)
const boundaryCases: Array<[unknown, number | null, string]> = [
  [0, null, 'PRICE_DATA_MISSING'],
  [-1, null, 'PRICE_DATA_MISSING'],
  [0.01, 30.01, 'OK'],
  [99.99, 149.99, 'OK'],
  [100, 150, 'OK'],
  [499.99, 629.99, 'OK'],
  [500, 630, 'OK'],
  [500.01, null, 'PRICE_RULE_NOT_FOUND'],
  [999.99, 1279.99, 'OK'],
  [1000, 1280, 'OK'],
  [1000.01, null, 'PRICE_RULE_NOT_FOUND'],
];
for (const [input, expected, status] of boundaryCases) {
  const res = resolveListingPrice(input, rules);
  const ok = expected === null
    ? (res.status === status && res.listingPrice === null)
    : (res.status === status && approx(res.listingPrice, expected));
  check(`boundary ${String(input)} → ${expected ?? status}`, ok, res.status + ' ' + res.listingPrice);
}

// Fail-closed: null/undefined/NaN/Infinity
for (const bad of [null, undefined, NaN, Infinity, -Infinity, 'abc', '']) {
  const res = resolveListingPrice(bad, rules);
  check(`fail-closed ${String(bad)} → PRICE_DATA_MISSING`, res.status === 'PRICE_DATA_MISSING', res.status);
}

// Kural yok / boş
check('kural yok → PRICE_RULE_NOT_FOUND', resolveListingPrice(500, null).status === 'PRICE_RULE_NOT_FOUND');
check('boş kural → PRICE_RULE_NOT_FOUND', resolveListingPrice(500, []).status === 'PRICE_RULE_NOT_FOUND');

// Çakışan bantlar → AMBIGUOUS (0-500 ve 500-1000 ikisi de 500'ü kapsar)
const ambiguousRules = [
  { minPrice: 0, maxPrice: 500, profitMargin: 20, fixedAmount: 30 },
  { minPrice: 500, maxPrice: 1000, profitMargin: 25, fixedAmount: 30 },
];
const amb = resolveListingPrice(500, ambiguousRules);
check('çakışan bant 500 → PRICE_RULE_AMBIGUOUS', amb.status === 'PRICE_RULE_AMBIGUOUS', amb.status);

// parsePriceRangeRules
const parsed = parsePriceRangeRules(JSON.stringify(rules));
check('parsePriceRangeRules geçerli', Array.isArray(parsed) && parsed.length === 2);
check('parsePriceRangeRules boş/geçersiz → null', parsePriceRangeRules(null) === null && parsePriceRangeRules('{bad') === null && parsePriceRangeRules('[]') === null);

// negatif fixed amount geçersiz kural → null
check('negatif fixedAmount kural → null', parsePriceRangeRules('[{"minPrice":0,"maxPrice":100,"profitMargin":10,"fixedAmount":-5}]') === null);

console.log('========================================');
console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
if (failures.length) { for (const f of failures) console.log(' - ' + f); }
process.exit(fail > 0 ? 1 : 0);
