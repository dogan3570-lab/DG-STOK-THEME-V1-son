// GEÇİCİ — varyant attribute'u olan Trendyol kategorisini bul (yalnızca okuma + gerçek catalog).
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
  const mappings = await p.categoryMapping.findMany({ where: { marketplaceId: mpId, active: true }, select: { categoryId: true, externalId: true, category: { select: { name: true } } } });
  const numeric = mappings.filter((m) => /^\d+$/.test(String(m.externalId || '')));
  console.log('NUMERIC_MAPPINGS', JSON.stringify(numeric.map((m) => ({ externalId: m.externalId, name: m.category && m.category.name, categoryId: m.categoryId }))));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
