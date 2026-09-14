import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (!provider || !provider.apiKeyEncrypted || !provider.apiKeyIv || !provider.apiKeyTag) {
    console.log('NO API KEY CONFIGURED');
    await prisma.$disconnect();
    return;
  }
  
  console.log('Encrypted length:', provider.apiKeyEncrypted.length);
  console.log('IV length:', provider.apiKeyIv.length);
  console.log('Tag length:', provider.apiKeyTag.length);
  console.log('Encrypted:', provider.apiKeyEncrypted.substring(0, 100));
  console.log('IV:', provider.apiKeyIv);
  console.log('Tag:', provider.apiKeyTag);
  
  // Check if they are valid hex
  try {
    Buffer.from(provider.apiKeyIv, 'hex');
    console.log('IV is valid hex');
  } catch (e) {
    console.log('IV is NOT valid hex:', e.message);
  }
  
  try {
    Buffer.from(provider.apiKeyTag, 'hex');
    console.log('Tag is valid hex');
  } catch (e) {
    console.log('Tag is NOT valid hex:', e.message);
  }
  
  try {
    Buffer.from(provider.apiKeyEncrypted, 'hex');
    console.log('Encrypted is valid hex');
  } catch (e) {
    console.log('Encrypted is NOT valid hex:', e.message);
  }
  
  // Check if the IV and tag lengths are correct for AES-256-GCM
  // IV should be 16 bytes = 32 hex chars
  // Tag should be 16 bytes = 32 hex chars
  console.log('IV length (bytes):', provider.apiKeyIv.length / 2);
  console.log('Tag length (bytes):', provider.apiKeyTag.length / 2);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });