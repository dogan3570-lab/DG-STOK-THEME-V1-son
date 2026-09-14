const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.productMarketplaceState.groupBy({
    by: ['status'],
    _count: { status: true }
  });
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);