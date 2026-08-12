import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'nvidia' } });
  console.log('apiKeyEncrypted:', provider.apiKeyEncrypted?.substring(0, 50));
  console.log('apiKeyIv:', provider.apiKeyIv);
  console.log('apiKeyTag:', provider.apiKeyTag);
}
main().catch(console.error).finally(() => prisma.$disconnect());