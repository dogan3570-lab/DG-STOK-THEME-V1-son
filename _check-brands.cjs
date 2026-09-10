const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // What brands exist in the Brand table?
  const brands = await prisma.brand.findMany({ select: { id: true, name: true, prefixFormat: true, _count: { select: { products: true } } } });
  console.log('=== BRAND TABLE ===');
  for (const b of brands) {
    console.log('  ' + b.name + ' (id=' + b.id + ', products=' + b._count.products + ', prefix=' + (b.prefixFormat || 'default') + ')');
  }

  // What does the XML file actually contain for brand?
  // Check xmlKey patterns and xmlSource
  console.log('\n=== PRODUCTS WITH brandId (before unmatch) ===');
  const withBrand = await prisma.product.groupBy({
    by: ['brandId'],
    _count: { id: true },
    where: { xmlSource: { name: { contains: 'AKILLI' } } }
  });
  for (const wb of withBrand) {
    const brand = wb.brandId ? await prisma.brand.findUnique({ where: { id: wb.brandId }, select: { name: true } }) : null;
    console.log('  brandId=' + wb.brandId + ' brand.name=' + (brand?.name || 'null') + ' count=' + wb._count.id);
  }

  // Check what the original XML brand was during import
  // The brand was stored in Brand table with the XML value
  console.log('\n=== BRAND RECORDS (potential XML brands) ===');
  const allBrands = await prisma.brand.findMany({ select: { name: true } });
  console.log('Total brands in DB: ' + allBrands.length);
  for (const b of allBrands) {
    console.log('  - ' + b.name);
  }
  
  // Check BrandMapping table
  console.log('\n=== BRAND MAPPING ===');
  const mappings = await prisma.brandMapping.findMany();
  for (const m of mappings) {
    const dgBrand = await prisma.brand.findUnique({ where: { id: m.dgBrandId }, select: { name: true } });
    console.log('  xmlBrandName=' + m.xmlBrandName + ' → dgBrand=' + (dgBrand?.name || m.dgBrandId) + ' (isAuto=' + m.isAuto + ')');
  }
  
  await prisma.$disconnect();
})();
