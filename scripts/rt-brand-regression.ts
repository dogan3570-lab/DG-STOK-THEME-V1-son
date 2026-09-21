// scripts/rt-brand-regression.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const brands = await prisma.brand.count();
  const brandMappings = await prisma.brandMapping.count();
  const categories = await prisma.category.count();
  const catMappings = await prisma.categoryMapping.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const rules = await prisma.marketplacePricingRule.count();
  const catMatched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const brandMatched = await prisma.product.count({ where: { status: { not: 'DELETED' }, brandMatch: true } });
  console.log(JSON.stringify({ total, brandMatched, brands, brandMappings, catMatched, categories, catMappings, tpa, rules }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
