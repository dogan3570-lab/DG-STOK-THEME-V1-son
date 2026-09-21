// scripts/rt-gate-tests.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.ts';
const prisma = new PrismaClient();
async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });

  // POSITIVE: READY 4/4
  const pos = await prisma.product.findFirst({ where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] }, select: { id: true, xmlKey: true, xmlSourceId: true } });
  if (pos) {
    const g = await evaluateTrendyolSendGate({ productId: pos.id, marketplaceId: tt!.id, xmlSourceId: pos.xmlSourceId || '' });
    console.log(`POSITIVE ${pos.xmlKey}: ok=${g.ok} category=${g.steps.category.status} brand=${g.steps.brand.status} variant=${g.steps.variant.status} listing=${g.steps.listing.status} price=${g.steps.price.status} firstFail=${g.firstFailureCode ?? '-'}`);
  }

  // NEGATIVE: category missing
  const negCat = await prisma.product.findFirst({ where: { categoryMatch: false }, select: { id: true, xmlKey: true, xmlSourceId: true } });
  if (negCat) {
    const g = await evaluateTrendyolSendGate({ productId: negCat.id, marketplaceId: tt!.id, xmlSourceId: negCat.xmlSourceId || '' });
    console.log(`NEGATIVE(category) ${negCat.xmlKey}: ok=${g.ok} category=${g.steps.category.status}(${g.firstFailureCode})`);
  }

  // NEGATIVE: wrong xml context
  const anyP = await prisma.product.findFirst({ where: { status: { not: 'DELETED' } }, select: { id: true, xmlKey: true } });
  if (anyP) {
    const g = await evaluateTrendyolSendGate({ productId: anyP.id, marketplaceId: tt!.id, xmlSourceId: 'WRONG-XML-ID' });
    console.log(`NEGATIVE(wrongXml) ${anyP.xmlKey}: ok=${g.ok} firstFail=${g.firstFailureCode}`);
  }

  // REQUIRED ATTRIBUTE gate: via send gate on a READY product already covered above.
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
