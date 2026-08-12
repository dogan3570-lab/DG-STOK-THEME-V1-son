const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  // Get all brands with product counts
  const brands = await p.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  console.log('All brands:');
  for (const b of brands) {
    const count = await p.product.count({ where: { brandId: b.id } });
    if (count > 0) console.log('  ' + b.name + ' (' + b.id.substring(0,8) + '): ' + count + ' products');
  }
  
  // Check if there are products with brand name 'akilli bayi' (not via brandId)
  const akilliBrand = await p.brand.findFirst({ where: { name: 'akilli bayi' } });
  console.log('\nakilli bayi brand:', JSON.stringify(akilliBrand));
  
  // Check D&G brand
  const dgBrand = await p.brand.findFirst({ where: { name: 'D&G' } });
  console.log('D&G brand:', JSON.stringify(dgBrand));
  
  // How many products have brandId = D&G?
  if (dgBrand) {
    const dgCount = await p.product.count({ where: { brandId: dgBrand.id } });
    console.log('Products with D&G brandId:', dgCount);
    
    // Sample some
    const samples = await p.product.findMany({ where: { brandId: dgBrand.id }, take: 3, select: { title: true, originalTitle: true } });
    samples.forEach(s => console.log('  ' + (s.title||'').substring(0,60)));
  }
  
  // Check product count by brandUsageType
  const usageTypes = await p.product.groupBy({ by: ['brandUsageType'], _count: { id: true } });
  console.log('\nBy brandUsageType:');
  usageTypes.forEach(u => console.log('  ' + u.brandUsageType + ': ' + u._count.id));
  
  await p.$disconnect();
})();
