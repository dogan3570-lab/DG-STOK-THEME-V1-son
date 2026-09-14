import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (!provider || !provider.apiKeyEncrypted || !provider.apiKeyIv || !provider.apiKeyTag) {
    console.log('NO API KEY CONFIGURED');
    await prisma.$disconnect();
    return;
  }
  
  console.log('Encrypted:', provider.apiKeyEncrypted.substring(0, 50) + '...');
  console.log('IV:', provider.apiKeyIv);
  console.log('Tag:', provider.apiKeyTag);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });