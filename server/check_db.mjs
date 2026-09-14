import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (!provider) {
    console.log('NO PROVIDER');
    await prisma.$disconnect();
    return;
  }
  
  console.log('Provider:', provider.provider);
  console.log('Active:', provider.active);
  console.log('Model:', provider.model);
  console.log('Has encrypted key:', !!provider.apiKeyEncrypted);
  console.log('Encrypted length:', provider.apiKeyEncrypted?.length);
  console.log('Encrypted preview:', provider.apiKeyEncrypted?.substring(0, 50));
  console.log('IV:', provider.apiKeyIv);
  console.log('Tag:', provider.apiKeyTag);
  console.log('UpdatedAt:', provider.updatedAt);
  console.log('LastStatus:', provider.lastStatus);
  console.log('LastError:', provider.lastError);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });