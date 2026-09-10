const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const dg = await p.brand.findFirst({ where: { name: 'D&G' }, select: { id: true, name: true, prefixFormat: true } });
  console.log('D&G brand:', JSON.stringify(dg));
  
  const hob = await p.brand.findFirst({ where: { name: { contains: 'HOB' } }, select: { id: true, name: true } });
  console.log('HOB brand:', JSON.stringify(hob));
  
  const samples = await p.product.findMany({ where: { brandMatch: true }, take: 5, select: { title: true, originalTitle: true, computedTitle: true, prefixEnabled: true, brandId: true, brand: { select: { name: true } } } });
  console.log('Matched samples:');
  samples.forEach(s => console.log('  title=' + (s.title||'').substring(0,60) + ' | orig=' + (s.originalTitle||'').substring(0,40) + ' | prefix=' + s.prefixEnabled + ' | brand=' + s.brand?.name));
  
  const mappings = await p.brandMapping.findMany({ select: { xmlBrandName: true, dgBrandId: true, productCount: true } });
  console.log('Mappings:');
  for (const m of mappings) {
    const b = await p.brand.findUnique({ where: { id: m.dgBrandId }, select: { name: true } });
    console.log('  ' + m.xmlBrandName + ' -> ' + (b?.name || 'UNKNOWN') + ' (' + m.productCount + ')');
  }
  
  await p.$disconnect();
})();
