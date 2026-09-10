import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { getTrendyolMappingStatus } from './src/services/trendyolMapping.ts';

async function main() {
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  const src = await prisma.xmlSource.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true } });
  if (!tt || !src) { console.log('ctx yok'); await prisma.$disconnect(); process.exit(1); }

  const [catMappings, brandMappings] = await Promise.all([
    prisma.categoryMapping.findMany({ where: { marketplaceId: tt.id }, select: { externalId: true, externalName: true, source: true, confidence: true, active: true } }),
    prisma.brandMapping.findMany({ select: { xmlBrandName: true, marketplaceKey: true, isAuto: true } }),
  ]);
  console.log('CATEGORY_MAPPING_ROWS:', JSON.stringify(catMappings, null, 2));
  console.log('BRAND_MAPPING_ROWS:', JSON.stringify(brandMappings, null, 2));

  const status = await getTrendyolMappingStatus({ xmlSourceId: src.id, marketplaceId: tt.id });
  console.log('UX_HEADER:', status.header);
  console.log('UX_GATES:', JSON.stringify(status.gates));
  console.log('UX_TOTALS:', JSON.stringify(status.totals));
  console.log('UX_PROGRESS:', status.progress);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
