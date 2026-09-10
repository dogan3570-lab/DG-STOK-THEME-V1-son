import { prisma } from './src/db/prisma.ts';

async function resetDb() {
  await prisma.xmlImportItemResult.deleteMany();
  await prisma.xmlImportRun.deleteMany();
  await prisma.variant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.xmlSource.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  console.log('DB_RESET_OK');
  await prisma.$disconnect();
  process.exit(0);
}

async function cleanupDb() {
  const products = await prisma.product.findMany({
    where: { xmlKey: { startsWith: 'DGTEST-' } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  if (ids.length > 0) {
    await prisma.variant.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
  const sources = await prisma.xmlSource.findMany({
    where: { name: { startsWith: 'DGTEST' } },
    select: { id: true },
  });
  for (const s of sources) {
    await prisma.xmlImportItemResult.deleteMany({ where: { importRun: { sourceId: s.id } } });
    await prisma.xmlImportRun.deleteMany({ where: { sourceId: s.id } });
    await prisma.xmlSource.delete({ where: { id: s.id } });
  }
  console.log('DB_CLEANUP_OK deletedProducts=' + ids.length + ' deletedSources=' + sources.length);
  await prisma.$disconnect();
  process.exit(0);
}

async function main() {
  const [totalProducts, totalSources, categories, brands, orders] = await Promise.all([
    prisma.product.count(),
    prisma.xmlSource.count(),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.order.count(),
  ]);

  const sources = await prisma.xmlSource.findMany({
    select: {
      id: true,
      name: true,
      active: true,
      connectionStatus: true,
      lastError: true,
      lastSuccessAt: true,
    },
  });

  const productsBySource = await Promise.all(
    sources.map(async (s) => ({
      name: s.name,
      products: await prisma.product.count({ where: { xmlSourceId: s.id } }),
    }))
  );

  const linkedProducts = await prisma.product.count({ where: { xmlSourceId: { not: null } } });
  const unlinkedProducts = await prisma.product.count({ where: { xmlSourceId: null } });
  const variants = await prisma.variant.count();
  const importRuns = await prisma.xmlImportRun.count();

  console.log(
    JSON.stringify({
      totalProducts,
      totalSources,
      categories,
      brands,
      orders,
      linkedProducts,
      unlinkedProducts,
      variants,
      importRuns,
      sources: sources.map((s) => ({
        name: s.name,
        active: s.active,
        connectionStatus: s.connectionStatus,
        lastError: s.lastError,
        lastSuccessAt: s.lastSuccessAt ? s.lastSuccessAt.toISOString() : null,
      })),
      productsBySource,
    })
  );

  await prisma.$disconnect();
  process.exit(0);
}

if (process.argv.includes('reset')) {
  resetDb();
} else if (process.argv.includes('cleanup')) {
  cleanupDb();
} else {
  main().catch(async (err) => {
    console.error('DBCHECK_ERROR', err);
    await prisma.$disconnect();
    process.exit(1);
  });
}