// scripts/rt-template-baseline.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { resolveListingTemplate } from '../server/src/services/listingTemplateResolver.ts';
const prisma = new PrismaClient();
async function main() {
  const mps = await prisma.marketplace.findMany({ select: { id: true, key: true, name: true, active: true } });
  console.log('=== Marketplaces ===');
  for (const m of mps) console.log(`  ${m.key} | ${m.name} | active=${m.active}`);

  const tpls = await prisma.listingTemplate.findMany({ select: { id: true, name: true, marketplaceId: true, active: true, productId: true, categoryId: true, brandId: true, commissionRate: true, vatRate: true, priceSource: true, priceRangeRules: true } });
  console.log(`\n=== ListingTemplates: ${tpls.length} ===`);
  const active = tpls.filter(t=>t.active).length;
  console.log(`active=${active} inactive=${tpls.length-active}`);
  const byScope = { PRODUCT: 0, CATEGORY: 0, GENERAL: 0, OTHER: 0, NO_MP: 0 };
  for (const t of tpls) {
    if (!t.marketplaceId) byScope.NO_MP++;
    else if (t.productId) byScope.PRODUCT++;
    else if (t.categoryId) byScope.CATEGORY++;
    else if (!t.productId && !t.categoryId && !t.brandId) byScope.GENERAL++;
    else byScope.OTHER++;
  }
  console.log('by scope:', JSON.stringify(byScope));
  console.log('with priceRangeRules:', tpls.filter(t=>t.priceRangeRules).length, '| with commission:', tpls.filter(t=>t.commissionRate!=null).length);
  for (const t of tpls) console.log(`  ${t.name} | mp=${t.marketplaceId?.substring(0,8) ?? 'NULL'} | active=${t.active} | prod=${t.productId?.substring(0,8) ?? '-'} cat=${t.categoryId?.substring(0,8) ?? '-'} brand=${t.brandId?.substring(0,8) ?? '-'}`);

  const tt = mps.find(m=>m.key==='tt');
  if (tt) {
    const prods = await prisma.product.findMany({ where: { status: { not: 'DELETED' } }, select: { id: true, categoryId: true, brandId: true, templateMatch: true } });
    const src: Record<string, number> = {};
    for (const p of prods) {
      const r = await resolveListingTemplate({ productId: p.id, categoryId: p.categoryId, brandId: p.brandId, marketplaceId: tt.id });
      src[r.source] = (src[r.source] || 0) + 1;
    }
    console.log(`\n=== Resolved template source (tt, all ${prods.length} products) ===`);
    console.log(JSON.stringify(src));
  }
  const tm = await prisma.product.groupBy({ by: ['templateMatch'], where: { status: { not: 'DELETED' } }, _count: true });
  console.log('Product.templateMatch distribution:', JSON.stringify(tm.map(t=>[t.templateMatch, t._count])));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
