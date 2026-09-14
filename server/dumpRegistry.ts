import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const prisma = new PrismaClient();
async function main() {
  const row = await prisma.setting.findUnique({ where: { key: 'omniroute_registry' } });
  if (row) {
    fs.writeFileSync('registry.json', row.value);
    console.log('written registry.json length', row.value.length);
  } else {
    console.log('not found');
  }
  await prisma.$disconnect();
}
main().catch(console.error);