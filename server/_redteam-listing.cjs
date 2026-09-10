// RED TEAM — LISTING PRICE RULE MOTORU. Gerçek DB + gerçek API (localhost:4001). Test sonunda kurallar temizlenir.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';
const TT = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

const OUT = [];
function ok(label, pass, extra) { OUT.push({ label, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  async function call(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }

  const createdRuleIds = [];
  async function delRule(id) { if (id) await call('DELETE', '/listing-v2/rules/' + id); }

  // Mevcut kuralları yedekle ve test için temizle (test sonunda geri yüklenir)
  const existingRules = await call('GET', '/listing-v2/rules?marketplaceId=' + TT);
  const backup = (existingRules.body && existingRules.body.items) || [];
  for (const r of backup) await delRule(r.id);
  console.log('Yedeklenen + temizlenen mevcut kural:', backup.length);

  // 1) FORMÜL TESTLERİ
  console.log('=== FORMÜL (KDV dahil girdi) ===');
  const t1 = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 20, profitMargin: 75, fixedAmount: 30 });
  ok('20 × 1.75 + 30 = 65', t1.body && t1.body.finalPrice === 65, 'finalPrice=' + (t1.body && t1.body.finalPrice));
  const t2 = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 100, profitMargin: 20, fixedAmount: 10 });
  ok('100 × 1.20 + 10 = 130', t2.body && t2.body.finalPrice === 130, 'finalPrice=' + (t2.body && t2.body.finalPrice));
  const t3 = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 250, profitMargin: 50, fixedAmount: 0 });
  ok('250 × 1.50 + 0 = 375', t3.body && t3.body.finalPrice === 375, 'finalPrice=' + (t3.body && t3.body.finalPrice));
  const tBad = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 0, profitMargin: 75, fixedAmount: 30 });
  ok('Alış 0 → PRICE_DATA_MISSING', tBad.status === 400, 'status=' + tBad.status);

  // 2) GERÇEK ÜRÜN + KATEGORİ
  const prod = await prisma.product.findFirst({
    where: { xmlSourceId: XS, categoryId: { not: null }, salePrice: { not: null } },
    select: { id: true, categoryId: true, salePrice: true, purchasePrice: true, vatRate: true },
    orderBy: { createdAt: 'desc' },
  });
  const vatIncluded = Math.round((prod.purchasePrice || prod.salePrice || 0) * 100) / 100;
  console.log('\nGERÇEK ÜRÜN: id=' + prod.id + ' cat=' + prod.categoryId + ' kdvDahilAlis≈' + vatIncluded);

  // 3) GENEL KURAL
  console.log('\n=== GENEL KURAL ===');
  let r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, xmlSourceId: null, minPrice: 0, maxPrice: 0, profitMargin: 20, fixedAmount: 10, rounding: 'none' });
  const generalId = r.body && r.body.item && r.body.item.id;
  createdRuleIds.push(generalId);
  ok('GENEL kural oluşturuldu (201)', r.status === 201 && !!generalId, 'id=' + (generalId || '').slice(0, 8));
  let price = await call('GET', '/listing-v2/price/' + prod.id + '/' + TT);
  const expectGeneral = Math.round((vatIncluded * 1.20 + 10) * 100) / 100;
  ok('GENEL uygulandı: ' + vatIncluded + ' × 1.20 + 10 = ' + expectGeneral, price.body && price.body.listingPrice === expectGeneral && price.body.ruleType === 'GENERAL', JSON.stringify(price.body));

  // 4) KATEGORİ KURALI (GENEL'i ezer)
  console.log('\n=== KATEGORİ KURALI ===');
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, xmlSourceId: null, categoryId: prod.categoryId, minPrice: 0, maxPrice: 0, profitMargin: 50, fixedAmount: 20, rounding: 'none' });
  const catId = r.body && r.body.item && r.body.item.id;
  createdRuleIds.push(catId);
  ok('KATEGORİ kural oluşturuldu', r.status === 201 && !!catId, '');
  price = await call('GET', '/listing-v2/price/' + prod.id + '/' + TT);
  const expectCat = Math.round((vatIncluded * 1.50 + 20) * 100) / 100;
  ok('KATEGORİ kazanır: ' + expectCat, price.body && price.body.listingPrice === expectCat && price.body.ruleType === 'CATEGORY', JSON.stringify(price.body));

  // 5) TEK ÜRÜN KURALI (KATEGORİ'yi ezer)
  console.log('\n=== TEK ÜRÜN KURALI ===');
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, xmlSourceId: null, productId: prod.id, minPrice: 0, maxPrice: 0, profitMargin: 75, fixedAmount: 30, rounding: 'none' });
  const prodId = r.body && r.body.item && r.body.item.id;
  createdRuleIds.push(prodId);
  ok('TEK ÜRÜN kural oluşturuldu', r.status === 201 && !!prodId, '');
  price = await call('GET', '/listing-v2/price/' + prod.id + '/' + TT);
  const expectProd = Math.round((vatIncluded * 1.75 + 30) * 100) / 100;
  ok('TEK ÜRÜN kazanır: ' + expectProd, price.body && price.body.listingPrice === expectProd && price.body.ruleType === 'PRODUCT', JSON.stringify(price.body));

  // 6) MIN/MAX = ALIŞ FİYATI BANDI (ürün kuralı band dışı → kategoriye fallback)
  console.log('\n=== MIN/MAX BAND + FALLBACK ===');
  r = await call('PUT', '/listing-v2/rules/' + prodId, { minPrice: 0, maxPrice: 10 });
  price = await call('GET', '/listing-v2/price/' + prod.id + '/' + TT);
  ok('Ürün kuralı band dışı → KATEGORİ fallback', price.body && price.body.ruleType === 'CATEGORY', 'ruleType=' + (price.body && price.body.ruleType) + ' (kdvDahilAlis=' + vatIncluded + ' band 0-10 dışı)');

  // 7) XML İZOLASYONU (yanlış xmlSourceId → uygulanmaz)
  console.log('\n=== XML + MARKETPLACE İZOLASYONU ===');
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, xmlSourceId: 'bogus-xml-id', minPrice: 0, maxPrice: 0, profitMargin: 90, fixedAmount: 50, rounding: 'none' });
  const bogusXmlRule = r.body && r.body.item && r.body.item.id;
  createdRuleIds.push(bogusXmlRule);
  price = await call('GET', '/listing-v2/price/' + prod.id + '/' + TT);
  ok('Yanlış XML kuralı UYGULANMAZ (KATEGORİ kalır)', price.body && price.body.ruleType === 'CATEGORY', 'ruleType=' + (price.body && price.body.ruleType));

  // Marketplace izolasyonu: Hepsiburada → Trendyol kuralları uygulanmaz
  const he = await prisma.marketplace.findUnique({ where: { key: 'he' }, select: { id: true } });
  if (he) {
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + he.id);
    ok('Hepsiburada → Trendyol kuralları uygulanmaz', price.body && price.body.ruleType === 'NONE' && price.body.listingPrice === null, 'ruleType=' + (price.body && price.body.ruleType));
  } else {
    console.log('Hepsiburada marketplace bulunamadı (test atlandı)');
  }

  // 8) ÇAKIŞMA + VALIDATION
  console.log('\n=== ÇAKIŞMA + VALIDATION ===');
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, xmlSourceId: null, minPrice: 0, maxPrice: 0, profitMargin: 40, fixedAmount: 0, rounding: 'none' });
  ok('Aynı GENEL scope + çakışan band → 409', r.status === 409, 'status=' + r.status);
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, minPrice: 100, maxPrice: 50, profitMargin: 10, fixedAmount: 0 });
  ok('min > max → 400', r.status === 400, 'status=' + r.status);
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, minPrice: 0, maxPrice: 0, profitMargin: -5, fixedAmount: 0 });
  ok('negatif kâr → 400', r.status === 400, 'status=' + r.status);
  r = await call('POST', '/listing-v2/rules', { marketplaceId: TT, minPrice: 0, maxPrice: 0, profitMargin: 10, fixedAmount: -5 });
  ok('negatif sabit ek → 400', r.status === 400, 'status=' + r.status);

  // 9) TEMİZLİK + GERİ YÜKLEME
  for (const id of createdRuleIds) await delRule(id);
  console.log('\nTemizlik: ' + createdRuleIds.length + ' test kuralı silindi');
  for (const r of backup) {
    await call('POST', '/listing-v2/rules', {
      marketplaceId: r.marketplaceId, xmlSourceId: r.xmlSourceId ?? null, productId: r.productId ?? null, categoryId: r.categoryId ?? null,
      minPrice: r.minPrice, maxPrice: r.maxPrice, fixedAmount: r.fixedAmount ?? 0, profitMargin: r.profitMargin, rounding: r.rounding, active: r.active, priority: r.priority,
    });
  }
  console.log('Geri yükleme: ' + backup.length + ' kural geri yüklendi');

  await prisma.$disconnect();
  const fails = OUT.filter(o => !o.pass);
  console.log('\n=== LISTING RED TEAM: ' + (fails.length === 0 ? '0 FAIL' : fails.length + ' FAIL') + ' ===');
  process.exitCode = fails.length === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
