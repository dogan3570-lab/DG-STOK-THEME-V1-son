import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  console.log('Marketplace createdAt:', mp?.createdAt);
  console.log('Marketplace updatedAt:', mp?.updatedAt);
  
  // Check if there are any old env files or configs
  const settings = await prisma.setting.findMany({
    where: { key: { contains: 'encrypt' } }
  });
  console.log('\nSettings with encrypt:', JSON.stringify(settings, null, 2));
  
  const allSettings = await prisma.setting.findMany();
  console.log('\nAll settings keys:', allSettings.map(s => s.key));
}
main().catch(console.error).finally(() => prisma.$disconnect());