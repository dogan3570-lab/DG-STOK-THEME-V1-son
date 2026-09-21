import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const ttMp = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const mpId = ttMp!.id;

  // Pricing rules are tied to a specific xmlSourceId
  const prRules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: mpId, active: true },
    select: { minPrice: true, maxPrice: true, xmlSourceId: true },
    orderBy: { minPrice: 'asc' },
  });
  console.log('Pricing rules xmlSourceIds:', [...new Set(prRules.map(r => r.xmlSourceId))]);

  // How many products per xmlSourceId?
  const xmlSourceDist = await prisma.product.groupBy({
    by: ['xmlSourceId'],
    where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    _count: { id: true },
  });
  console.log('Products per xmlSourceId:');
  for (const x of xmlSourceDist) {
    console.log(`  ${x.xmlSourceId}: ${x._count.id}`);
  }

  // Products whose xmlSourceId does NOT have pricing rules
  const ruleXmlIds = new Set(prRules.map(r => r.xmlSourceId).filter(Boolean));
  const productsWithoutPricing = await prisma.product.count({
    where: {
      xmlSourceId: { not: null, notIn: Array.from(ruleXmlIds) },
      status: { not: 'DELETED' },
    },
  });
  console.log('Products WITHOUT pricing rules (xmlSourceId not in rule set):', productsWithoutPricing);

  // Of those, how many have categoryId?
  const productsWithoutPricingWithCat = await prisma.product.count({
    where: {
      xmlSourceId: { not: null, notIn: Array.from(ruleXmlIds) },
      status: { not: 'DELETED' },
      categoryId: { not: null },
    },
  });
  console.log('Of those, with categoryId:', productsWithoutPricingWithCat);

  // Now: the real missingFieldsService scan - simulate it exactly
  // It uses categoryMatch=true, brandMatch=true, templateMatch=true, then evaluates gate
  const mfCandidates = await prisma.product.findMany({
    where: {
      status: { notIn: ['ACTIVE', 'SENDING', 'DELETED'] },
      xmlSourceId: { not: null },
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      OR: [{ variantMatch: false }, { variantStatus: { not: 'NOT_REQUIRED' } }],
    },
    select: {
      id: true,
      title: true,
      categoryId: true,
      xmlSourceId: true,
      salePrice: true,
      brand: { select: { externalId: true } },
      variants: { select: { id: true } },
    },
    take: 3000,
  });
  console.log('\nMF scan candidates count:', mfCandidates.length);

  // Now evaluate each through DB-only gate
  const catMappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: mpId, active: true },
    select: { categoryId: true, externalId: true },
    orderBy: { createdAt: 'desc' },
  });
  const catExtMap = new Map<string, number>();
  for (const cm of catMappings) {
    if (!cm.categoryId || catExtMap.has(cm.categoryId)) continue;
    const n = Number(cm.externalId);
    if (Number.isInteger(n) && n > 0) catExtMap.set(cm.categoryId, n);
  }

  let gate1Fail = 0, gate2Fail = 0, gate3Fail = 0, gate4Fail = 0, gate5Fail = 0, passAll = 0;
  let tpaMissing = 0, tpaPresent = 0;

  const tpaProducts = await prisma.trendyolProductAttribute.groupBy({
    by: ['productId'],
    where: { marketplaceKey: 'tt' },
    _count: { id: true },
  });
  const tpaSet = new Set(tpaProducts.map(t => t.productId));

  for (const p of mfCandidates) {
    // Gate 1
    if (!p.categoryId || !catExtMap.has(p.categoryId)) { gate1Fail++; continue; }
    // Gate 2
    const brandExt = Number(p.brand?.externalId);
    if (!Number.isInteger(brandExt) || brandExt <= 0) { gate2Fail++; continue; }
    // Gate 3 (DB proxy)
    if (!tpaSet.has(p.id)) { gate3Fail++; tpaMissing++; continue; }
    tpaPresent++;
    // Gate 4
    // We know there's 1 general template, so all pass
    // Gate 5
    const price = p.salePrice;
    if (!price || !Number.isFinite(price) || price <= 0) { gate5Fail++; continue; }
    const applicable = prRules.filter(r => r.xmlSourceId === null || r.xmlSourceId === p.xmlSourceId);
    const matches = applicable.filter(r => {
      const inLower = price >= r.minPrice;
      const inUpper = r.maxPrice === 0 || price <= r.maxPrice;
      return inLower && inUpper;
    });
    if (matches.length === 0) { gate5Fail++; continue; }
    passAll++;
  }

  console.log('\nGate results for MF candidates:');
  console.log('  Gate 1 (Category) FAIL:', gate1Fail);
  console.log('  Gate 2 (Brand) FAIL:', gate2Fail);
  console.log('  Gate 3 (Variant) FAIL:', gate3Fail, '(TPA missing:', tpaMissing, '/ TPA present but API would block:', 0, ')');
  console.log('  Gate 4 (Listing) FAIL:', gate4Fail);
  console.log('  Gate 5 (Price) FAIL:', gate5Fail);
  console.log('  All gates PASS:', passAll);

  // Products with categoryId=null but categoryMatch=true (DATA INTEGRITY ISSUE)
  const catMatchTrueNoCatId = await prisma.product.count({
    where: {
      xmlSourceId: { not: null },
      status: { not: 'DELETED' },
      categoryMatch: true,
      categoryId: null,
    },
  });
  console.log('\nDATA INTEGRITY: categoryMatch=true but categoryId=null:', catMatchTrueNoCatId);

  // Products with variantMatch=false
  const variantMatchFalse = await prisma.product.count({
    where: {
      xmlSourceId: { not: null },
      status: { not: 'DELETED' },
      variantMatch: false,
    },
  });
  console.log('Products with variantMatch=false:', variantMatchFalse);

  // How many of 728 (no categoryId) have categoryMatch=true?
  const noCatButMatched = await prisma.product.findMany({
    where: {
      xmlSourceId: { not: null },
      status: { not: 'DELETED' },
      categoryId: null,
    },
    select: { id: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true },
    take: 5,
  });
  console.log('\nSample products with no categoryId:', JSON.stringify(noCatButMatched, null, 2));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
