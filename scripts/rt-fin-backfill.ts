// scripts/rt-fin-backfill.ts — purchasePrice normalizasyonu (kuru çalıştırma + uygula)
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const nullCost = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: null, salePrice: { gt: 0 } } });
  const already = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: { gt: 0 } } });
  console.log(JSON.stringify({ mode: APPLY ? 'APPLY' : 'DRY-RUN', toBackfill: nullCost, alreadyHasCost: already }));

  if (!APPLY) {
    const sample = await prisma.product.findMany({ where: { status: { not: 'DELETED' }, purchasePrice: null, salePrice: { gt: 0 } }, select: { xmlKey: true, sku: true, salePrice: true }, take: 5 });
    console.log('ÖRNEK:', JSON.stringify(sample));
    await prisma.$disconnect();
    return;
  }

  // Product-level additive normalize: purchasePrice = salePrice (KDV dahil alış)
  const targets = await prisma.product.findMany({ where: { status: { not: 'DELETED' }, purchasePrice: null, salePrice: { gt: 0 } }, select: { id: true, salePrice: true } });
  let updated = 0;
  for (const t of targets) {
    await prisma.product.update({ where: { id: t.id }, data: { purchasePrice: t.salePrice } });
    updated++;
  }
  await prisma.auditLog.create({
    data: {
      action: 'FINANCE_COST_NORMALIZE',
      entity: 'Product',
      entityId: 'bulk',
      details: JSON.stringify({ updated, source: 'salePrice->purchasePrice (XML PriceInclusiveVat = B2B toptan ALIŞ)', canonical: 'canonicalFinance.ts' }),
    },
  }).catch((e) => console.log('audit-log skipped:', e.message));

  const after = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: { gt: 0 } } });
  console.log(JSON.stringify({ updated, purchasePricePositiveAfter: after }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
