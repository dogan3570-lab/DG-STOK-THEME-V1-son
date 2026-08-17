// GEÇİCİ — kategori eşlenmiş MANUAL_REVIEW ürünü bul (yalnızca okuma).
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
  const mappings = await p.categoryMapping.findMany({ where: { marketplaceId: mpId, active: true }, select: { categoryId: true, externalId: true } });
  const mappedCatIds = mappings.filter((m) => /^\d+$/.test(String(m.externalId || ''))).map((m) => m.categoryId);
  console.log('MAPPED_CAT_COUNT', mappedCatIds.length);
  const products = await p.product.findMany({
    where: { xmlSourceId: xsId, variantStatus: 'MANUAL_REVIEW', categoryId: { in: mappedCatIds } },
    select: { id: true, title: true, categoryId: true, sku: true, variants: { select: { name: true, value: true } } },
    take: 5,
  });
  console.log('MAPPED_MANUAL_PRODUCTS', JSON.stringify(products, null, 2));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
