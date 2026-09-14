import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  console.log('Marketplace:', JSON.stringify(mp, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());