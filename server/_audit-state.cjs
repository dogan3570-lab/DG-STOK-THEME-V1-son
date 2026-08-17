// GEÇİCİ DB DENETİM SCRIPTİ — yalnızca okuma yapar (reset/seed/migration YOK).
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
  const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

  const [xmlSources, marketplaces] = await Promise.all([
    prisma.xmlSource.findMany({ select: { id: true, name: true } }),
    prisma.marketplace.findMany({ select: { id: true, name: true, key: true } }),
  ]);
  console.log('XML_SOURCES', JSON.stringify(xmlSources));
  console.log('MARKETPLACES', JSON.stringify(marketplaces));

  // Product Pool sayaçları (products/stats ile aynı formül)
  const pool = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: xsId } }),
    prisma.product.count({ where: { xmlSourceId: xsId, categoryId: null } }),
    prisma.product.count({ where: { categoryId: null } }),
    prisma.product.count({ where: { xmlSourceId: xsId, categoryId: { not: null } } }),
  ]);
  console.log('POOL', JSON.stringify({
    xmlTotal: pool[0],
    xmlCategoryIdNull: pool[1],
    globalCategoryIdNull: pool[2],
    xmlCategoryIdNotNull: pool[3],
  }));

  // Category Mapping ekranının kullandığı /categories/products kapsamı (xmlSourceId yalnız)
  const catProducts = await prisma.product.findMany({
    where: { xmlSourceId: xsId },
    select: { id: true, title: true, supplierCategory: true, categoryId: true, categoryMatch: true, aiSuggestedCategoryId: true },
  });
  const bySuppCat = {};
  for (const p of catProducts) {
    const k = (p.supplierCategory || 'Kategorisiz').trim();
    (bySuppCat[k] = bySuppCat[k] || []).push(p);
  }
  const groups = Object.entries(bySuppCat).map(([k, arr]) => {
    const matched = arr.filter((p) => p.categoryMatch && p.categoryId);
    return { xmlPath: k, total: arr.length, matched: matched.length };
  });
  const catManualGroups = groups.filter((g) => g.matched < g.total).length;
  console.log('CATEGORY_MAPPING', JSON.stringify({
    totalProducts: catProducts.length,
    groupCount: groups.length,
    manualGroups: catManualGroups,
    matchedGroups: groups.length - catManualGroups,
    groups: groups.slice(0, 40),
  }));

  // categoryMatch ile categoryId tutarsızlıkları
  const matchIdDiff = catProducts.filter((p) => (p.categoryId != null) !== p.categoryMatch).length;
  console.log('CATEGORY_MATCH_vs_CATEGORYID_DIFF', matchIdDiff);

  // Varyant ekranı sayaçları (variants/dashboard ile aynı formül)
  const vDash = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: xsId } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantStatus: 'NOT_REQUIRED' } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantStatus: 'WAITING_AI', variantMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantStatus: 'MANUAL_REVIEW' } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantStatus: 'COMPLETED' } }),
    prisma.product.count({ where: { xmlSourceId: xsId, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } }),
  ]);
  console.log('VARIANT_DASHBOARD', JSON.stringify({
    totalProducts: vDash[0],
    notRequired: vDash[1],
    autoMatched: vDash[2],
    waitingAi: vDash[3],
    manualReview: vDash[4],
    completed: vDash[5],
    variantMatchFalse_notRequiredExcluded: vDash[6],
  }));

  // variantStatus dağılımı
  const vStatus = await prisma.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: xsId }, _count: { id: true } });
  console.log('VARIANT_STATUS_DIST', JSON.stringify(vStatus));

  // HEDEF ÜRÜN: HOBİBAHÇEM vantilatör
  const targets = await prisma.product.findMany({
    where: { title: { contains: 'HOBİBAHÇEM' } },
    select: { id: true, title: true, xmlKey: true, sku: true, barcode: true, xmlBrandName: true, supplierCategory: true, categoryId: true, categoryMatch: true, variantMatch: true, variantStatus: true, matchedBy: true, variants: { select: { name: true, value: true } } },
  });
  console.log('TARGET_PRODUCTS', JSON.stringify(targets.slice(0, 10), null, 2));

  // Tüm varyant isimleri (çöp alan tespiti için)
  const vNames = await prisma.variant.groupBy({ by: ['name'], _count: { name: true }, orderBy: { _count: { name: 'desc' } } });
  console.log('ALL_VARIANT_NAMES', JSON.stringify(vNames));

  // Varyantı olan ürünlerden örnek
  const withV = await prisma.variant.findMany({ where: { product: { xmlSourceId: xsId } }, select: { name: true, value: true, product: { select: { id: true, title: true } } }, take: 30 });
  console.log('SAMPLE_VARIANTS', JSON.stringify(withV, null, 2));

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
