/**
 * RED TEAM — XML → Trendyol mapping + price + payload (SAF, DB/ağ YOK).
 * Gerçek numeric ID / whitelist / fail-closed / payload şekli doğrulanır.
 */
import {
  matchTrendyolCategoryByPath,
  matchTrendyolBrand,
  classifyMatch,
  normalizeName,
} from './src/services/categoryBrandMapper.ts';
import {
  resolveTrendyolAttributes,
  matchVariantToTrendyolAttribute,
  isMeaningfulVariantValue,
  type TrendyolAttributeDef,
  type TrendyolAttributeValueDef,
} from './src/services/trendyolVariantResolver.ts';
import { resolveListingPrice, parsePriceRangeRules } from './src/services/listingPriceResolver.ts';
import { trendyolAdapter } from './src/services/marketplace/adapters.ts';
import type { MarketplaceListingPayload } from './src/services/marketplace/types.ts';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ==================== FIXTURES ====================

const tree = [
  {
    id: 10, name: 'Kadın', parentId: null,
    subCategories: [
      { id: 100, name: 'Giyim', parentId: 10, subCategories: [{ id: 1001, name: 'Elbise', parentId: 100, subCategories: [] }] },
      { id: 101, name: 'Ayakkabı', parentId: 10, subCategories: [] },
    ],
  },
  {
    id: 20, name: 'Erkek', parentId: null,
    subCategories: [
      { id: 200, name: 'Giyim', parentId: 20, subCategories: [{ id: 2001, name: 'Tişört', parentId: 200, subCategories: [] }] },
      { id: 201, name: 'Ayakkabı', parentId: 20, subCategories: [] },
    ],
  },
];

const brands = [
  { id: 1001, name: 'Apple', luxe: false },
  { id: 1002, name: 'Samsung', luxe: false },
];

const attrDefs: TrendyolAttributeDef[] = [
  { attribute: { id: 338, name: 'Renk' }, categoryId: 1001, required: true, varianter: true, slicer: false, allowCustom: false },
  { attribute: { id: 339, name: 'Kordon Renk' }, categoryId: 1001, required: false, varianter: true, slicer: false, allowCustom: false },
  { attribute: { id: 340, name: 'Beden' }, categoryId: 1001, required: true, varianter: true, slicer: false, allowCustom: false },
];

function valuesOf(...pairs: Array<[number, string[]]>): Map<number, TrendyolAttributeValueDef[]> {
  const m = new Map<number, TrendyolAttributeValueDef[]>();
  for (const [attrId, vals] of pairs) {
    m.set(attrId, vals.map((v, i) => ({ attributeValueId: attrId * 100 + i + 1, attributeValue: v })));
  }
  return m;
}

// ==================== CATEGORY ====================

let r = matchTrendyolCategoryByPath('Kadın > Giyim > Elbise', tree);
check('CATEGORY: gerçek path → MATCHED 1001', r.status === 'MATCHED' && r.id === 1001, r.status + ' ' + r.id);

r = matchTrendyolCategoryByPath('Erkek > Giyim > Tişört', tree);
check('CATEGORY: gerçek path → MATCHED 2001', r.status === 'MATCHED' && r.id === 2001, r.status);

r = matchTrendyolCategoryByPath('Kadın > Giyim', tree);
check('CATEGORY: parent path disambiguation → MATCHED 100', r.status === 'MATCHED' && r.id === 100, r.status + ' ' + r.id);

r = matchTrendyolCategoryByPath('Ayakkabı', tree);
check('CATEGORY: ambiguous (iki dalda Ayakkabı)', r.status === 'AMBIGUOUS' && r.candidates.length === 2, r.status);

r = matchTrendyolCategoryByPath('AKYI', tree);
check('CATEGORY: AKYI → NOT_FOUND', r.status === 'NOT_FOUND', r.status);

r = matchTrendyolCategoryByPath('Yanlış > Xyz', tree);
check('CATEGORY: yanlış ID → NOT_FOUND', r.status === 'NOT_FOUND', r.status);

let c = classifyMatch(matchTrendyolCategoryByPath('Kadın > Giyim > Elbise', tree));
check('CATEGORY classify: MATCHED → AUTO_MATCH', c.status === 'AUTO_MATCH' && c.id === 1001, c.status);
c = classifyMatch(matchTrendyolCategoryByPath('Ayakkabı', tree));
check('CATEGORY classify: AMBIGUOUS → MANUAL_REVIEW', c.status === 'MANUAL_REVIEW', c.status);
c = classifyMatch(matchTrendyolCategoryByPath('AKYI', tree));
check('CATEGORY classify: NOT_FOUND → NOT_FOUND', c.status === 'NOT_FOUND', c.status);

