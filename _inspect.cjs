const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const brandCounts = await prisma.product.groupBy({ by: ['brandId'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 10 });
  console.log('Products by brandId:');
  for (const bc of brandCounts) {
    const brand = bc.brandId ? await prisma.brand.findUnique({ where: { id: bc.brandId }, select: { name: true } }) : null;
    console.log('  ' + (brand ? brand.name : 'NULL') + ': ' + bc._count.id + ' products');
  }
  const sample = await prisma.product.findFirst({ select: { id: true, xmlBrandName: true, brandId: true, brandMatch: true, brand: { select: { name: true } } } });
  console.log('Sample product:', JSON.stringify(sample));
  const matchedCount = await prisma.product.count({ where: { brandMatch: true } });
  console.log('Matched products:', matchedCount);
  const withXml = await prisma.product.count({ where: { xmlBrandName: { not: null } } });
  console.log('Products with xmlBrandName set:', withXml);
  
  // Count unmatched products with brand
  const unmatchedWithBrand = await prisma.product.count({ where: { brandMatch: false, brandId: { not: null } } });
  console.log('Unmatched with brandId:', unmatchedWithBrand);
  
  // Sample some unmatched products
  const samples = await prisma.product.findMany({ where: { brandMatch: false }, take: 5, select: { id: true, title: true, brandId: true, brand: { select: { name: true } } } });
  console.log('Unmatched samples:');
  samples.forEach(s => console.log('  ' + (s.title || '').substring(0, 50) + ' | brand=' + (s.brand?.name || 'null')));
  
  await prisma.$disconnect();
})();
