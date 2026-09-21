// scripts/rt-check-renk-existing.ts
// Check how Renk is handled in existing TPA records
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  // Find any TPA records for attribute 47 (Renk)
  const renkTpa = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt', attributeId: 47 },
    select: { productId: true, categoryExternalId: true, attributeValueId: true, attributeValue: true, source: true },
    take: 20,
  });
  console.log('TPA records for Renk(47):', renkTpa.length);
  for (const r of renkTpa) {
    console.log(`  product=${r.productId.substring(0,8)} cat=${r.categoryExternalId} valId=${r.attributeValueId} val="${r.attributeValue}" src=${r.source}`);
  }

  // Check gate for one of the remaining 20 products
  // Pick one that still needs Renk
  const pid = '94931112-1287-4376-8c9e-fdda2ee4e860';
  const tpa = await prisma.trendyolProductAttribute.findMany({
    where: { productId: pid },
    select: { attributeId: true, attributeName: true, attributeValueId: true, attributeValue: true },
  });
  console.log(`\nProduct ${pid.substring(0,8)} TPA records:`, tpa.length);
  for (const t of tpa) {
    console.log(`  ${t.attributeName}(${t.attributeId}) valId=${t.attributeValueId} val="${t.attributeValue}"`);
  }

  // Check how the gate evaluates this product now
  const { evaluateTrendyolSendGate } = await import('../server/src/services/sendReadiness.ts');
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const gate = await evaluateTrendyolSendGate({ productId: pid, marketplaceId: tt!.id, xmlSourceId: (await prisma.product.findUnique({ where: { id: pid }, select: { xmlSourceId: true } }))?.xmlSourceId || '' });
  console.log(`\nGate: ok=${gate.ok} code=${gate.firstFailureCode} msg=${gate.firstFailureMessage?.substring(0, 200)}`);

  // Check a product that DOES pass (from the 2353 READY group)
  const readyProducts = await prisma.product.findMany({
    where: { id: { not: { in: [...Array.from({length: 10}).map((_, i) => `placeholder-${i}`)] } }, xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: { id: true, categoryId: true },
    take: 5,
  });
  // Just pick any READY product
  const readyPid = 'a599308d-2a5a-4a9e-8596-e9da0c259840'; // random from DB
  const readyTpa = await prisma.trendyolProductAttribute.findMany({
    where: { productId: readyPid },
    select: { attributeId: true, attributeName: true, attributeValueId: true, attributeValue: true },
  });
  console.log(`\nREADY product ${readyPid.substring(0,8)} TPA:`, readyTpa.length);
  for (const t of readyTpa) {
    console.log(`  ${t.attributeName}(${t.attributeId}) valId=${t.attributeValueId} val="${t.attributeValue}"`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
