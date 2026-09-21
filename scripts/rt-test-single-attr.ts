// scripts/rt-test-single-attr.ts
// Test proposeForProduct + applyProposals on a SINGLE product
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { proposeForProduct, applyProposals } from '../server/src/services/attributeAutoComplete.ts';
const prisma = new PrismaClient();

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const pid = '94931112-1287-4376-8c9e-fdda2ee4e860';

  const prod = await prisma.product.findUnique({
    where: { id: pid },
    select: { id: true, title: true, categoryId: true, xmlSourceId: true,
      brand: { select: { name: true, externalId: true } } },
  });
  console.log('Product:', prod?.title?.substring(0, 60));
  console.log('Category:', prod?.categoryId);
  console.log('Brand:', prod?.brand?.name, 'extId:', prod?.brand?.externalId);

  // Check category mapping
  const catMap = await prisma.categoryMapping.findFirst({
    where: { categoryId: prod?.categoryId!, marketplaceId: MP, active: true },
    select: { externalId: true, externalName: true },
  });
  console.log('Category mapping extId:', catMap?.externalId, 'name:', catMap?.externalName);

  // Run proposeForProduct (deterministic, no AI)
  console.log('\n--- proposeForProduct (det) ---');
  try {
    const proposal = await proposeForProduct(pid, MP, { useAI: false });
    console.log('Proposals count:', proposal.proposals.length);
    for (const p of proposal.proposals) {
      console.log(`  ${p.attributeName} = ${p.value} (valId=${p.valueId}, src=${p.source}, conf=${p.confidence}, catExtId=${p.categoryExternalId})`);
    }

    if (proposal.proposals.length > 0) {
      console.log('\n--- applyProposals (minConfidence=0.9) ---');
      const res = await applyProposals(pid, proposal.proposals, 0.9);
      console.log('Applied:', res.applied, 'Skipped:', res.skipped);
      for (const d of res.details) {
        console.log('  ', d);
      }
    }
  } catch (e: any) {
    console.error('ERROR:', e.message?.substring(0, 300));
  }

  // Check TPA after
  const tpa = await prisma.trendyolProductAttribute.findMany({
    where: { productId: pid },
    select: { id: true, attributeName: true, attributeValue: true, source: true },
  });
  console.log('\nTPA records after:', tpa.length);
  for (const t of tpa) {
    console.log(`  ${t.attributeName} = ${t.attributeValue} (src=${t.source})`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
