// scripts/rt-provide-ids.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.product.findFirst({ where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] }, select: { id: true, xmlKey: true } });
  const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
  console.log(`${p?.id}|${p?.xmlKey}|${mp?.id}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
