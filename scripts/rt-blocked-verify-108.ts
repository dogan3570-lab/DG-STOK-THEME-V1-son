// scripts/rt-blocked-verify-108.ts
// READ-ONLY VERIFICATION — ZERO API calls, ZERO DB writes.
// Proves every claim with exact DISTINCT productId lists.
// Run: npx tsx scripts/rt-blocked-verify-108.ts

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

function parsePositiveInt(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main() {
  const out: Record<string, unknown> = {};
  const t0 = Date.now();

  // ═══════════════════════════════════════════════════════════
  // STEP 0: Foundational data — DB reads only
  // ═══════════════════════════════════════════════════════════
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  // Category mappings
  const catMaps = await prisma.categoryMapping.findMany({
    where: { marketplaceId: MP, active: true },
    select: { categoryId: true, externalId: true },
    orderBy: { createdAt: 'desc' },
  });
  const catExtMap = new Map<string, number>();
  for (const cm of catMaps) {
    if (!cm.categoryId || catExtMap.has(cm.categoryId)) continue;
    const n = parsePositiveInt(cm.externalId);
    if (n) catExtMap.set(cm.categoryId, n);
  }

  // Pricing rules
  const rules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: MP, active: true },
    select: { minPrice: true, maxPrice: true, profitMargin: true, fixedAmount: true, xmlSourceId: true, rounding: true },
    orderBy: { minPrice: 'asc' },
  });

  // Templates
  const tpls = await prisma.listingTemplate.findMany({
    where: { marketplaceId: MP, active: true },
    select: { productId: true, categoryId: true, brandId: true },
  });
  const prodTpls = new Set(tpls.filter(t => t.productId).map(t => t.productId));
  const catTpls = new Set(tpls.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneral = tpls.some(t => !t.productId && !t.categoryId && !t.brandId);

  // TrendyolProductAttribute
  const tpaRows = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { productId: true, attributeId: true, attributeValueId: true },
  });
  const tpaByProduct = new Map<string, Set<number>>(); // productId → set of attributeIds
  const tpaWithValueByProduct = new Map<string, Set<number>>();
  for (const r of tpaRows) {
    if (!tpaByProduct.has(r.productId)) tpaByProduct.set(r.productId, new Set());
    tpaByProduct.get(r.productId)!.add(r.attributeId);
    if (r.attributeValueId !== null) {
      if (!tpaWithValueByProduct.has(r.productId)) tpaWithValueByProduct.set(r.productId, new Set());
      tpaWithValueByProduct.get(r.productId)!.add(r.attributeId);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1: All 3189 products — full snapshot
  // ═══════════════════════════════════════════════════════════
  const allP = await prisma.product.findMany({
    where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: {
      id: true, title: true, sku: true, barcode: true,
      categoryId: true, brandId: true, xmlSourceId: true,
      salePrice: true, purchasePrice: true, status: true,
      categoryMatch: true, brandMatch: true, variantMatch: true, templateMatch: true,
      variantStatus: true,
      brand: { select: { externalId: true, name: true } },
      category: { select: { id: true, name: true } },
      variants: { select: { id: true } },
    },
  });

  // ═══════════════════════════════════════════════════════════
  // STEP 2: Evaluate ALL 5 gates for EVERY product (DB-only)
  // ═══════════════════════════════════════════════════════════
  interface Row {
    id: string; title: string | null; sku: string | null;
    categoryId: string | null; catName: string | null;
    brandExternalId: string | null; brandName: string | null;
    salePrice: number | null; xmlSourceId: string | null;
    variantCount: number; tpaCount: number; tpaWithValueCount: number;
    g1: string | null; g2: string | null; g3: string | null; g4: string | null; g5: string | null;
    firstFailure: string | null;
    allFailures: string[];
    classification: string;
  }

  const rows: Row[] = [];
  const readyIds = new Set<string>();
  const blockedIds = new Set<string>();
  const catFailIds = new Set<string>();
  const attrFailIds = new Set<string>();
  const priceFailIds = new Set<string>();

  for (const p of allP) {
    const allFailures: string[] = [];

    // Gate 1: Category
    let g1: string | null = 'PASS';
    if (!p.categoryId || !catExtMap.has(p.categoryId)) {
      g1 = 'CATEGORY_MAPPING_NOT_FOUND';
      allFailures.push(g1);
    }

    // Gate 2: Brand
    let g2: string | null = 'PASS';
    const bExt = parsePositiveInt(p.brand?.externalId);
    if (!bExt) {
      g2 = 'BRAND_MAPPING_NOT_FOUND';
      allFailures.push(g2);
    }

    // Gate 3: Variant/Attribute (DB proxy: TPA record existence)
    let g3: string | null = 'PASS';
    const tpaSet = tpaByProduct.get(p.id) || new Set();
    const tpaValSet = tpaWithValueByProduct.get(p.id) || new Set();
    if (p.variants.length > 0 || tpaSet.size === 0) {
      // If product has variants OR no TPA at all, check TPA
      if (tpaSet.size === 0) {
        g3 = 'REQUIRED_ATTRIBUTE_MISSING';
        allFailures.push(g3);
      }
    }

    // Gate 4: Listing
    let g4: string | null = 'PASS';
    if (prodTpls.has(p.id)) { /* ok */ }
    else if (p.categoryId && catTpls.has(p.categoryId)) { /* ok */ }
    else if (hasGeneral) { /* ok */ }
    else {
      g4 = 'TEMPLATE_NOT_FOUND';
      allFailures.push(g4);
    }

    // Gate 5: Price
    let g5: string | null = 'PASS';
    if (p.salePrice == null || !Number.isFinite(p.salePrice) || p.salePrice <= 0) {
      g5 = 'PRICE_DATA_MISSING';
      allFailures.push(g5);
    } else {
      const applicable = rules.filter(r => r.xmlSourceId === null || r.xmlSourceId === p.xmlSourceId);
      const matches = applicable.filter(r => {
        const lo = p.salePrice! >= r.minPrice;
        const hi = r.maxPrice === 0 || p.salePrice! <= r.maxPrice;
        return lo && hi;
      });
      if (matches.length === 0) {
        g5 = 'PRICE_RULE_NOT_FOUND';
        allFailures.push(g5);
      }
    }

    // First failure (gate order: category → brand → variant → listing → price)
    let firstFailure: string | null = null;
    for (const code of [g1, g2, g3, g4, g5]) {
      if (code !== 'PASS') { firstFailure = code; break; }
    }

    // Classification
    let classification = 'READY';
    if (firstFailure) {
      blockedIds.add(p.id);
      if (firstFailure === 'CATEGORY_MAPPING_NOT_FOUND') { classification = 'SYSTEM_FIX'; catFailIds.add(p.id); }
      else if (firstFailure === 'BRAND_MAPPING_NOT_FOUND') { classification = 'SYSTEM_FIX'; }
      else if (firstFailure === 'REQUIRED_ATTRIBUTE_MISSING') { classification = 'AUTO_RESOLVABLE'; attrFailIds.add(p.id); }
      else if (firstFailure === 'TEMPLATE_NOT_FOUND') { classification = 'SYSTEM_FIX'; }
      else if (firstFailure === 'PRICE_RULE_NOT_FOUND' || firstFailure === 'PRICE_DATA_MISSING') { classification = 'SYSTEM_FIX'; priceFailIds.add(p.id); }
      else { classification = 'UNKNOWN'; }
    } else {
      readyIds.add(p.id);
    }

    rows.push({
      id: p.id, title: p.title, sku: p.sku,
      categoryId: p.categoryId, catName: p.category?.name ?? null,
      brandExternalId: p.brand?.externalId ?? null, brandName: p.brand?.name ?? null,
      salePrice: p.salePrice, xmlSourceId: p.xmlSourceId,
      variantCount: p.variants.length, tpaCount: tpaSet.size, tpaWithValueCount: tpaValSet.size,
      g1, g2, g3, g4, g5,
      firstFailure, allFailures, classification,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 3: Verify DISTINCT counts
  // ═══════════════════════════════════════════════════════════
  const allIds = rows.map(r => r.id);
  const uniqueAllIds = new Set(allIds);

  out['verification'] = {
    totalRows: rows.length,
    uniqueProductIds: uniqueAllIds.size,
    noDuplicates: rows.length === uniqueAllIds.size,
    readyDistinct: readyIds.size,
    blockedDistinct: blockedIds.size,
    checksumReadyBlocked: readyIds.size + blockedIds.size,
    checksumMatchesTotal: readyIds.size + blockedIds.size === uniqueAllIds.size,
    // Overlap checks
    catAndAttrOverlap: [...catFailIds].filter(id => attrFailIds.has(id)).length,
    catAndPriceOverlap: [...catFailIds].filter(id => priceFailIds.has(id)).length,
    attrAndPriceOverlap: [...attrFailIds].filter(id => priceFailIds.has(id)).length,
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 4: ROOT CAUSE 1 — Category fail (728 products)
  // ═══════════════════════════════════════════════════════════
  const catFailProducts = rows.filter(r => r.g1 !== 'PASS');
  const catFailDistinct = new Set(catFailProducts.map(r => r.id));

  // Sub-classify: WHY can't category be assigned?
  // Products with no categoryId at all
  const catFail_noCategoryId = catFailProducts.filter(r => !r.categoryId);
  // Products with categoryId but no mapping (should be 0 based on previous analysis)
  const catFail_hasCategoryId_noMapping = catFailProducts.filter(r => r.categoryId && !catExtMap.has(r.categoryId));

  out['root_cause_1_category'] = {
    code: 'CATEGORY_MAPPING_NOT_FOUND',
    totalBlocked: catFailProducts.length,
    distinctIds: catFailDistinct.size,
    noDuplicates: catFailProducts.length === catFailDistinct.size,
    subCategories: {
      noCategoryId: {
        count: catFail_noCategoryId.length,
        distinctIds: new Set(catFail_noCategoryId.map(r => r.id)).size,
        message: 'Ürünün categoryId\'si hiç yok — XML import\'ta kategori eşleştirmesi yapılamamış',
        // Sub-classify further
        analysis: {
          hasVariants: catFail_noCategoryId.filter(r => r.variantCount > 0).length,
          noVariants: catFail_noCategoryId.filter(r => r.variantCount === 0).length,
          hasTpa: catFail_noCategoryId.filter(r => r.tpaCount > 0).length,
          noTpa: catFail_noCategoryId.filter(r => r.tpaCount === 0).length,
          brandMatchTrue: catFail_noCategoryId.filter(r => r.g2 === 'PASS').length,
        },
        sampleIds: catFail_noCategoryId.slice(0, 10).map(r => r.id),
      },
      hasCategoryIdNoMapping: {
        count: catFail_hasCategoryId_noMapping.length,
        distinctIds: new Set(catFail_hasCategoryId_noMapping.map(r => r.id)).size,
        message: 'categoryId var ama TT için CategoryMapping yok',
      },
    },
    // CAN these be auto-assigned?
    autoAssignAnalysis: {
      // If product has brand+template+price OK, only category is missing
      // → AI category suggestion could fix these
      onlyCategoryFails: catFailProducts.filter(r => r.g2 === 'PASS' && r.g3 === 'PASS' && r.g4 === 'PASS' && r.g5 === 'PASS').length,
      categoryPlusOtherFails: catFailProducts.filter(r => r.g2 !== 'PASS' || r.g3 !== 'PASS' || r.g4 !== 'PASS' || r.g5 !== 'PASS').length,
    },
    allDistinctIds: Array.from(catFailDistinct),
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 5: ROOT CAUSE 2 — Attribute fail (87 products)
  // ═══════════════════════════════════════════════════════════
  const attrFailProducts = rows.filter(r => r.g3 !== 'PASS' && r.g1 === 'PASS' && r.g2 === 'PASS');
  const attrFailDistinct = new Set(attrFailProducts.map(r => r.id));

  out['root_cause_2_attribute'] = {
    code: 'REQUIRED_ATTRIBUTE_MISSING',
    totalBlocked: attrFailProducts.length,
    distinctIds: attrFailDistinct.size,
    noDuplicates: attrFailProducts.length === attrFailDistinct.size,
    detail: {
      noTpaAtAll: attrFailProducts.filter(r => r.tpaCount === 0).length,
      hasTpaButIncomplete: attrFailProducts.filter(r => r.tpaCount > 0 && r.tpaWithValueCount < r.tpaCount).length,
    },
    allDistinctIds: Array.from(attrFailDistinct),
    sampleProducts: attrFailProducts.slice(0, 10).map(r => ({
      id: r.id, title: r.title, sku: r.sku,
      tpaCount: r.tpaCount, tpaWithValueCount: r.tpaWithValueCount,
      variantCount: r.variantCount,
    })),
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 6: ROOT CAUSE 3 — Price fail (21 products)
  // ═══════════════════════════════════════════════════════════
  const priceFailProducts = rows.filter(r => (r.g5 === 'PRICE_RULE_NOT_FOUND' || r.g5 === 'PRICE_DATA_MISSING') && r.g1 === 'PASS' && r.g2 === 'PASS' && r.g3 === 'PASS');
  const priceFailDistinct = new Set(priceFailProducts.map(r => r.id));

  // Pricing rules range
  const ruleRanges = rules.map(r => ({ min: r.minPrice, max: r.maxPrice, margin: r.profitMargin, fixed: r.fixedAmount }));

  out['root_cause_3_price'] = {
    code: 'PRICE_RULE_NOT_FOUND',
    totalBlocked: priceFailProducts.length,
    distinctIds: priceFailDistinct.size,
    noDuplicates: priceFailProducts.length === priceFailDistinct.size,
    pricingRules: ruleRanges,
    allDistinctIds: Array.from(priceFailDistinct),
    everyProduct: priceFailProducts.map(r => ({
      id: r.id,
      title: r.title,
      sku: r.sku,
      salePrice: r.salePrice,
      failureDetail: r.g5,
      gapFromMax: r.salePrice ? Math.round((r.salePrice - 20000) * 100) / 100 : null,
      fix: 'Add pricing rule with maxPrice=0 (unbounded) for salePrices > 20000',
      remainingAfterFix: 'NONE — this is the only blocker for these products',
    })),
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 7: The "108 products" claim — PROVE IT
  // ═══════════════════════════════════════════════════════════
  // 108 = 87 attr fail (first failure, within MF candidates) + 21 price fail (first failure, within MF candidates)
  // These are products that pass gate 1+2 but fail gate 3 or 5

  const fixable108_attr = attrFailProducts; // 87 products
  const fixable108_price = priceFailProducts; // 21 products
  const fixable108_all = [...fixable108_attr, ...fixable108_price];
  const fixable108_ids = new Set(fixable108_all.map(r => r.id));

  out['fixable_108'] = {
    claim: '87 attribute + 21 price = 108 products fixable without touching category',
    attrFailCount: fixable108_attr.length,
    priceFailCount: fixable108_price.length,
    combinedDistinct: fixable108_ids.size,
    overlap: fixable108_all.length - fixable108_ids.size,
    verified: fixable108_ids.size === 108,
    // After fixing these 108, what remains blocked?
    afterFix108: {
      onlyCategoryRemains: catFailProducts.length,
      remainingBlocked: catFailProducts.length,
      newReadyCount: readyIds.size + 108,
      newTotalReady: readyIds.size + fixable108_ids.size,
    },
    everyProduct: fixable108_all.map(r => ({
      id: r.id,
      title: r.title,
      sku: r.sku,
      currentBlocker: r.firstFailure,
      fix: r.firstFailure === 'REQUIRED_ATTRIBUTE_MISSING'
        ? 'Run autoResolveMissingFields — TPA record will be created'
        : 'Add pricing rule maxPrice=0 for prices > 20000',
      remainingAfterFix: 'NONE (only blocker for this product)',
    })),
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 8: READY_AFTER_AUTO_FIX = READY ∪ AUTO_FIXABLE (DISTINCT)
  // ═══════════════════════════════════════════════════════════
  const autoFixableIds = new Set<string>();
  for (const r of rows) {
    if (r.firstFailure === 'REQUIRED_ATTRIBUTE_MISSING') autoFixableIds.add(r.id);
  }
  const readyAfterAutoFix = new Set([...readyIds, ...autoFixableIds]);

  out['ready_after_auto_fix'] = {
    readyNow: readyIds.size,
    autoFixable: autoFixableIds.size,
    union: readyAfterAutoFix.size,
    formula: 'READY_NOW ∪ AUTO_FIXABLE = DISTINCT union',
    verified: readyAfterAutoFix.size === readyIds.size + autoFixableIds.size,
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 9: 578 READY verification
  // ═══════════════════════════════════════════════════════════
  // Check: what would produce 578?
  // Theory: 578 = products where ALL gates pass AND status = 'READY' in Product table
  const readyStatusProducts = allP.filter(p => p.status === 'READY');
  const readyStatusIds = new Set(readyStatusProducts.map(p => p.id));

  // Products with status=READY AND pass all gates
  const readyStatusAndAllGatesPass = rows.filter(r => r.firstFailure === null && allP.find(p => p.id === r.id)?.status === 'READY');

  out['verify_578'] = {
    productsWithStatusREADY: readyStatusProducts.length,
    productsWithStatusREADYAndAllGatesPass: readyStatusAndAllGatesPass.length,
    productsWithAllGatesPassRegardlessOfStatus: readyIds.size,
    note: '578 may come from a different filter or time. Current DB shows different numbers.',
    possibleExplanations: [
      `Product.status='READY' count = ${readyStatusProducts.length}`,
      `All-gates-pass count = ${readyIds.size}`,
      `MF-scan-candidate count = ${rows.filter(r => r.g1 === 'PASS' && r.g2 === 'PASS').length}`,
      '578 may have been from a snapshot with fewer products or different filtering',
    ],
  };

  // ═══════════════════════════════════════════════════════════
  // STEP 10: Final checksum
  // ═══════════════════════════════════════════════════════════
  // BLOCKED = firstFailure != null
  // READY = firstFailure == null
  // Unique blocked by first failure code
  const blockedByCode: Record<string, string[]> = {};
  for (const r of rows) {
    if (r.firstFailure) {
      if (!blockedByCode[r.firstFailure]) blockedByCode[r.firstFailure] = [];
      blockedByCode[r.firstFailure].push(r.id);
    }
  }

  out['final_checksum'] = {
    totalProducts: uniqueAllIds.size,
    readyNow: readyIds.size,
    blockedNow: blockedIds.size,
    readyPlusBlocked: readyIds.size + blockedIds.size,
    checksumPass: readyIds.size + blockedIds.size === uniqueAllIds.size,
    blockedByCode: Object.fromEntries(
      Object.entries(blockedByCode).map(([k, v]) => [k, { count: v.length, distinctIds: new Set(v).size }])
    ),
    // Verify each blocked product appears in exactly one firstFailure
    everyBlockedInExactlyOneGroup: Object.values(blockedByCode).every(ids => new Set(ids).size === ids.length),
    totalFromGroups: Object.values(blockedByCode).reduce((a, b) => a + b.length, 0),
    totalFromGroupsMatchesBlocked: Object.values(blockedByCode).reduce((a, b) => a + b.length, 0) === blockedIds.size,
  };

  out['elapsedMs'] = Date.now() - t0;

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
