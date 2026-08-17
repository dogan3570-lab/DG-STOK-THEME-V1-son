const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const id = '739d360d-8998-436f-bd22-ef7e3539836d';
  const prod = await p.product.findUnique({
    where: { id },
    select: { id: true, variantMatch: true, variantStatus: true, matchedBy: true, lastMatchDate: true, variants: { select: { name: true, value: true } } },
  });
  console.log('PRODUCT DB:', JSON.stringify(prod, null, 0));
  const va = await p.variantAnalysis.findFirst({ where: { productId: id }, select: { source: true, status: true, validationPassed: true, checkResults: true } });
  console.log('VARIANT_ANALYSIS DB:', JSON.stringify(va, null, 0));
  const manualCount = await p.product.count({ where: { matchedBy: 'manual' } });
  console.log('TOTAL manual matchedBy ürün:', manualCount);
  const audit = await p.auditLog.findMany({ where: { action: 'V5_MANUAL_MATCH_V2' }, orderBy: { createdAt: 'desc' }, take: 1, select: { details: true, createdAt: true } });
  console.log('AUDIT LOG:', JSON.stringify(audit, null, 0));
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
