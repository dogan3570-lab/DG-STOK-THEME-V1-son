import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const row = await prisma.setting.findUnique({ where: { key: 'omniroute_registry' } });
  if (row) {
    console.log(row.value.substring(0, 5000));
  } else {
    console.log('not found');
  }
  await prisma.$disconnect();
}
main().catch(console.error);