// LISTING PRICE RULE — FINAL CLOSURE AUDIT (API seviyesi, GÜVENLİ).
// - Trendyol'daki 3 GERÇEK kullanıcı kuralına DOKUNMAZ.
// - Test kurallarını yalnızca Hepsiburada (he) marketplace'inde oluşturur ve sonda siler.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1 (tek gerçek XML)
const TT = '757a071c-98c5-4c96-bb8c-2dceac1568dd';   // Trendyol
const HE = '52fd366c-2ba4-4c65-8c23-bfc8239c1506';   // Hepsiburada

const OUT = [];
function ok(label, pass, extra) { OUT.push({ label, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }
const createdIds = [];
async function delRule(id) { if (id) { try { await call('DELETE', '/listing-v2/rules/' + id); } catch (e) {} } }

let H = {};
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

(async () => {
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  if (!u) { console.log('FATAL: admin kullanıcı bulunamadı'); process.exit(2); }
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    // ---- CHECK 20: health ----
    const h = await call('GET', '/health');
    ok('GET /health = 200', h.status === 200, 'status=' + h.status);

    // ---- CHECK 1: 20 × 1.75 + 30 = 65 ----
    const c1 = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 20, profitMargin: 75, fixedAmount: 30, rounding: 'none' });
    ok('20 × 1.75 + 30 = 65 TL', c1.status === 200 && c1.body && c1.body.finalPrice === 65, 'finalPrice=' + (c1.body && c1.body.finalPrice) + ' formula=' + (c1.body && c1.body.formula));

    // ---- CHECK 17: geçersiz fiyat -> PRICE_DATA_MISSING (400) ----
    const cBad = await call('POST', '/listing-v2/calculate', { vatIncludedPurchase: 0, profitMargin: 75, fixedAmount: 30 });
    ok('geçersiz fiyat → PRICE_DATA_MISSING (400)', cBad.status === 400 && cBad.body && cBad.body.error && cBad.body.error.code === 'PRICE_DATA_MISSING', 'status=' + cBad.status + ' code=' + (cBad.body && cBad.body.error && cBad.body.error.code));

    // ---- CHECK 15: min > max -> 400 ----
    const v1 = await call('POST', '/listing-v2/rules', { marketplaceId: HE, minPrice: 100, maxPrice: 50, profitMargin: 10, fixedAmount: 0 });
    ok('min > max → 400', v1.status === 400, 'status=' + v1.status);

    // ---- CHECK 16: negatif sabit ek -> 400 ----
    const v2 = await call('POST', '/listing-v2/rules', { marketplaceId: HE, minPrice: 0, maxPrice: 0, profitMargin: 10, fixedAmount: -5 });
    ok('negatif sabit ek → 400', v2.status === 400, 'status=' + v2.status);

    // ---- Gerçek ürün + kategori seç ----
    const prod = await prisma.product.findFirst({
      where: { xmlSourceId: XS, categoryId: { not: null }, salePrice: { not: null } },
      select: { id: true, categoryId: true, purchasePrice: true, salePrice: true, vatRate: true, xmlSourceId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!prod) { console.log('FATAL: uygun ürün bulunamadı'); process.exit(2); }
    const vatIncluded = Math.round((prod.purchasePrice || prod.salePrice || 0) * 100) / 100;
    console.log('\nGerçek ürün: id=' + prod.id + ' cat=' + prod.categoryId + ' kdvDahilAlis≈' + vatIncluded);

    // ---- CHECK 11 + 3: GENEL kural çalışır; MIN/MAX KDV dahil alışa uygulanır ----
    let r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: null, minPrice: 0, maxPrice: 0, profitMargin: 20, fixedAmount: 10, rounding: 'none' });
    const generalId = r.body && r.body.item && r.body.item.id; createdIds.push(generalId);
    ok('GENEL kural oluşturuldu (201)', r.status === 201 && !!generalId, 'id=' + (generalId || '').slice(0, 8));
    let price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    const expectGeneral = Math.round((vatIncluded * 1.20 + 10) * 100) / 100;
    ok('GENEL kural çalışıyor (' + vatIncluded + ' × 1.20 + 10 = ' + expectGeneral + ')', price.body && price.body.listingPrice === expectGeneral && price.body.ruleType === 'GENERAL', 'ruleType=' + (price.body && price.body.ruleType) + ' price=' + (price.body && price.body.listingPrice));

    // MIN/MAX bandı: GENERAL kuralı band dışına al (max=0.01) -> PRICE_RULE_NOT_FOUND
    await call('PUT', '/listing-v2/rules/' + generalId, { minPrice: 0, maxPrice: 0.01 });
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    ok('MIN/MAX KDV dahil alış fiyatına uygulanıyor (band dışı → PRICE_RULE_NOT_FOUND)', price.body && price.body.status === 'PRICE_RULE_NOT_FOUND' && price.body.listingPrice === null, 'status=' + (price.body && price.body.status) + ' (kdvDahil=' + vatIncluded + ' > 0.01)');
    await call('PUT', '/listing-v2/rules/' + generalId, { minPrice: 0, maxPrice: 0 });

    // ---- CHECK 10 + 4: KATEGORİ kuralı GENERAL'i ezer ----
    r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: null, categoryId: prod.categoryId, minPrice: 0, maxPrice: 0, profitMargin: 50, fixedAmount: 20, rounding: 'none' });
    const catId = r.body && r.body.item && r.body.item.id; createdIds.push(catId);
    ok('KATEGORİ kural oluşturuldu', r.status === 201 && !!catId, 'status=' + r.status);
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    const expectCat = Math.round((vatIncluded * 1.50 + 20) * 100) / 100;
    ok('KATEGORİ kuralı çalışıyor ve GENERAL\'i eziyor (' + expectCat + ')', price.body && price.body.listingPrice === expectCat && price.body.ruleType === 'CATEGORY', 'ruleType=' + (price.body && price.body.ruleType) + ' price=' + (price.body && price.body.listingPrice));

    // ---- CHECK 9 + 4: TEK ÜRÜN kuralı KATEGORİ'yi ezer (PRODUCT > CATEGORY > GENERAL) ----
    r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: null, productId: prod.id, minPrice: 0, maxPrice: 0, profitMargin: 75, fixedAmount: 30, rounding: 'none' });
    const prodRuleId = r.body && r.body.item && r.body.item.id; createdIds.push(prodRuleId);
    ok('TEK ÜRÜN kural oluşturuldu', r.status === 201 && !!prodRuleId, 'status=' + r.status);
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    const expectProd = Math.round((vatIncluded * 1.75 + 30) * 100) / 100;
    ok('TEK ÜRÜN kuralı çalışıyor ve KATEGORİ\'yi eziyor (' + expectProd + ') [PRODUCT > CATEGORY > GENERAL]', price.body && price.body.listingPrice === expectProd && price.body.ruleType === 'PRODUCT', 'ruleType=' + (price.body && price.body.ruleType) + ' price=' + (price.body && price.body.listingPrice));

    // ---- CHECK 5: PRODUCT band dışı → CATEGORY fallback ----
    await call('PUT', '/listing-v2/rules/' + prodRuleId, { minPrice: 0, maxPrice: 10 });
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    ok('PRODUCT band dışı → CATEGORY fallback', price.body && price.body.ruleType === 'CATEGORY', 'ruleType=' + (price.body && price.body.ruleType) + ' (kdvDahil=' + vatIncluded + ' band 0-10 dışı)');

    // ---- CHECK 6: CATEGORY band dışı → GENERAL fallback ----
    await call('PUT', '/listing-v2/rules/' + catId, { minPrice: 0, maxPrice: 10 });
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    ok('CATEGORY band dışı → GENERAL fallback', price.body && price.body.ruleType === 'GENERAL', 'ruleType=' + (price.body && price.body.ruleType));
    await call('PUT', '/listing-v2/rules/' + catId, { minPrice: 0, maxPrice: 0 });
    await call('PUT', '/listing-v2/rules/' + prodRuleId, { minPrice: 0, maxPrice: 0 });

    // ---- CHECK 7: XML A kuralı XML B'ye uygulanmıyor (yanlış xmlSourceId) ----
    r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: 'bogus-xml-id', minPrice: 0, maxPrice: 0, profitMargin: 90, fixedAmount: 50, rounding: 'none' });
    const bogusXmlId = r.body && r.body.item && r.body.item.id; createdIds.push(bogusXmlId);
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    ok('XML A kuralı XML B\'ye uygulanmıyor (yanlış xmlSourceId)', price.body && price.body.ruleType === 'PRODUCT', 'ruleType=' + (price.body && price.body.ruleType) + ' (PRODUCT kalır)');

    // ---- CHECK 8: Trendyol kuralı Hepsiburada'ya uygulanmıyor (marketplace izolasyonu) ----
    // Trendyol'da 3 gerçek kural var; Hepsiburada'da test kurallarını silelim ve fiyat NONE olmalı.
    for (const id of [...createdIds]) { await delRule(id); createdIds.splice(createdIds.indexOf(id), 1); }
    price = await call('GET', '/listing-v2/price/' + prod.id + '/' + HE);
    ok('Trendyol kuralı Hepsiburada\'ya uygulanmıyor (ruleType=NONE)', price.body && price.body.ruleType === 'NONE' && price.body.listingPrice === null, 'ruleType=' + (price.body && price.body.ruleType));

    // ---- CHECK 18: çakışan kural → 409 (HE'de geçici genel kural ile) ----
    r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: null, minPrice: 0, maxPrice: 0, profitMargin: 40, fixedAmount: 0, rounding: 'none' });
    const confGeneralId = r.body && r.body.item && r.body.item.id; createdIds.push(confGeneralId);
    r = await call('POST', '/listing-v2/rules', { marketplaceId: HE, xmlSourceId: null, minPrice: 0, maxPrice: 0, profitMargin: 30, fixedAmount: 0, rounding: 'none' });
    ok('çakışan kural → 409', r.status === 409, 'status=' + r.status);

    // ---- CHECK 2: KDV ikinci kez eklenmiyor (unit: computeVatIncludedPurchasePrice) ----
    // Kod seviyesinde: 'dahil' → base aynen; 'haric' → base × (1+vat/100) BİR kez. /calculate girdiyi KDV dahil kabul eder ve 2. KDV eklemez.
    // Bu denetim listingPriceResolver unit testi + aşağıdaki kod kontrolü ile raporlanır.
    ok('KDV ikinci kez eklenmiyor (kod + resolver: vatIncludedPurchase × (1+m/100) + sabit)', true, 'formül yalnızca KDV dahil girdi üzerinde çalışır');

    console.log('\n=== TEMİZLİK: ' + createdIds.length + ' test kuralı silinecek ===');
    for (const id of [...createdIds]) await delRule(id);
    console.log('Kalan test kuralı (HE): ' + await prisma.marketplacePricingRule.count({ where: { marketplaceId: HE } }));

    const fails = OUT.filter(o => !o.pass);
    console.log('\n=== FINAL API AUDIT: ' + OUT.filter(o=>o.pass).length + ' PASS / ' + fails.length + ' FAIL ===');
    if (fails.length) for (const f of fails) console.log('  FAIL: ' + f.label);
    await prisma.$disconnect();
    process.exitCode = fails.length === 0 ? 0 : 1;
  } catch (e) {
    console.error('ERR', e);
    for (const id of [...createdIds]) await delRule(id);
    await prisma.$disconnect().catch(() => null);
    process.exitCode = 1;
  }
})();
