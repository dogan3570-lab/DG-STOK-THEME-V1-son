const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const sample = await p.product.findFirst({ select: { id: true, xmlBrandName: true, title: true } });
  console.log('Sample:', JSON.stringify(sample));
  
  const result = await p.$queryRaw`SELECT xmlBrandName, COUNT(*) as cnt FROM Product GROUP BY xmlBrandName LIMIT 10`;
  result.forEach(r => console.log('  ' + (r.xmlBrandName || 'NULL') + ': ' + Number(r.cnt)));
  
  await p.$disconnect();
})();