// ==================== BRAND ====================

let b = matchTrendyolBrand('Apple', brands);
check('BRAND: gerçek → MATCHED 1001', b.status === 'MATCHED' && b.id === 1001, b.status);
b = matchTrendyolBrand('AKYI', brands);
check('BRAND: bulunamayan → NOT_FOUND', b.status === 'NOT_FOUND', b.status);
b = matchTrendyolBrand('Apple', [...brands, { id: 2001, name: 'Apple', luxe: true }]);
check('BRAND: ambiguous (iki Apple)', b.status === 'AMBIGUOUS' && b.candidates.length === 2, b.status);

// ==================== VARIANT ====================

// 1) Gerçek attribute + gerçek value (whitelist)
let vres = resolveTrendyolAttributes(attrDefs, valuesOf([338, ['Siyah', 'Beyaz']], [339, ['Siyah']], [340, ['M', 'L']]), [
  { name: 'Renk', value: 'Siyah' },
  { name: 'Beden', value: 'M' },
]);
check('VARIANT: gerçek attribute+value → OK', vres.status === 'OK', vres.status);
check('VARIANT: payload attributeId 338 + valueId 33801', vres.attributes.some((a) => a.attributeId === 338 && a.attributeValueIds?.[0] === 33801));
check('VARIANT: payload attributeId 340 + valueId 34001', vres.attributes.some((a) => a.attributeId === 340 && a.attributeValueIds?.[0] === 34001));

// 2) Örnek: XML "Renk = Siyah" → Trendyol "Kordon Renk" (isim içerir eşleşmesi)
const kordonOnly: TrendyolAttributeDef[] = [
  { attribute: { id: 339, name: 'Kordon Renk' }, categoryId: 1001, required: true, varianter: true, slicer: false, allowCustom: false },
];
vres = resolveTrendyolAttributes(kordonOnly, valuesOf([339, ['Siyah']]), [{ name: 'Renk', value: 'Siyah' }]);
check('VARIANT: Renk=Siyah → Kordon Renk (id 339)', vres.status === 'OK' && vres.attributes.some((a) => a.attributeId === 339), vres.status + ' ' + JSON.stringify(vres.attributes));

// 3) Required attribute eksik
vres = resolveTrendyolAttributes(attrDefs, valuesOf([338, ['Siyah']], [340, ['M']]), [{ name: 'Renk', value: 'Siyah' }]);
check('VARIANT: required eksik → REQUIRED_ATTRIBUTE_MISSING', vres.status === 'REQUIRED_ATTRIBUTE_MISSING' && vres.requiredMissing.some((m) => m.attributeId === 340), vres.status);

// 4) Yanlış value (whitelist dışı)
vres = resolveTrendyolAttributes(attrDefs, valuesOf([338, ['Siyah']], [339, ['Siyah']], [340, ['M']]), [
  { name: 'Renk', value: 'Mor' },
  { name: 'Beden', value: 'M' },
]);
check('VARIANT: yanlış value → VARIANT_ATTRIBUTE_NOT_FOUND', vres.status === 'VARIANT_ATTRIBUTE_NOT_FOUND', vres.status);

// 5) AKYI bozuk değer → otomatik kabul EDİLMEZ (whitelist)
vres = resolveTrendyolAttributes(attrDefs, valuesOf([338, ['Siyah']], [340, ['M']]), [
  { name: 'Renk', value: 'AKYI' },
  { name: 'Beden', value: 'M' },
]);
check('VARIANT: AKYI → NOT_FOUND (auto kabul YOK)', vres.status === 'VARIANT_ATTRIBUTE_NOT_FOUND' && vres.missing.some((m) => m.xmlVariantValue === 'AKYI'), vres.status);

// 6) Ambig variant (value-only iki aday)
const twoColors: TrendyolAttributeDef[] = [
  { attribute: { id: 338, name: 'Renk' }, categoryId: 1001, required: false, varianter: true, slicer: false, allowCustom: false },
  { attribute: { id: 339, name: 'Kordon Renk' }, categoryId: 1001, required: false, varianter: true, slicer: false, allowCustom: false },
];
vres = resolveTrendyolAttributes(twoColors, valuesOf([338, ['Siyah']], [339, ['Siyah']]), [{ name: 'X', value: 'Siyah' }]);
check('VARIANT: ambiguous value-only → AMBIGUOUS', vres.status === 'VARIANT_ATTRIBUTE_NOT_FOUND' && vres.missing.some((m) => m.reason.includes('AMBIGUOUS')), vres.status);

// ==================== PRICE ====================

