import { PrismaClient } from '@prisma/client';
import { decryptApiKey } from './src/services/crypto.ts';
import { env } from './src/env.ts';

const prisma = new PrismaClient();
async function main() {
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'nvidia' } });
  if (provider.apiKeyEncrypted && provider.apiKeyIv && provider.apiKeyTag) {
    const decrypted = decryptApiKey(provider.apiKeyEncrypted, provider.apiKeyIv, provider.apiKeyTag);
    console.log('Decrypted key:', decrypted);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());