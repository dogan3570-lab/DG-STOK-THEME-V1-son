// GEÇİCİ DENETİM — yalnızca okuma.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Hedef ürün
  const target = await prisma.product.findMany({
    where: { OR: [{ sku: { contains: '053937' } }, { title: { contains: 'Vantilator' } }, { title: { contains: 'Ayakli' } }] },
    select: { id: true, title: true, xmlKey: true, sku: true, barcode: true, supplierCategory: true, categoryId: true, categoryMatch: true, variantMatch: true, variantStatus: true, matchedBy: true, variants: { select: { name: true, value: true } } },
  });
  console.log('TARGET', JSON.stringify(target.slice(0, 12), null, 2));

  // Beden değer dağılımı (sahte tespit için)
  const bedenVals = await prisma.variant.groupBy({ by: ['value'], where: { name: 'Beden' }, _count: { value: true }, orderBy: { _count: { value: 'desc' } } });
  console.log('BEDEN_VALUES', JSON.stringify(bedenVals));

  // Numara değer dağılımı
  const numVals = await prisma.variant.groupBy({ by: ['value'], where: { name: 'Numara' }, _count: { value: true }, orderBy: { _count: { value: 'desc' } } });
  console.log('NUMARA_VALUES', JSON.stringify(numVals));

  // Sahte tek harfli bedenli ürün sayısı
  const fakeBeden = await prisma.variant.count({ where: { name: 'Beden', value: { in: ['S', 'M', 'L'] } } });
  const fakeYukseklik = await prisma.variant.count({ where: { name: 'Yükseklik' } });
  const cop = await prisma.variant.count({ where: { OR: [{ name: { startsWith: 'HBT-' } }, { name: { startsWith: 'DGLIVE-' } }, { name: { startsWith: 'DGTEST' } }] } });
  console.log('FAKE_COUNTS', JSON.stringify({ fakeBedenSMl: fakeBeden, yukseklik: fakeYukseklik, cop: cop }));

  // Gerçek varyant sinyali (Beden: XS/XL vs) — gerçek etiketli bedenler
  const realBedenMulti = await prisma.variant.count({ where: { name: 'Beden', value: { in: ['XS', 'XL', 'XXL', '2XL', '3XL'] } } });
  console.log('REAL_BEDEN_MULTI', realBedenMulti);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
