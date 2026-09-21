// scripts/rt-check-tpa-direct.ts
// Direct DB check: are there ANY TPA records for the 87 products?
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  // Total TPA count for 'tt'
  const totalTpa = await prisma.trendyolProductAttribute.count({ where: { marketplaceKey: 'tt' } });
  console.log('Total TPA records for tt:', totalTpa);

  // Sample: check first 5 of the 87 products
  const sampleIds = [
    '94931112-1287-4376-8c9e-fdda2ee4e860',
    '1cea01f3-a7ea-4f1e-a1be-98dd2e0e7cd5',
    'd104b3c3-6e14-4541-9911-015ee37450cf',
    '2755030d-fb07-45ba-87e1-cafa90a1449b',
    'f2667457-b621-4b5e-8449-d458c83d7d52',
  ];

  for (const id of sampleIds) {
    const tpa = await prisma.trendyolProductAttribute.findMany({
      where: { productId: id },
      select: { id: true, marketplaceKey: true, attributeId: true, attributeName: true, attributeValueId: true, attributeValue: true, source: true, confidence: true },
    });
    console.log(`\nProduct ${id.substring(0,8)}: ${tpa.length} TPA records`);
    for (const t of tpa) {
      console.log(`  marketplace=${t.marketplaceKey} attr=${t.attributeId} name=${t.attributeName} valId=${t.attributeValueId} val=${t.attributeValue} src=${t.source} conf=${t.confidence}`);
    }
  }

  // Check if any TPA records exist at all for these 87
  const all87 = [
    '94931112-1287-4376-8c9e-fdda2ee4e860','1cea01f3-a7ea-4f1e-a1be-98dd2e0e7cd5',
    'd104b3c3-6e14-4541-9911-015ee37450cf','2755030d-fb07-45ba-87e1-cafa90a1449b',
    'f2667457-b621-4b5e-8449-d458c83d7d52','ee2be0a0-3fe9-4ab2-8bcc-c5b4e0be9b4e',
    'cb6c2091-287d-4ea7-81e5-36f423398137','711881d8-ecca-4794-817b-10b5532c3cca',
    '53a7bedc-2f3e-4393-9807-83d23f00a264','670e7314-e327-48f8-a47a-627f91af06b6',
  ];
  const anyTpa = await prisma.trendyolProductAttribute.findMany({
    where: { productId: { in: all87 } },
    select: { productId: true },
  });
  console.log('\nTPA records found for first 10 of 87:', anyTpa.length);

  // Check if there are ANY TPA records with these attribute IDs
  const anyTpaAll = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { id: true, productId: true },
    take: 5,
  });
  console.log('\nSample of existing TPA records:');
  for (const t of anyTpaAll) {
    console.log(`  id=${t.id.substring(0,8)} productId=${t.productId.substring(0,8)}`);
  }

  // Check the autoResolve cache file
  const fs = await import('fs');
  const path = await import('path');
  const cachePath = path.join(process.cwd(), 'server', 'src', 'data', 'blocked-products', 'auto-resolve.json');
  if (fs.existsSync(cachePath)) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    console.log('\nAuto-resolve cache:');
    console.log('  processed:', data.processed);
    console.log('  deterministic:', data.deterministic);
    console.log('  ai:', data.ai);
    console.log('  unresolved:', data.unresolved);
    console.log('  rejected:', data.rejected);
    console.log('  errors:', data.errors);
    console.log('  remainingProducts:', data.remainingProducts);
    console.log('  remainingMissing:', data.remainingMissing);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
