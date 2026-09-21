import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.ts';
import { fetchTrendyolCategoryAttributes } from '../server/src/services/trendyolCatalog.ts';
const prisma = new PrismaClient();

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  
  // Check first product in detail
  const pid = '04eaa732-d4a8-452d-b639-50aa9a7b210f';
  const prod = await prisma.product.findUnique({ where: { id: pid }, select: { id: true, categoryId: true, title: true, xmlSourceId: true, brand: { select: { externalId: true } }, variants: { select: { id: true } } } });
  console.log('Product:', prod?.title?.substring(0, 60));
  console.log('CategoryId:', prod?.categoryId);
  console.log('Variants:', prod?.variants?.length);
  console.log('Brand extId:', prod?.brand?.externalId);
  
  // Category mapping
  const cm = await prisma.categoryMapping.findFirst({ where: { categoryId: prod!.categoryId!, marketplaceId: MP, active: true }, select: { externalId: true } });
  const extId = cm ? Number(cm.externalId) : NaN;
  console.log('Category extId:', extId);
  
  // Trendyol required attrs for this category
  const defs = await fetchTrendyolCategoryAttributes(extId);
  const required = (defs as any[]).filter(d => d.required === true);
  console.log('Required attrs:', required.length);
  for (const r of required) {
    console.log(`  ${r.attribute.name}(${r.attribute.id}) varianter=${r.varianter} slicer=${r.slicer}`);
  }
  
  // Full gate
  const gate = await evaluateTrendyolSendGate({ productId: pid, marketplaceId: MP, xmlSourceId: prod!.xmlSourceId! });
  console.log('\nGate:', gate.ok, gate.firstFailureCode, gate.firstFailureMessage?.substring(0, 200));
  
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
