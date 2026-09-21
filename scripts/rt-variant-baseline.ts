// scripts/rt-variant-baseline.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const w = { status: { not: 'DELETED' } };
  const total = await prisma.product.count({ where: w });
  const byStatus = await prisma.product.groupBy({ by: ['variantStatus'], where: w, _count: true });
  const byMatch = await prisma.product.groupBy({ by: ['variantMatch'], where: w, _count: true });
  const notRequired = await prisma.product.count({ where: { ...w, variantStatus: 'NOT_REQUIRED' } });
  const variantMatchTrue = await prisma.product.count({ where: { ...w, variantMatch: true } });
  const waitingAi = await prisma.product.count({ where: { ...w, variantStatus: 'WAITING_AI', variantMatch: false } });
  const manualReview = await prisma.product.count({ where: { ...w, variantStatus: 'MANUAL_REVIEW' } });
  // matchedBy for variant
  const vmb = await prisma.product.groupBy({ by: ['matchedBy'], where: { ...w, variantMatch: true }, _count: true });
  // products with variants relation rows
  const withVariants = await prisma.product.count({ where: { ...w, variants: { some: {} } } });
  const variantRows = await prisma.variant.count();
  console.log('=== DB BASELINE ===');
  console.log('total:', total);
  console.log('variantStatus distribution:', JSON.stringify(byStatus.map(s=>[s.variantStatus, s._count])));
  console.log('variantMatch distribution:', JSON.stringify(byMatch.map(s=>[s.variantMatch, s._count])));
  console.log('notRequired (NOT_REQUIRED):', notRequired);
  console.log('variantMatch=true:', variantMatchTrue);
  console.log('waitingAi (WAITING_AI & !match):', waitingAi);
  console.log('manualReview (MANUAL_REVIEW):', manualReview);
  console.log('variant matched by matchedBy:', JSON.stringify(vmb.map(m=>[m.matchedBy, m._count])));
  console.log('products with Variant rows:', withVariants);
  console.log('total Variant rows:', variantRows);
  const sample = await prisma.product.findMany({ where: { ...w, variantStatus: { not: 'NOT_REQUIRED' } }, select: { xmlKey: true, variantStatus: true, variantMatch: true, matchedBy: true, variants: { select: { name: true, value: true } } }, take: 5 });
  console.log('sample non-NOT_REQUIRED:', JSON.stringify(sample));
  const sampleNR = await prisma.product.findMany({ where: { ...w, variantStatus: 'NOT_REQUIRED' }, select: { xmlKey: true, variantStatus: true, variantMatch: true, variants: { select: { name: true, value: true } } }, take: 3 });
  console.log('sample NOT_REQUIRED:', JSON.stringify(sampleNR));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
