const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Products per XML source
  const perSource = await prisma.product.groupBy({
    by: ['xmlSourceId'],
    _count: { id: true }
  });
  console.log('=== PRODUCTS PER XML SOURCE ===');
  for (const ps of perSource) {
    const src = ps.xmlSourceId ? await prisma.xmlSource.findUnique({ where: { id: ps.xmlSourceId }, select: { name: true } }) : null;
    console.log('  ' + (src?.name || 'null') + ': ' + ps._count.id + ' products');
  }

  // For AKILLIBAYI1: The actual XML brand = "akilli bayi" (from BrandMapping)
  // All 13246 products from AKILLIBAYI1 should have xmlBrandName = "akilli bayi"
  
  // Verify: check the BrandMapping for akilli bayi
  const mapping = await prisma.brandMapping.findUnique({ where: { xmlBrandName: 'akilli bayi' } });
  console.log('\n=== MAPPING FOR akilli bayi ===');
  console.log(JSON.stringify(mapping, null, 2));
  
  // How many products currently have xmlBrandName = "D&G"?
  const dgCount = await prisma.product.count({ where: { xmlBrandName: 'D&G' } });
  console.log('\nProducts with xmlBrandName="D&G": ' + dgCount);
  
  // How many have xmlBrandName = "akilli bayi"?
  const akilliCount = await prisma.product.count({ where: { xmlBrandName: 'akilli bayi' } });
  console.log('Products with xmlBrandName="akilli bayi": ' + akilliCount);
  
  // The fix: set xmlBrandName = "akilli bayi" for ALL products from AKILLIBAYI1
  // This is the correct XML brand value from the actual XML file
  
  console.log('\n=== READY TO FIX ===');
  console.log('Will update ' + dgCount + ' products: xmlBrandName "D&G" → "akilli bayi"');
  
  await prisma.$disconnect();
})();
