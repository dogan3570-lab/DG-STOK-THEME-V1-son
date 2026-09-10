import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const provider = await prisma.aIProviderConfig.update({
    where: { provider: 'nvidia' },
    data: { displayName: 'NVIDIA NIM' }
  });
  console.log('Updated:', provider.displayName);
}
main().catch(console.error).finally(() => prisma.$disconnect());