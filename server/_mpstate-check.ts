import { prisma } from './src/db/prisma.ts';

const [products, mpStateTotal, productsWithState, productsWithoutState] = await Promise.all([
  prisma.product.count(),
  prisma.productMarketplaceState.count(),
  prisma.product.count({ where: { marketplaceStates: { some: {} } } }),
  prisma.product.count({ where: { marketplaceStates: { none: {} } } }),
]);

const mpStateByMp = await prisma.productMarketplaceState.groupBy({
  by: ['marketplaceId'],
  _count: { _all: true },
});

console.log(JSON.stringify({
  products,
  mpStateTotal,
  productsWithState,
  productsWithoutState,
  mpStateByMp,
}, null, 2));

await prisma.$disconnect();
