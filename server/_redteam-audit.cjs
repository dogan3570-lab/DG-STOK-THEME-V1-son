// GEÇİCİ RED-TEAM DENETİMİ — yalnızca okuma.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();

(async () => {
  // XML kaynakları
  const xs = await p.xmlSource.findMany({ select: { id: true, name: true, url: true } });
  console.log('XML_SOURCES', JSON.stringify(xs));

  // Hedef ürün
  const target = await p.product.findMany({
    where: { title: { contains: 'Airpods 3' } },
    select: { id: true, title: true, sku: true, barcode: true, xmlKey: true, variantStatus: true, variantMatch: true, matchedBy: true, variants: { select: { name: true, value: true } } },
    take: 10,
  });
  console.log('TARGET_AIRPODS', JSON.stringify(target, null, 2));

  // Aynı SKU altında birden fazla ürün var mı? (gerçek varyant yapısı testi)
  const dupSku = await p.product.groupBy({ by: ['sku'], where: { sku: { not: null } }, _count: { id: true }, having: { id: { _count: { gt: 1 } } }, orderBy: { _count: { id: 'desc' } }, take: 20 });
  console.log('DUP_SKU', JSON.stringify(dupSku));

  // Aynı barcode altında birden fazla ürün var mı?
  const dupBarcode = await p.product.groupBy({ by: ['barcode'], where: { barcode: { not: null } }, _count: { id: true }, having: { id: { _count: { gt: 1 } } }, orderBy: { _count: { id: 'desc' } }, take: 20 });
  console.log('DUP_BARCODE', JSON.stringify(dupBarcode));

  // Aynı başlık altında birden fazla ürün var mı?
  const dupTitle = await p.product.groupBy({ by: ['title'], where: { title: { not: null } }, _count: { id: true }, having: { id: { _count: { gt: 1 } } }, orderBy: { _count: { id: 'desc' } }, take: 20 });
  console.log('DUP_TITLE', JSON.stringify(dupTitle));

  // Varyant kaydı olan ürün sayısı (Renk/Kapasite kalan)
  const vNames = await p.variant.groupBy({ by: ['name'], _count: { name: true } });
  console.log('VARIANT_NAMES', JSON.stringify(vNames));

  // Siyah-Beyaz içeren ürünlerde varyant durumu
  const sb = await p.product.findMany({
    where: { title: { contains: 'Siyah-Beyaz' } },
    select: { id: true, title: true, variantStatus: true, variantMatch: true, variants: { select: { name: true, value: true } } },
    take: 15,
  });
  console.log('SIYAH_BEYAZ_PRODUCTS', JSON.stringify(sb, null, 2));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
