// GEÇİCİ — FINAL KANIT: false-positive + gerçek varyant + sayaç uyumu.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const { detectVariantAttributes } = require('./src/services/readiness.ts');
const p = new PrismaClient();

(async () => {
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';

  // 1) FALSE POSITIVE: hedef başlık ölçü/teknik birim içeriyor → varyant ÜRETMEMELİ
  const fpText = 'HOBİBAHÇEM® 18 Inc 45 Cm Kumandali Sanayi Tipi Ayakli Vantilator 65W 137CM';
  const fpDetected = detectVariantAttributes(fpText);
  console.log('FALSE_POSITIVE_DETECT', JSON.stringify(fpDetected));
  console.log('FALSE_POSITIVE_RESULT', fpDetected.length === 0 ? 'NOT_REQUIRED' : 'FALSE_POSITIVE_BUG');

  // 2) GERÇEK VARIANT: açık renk kelimesi içeren ürün → varyant ÜRETMELİ
  const realText = 'HOBİBAHÇEM® Raks Leo Burun Kulak Tuy Alma Makinesi 45 dk Sarj Sureli Kirmizi';
  const realDetected = detectVariantAttributes(realText);
  console.log('REAL_VARIANT_DETECT', JSON.stringify(realDetected));

  // 3) Hedef vantilatör DB durumu (temizlik sonrası)
  const vant = await p.product.findFirst({
    where: { title: { contains: 'N15 Dijital Gostergeli Vantilator' } },
    select: { id: true, title: true, variantStatus: true, variantMatch: true, variants: { select: { name: true, value: true } } },
  });
  console.log('VANTILATOR_DB', JSON.stringify(vant));

  // 4) Gerçek varyantlı ürün DB durumu
  const real = await p.product.findFirst({
    where: { id: 'f09c3b1c-aba4-427d-ba7c-15692778ef24' },
    select: { id: true, title: true, variantStatus: true, variantMatch: true, variants: { select: { name: true, value: true } } },
  });
  console.log('REAL_VARIANT_DB', JSON.stringify(real));

  // 5) Sayaç uyumu: Product Pool (categoryId null) vs Category Mapping (categoryId bazlı)
  const poolCatPending = await p.product.count({ where: { xmlSourceId: xsId, categoryId: null } });
  const catProducts = await p.product.findMany({ where: { xmlSourceId: xsId }, select: { id: true, supplierCategory: true, categoryId: true } });
  const byCat = {};
  for (const pr of catProducts) { const k = (pr.supplierCategory || 'Kategorisiz').trim(); (byCat[k] = byCat[k] || []).push(pr); }
  const manualGroups = Object.values(byCat).filter((arr) => arr.some((pr) => !pr.categoryId));
  const manualGroupProducts = manualGroups.reduce((s, arr) => s + arr.filter((pr) => !pr.categoryId).length, 0);
  console.log('COUNTER_ALIGNMENT', JSON.stringify({
    poolCategoryPending: poolCatPending,
    categoryMappingManualGroups: manualGroups.length,
    categoryMappingManualProducts: manualGroupProducts,
  }));

  // 6) Varyant sayaçları (temizlik sonrası)
  const vDash = await Promise.all([
    p.product.count({ where: { xmlSourceId: xsId } }),
    p.product.count({ where: { xmlSourceId: xsId, variantStatus: 'NOT_REQUIRED' } }),
    p.product.count({ where: { xmlSourceId: xsId, variantMatch: true } }),
    p.product.count({ where: { xmlSourceId: xsId, variantStatus: 'MANUAL_REVIEW' } }),
    p.product.count({ where: { xmlSourceId: xsId, variantStatus: 'WAITING_AI' } }),
  ]);
  console.log('VARIANT_COUNTS_AFTER', JSON.stringify({ total: vDash[0], notRequired: vDash[1], matched: vDash[2], manualReview: vDash[3], waitingAi: vDash[4] }));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
