// RED TEAM FALSE-POSITIVE TARAMA — başlıktaki renk/beden/numara/ölçü/teknik değerler ASLA varyant değildir.
// KAPSAM: AKILLIBAYI1 (seçili XML). Yalnızca OKUMA.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XML_SOURCE_ID = '949855eb-d68c-4920-b378-c622a6a665e2';

(async () => {
  const patterns = [
    'Siyah', 'Beyaz', 'Siyah-Beyaz', 'Kırmızı', 'Mavi', 'Beden', 'Numara',
    ' Cm', 'CM', 'mm', 'W', 'V', 'ml', 'GB', 'TB', '45 Cm', '65W', '128 GB', '500 ml', '1.5 L', 'L',
  ];
  console.log('PATTERN | eslesen | NOT_REQUIRED | DIGER | variantsToplam');
  let fail = false;
  for (const pat of patterns) {
    const where = { title: { contains: pat }, xmlSourceId: XML_SOURCE_ID };
    const [total, notReq, other, variants] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, variantStatus: 'NOT_REQUIRED' } }),
      prisma.product.count({ where: { ...where, variantStatus: { not: 'NOT_REQUIRED' } } }),
      prisma.variant.count({ where: { product: { title: { contains: pat }, xmlSourceId: XML_SOURCE_ID } } }),
    ]);
    const okRow = other === 0 && variants === 0;
    if (!okRow) fail = true;
    console.log(`${pat} | ${total} | ${notReq} | ${other} | ${variants} ${okRow ? 'OK' : '<<< FALSE-POSITIVE!'}`);
  }

  // Hedef ürün kesin kanıt
  const hedef = await prisma.product.findFirst({ where: { title: { contains: 'Apple Airpods 3 (3.nesil) Spor Delikli Kilif - Siyah-Beyaz' }, xmlSourceId: XML_SOURCE_ID } });
  console.log('\nHEDEF:', hedef ? `${hedef.variantStatus} / variantMatch=${hedef.variantMatch} / variants=${await prisma.variant.count({ where: { productId: hedef.id } })}` : 'BULUNAMADI');

  // Gerçek varyant adayı var mı (parent/group tabanlı)
  const aday = await prisma.product.count({ where: { variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] } } });
  console.log('\nGERÇEK VARYANT ADAYI (WAITING_AI/MANUAL_REVIEW):', aday, '(0 = XMLde parent/group/variant yapisi YOK)');

  await prisma.$disconnect();
  console.log(fail ? '\nFALSE-POSITIVE BULUNDU' : '\nFALSE-POSITIVE YOK: hepsi NOT_REQUIRED');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
