// RED TEAM — 4/4 READINESS GATE + NO_VARIANTS zinciri (DB okuma).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

(async () => {
  // 1) VARYANT AİLESİ AYRIMI (gerçek XML yapısı parent/group olmadan → variantStatus ile özet)
  console.log('=== VARYANT AİLESİ AYRIMI (AKILLIBAYI1) ===');
  const vsRows = await prisma.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: XS }, _count: { _all: true } });
  let notRequired = 0, waiting = 0, manual = 0, completed = 0, other = 0;
  for (const r of vsRows) {
    const v = r.variantStatus || '(null)';
    if (v === 'NOT_REQUIRED') notRequired = r._count._all;
    else if (v === 'WAITING_AI') waiting = r._count._all;
    else if (v === 'MANUAL_REVIEW') manual = r._count._all;
    else if (v === 'COMPLETED') completed = r._count._all;
    else { other += r._count._all; console.log('  BEKLENMEYEN variantStatus:', v, r._count._all); }
    console.log(`  ${v} = ${r._count._all}`);
  }
  console.log(`\n  VARYANT AİLESİ VAR (gerçek group)     = ${completed + waiting + manual} (COMPLETED/WAITING_AI/MANUAL_REVIEW)`);
  console.log(`  VARYANT AİLESİ YOK (NO_VARIANTS)      = ${notRequired}`);
  console.log(`  ANALİZ EDİLEMEDİ (beklenmeyen durum)  = ${other}`);
  const variantRows = await prisma.variant.count({ where: { product: { xmlSourceId: XS } } });
  console.log(`  toplam variant kaydı (AKILLIBAYI1)    = ${variantRows}`);

  // 2) 4/4 READINESS GATE SAYIMI
  console.log('\n=== 4/4 READINESS GATE (AKILLIBAYI1) ===');
  const [total, statusReady, catTrue, catFalse, brandTrue, brandFalse, tmplTrue, tmplFalse, varTrue, varFalse] = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: XS } }),
    prisma.product.count({ where: { xmlSourceId: XS, status: 'READY' } }),
    prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: XS, brandMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: XS, brandMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: XS, templateMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: XS, templateMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: XS, variantMatch: false } }),
  ]);
  console.log(`  total=${total} statusREADY=${statusReady}`);
  console.log(`  categoryMatch true=${catTrue} false=${catFalse}`);
  console.log(`  brandMatch    true=${brandTrue} false=${brandFalse}`);
  console.log(`  templateMatch true=${tmplTrue} false=${tmplFalse}`);
  console.log(`  variantMatch  true=${varTrue} false=${varFalse}`);

  // READY_FILTER eşdeğeri
  const readyFilterCount = await prisma.product.count({
    where: {
      xmlSourceId: XS,
      status: 'READY',
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }],
    },
  });
  console.log(`  READY_FILTER uyumu = ${readyFilterCount}`);

  // NO_VARIANTS (NOT_REQUIRED) + diğer 3 gate tamam olanlar (variant adımı PASS mi?)
  const noVariantsReady = await prisma.product.count({
    where: {
      xmlSourceId: XS,
      status: 'READY',
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantStatus: 'NOT_REQUIRED',
      variantMatch: false,
    },
  });
  console.log(`  NO_VARIANTS + 4/4 tamam (isReady=true) = ${noVariantsReady}`);

  // Kategori tutarsızlığı
  const catIdDoluMatchFalse = await prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: false, categoryId: { not: null } } });
  const catIdNullMatchTrue = await prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: true, categoryId: null } });
  console.log(`\n  TUTARSIZLIK: categoryMatch=false & categoryId dolu = ${catIdDoluMatchFalse}`);
  console.log(`  TUTARSIZLIK: categoryMatch=true & categoryId null = ${catIdNullMatchTrue}`);

  // 3) HEDEF ÜRÜN (Airpods 3 Spor Delikli Kilif Siyah-Beyaz) zinciri
  console.log('\n=== HEDEF ÜRÜN (NO_VARIANTS) ===');
  const hedef = await prisma.product.findFirst({
    where: { xmlSourceId: XS, title: { contains: 'Apple Airpods 3 (3.nesil) Spor Delikli Kilif - Siyah-Beyaz' } },
    select: { id: true, title: true, status: true, categoryMatch: true, categoryId: true, brandMatch: true, brandId: true, templateMatch: true, variantMatch: true, variantStatus: true },
  });
  console.log('  id=' + hedef.id);
  console.log('  status=' + hedef.status + ' categoryMatch=' + hedef.categoryMatch + ' brandMatch=' + hedef.brandMatch + ' templateMatch=' + hedef.templateMatch + ' variantMatch=' + hedef.variantMatch + ' variantStatus=' + hedef.variantStatus);
  const isVariantComplete = hedef.variantMatch === true || hedef.variantStatus === 'NOT_REQUIRED';
  const isReady = hedef.status === 'READY' && hedef.categoryMatch && hedef.brandMatch && hedef.templateMatch && isVariantComplete;
  console.log('  isVariantComplete=' + isVariantComplete + ' isReady=' + isReady);

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
