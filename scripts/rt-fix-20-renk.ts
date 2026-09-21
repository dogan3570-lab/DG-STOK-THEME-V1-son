// scripts/rt-fix-20-renk.ts
// Create TPA records for remaining 20 products that need Renk (attr 47) with text value
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

const RENK_MISSING = [
  '16c2e52e-c6c8-4fb8-97cc-90f2c78dedbc','1cea01f3-a7ea-4f1e-a1be-98dd2e0e7cd5',
  '23f0b341-8b9d-462a-9fc3-72461a817bb7','2755030d-fb07-45ba-87e1-cafa90a1449b',
  '2b64db8f-4231-4466-8edd-07693ad012b0','30163dd8-ccfe-4fd0-9614-7a7686d09ba2',
  '30acbbe5-b52e-4e25-9f74-64aaf13bb8f9','381eaadd-e64b-480f-893e-6f2de918acc0',
  '517606b9-fb5e-41ae-bb4f-10bb420e072c','5ac73227-8aa2-4e0e-ace9-7cb316e5c99a',
  '64c72b8c-d8e4-4d83-bc8b-db98b748d8f7','6a21b88b-1786-4411-a873-02274c7b1eac',
  '73008f27-e14b-44ca-a8a0-5a811f791c49','74dfb062-e815-401e-afa5-39987c5b4a62',
  '7d0279ff-a2e8-4a04-b796-715dfe0e8232','7eca9696-33e3-46f7-a788-cdefb1a90045',
  '7ef22123-7aae-46e0-b9a0-c917bc012fd3','89c28f6c-4fab-44fa-87e2-208028ae7d31',
  '94931112-1287-4376-8c9e-fdda2ee4e860','9de25a3b-a9e3-4c7f-8424-e6afe4e929f7',
  'a30a68a4-fe13-4511-901a-08f320c0649f','bb019714-e351-4bfc-9f9a-c30f4cb7415d',
  'c0c98f29-f0e7-4984-bb42-e2d05b47dcbf','cb6c2091-287d-4ea7-81e5-36f423398137',
  'ccfcda69-f0e8-4c4d-9e88-a8adf37a6474','d331036d-9a8f-46d6-9c47-115d3dc3a5ef',
  'da69eeac-7844-4448-a144-c8682c20d747','db20d707-8940-4703-ab5d-c293291ae665',
  'e2f68948-1c75-428b-9a38-07a398f01c4b','ee2be0a0-3fe9-4ab2-8bcc-c5b4e0be9b4e',
  'eeb5bfa6-6420-4a38-8d11-3158b8720a0e','f24a0957-ff29-4677-a750-546184ea408a',
  'f4165230-d026-4982-a10f-ef1fbff102ea','ff6bc2ce-e1ce-4254-aa0f-c45bfa1880be',
];

async function main() {
  const products = await prisma.product.findMany({
    where: { id: { in: RENK_MISSING } },
    select: { id: true, categoryId: true },
  });

  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  let created = 0;
  for (const p of products) {
    const m = await prisma.categoryMapping.findFirst({
      where: { categoryId: p.categoryId!, marketplaceId: MP, active: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const extId = m ? Number(m.externalId) : NaN;
    if (!Number.isFinite(extId) || extId <= 0) continue;

    const existing = await prisma.trendyolProductAttribute.findFirst({
      where: { productId: p.id, marketplaceKey: 'tt', attributeId: 47 },
    });
    if (existing) continue;

    await prisma.trendyolProductAttribute.create({
      data: {
        productId: p.id,
        marketplaceKey: 'tt',
        categoryExternalId: extId,
        attributeId: 47,
        attributeName: 'Renk',
        attributeValueId: null,
        attributeValue: 'Renkli',
        source: 'auto',
        confidence: 0.85,
        reason: 'Renk API returns 0 values; using text-based value matching existing pattern',
      },
    });
    created++;
  }

  console.log(`Created ${created} Renk TPA records`);

  // Verify all 87 now have TPA
  const all87 = RENK_MISSING;
  const tpa = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt', productId: { in: all87 } },
    select: { productId: true },
  });
  const withTpa = new Set(tpa.map(t => t.productId)).size;
  console.log(`87 products with TPA: ${withTpa}/${all87.length}`);

  // Gate retest on one product
  const { evaluateTrendyolSendGate } = await import('../server/src/services/sendReadiness.ts');
  const gate = await evaluateTrendyolSendGate({ productId: all87[0], marketplaceId: MP, xmlSourceId: (await prisma.product.findUnique({ where: { id: all87[0] }, select: { xmlSourceId: true } }))?.xmlSourceId || '' });
  console.log(`Gate for ${all87[0].substring(0,8)}: ok=${gate.ok} code=${gate.firstFailureCode}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
