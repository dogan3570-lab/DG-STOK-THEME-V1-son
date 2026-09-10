// GEÇİCİ V2 TEMİZLİK — kontrollü veri düzeltmesi (reset/seed/migration DEĞİL).
// Kanıt: AKILLIBAYI1 XML'inde parent/variant/option/color/beden alanı YOK (tag sayısı 0).
// Bu nedenle başlıktan üretilmiş TÜM varyant kayıtları sahtedir; silinir ve ürünler NOT_REQUIRED yapılır.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();

(async () => {
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';

  const before = await p.variant.count({ where: { product: { xmlSourceId: xsId } } });
  console.log('VARIANT_BEFORE', before);

  const deleted = await p.variant.deleteMany({ where: { product: { xmlSourceId: xsId } } });
  console.log('VARIANT_DELETED', deleted.count);

  // Tüm ürünler: gerçek varyant yapısı yok → NOT_REQUIRED
  const upd = await p.product.updateMany({
    where: { xmlSourceId: xsId },
    data: { variantMatch: false, variantStatus: 'NOT_REQUIRED', matchedBy: null },
  });
  console.log('PRODUCT_UPDATED_NOT_REQUIRED', upd.count);

  // Varyant analiz kayıtlarını temizle (sahte MANUAL_REVIEW/WAITING_AI analizi kalmasın)
  const vaDel = await p.variantAnalysis.deleteMany({ where: { product: { xmlSourceId: xsId } } });
  console.log('VARIANT_ANALYSIS_DELETED', vaDel.count);

  const after = await p.variant.count({ where: { product: { xmlSourceId: xsId } } });
  const statusDist = await p.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: xsId }, _count: { id: true } });
  console.log('VARIANT_AFTER', after);
  console.log('STATUS_DIST', JSON.stringify(statusDist));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
