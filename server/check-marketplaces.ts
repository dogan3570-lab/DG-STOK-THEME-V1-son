import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  console.log('Marketplace TT:', {
    id: mp?.id,
    key: mp?.key,
    name: mp?.name,
    apiKey: mp?.apiKey ? 'ENCRYPTED' : 'NULL',
    apiSecret: mp?.apiSecret ? 'ENCRYPTED' : 'NULL',
    settings: mp?.settings
  });
  
  // Check if there are any other marketplaces with valid credentials
  const all = await prisma.marketplace.findMany();
  console.log('\nAll marketplaces:');
  for (const m of all) {
    console.log(`  ${m.key}: apiKey=${m.apiKey ? 'ENCRYPTED' : 'NULL'}, apiSecret=${m.apiSecret ? 'ENCRYPTED' : 'NULL'}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());