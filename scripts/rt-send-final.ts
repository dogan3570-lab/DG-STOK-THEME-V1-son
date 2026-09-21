// scripts/rt-send-final.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const w = { status: { not: 'DELETED' } };
  const total = await prisma.product.count({ where: w });
  const catMatched = await prisma.product.count({ where: { ...w, categoryMatch: true } });
  const brandMatched = await prisma.product.count({ where: { ...w, brandMatch: true } });
  const nr = await prisma.product.count({ where: { ...w, variantStatus: 'NOT_REQUIRED' } });
  const tpl = await prisma.product.count({ where: { ...w, templateMatch: true } });
  const tplCount = await prisma.listingTemplate.count();
  const categories = await prisma.category.count();
  const catMappings = await prisma.categoryMapping.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const rules = await prisma.marketplacePricingRule.count();
  console.log('REGRESSION:', JSON.stringify({ total, catMatched, brandMatched, variantNR: nr, templateMatch: tpl, templates: tplCount, categories, catMappings, tpa, rules }));
  const pms = await prisma.productMarketplaceState.groupBy({ by: ['status'], _count: true });
  console.log('PMS status:', JSON.stringify(pms.map(s=>[s.status, s._count])));
  // the 2 test products
  for (const k of ['13290','2980']) {
    const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { id: true } });
    const st = await prisma.productMarketplaceState.findFirst({ where: { productId: p!.id }, select: { status: true, externalRef: true, errorMessage: true, lastActionAt: true } });
    console.log(`  ${k}: PMS=${JSON.stringify(st)}`);
  }
  const errors = await prisma.productMarketplaceState.count({ where: { status: 'ERROR' } });
  console.log('PMS ERROR count (not-going source):', errors);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
