// GEÇİCİ FALSE-POSITIVE TEMİZLİĞİ — kontrollü veri düzeltmesi (reset/seed/migration DEĞİL).
// Kanıt: AKILLIBAYI1 XML'inde gerçek Beden/Numara etiketi yok; "Beden:S/M/L/XS" başlık harflerinden,
// "Numara" çıplak sayılardan (32-50) üretilmiş sahte kayıtlardır. "Yükseklik" fiziksel ölçüdür.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

const REAL_VARIANT_NAMES = new Set(['Renk', 'Kapasite', 'Hacim', 'Cinsiyet', 'Materyal', 'Model']);

(async () => {
  // Etkilenecek ürünleri silmeden önce topla
  const affectedBefore = await prisma.variant.findMany({
    where: { OR: [
      { name: 'Beden', value: { in: ['S', 'M', 'L', 'XS'] } },
      { name: 'Numara' },
      { name: 'Yükseklik' },
      { name: { startsWith: 'HBT-' } },
      { name: { startsWith: 'DGLIVE-' } },
      { name: { startsWith: 'DGTEST' } },
    ] },
    select: { productId: true },
    distinct: ['productId'],
  });
  const affectedIds = affectedBefore.map((a) => a.productId);

  // Sahte varyantları sil
  const deleted = await prisma.variant.deleteMany({
    where: { OR: [
      { name: 'Beden', value: { in: ['S', 'M', 'L', 'XS'] } },
      { name: 'Numara' },
      { name: 'Yükseklik' },
      { name: { startsWith: 'HBT-' } },
      { name: { startsWith: 'DGLIVE-' } },
      { name: { startsWith: 'DGTEST' } },
    ] },
  });

  // Silmeden etkilenen ürünlerde kalan gerçek varyant var mı?
  let fixedNotRequired = 0;
  let fixedMatchFalse = 0;
  for (const pid of affectedIds) {
    const remaining = await prisma.variant.findMany({ where: { productId: pid }, select: { name: true } });
    const hasReal = remaining.some((v) => REAL_VARIANT_NAMES.has(v.name));
    if (!hasReal) {
      // XML'de gerçek varyant yok → NOT_REQUIRED (kullanıcıya manuel iş çıkmaz)
      const r = await prisma.product.updateMany({
        where: { id: pid, variantStatus: { not: 'NOT_REQUIRED' } },
        data: { variantMatch: false, variantStatus: 'NOT_REQUIRED', matchedBy: null },
      });
      fixedNotRequired += r.count;
    } else {
      // Gerçek varyant (Renk/Kapasite vs.) kaldıysa variantMatch'i gerçek duruma çek
      const r = await prisma.product.updateMany({ where: { id: pid }, data: { variantMatch: false } });
      fixedMatchFalse += r.count;
    }
  }

  console.log('FIX_RESULT', JSON.stringify({
    deletedVariants: deleted.count,
    affectedProducts: affectedIds.length,
    fixedNotRequired,
    fixedMatchFalse,
  }));

  // Son durum istatistiği
  const [bedenLeft, numaraLeft, yukseklikLeft, copLeft] = await Promise.all([
    prisma.variant.count({ where: { name: 'Beden' } }),
    prisma.variant.count({ where: { name: 'Numara' } }),
    prisma.variant.count({ where: { name: 'Yükseklik' } }),
    prisma.variant.count({ where: { OR: [{ name: { startsWith: 'HBT-' } }, { name: { startsWith: 'DGLIVE-' } }, { name: { startsWith: 'DGTEST' } }] } }),
  ]);
  console.log('AFTER_COUNTS', JSON.stringify({ bedenLeft, numaraLeft, yukseklikLeft, copLeft }));

  const vNames = await prisma.variant.groupBy({ by: ['name'], _count: { name: true }, orderBy: { _count: { name: 'desc' } } });
  console.log('AFTER_VARIANT_NAMES', JSON.stringify(vNames));

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
