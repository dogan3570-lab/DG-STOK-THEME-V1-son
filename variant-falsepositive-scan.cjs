const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();

const XML_SOURCE = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1
const REAL = new Set(['Renk', 'Beden', 'Numara', 'Kapasite', 'Hacim', 'Cinsiyet', 'Materyal', 'Model']);

(async () => {
  const total = await p.product.count({ where: { xmlSourceId: XML_SOURCE } });

  // Varyant tablosundaki isim dağılımı
  const variants = await p.variant.findMany({
    where: { product: { xmlSourceId: XML_SOURCE } },
    select: { name: true, value: true, productId: true },
  });
  const nameDist = {};
  for (const v of variants) nameDist[v.name] = (nameDist[v.name] || 0) + 1;
  console.log('TOTAL XML ÜRÜN:', total);
  console.log('VARIANT ROW TOPLAM:', variants.length);
  console.log('VARIANT NAME DAĞILIMI:', JSON.stringify(nameDist, null, 0));

  const junkNames = Object.keys(nameDist).filter(n => !REAL.has(n));
  const junkRowCount = junkNames.reduce((s, n) => s + nameDist[n], 0);
  console.log('JUNK VARIANT ROW (AKYI vs):', junkRowCount, '->', JSON.stringify(junkNames));

  const prodsWithJunk = new Set(variants.filter(v => !REAL.has(v.name)).map(v => v.productId)).size;
  console.log('JUNK VARYANTLI ÜRÜN SAYISI:', prodsWithJunk);

  const prodsWithNumara = new Set(variants.filter(v => v.name === 'Numara').map(v => v.productId)).size;
  console.log('NUMARA VARYANTLI ÜRÜN SAYISI:', prodsWithNumara);

  const prodsWithBedenS = new Set(variants.filter(v => v.name === 'Beden' && v.value === 'S').map(v => v.productId)).size;
  console.log('BEDEN=S VARYANTLI ÜRÜN SAYISI:', prodsWithBedenS);

  const statusDist = await p.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: XML_SOURCE }, _count: { variantStatus: true } });
  console.log('VARIANT STATUS DAĞILIMI:', JSON.stringify(statusDist, null, 0));

  const matchedCount = await p.product.count({ where: { xmlSourceId: XML_SOURCE, variantMatch: true } });
  console.log('variantMatch=true:', matchedCount);

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
