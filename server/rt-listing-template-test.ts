import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { resolveListingTemplate, hasListingTemplate } from './src/services/listingTemplateResolver.ts';

/**
 * LISTING TEMPLATE RESOLVER testi — Product > Category > General > NO_TEMPLATE
 * + marketplace context izolasyonu. Sentetik kayıtlar cleanup ile silinir.
 */
const TS = Date.now();
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const mp = await prisma.marketplace.create({ data: { key: `rt-ltr-${TS}`, name: 'RT-LTR', active: true, apiStatus: 'unknown' } });
  const otherMp = await prisma.marketplace.create({ data: { key: `rt-ltr-other-${TS}`, name: 'RT-LTR-OTHER', active: true, apiStatus: 'unknown' } });
  const cat = await prisma.category.create({ data: { name: `RT-LTR-CAT-${TS}` } });
  const prod = await prisma.product.create({
    data: {
      xmlKey: `rt-ltr-prod-${TS}`,
      title: 'RT LTR Ürün',
      status: 'XML',
      categoryId: cat.id,
    },
  });

  const tProduct = await prisma.listingTemplate.create({ data: { name: 'A-PRODUCT', marketplaceId: mp.id, productId: prod.id, active: true } });
  const tCategory = await prisma.listingTemplate.create({ data: { name: 'B-CATEGORY', marketplaceId: mp.id, categoryId: cat.id, active: true } });
  const tGeneral = await prisma.listingTemplate.create({ data: { name: 'C-GENERAL', marketplaceId: mp.id, active: true } });
  // Yanlış marketplace genel şablonu (context izolasyon)
  const tWrongMp = await prisma.listingTemplate.create({ data: { name: 'WRONG-MP', marketplaceId: otherMp.id, active: true } });

  // 1: üçü de var → PRODUCT
  let r = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
  check('Product>Category>General: üçü varken PRODUCT', r.source === 'PRODUCT' && r.id === tProduct.id, r.source);

  // 2: product şablonu sil → CATEGORY
  await prisma.listingTemplate.delete({ where: { id: tProduct.id } });
  r = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
  check('Product yoksa CATEGORY', r.source === 'CATEGORY' && r.id === tCategory.id, r.source);

  // 3: category şablonu sil → GENERAL
  await prisma.listingTemplate.delete({ where: { id: tCategory.id } });
  r = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
  check('Product+Category yoksa GENERAL', r.source === 'GENERAL' && r.id === tGeneral.id, r.source);

  // 4: hepsi sil → NO_TEMPLATE
  await prisma.listingTemplate.delete({ where: { id: tGeneral.id } });
  r = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
  check('Hiçbiri yoksa NO_TEMPLATE', r.source === 'NO_TEMPLATE' && r.id === null, r.source);
  check('hasListingTemplate=false (NO_TEMPLATE)', hasListingTemplate(r) === false);

  // 5: context izolasyon — yanlış marketplace şablonu kullanılmaz
  r = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
  check('Yanlış marketplace şablonu SIZMAZ (NO_TEMPLATE)', r.source === 'NO_TEMPLATE', r.source);
  const rOther = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: otherMp.id });
  check('Doğru marketplace şablonu (WRONG-MP general) diğer MP için GENERAL', rOther.source === 'GENERAL' && rOther.id === tWrongMp.id, rOther.source);

  // 6: boş marketplaceId → NO_TEMPLATE
  const rEmpty = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: '' });
  check('Boş marketplaceId → NO_TEMPLATE', rEmpty.source === 'NO_TEMPLATE');

  // cleanup
  await prisma.listingTemplate.deleteMany({ where: { marketplaceId: { in: [mp.id, otherMp.id] } } });
  await prisma.product.delete({ where: { id: prod.id } });
  await prisma.category.delete({ where: { id: cat.id } });
  await prisma.marketplace.deleteMany({ where: { id: { in: [mp.id, otherMp.id] } } });
  const leftover = await prisma.listingTemplate.count({ where: { marketplaceId: { in: [mp.id, otherMp.id] } } });
  check('cleanup: sentetik kayıtlar temizlendi', leftover === 0);

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect();
  process.exit(2);
});
