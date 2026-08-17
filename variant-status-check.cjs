const { PrismaClient } = require('./server/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: '949855eb-d68c-4920-b378-c622a6a665e2' }, _count: { variantStatus: true } });
  console.log('STATUS DIST:', JSON.stringify(rows, null, 0));
  const nullCount = await p.product.count({ where: { xmlSourceId: '949855eb-d68c-4920-b378-c622a6a665e2', variantStatus: null } });
  console.log('NULL status:', nullCount);
  // variantMatch=true ama status WAITING_AI olan tutarsız kayıtlar
  const inconsistent = await p.product.count({ where: { xmlSourceId: '949855eb-d68c-4920-b378-c622a6a665e2', variantMatch: true, variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] } } });
  console.log('variantMatch=true ama WAITING_AI/MANUAL_REVIEW:', inconsistent);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