const priceRules = [
  { minPrice: 0, maxPrice: 500, profitMargin: 20, fixedAmount: 30 },
  { minPrice: 501, maxPrice: 1000, profitMargin: 25, fixedAmount: 30 },
];
let p = resolveListingPrice(500, priceRules);
check('PRICE: 500 → 630', p.status === 'OK' && p.listingPrice === 630, p.status + ' ' + p.listingPrice);
check('PRICE: 0 → PRICE_DATA_MISSING', resolveListingPrice(0, priceRules).status === 'PRICE_DATA_MISSING');
check('PRICE: negatif → PRICE_DATA_MISSING', resolveListingPrice(-10, priceRules).status === 'PRICE_DATA_MISSING');
check('PRICE: null → PRICE_DATA_MISSING', resolveListingPrice(null, priceRules).status === 'PRICE_DATA_MISSING');
check('PRICE: kural yok → PRICE_RULE_NOT_FOUND', resolveListingPrice(500, null).status === 'PRICE_RULE_NOT_FOUND');
check('PRICE: bant dışı → PRICE_RULE_NOT_FOUND', resolveListingPrice(1001, priceRules).status === 'PRICE_RULE_NOT_FOUND');
const ambRules = [
  { minPrice: 0, maxPrice: 500, profitMargin: 20, fixedAmount: 30 },
  { minPrice: 500, maxPrice: 1000, profitMargin: 25, fixedAmount: 30 },
];
check('PRICE: çakışan bant → PRICE_RULE_AMBIGUOUS', resolveListingPrice(500, ambRules).status === 'PRICE_RULE_AMBIGUOUS');

// ==================== TRENDYOL PAYLOAD ====================

const payload: MarketplaceListingPayload = {
  barcode: '8690000000001',
  sku: 'SKU-1',
  title: 'Elbise',
  description: 'Açıklama',
  price: 630,
  stock: 5,
  vatRate: 20,
  categoryExternalId: '1001',
  brandName: 'Apple',
  images: ['https://img.example/1.jpg', 'https://img.example/2.jpg', 'https://img.example/3.jpg', 'https://img.example/4.jpg', 'https://img.example/5.jpg', 'https://img.example/6.jpg', 'https://img.example/7.jpg', 'https://img.example/8.jpg', 'https://img.example/9.jpg'],
  brandId: 1001,
  categoryId: 1001,
  attributes: [{ attributeId: 338, attributeValueIds: [33801] }],
};

const req = trendyolAdapter.buildRequest(
  { apiKey: 'k', apiSecret: 's', refreshToken: null, merchantId: null, sellerId: '12345', storeId: null },
  payload,
  'https://apigw.trendyol.com/integration'
);
const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
const items = Array.isArray(body.items) ? body.items : [];
const item = items[0] as Record<string, unknown>;

check('TRENDYOL: items[] uzunluk 1', items.length === 1);
check('TRENDYOL: User-Agent = "12345 - SelfIntegration"', req.headers['User-Agent'] === '12345 - SelfIntegration');
check('TRENDYOL: url sellerId + /v2/products', req.url.includes('/product/sellers/12345/v2/products'));
check('TRENDYOL: images[] {url} (maks 8)', Array.isArray(item.images) && (item.images as Array<Record<string, unknown>>).every((im) => typeof im.url === 'string') && (item.images as unknown[]).length === 8);
check('TRENDYOL: attributes gerçek ID', Array.isArray(item.attributes) && ((item.attributes as Array<Record<string, unknown>>)[0]?.attributeId) === 338 && Array.isArray(((item.attributes as Array<Record<string, unknown>>)[0]?.attributeValueIds)) && (((item.attributes as Array<Record<string, unknown>>)[0]?.attributeValueIds as number[])[0]) === 33801);
check('TRENDYOL: categoryId/brandId numeric gerçek', item.categoryId === 1001 && item.brandId === 1001);
check('TRENDYOL: salePrice = listingPrice (630)', item.salePrice === 630);

const parsed = trendyolAdapter.parseResponse(200, JSON.stringify({ batchRequestId: 'batch-abc-123' }));
check('TRENDYOL: batchRequestId listingId SANILMAZ', parsed.ok === true && parsed.externalListingId === null && parsed.batchRequestId === 'batch-abc-123', JSON.stringify(parsed));

// normalize / anlamlı değer
check('normalize: Türkçe + case', normalizeName('Kadın Giyim') === 'kadingiyim');
check('isMeaningful: boş false', isMeaningfulVariantValue('') === false);
check('isMeaningful: "---" false (harf yok)', isMeaningfulVariantValue('---') === false);

console.log('========================================');
console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
if (failures.length) { for (const f of failures) console.log(' - ' + f); }
process.exit(fail > 0 ? 1 : 0);
