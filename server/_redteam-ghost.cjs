// RED TEAM — xmlSourceId=null (HAYALET) ürünleri ve COMPLETED varyant kayıtlarını incele.
// Yalnızca OKUMA.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const ghosts = await prisma.product.findMany({
    where: { xmlSourceId: null },
    select: { id: true, title: true, xmlKey: true, variantStatus: true, variantMatch: true, categoryId: true, categoryMatch: true },
  });
  console.log('HAYALET (xmlSourceId=null) ürün sayısı:', ghosts.length);
  for (const g of ghosts) {
    const vars = await prisma.variant.findMany({ where: { productId: g.id }, select: { name: true, value: true } });
    console.log(`\n[${g.variantStatus}|vm=${g.variantMatch}|cat=${g.categoryId ? 'dolu' : 'null'}|cm=${g.categoryMatch}] ${g.title}`);
    console.log('   variants=', JSON.stringify(vars));
  }

  const completed = await prisma.product.findMany({
    where: { variantStatus: 'COMPLETED' },
    select: { id: true, title: true, xmlSourceId: true, variantMatch: true, matchedBy: true },
  });
  console.log('\nCOMPLETED ürün sayısı:', completed.length);
  for (const c of completed) {
    const vars = await prisma.variant.findMany({ where: { productId: c.id }, select: { name: true, value: true } });
    console.log(`\n[src=${c.xmlSourceId}|matchedBy=${c.matchedBy}] ${c.title}`);
    console.log('   variants=', JSON.stringify(vars));
  }
  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
