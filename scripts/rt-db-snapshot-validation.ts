import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const ttMp = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const mpId = ttMp?.id;

  const total = await prisma.product.count({ where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } } });
  console.log('Total products with xmlSource:', total);

  const statusDist = await prisma.product.groupBy({ by: ['status'], where: { xmlSourceId: { not: null } }, _count: { id: true } });
  console.log('Status distribution:', JSON.stringify(statusDist.map(s => ({ status: s.status, count: s._count.id })), null, 2));

  const pmsDist = await prisma.productMarketplaceState.groupBy({ by: ['status'], where: { marketplaceId: mpId }, _count: { id: true } });
  console.log('PMS distribution (TT):', JSON.stringify(pmsDist.map(s => ({ status: s.status, count: s._count.id })), null, 2));

  const candidates = await prisma.product.count({
    where: {
      status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
      xmlSourceId: { not: null },
    },
  });
  console.log('Candidates (not ACTIVE/SENDING/DELETED):', candidates);

  const matchTrue = await prisma.product.count({
    where: {
      status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
      xmlSourceId: { not: null },
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
    },
  });
  console.log('Products with categoryMatch+brandMatch+templateMatch true:', matchTrue);

  const mfScanCandidates = await prisma.product.count({
    where: {
      status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
      xmlSourceId: { not: null },
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      OR: [{ variantMatch: false }, { variantStatus: { not: 'NOT_REQUIRED' } }],
    },
  });
  console.log('MF scan candidates (matching missingFieldsService filter):', mfScanCandidates);

  const noCategoryId = await prisma.product.count({
    where: {
      xmlSourceId: { not: null },
      categoryId: null,
      status: { not: 'DELETED' },
    },
  });
  console.log('Products with categoryId IS NULL:', noCategoryId);

  const productsWithCat = await prisma.product.findMany({
    where: {
      xmlSourceId: { not: null },
      categoryId: { not: null },
      status: { not: 'DELETED' },
    },
    select: { id: true, categoryId: true },
  });
  const catMappingIds = new Set(
    (await prisma.categoryMapping.findMany({
      where: { marketplaceId: mpId, active: true },
      select: { categoryId: true },
    })).map(m => m.categoryId)
  );
  const noCatMapping = productsWithCat.filter(p => !catMappingIds.has(p.categoryId!));
  console.log('Products with categoryId but no CategoryMapping for TT:', noCatMapping.length);

  const noBrand = await prisma.product.count({
    where: {
      xmlSourceId: { not: null },
      status: { not: 'DELETED' },
      OR: [
        { brandId: null },
        { brand: { externalId: null } },
      ],
    },
  });
  console.log('Products with no brand or null externalId:', noBrand);

  const prCount = await prisma.marketplacePricingRule.count({ where: { marketplaceId: mpId, active: true } });
  const prRange = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: mpId, active: true },
    select: { minPrice: true, maxPrice: true, xmlSourceId: true },
    orderBy: { minPrice: 'asc' },
  });
  console.log('Pricing rules count:', prCount);
  console.log('Pricing rules:', JSON.stringify(prRange, null, 2));

  const tplCount = await prisma.listingTemplate.count({ where: { marketplaceId: mpId, active: true } });
  const tplDetails = await prisma.listingTemplate.findMany({
    where: { marketplaceId: mpId, active: true },
    select: { id: true, name: true, productId: true, categoryId: true, brandId: true },
  });
  console.log('Template count:', tplCount);
  const productTpl = tplDetails.filter(t => t.productId).length;
  const catTpl = tplDetails.filter(t => t.categoryId && !t.productId).length;
  const generalTpl = tplDetails.filter(t => !t.productId && !t.categoryId && !t.brandId).length;
  console.log('Product-level templates:', productTpl);
  console.log('Category-level templates:', catTpl);
  console.log('General templates:', generalTpl);

  const tpaCount = await prisma.trendyolProductAttribute.count({ where: { marketplaceKey: 'tt' } });
  const tpaDistinctProducts = await prisma.trendyolProductAttribute.groupBy({ by: ['productId'], where: { marketplaceKey: 'tt' } });
  console.log('TrendyolProductAttribute total rows:', tpaCount);
  console.log('TrendyolProductAttribute distinct products:', tpaDistinctProducts.length);

  const readyLikeProducts = await prisma.product.findMany({
    where: {
      status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
      xmlSourceId: { not: null },
    },
    select: { id: true, status: true },
  });
  const statusCounts = new Map<string, number>();
  for (const p of readyLikeProducts) {
    statusCounts.set(p.status, (statusCounts.get(p.status) || 0) + 1);
  }
  console.log('Candidate statuses:', Object.fromEntries(statusCounts));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
