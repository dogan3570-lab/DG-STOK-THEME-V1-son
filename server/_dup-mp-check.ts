import { prisma } from './src/db/prisma.ts';

const mps = await prisma.marketplace.findMany({ orderBy: { createdAt: 'asc' } });

const result: Record<string, Record<string, number>> = {};

for (const mp of mps) {
  const [orders, mappings, templates, pricingRules, states] = await Promise.all([
    prisma.order.count({ where: { marketplaceId: mp.id } }),
    prisma.categoryMapping.count({ where: { marketplaceId: mp.id } }),
    prisma.listingTemplate.count({ where: { marketplaceId: mp.id } }),
    prisma.marketplacePricingRule.count({ where: { marketplaceId: mp.id } }),
    prisma.productMarketplaceState.count({ where: { marketplaceId: mp.id } }),
  ]);
  result[`${mp.key} (${mp.id})`] = { orders, mappings, templates, pricingRules, states };
}

console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
