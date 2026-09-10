import 'dotenv/config';
import { matchTrendyolCategory, matchTrendyolBrand, normalizeName } from './src/services/categoryBrandMapper.ts';

/**
 * XML → Trendyol mapping matcher testi (mock catalog verisi, canlı API YOK).
 * MATCHED / AMBIGUOUS / NOT_FOUND + AKYI benzeri bozuk değer reddi.
 */
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

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

// Category tests
let r = matchTrendyolCategory('Kadın > Giyim > Elbise', tree);
check('Elbise → MATCHED (id=1001)', r.status === 'MATCHED' && r.id === 1001, r.status + ' ' + r.id);

r = matchTrendyolCategory('Erkek > Giyim > Tişört', tree);
check('Tişört → MATCHED (id=2001)', r.status === 'MATCHED' && r.id === 2001, r.status);

r = matchTrendyolCategory('Ayakkabı', tree);
check('Ayakkabı (iki yerde) → AMBIGUOUS', r.status === 'AMBIGUOUS' && r.candidates.length === 2, r.status);

r = matchTrendyolCategory('AKYI', tree);
check('AKYI → NOT_FOUND', r.status === 'NOT_FOUND', r.status);

r = matchTrendyolCategory('Bilinmeyen > Xyz', tree);
check('Bilinmeyen → NOT_FOUND', r.status === 'NOT_FOUND', r.status);

// Brand tests
let b = matchTrendyolBrand('Apple', brands);
check('Apple → MATCHED (id=1001)', b.status === 'MATCHED' && b.id === 1001, b.status);

b = matchTrendyolBrand('Samsung', brands);
check('Samsung → MATCHED', b.status === 'MATCHED' && b.id === 1002, b.status);

b = matchTrendyolBrand('AKYI', brands);
check('AKYI marka → NOT_FOUND', b.status === 'NOT_FOUND', b.status);

// Ambig brand
const ambBrands = [...brands, { id: 2001, name: 'Apple', luxe: true }];
b = matchTrendyolBrand('Apple', ambBrands);
check('Apple (iki kayıt) → AMBIGUOUS', b.status === 'AMBIGUOUS' && b.candidates.length === 2, b.status);

// normalize
check('normalizeName Türkçe + case', normalizeName('Kadın Giyim') === 'kadingiyim');
check('normalizeName boşluk/özel', normalizeName('  Şapka & Bere! ') === 'sapkabere');

console.log('========================================');
console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
if (failures.length) { for (const f of failures) console.log(' - ' + f); }
process.exit(fail > 0 ? 1 : 0);
