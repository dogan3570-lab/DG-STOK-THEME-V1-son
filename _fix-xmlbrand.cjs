const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Step 1: Fix AKILLIBAYI1 products → xmlBrandName = "akilli bayi"
  console.log('=== FIXING AKILLIBAYI1 PRODUCTS ===');
  const akilliSource = await prisma.xmlSource.findFirst({ where: { name: 'AKILLIBAYI1' } });
  if (akilliSource) {
    const r1 = await prisma.product.updateMany({
      where: { xmlSourceId: akilliSource.id },
      data: { xmlBrandName: 'akilli bayi' }
    });
    console.log('Updated ' + r1.count + ' AKILLIBAYI1 products: xmlBrandName → "akilli bayi"');
  }
  
  // Step 2: Check RT_TEST_XML_UPD products
  const rtSource = await prisma.xmlSource.findFirst({ where: { name: 'RT_TEST_XML_UPD' } });
  if (rtSource) {
    const rtProducts = await prisma.product.findMany({
      where: { xmlSourceId: rtSource.id },
      select: { id: true, xmlBrandName: true, brandId: true },
      take: 5
    });
    console.log('\n=== RT_TEST_XML_UPD PRODUCTS ===');
    for (const p of rtProducts) {
      console.log('  xmlBrandName=' + p.xmlBrandName + ' brandId=' + p.brandId);
    }
  }
  
  // Step 3: Check products with no source (19 test products)
  const noSource = await prisma.product.findMany({
    where: { xmlSourceId: null },
    select: { id: true, xmlBrandName: true, brandId: true, title: true },
    take: 5
  });
  console.log('\n=== PRODUCTS WITH NO XML SOURCE ===');
  for (const p of noSource) {
    console.log('  title=' + p.title.substring(0, 40) + ' xmlBrandName=' + p.xmlBrandName + ' brandId=' + p.brandId);
  }
  
  // Step 4: Verify final state
  const finalDistinct = await prisma.product.groupBy({
    by: ['xmlBrandName'],
    _count: { id: true }
  });
  console.log('\n=== FINAL xmlBrandName VALUES ===');
  for (const d of finalDistinct) {
    console.log('  ' + JSON.stringify(d.xmlBrandName) + ': ' + d._count.id + ' products');
  }
  
  await prisma.$disconnect();
  console.log('\nDONE');
})();
