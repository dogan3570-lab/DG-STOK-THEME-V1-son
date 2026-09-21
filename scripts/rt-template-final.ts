// scripts/rt-template-final.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.ts';
const prisma = new PrismaClient();
async function main() {
  // regression
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const catMatched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const brandMatched = await prisma.product.count({ where: { status: { not: 'DELETED' }, brandMatch: true } });
  const nr = await prisma.product.count({ where: { status: { not: 'DELETED' }, variantStatus: 'NOT_REQUIRED' } });
  const wa = await prisma.product.count({ where: { status: { not: 'DELETED' }, variantStatus: 'WAITING_AI' } });
  const tpl = await prisma.listingTemplate.count();
  const categories = await prisma.category.count();
  const catMappings = await prisma.categoryMapping.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const rules = await prisma.marketplacePricingRule.count();
  console.log('REGRESSION:', JSON.stringify({ total, catMatched, brandMatched, variantNR: nr, variantWaiting: wa, templates: tpl, categories, catMappings, tpa, rules }));

  // send gate template step for 3 sample products
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const samples = await prisma.product.findMany({ where: { status: { not: 'DELETED' } }, select: { id: true, xmlKey: true, xmlSourceId: true }, take: 5 });
  console.log('\nSEND GATE (template step):');
  for (const p of samples) {
    const g = await evaluateTrendyolSendGate({ productId: p.id, marketplaceId: tt!.id, xmlSourceId: p.xmlSourceId || '' });
    console.log(`  ${p.xmlKey} | ok=${g.ok} | firstFail=${g.firstFailureCode ?? '-'} | template.step=${g.steps.listing.status}${g.steps.listing.reasonCode ? '('+g.steps.listing.reasonCode+')' : ''} | templateSource=${g.template?.source ?? '-'}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
