import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { detectVariantAttributes, isVariantComplete, isPrepComplete, READY_FILTER } from './src/services/readiness.ts';
import { resolveTrendyolAttributes, isMeaningfulVariantValue } from './src/services/trendyolVariantResolver.ts';
import { fetchTrendyolCategoryAttributes } from './src/services/trendyolCatalog.ts';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function test(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

function fixtureAttrs() {
  return [
    { attribute: { id: 100, name: 'Renk' }, categoryId: 626, required: true, varianter: true, slicer: false, allowCustom: false },
    { attribute: { id: 101, name: 'Beden' }, categoryId: 626, required: false, varianter: true, slicer: false, allowCustom: false },
  ];
}
function fixtureValues() {
  const m = new Map<number, Array<{ attributeValueId: number; attributeValue: string }>>();
  m.set(100, [{ attributeValueId: 1001, attributeValue: 'Siyah' }, { attributeValueId: 1002, attributeValue: 'Beyaz' }, { attributeValueId: 1003, attributeValue: 'Kırmızı' }]);
  m.set(101, [{ attributeValueId: 2001, attributeValue: 'S' }, { attributeValueId: 2002, attributeValue: 'M' }, { attributeValueId: 2003, attributeValue: 'L' }]);
  return m;
}

async function main() {
  // 1) CONTEXT TEST
  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });
  test('VARIANT CONTEXT TEST (tek XML)', src?.name === 'AKILLIBAYI1', src?.name ?? 'none');
  const total = await prisma.product.count({ where: { xmlSourceId: src!.id } });
  test('VARIANT CONTEXT TEST (13.382 ürün)', total === 13382, String(total));

  // 2) DATASET TEST
  const garbage = await prisma.variant.count({ where: { name: 'AKYI' } });
  const real = await prisma.variant.count({ where: { name: { in: ['Renk', 'Beden', 'Numara', 'Kapasite'] }, product: { xmlSourceId: src!.id } } });
  test('VARIANT DATASET TEST (AKYI çöpü YOK)', garbage === 0, 'AKYI=' + garbage);
  test('VARIANT DATASET TEST (AKILLIBAYI1 gerçek varyant kaydı YOK)', real === 0, 'real=' + real);

  // 3) DETECTION TEST
  const d1 = detectVariantAttributes('HOBİBAHÇEM® Kirmizi ATM Tasarimli Sifreli Para Kasasi');
  test('VARIANT DETECTION TEST (başlıktan Renk üretilmez)', d1.length === 0, JSON.stringify(d1));
  const d2 = detectVariantAttributes('Elbise Beden M Siyah');
  test('VARIANT DETECTION TEST (başlıktan Renk+Beden üretilmez)', d2.length === 0, JSON.stringify(d2));
  const d3 = detectVariantAttributes('USB WiFi Adaptor 1200 Mbps');
  test('VARIANT DETECTION TEST (varyant yok)', d3.length === 0, JSON.stringify(d3));

  // 4) AUTO MATCH TEST (birebir whitelist)
  const autoRes = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Siyah' }, { name: 'Beden', value: 'M' }]);
  test('VARIANT AUTO MATCH TEST (Renk=Beden birebir)', autoRes.status === 'OK' && autoRes.attributes.length === 2, JSON.stringify(autoRes.attributes));

  // 5) AI MATCH TEST (değer normalizasyonu + whitelist doğrulama: Kirmizi -> Kırmızı)
  const normRes = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Kirmizi' }]);
  test('VARIANT AI MATCH TEST (Kirmizi→Kırmızı whitelist)', normRes.status === 'OK' && normRes.resolved[0].attributeValue === 'Kırmızı', normRes.status + ' ' + JSON.stringify(normRes.resolved[0]));

  // 6) MANUAL REVIEW TEST (whitelist dışı / bozuk değer)
  const manualRes = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'AKYI-123' }]);
  test('VARIANT MANUAL REVIEW TEST (bozuk değer)', manualRes.status === 'VARIANT_ATTRIBUTE_NOT_FOUND', manualRes.status);
  const manualRes2 = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Kırmızımsı Bordo' }]);
  test('VARIANT MANUAL REVIEW TEST (whitelist dışı değer)', manualRes2.status === 'VARIANT_ATTRIBUTE_NOT_FOUND', manualRes2.status);
  test('VARIANT MANUAL REVIEW TEST (meaningful kontrol)', isMeaningfulVariantValue('Siyah') === true && isMeaningfulVariantValue('---') === false, '');

  // 7) MARKETPLACE ATTRIBUTE TEST (gerçek Trendyol catalog)
  const attrs = await fetchTrendyolCategoryAttributes(626);
  test('VARIANT MARKETPLACE ATTRIBUTE TEST (gerçek catalog)', Array.isArray(attrs) && attrs.length > 0, 'attrCount=' + (Array.isArray(attrs) ? attrs.length : 'n/a'));

  // 8) READINESS TEST
  test('VARIANT READINESS TEST (variantMatch)', isVariantComplete({ variantMatch: true, variantStatus: null }) === true, '');
  test('VARIANT READINESS TEST (NOT_REQUIRED)', isVariantComplete({ variantMatch: false, variantStatus: 'NOT_REQUIRED' }) === true, '');
  test('VARIANT READINESS TEST (eksik)', isVariantComplete({ variantMatch: false, variantStatus: 'WAITING_AI' }) === false, '');
  test('VARIANT READINESS TEST (4/4)', isPrepComplete({ status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: false, variantStatus: 'NOT_REQUIRED' }) === true, '');
  test('VARIANT READINESS TEST (READY_FILTER)', (READY_FILTER as any).OR.length === 2, '');

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n=== VARIANT UNIT TESTS: ${passCount}/${results.length} PASS ===`);
  await prisma.$disconnect();
  process.exit(passCount === results.length ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
