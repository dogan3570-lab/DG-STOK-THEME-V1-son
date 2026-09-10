// RED TEAM — 4/4 GATE GERÇEK SENARYOLAR + SAYIM DENKLEMİ. SADECE OKUMA.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

// readiness.ts isVariantComplete ile BİREBİR aynı kural
function isVariantComplete(variantMatch, variantStatus) {
  return variantMatch === true || variantStatus === 'NOT_REQUIRED';
}
function isReady(p) {
  return p.status === 'READY' && p.categoryMatch === true && p.brandMatch === true && p.templateMatch === true && isVariantComplete(p.variantMatch, p.variantStatus);
}

(async () => {
  // 1) SAYIM + DENKLEM
  const [total, notRequired, waiting, manual, completed] = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: XS } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantStatus: 'NOT_REQUIRED' } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantStatus: 'WAITING_AI' } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantStatus: 'MANUAL_REVIEW' } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantStatus: 'COMPLETED' } }),
  ]);
  const realVariantProducts = waiting + manual + completed;
  const noVariants = notRequired;
  const analysisFailed = total - realVariantProducts - noVariants;
  console.log('=== SAYIM (AKILLIBAYI1) ===');
  console.log(`TOTAL=${total} REAL_VARIANT_PRODUCTS=${realVariantProducts} NO_VARIANTS=${noVariants} ANALYSIS_FAILED=${analysisFailed}`);
  console.log(`WAITING_AI=${waiting} MANUAL_REVIEW=${manual} COMPLETED=${completed}`);
  console.log(`DENKLEM: ${realVariantProducts} + ${noVariants} + ${analysisFailed} = ${total} -> ${realVariantProducts + noVariants + analysisFailed === total ? 'TUTARLI' : 'TUTARSIZ!'}`);

  // 2) TEST A — Category PASS, Brand PASS, Variant NO_VARIANTS, Listing PASS => READY TRUE
  const a = await prisma.product.findFirst({
    where: { xmlSourceId: XS, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantStatus: 'NOT_REQUIRED', variantMatch: false },
    select: { id: true, title: true, status: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true },
  });
  console.log('\nTEST A (tümü PASS + NO_VARIANTS):');
  console.log('  ürün=' + a.title);
  console.log('  isReady=' + isReady(a) + ' (beklenen: true)');

  // 3) TEST B — Category FAIL, Brand PASS, Variant NO_VARIANTS, Listing PASS => READY FALSE
  const b = await prisma.product.findFirst({
    where: { xmlSourceId: XS, status: 'READY', categoryMatch: false, brandMatch: true, templateMatch: true, variantStatus: 'NOT_REQUIRED' },
    select: { id: true, title: true, status: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true },
  });
  console.log('\nTEST B (Category FAIL, diğerleri PASS):');
  if (b) {
    console.log('  ürün=' + b.title);
    console.log('  isReady=' + isReady(b) + ' (beklenen: false)');
  } else {
    // categoryMatch=false olup status READY olan yoksa: categoryId null olanla göster
    const b2 = await prisma.product.findFirst({
      where: { xmlSourceId: XS, categoryMatch: false },
      select: { id: true, title: true, status: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true },
    });
    console.log('  (status READY + categoryMatch false bulunamadı; categoryMatch=false ilk örnek):');
    console.log('  ürün=' + b2.title + ' status=' + b2.status);
    console.log('  isReady=' + isReady(b2) + ' (beklenen: false)');
  }

  // 4) TEST C — Variant MANUAL_REVIEW => Variant gate PASS OLAMAZ (gerçek veride MANUAL_REVIEW=0)
  console.log('\nTEST C (Variant MANUAL_REVIEW):');
  console.log('  AKILLIBAYI1 MANUAL_REVIEW ürün sayısı=' + manual);
  console.log('  isVariantComplete(false, "MANUAL_REVIEW")=' + isVariantComplete(false, 'MANUAL_REVIEW') + ' (beklenen: false)');
  console.log('  isVariantComplete(false, "WAITING_AI")=' + isVariantComplete(false, 'WAITING_AI') + ' (beklenen: false)');
  console.log('  isVariantComplete(false, "ANALYSIS_FAILED")=' + isVariantComplete(false, 'ANALYSIS_FAILED') + ' (beklenen: false)');
  console.log('  isVariantComplete(false, "NOT_REQUIRED")=' + isVariantComplete(false, 'NOT_REQUIRED') + ' (beklenen: true)');
  console.log('  isVariantComplete(true,  "COMPLETED")=' + isVariantComplete(true, 'COMPLETED') + ' (beklenen: true)');

  // 5) TEST D — Category PASS, Brand PASS, Variant PASS(NO_VARIANTS), Listing FAIL => READY FALSE
  const d = await prisma.product.findFirst({
    where: { xmlSourceId: XS, title: { contains: 'Apple Airpods 3 (3.nesil) Spor Delikli Kilif - Siyah-Beyaz' } },
    select: { id: true, title: true, status: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true },
  });
  console.log('\nTEST D (Listing FAIL, hedef Airpods):');
  console.log('  ürün=' + d.title);
  console.log('  status=' + d.status + ' categoryMatch=' + d.categoryMatch + ' brandMatch=' + d.brandMatch + ' templateMatch=' + d.templateMatch + ' variantStatus=' + d.variantStatus);
  console.log('  isReady=' + isReady(d) + ' (beklenen: false)');

  // 6) ÖRNEK B — teknik ölçülü ürün (45 Cm / 137 Cm / 65W) => NO_VARIANTS
  console.log('\nÖRNEK B (teknik ölçü):');
  for (const pat of ['45 Cm', '137 Cm', '65W']) {
    const ex = await prisma.product.findFirst({ where: { xmlSourceId: XS, title: { contains: pat } }, select: { title: true, variantStatus: true, variantMatch: true } });
    console.log(`  "${pat}" -> ${ex ? ex.variantStatus + ' / variantMatch=' + ex.variantMatch + ' | ' + ex.title : 'BULUNAMADI'}`);
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
