/**
 * READ-ONLY — categoryMatch=true ama gerçek externalId/mapping olmayan anomali ürünlerin ayrıştırması.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  const ttId = tt?.id ?? null;

  const anomalies = await prisma.product.findMany({
    where: {
      categoryMatch: true,
      OR: [
        { categoryId: null },
        { category: { externalId: null } },
        { NOT: { category: { mappings: { some: { marketplaceId: ttId, active: true, externalId: { not: null } } } } } },
      ],
    },
    select: {
      id: true, xmlKey: true, title: true, supplierCategory: true, matchedBy: true, aiScore: true, status: true, categoryMatch: true,
      categoryId: true,
      category: { select: { id: true, name: true, externalId: true, parentId: true } },
    },
    take: 50,
  });

  console.log(JSON.stringify({ count: anomalies.length, items: anomalies }, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
