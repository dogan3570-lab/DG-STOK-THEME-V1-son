// scripts/rt-recount.ts
// READ-ONLY: recount after application
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const nullCat = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null } });
  const nullSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, supplierCategory: null } });
  const nullCatNullSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null, supplierCategory: null } });
  const nullCatHasSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null, supplierCategory: { not: null } } });
  const matched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const matchedManual = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true, matchedBy: 'manual' } });
  const srcMatched = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryMatch: true } });
  const srcNull = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null } });
  console.log(JSON.stringify({ total, matched, matchedManual, nullCat, nullSc, nullCatNullSc, nullCatHasSc, srcMatched, srcNull }, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
