const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const products = await prisma.product.findMany({
    take: 10,
    select: {
      id: true,
      title: true,
      originalTitle: true,
      xmlBrandName: true,
      brandId: true,
      brandMatch: true,
      brand: { select: { name: true } },
      xmlSource: { select: { name: true } }
    }
  });
  console.log('=== SAMPLE PRODUCTS ===');
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log((i+1) + '. Title: ' + p.title);
    console.log('   OriginalTitle: ' + p.originalTitle);
    console.log('   xmlBrandName: ' + p.xmlBrandName);
    console.log('   brandId: ' + p.brandId);
    console.log('   brand.name: ' + (p.brand?.name || 'null'));
    console.log('   brandMatch: ' + p.brandMatch);
    console.log('   xmlSource: ' + (p.xmlSource?.name || 'null'));
    console.log('');
  }
  
  const distinct = await prisma.product.groupBy({
    by: ['xmlBrandName'],
    _count: { id: true }
  });
  console.log('=== DISTINCT xmlBrandName VALUES ===');
  for (const d of distinct) {
    console.log('  ' + JSON.stringify(d.xmlBrandName) + ': ' + d._count.id + ' products');
  }

  // Check if there's raw XML brand data stored somewhere
  console.log('\n=== CHECKING XML IMPORT DATA ===');
  const sample = await prisma.product.findFirst({
    where: { xmlSource: { name: { contains: 'AKILLI' } } },
    select: {
      id: true, title: true, originalTitle: true, xmlBrandName: true,
      brandId: true, brand: { select: { name: true } },
      sku: true, barcode: true
    }
  });
  console.log('Sample AKILLIBAYI1 product:', JSON.stringify(sample, null, 2));
  
  // Check if products have any XML-specific data fields
  const schema = await prisma.$queryRaw`PRAGMA table_info(Product)`;
  console.log('\n=== PRODUCT TABLE COLUMNS ===');
  for (const col of schema) {
    if (col.name.toLowerCase().includes('xml') || col.name.toLowerCase().includes('brand') || col.name.toLowerCase().includes('original')) {
      console.log('  ' + col.name + ' (' + col.type + ')');
    }
  }
  
  await prisma.$disconnect();
})();
