import { PrismaClient } from '@prisma/client';
import { decryptCredential } from './src/services/crypto.ts';

const prisma = new PrismaClient();

async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'n11' } });
  console.log('Marketplace N11:', {
    id: mp?.id,
    key: mp?.key,
    name: mp?.name,
    apiKey: mp?.apiKey ? 'ENCRYPTED' : 'NULL',
    apiSecret: mp?.apiSecret ? 'ENCRYPTED' : 'NULL',
    settings: mp?.settings
  });
  
  if (mp?.apiKey && mp?.apiSecret) {
    const apiKey = decryptCredential(mp.apiKey);
    const apiSecret = decryptCredential(mp.apiSecret);
    console.log('apiKey decrypted:', apiKey ? 'OK' : 'NULL');
    console.log('apiSecret decrypted:', apiSecret ? 'OK' : 'NULL');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());