/**
 * READ-ONLY PLAN PROBE 3 — templateMatch=false kök neden ayrıştırması.
 * YAZMA YOK.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const tmFalse = await prisma.product.count({ where: { templateMatch: false } });
  const tmTrue = await prisma.product.count({ where: { templateMatch: true } });
  const tmFalseCatFalse = await prisma.product.count({ where: { templateMatch: false, categoryMatch: false } });
  const tmFalseCatTrue = await prisma.product.count({ where: { templateMatch: false, categoryMatch: true } });
  const tmTrueCatFalse = await prisma.product.count({ where: { templateMatch: true, categoryMatch: false } });
  const tmTrueCatTrue = await prisma.product.count({ where: { templateMatch: true, categoryMatch: true } });

  // templateMatch=false ürünlerin pazaryeri state dağılımı
  const states = await prisma.productMarketplaceState.groupBy({
    by: ['marketplaceId'],
    where: { product: { templateMatch: false } },
    _count: { id: true },
  });

  // sample: templateMatch=false ürünler
  const sample = await prisma.product.findMany({
    where: { templateMatch: false },
    select: { id: true, xmlKey: true, title: true, categoryMatch: true, status: true, xmlSourceId: true },
    take: 10,
  });

  console.log(JSON.stringify({
    templateMatch: { false: tmFalse, true: tmTrue },
    cross: { tmFalseCatFalse, tmFalseCatTrue, tmTrueCatFalse, tmTrueCatTrue },
    tmFalseByMarketplaceState: states,
    sample,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
