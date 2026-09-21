// scripts/rt-variant-filter-check.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const w = { status: { not: 'DELETED' } };
  const filters = {
    all_excl_notrequired: await prisma.product.count({ where: { ...w, variantStatus: { not: 'NOT_REQUIRED' } } }),
    matched: await prisma.product.count({ where: { ...w, variantMatch: true } }),
    unmatched: await prisma.product.count({ where: { ...w, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } }),
    manual: await prisma.product.count({ where: { ...w, variantStatus: 'MANUAL_REVIEW' } }),
    notRequired: await prisma.product.count({ where: { ...w, variantStatus: 'NOT_REQUIRED' } }),
    waitingAi: await prisma.product.count({ where: { ...w, variantStatus: 'WAITING_AI' } }),
  };
  console.log(JSON.stringify(filters, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
