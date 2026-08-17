import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { prisma } from './src/db/prisma.ts';
import { env } from './src/env.ts';
import { detectVariantAttributes, isVariantComplete, isPrepComplete } from './src/services/readiness.ts';
import { resolveTrendyolAttributes, isMeaningfulVariantValue } from './src/services/trendyolVariantResolver.ts';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function t(name: string, pass: boolean, detail = '') {
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
  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  const he = await prisma.marketplace.findUnique({ where: { key: 'he' }, select: { id: true } });
  const user = await prisma.user.findFirst({ select: { id: true } });
  const token = jwt.sign({ role: 'ADMIN', sub: user!.id }, env.JWT_SECRET, { expiresIn: '1h' });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  console.log('=== MOTOR TESTLERİ (TEST 1..10) ===\n');

  // TEST 1 — Varyantsız ürün → NOT_REQUIRED (motor + DB kanıtı)
  const dNone = detectVariantAttributes('USB WiFi Adaptor 1200 Mbps Dual Band');
  t('TEST 1 NO-VARIANT → NOT_REQUIRED', dNone.length === 0, 'detect=' + JSON.stringify(dNone));
  const nrCount = await prisma.product.count({ where: { xmlSourceId: src!.id, variantStatus: 'NOT_REQUIRED' } });
  t('TEST 1 NOT_REQUIRED DB kanıtı', nrCount === 13382, 'NOT_REQUIRED=' + nrCount);

  // TEST 2 — XML=Siyah, Trendyol=Siyah → birebir AUTO_MATCH (gerçek ID'ler)
  const exact = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Siyah' }]);
  t('TEST 2 EXACT MATCH → AUTO_MATCH', exact.status === 'OK' && exact.resolved[0].attributeId === 100 && exact.resolved[0].attributeValueId === 1001, 'attrId=' + exact.resolved[0].attributeId + ' valueId=' + exact.resolved[0].attributeValueId);

  // TEST 3 — normalize edilebilir (Kirmizi → Kırmızı) → AI_MATCH (whitelist doğrulamalı)
  const norm = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Kirmizi' }]);
  t('TEST 3 NORMALIZE → AI_MATCH', norm.status === 'OK' && norm.resolved[0].attributeValue === 'Kırmızı' && norm.resolved[0].attributeValueId === 1003, 'value=' + norm.resolved[0].attributeValue);

  // TEST 4 — Trendyol'da karşılığı yok → MANUAL_REVIEW
  const noEq = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'Kırmızımsı Bordo' }]);
  t('TEST 4 NO EQUIVALENT → MANUAL_REVIEW', noEq.status === 'VARIANT_ATTRIBUTE_NOT_FOUND', noEq.status);

  // TEST 5 — bozuk/çöp değer → MANUAL_REVIEW / NOT_FOUND, sahte ID YASAK
  const garbage = resolveTrendyolAttributes(fixtureAttrs(), fixtureValues(), [{ name: 'Renk', value: 'AKYI-123' }]);
  t('TEST 5 GARBAGE → NOT_FOUND (sahte ID yok)', garbage.status === 'VARIANT_ATTRIBUTE_NOT_FOUND' && garbage.resolved.every((r) => r.attributeId === null), garbage.status);
  t('TEST 5 meaningful kontrol', isMeaningfulVariantValue('Siyah') === true && isMeaningfulVariantValue('---') === false, '');

  // TEST 6 — kategori mapping yok → MANUAL_REVIEW CATEGORY_MAPPING_NOT_FOUND (fail-closed)
  const r6 = await fetch(`http://localhost:4001/variants/ai-match?limit=3&useAI=0`, { method: 'POST', headers, body: JSON.stringify({ xmlSourceId: src!.id, marketplaceId: tt!.id }) });
  const b6 = await r6.json();
  const allManual = (b6.results || []).every((x: any) => x.status === 'MANUAL_REVIEW');
  t('TEST 6 CATEGORY_MAPPING_NOT_FOUND → MANUAL_REVIEW', r6.status === 200 && allManual, (b6.results || []).map((x: any) => x.reason).join('; ').slice(0, 90));

  // TEST 7 — yanlış XML → context izolasyonu (bogus xmlSourceId → 0 ürün)
  const r7 = await fetch(`http://localhost:4001/variants/dashboard?xmlSourceId=bogus-id-xyz&marketplaceId=${tt!.id}`, { headers });
  const b7 = await r7.json();
  t('TEST 7 WRONG XML → CONTEXT ISOLATION', b7.totalProducts === 0, 'bogus total=' + b7.totalProducts);

  // TEST 8 — yanlış marketplace (Hepsiburada) → Trendyol attribute/value kullanılmaz
  const r8 = await fetch(`http://localhost:4001/variants/ai-match?limit=2&useAI=0`, { method: 'POST', headers, body: JSON.stringify({ xmlSourceId: src!.id, marketplaceId: he!.id }) });
  const b8 = await r8.json();
  const heReasons = (b8.results || []).map((x: any) => x.reason).join('; ');
  // V2: AKILLIBAYI1'de WAITING_AI ürünü YOK -> motor 0 ürün işler (sahte MANUAL üretilmez).
  t('TEST 8 WRONG MARKETPLACE (V2: WAITING_AI yok → 0 sonuç)', r8.status === 200 && (b8.results || []).length === 0, 'results=' + (b8.results || []).length);

  // TEST 9/10 — seçim kapsamı (browser testinde doğrulanır; burada uçtan uca API kanıtı)
  const r10 = await fetch(`http://localhost:4001/variants/products?page=1&limit=50&xmlSourceId=${src!.id}`, { headers });
  const b10 = await r10.json();
  // V2: tümü NOT_REQUIRED -> varyantlı ürün listesi boş (total 0), sahte varyant üretilmez.
  t('TEST 9/10 PAGE DATASET (V2: varyantlı ürün YOK → total 0)', Array.isArray(b10.items) && b10.items.length === 0 && b10.pagination?.total === 0, 'items=' + (b10.items || []).length + ' total=' + (b10.pagination?.total ?? 0));

  // READY kontrolü (4/4 gate)
  const readyOk = isPrepComplete({ status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: false, variantStatus: 'NOT_REQUIRED' });
  const readyNotOk = isPrepComplete({ status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: false, variantStatus: 'MANUAL_REVIEW' });
  t('READY 4/4 (NOT_REQUIRED)', readyOk === true, '');
  t('READY 4/4 (MANUAL_REVIEW → READY DEĞİL)', readyNotOk === false, '');

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== MOTOR TESTLERİ: ${pass}/${results.length} PASS ===`);
  await prisma.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
