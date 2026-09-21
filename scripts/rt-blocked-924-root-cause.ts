// scripts/rt-blocked-924-root-cause.ts
// READ-ONLY ROOT CAUSE ANALYSIS — ZERO external API calls.
// Uses ONLY SQLite/Prisma queries to evaluate all 5 gate steps.
// Run: npx tsx scripts/rt-blocked-924-root-cause.ts
// Output: JSON on stdout. No DB writes, no file writes, no API calls, no Git.

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';

const prisma = new PrismaClient();

function parsePositiveInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

interface GateResult {
  status: 'PASS' | 'FAIL';
  reasonCode: string | null;
  reasonMessage: string | null;
}

interface ProductGateAnalysis {
  productId: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  brandExternalId: string | null;
  xmlSourceId: string | null;
  salePrice: number | null;
  purchasePrice: number | null;
  status: string;
  variantCount: number;
  hasTrendyolAttributes: boolean;
  trendyolAttributeCount: number;
  trendyolAttributesWithValue: number;
  pmsStatus: string | null;
  allBlockerReasons: string[];
  steps: Record<string, GateResult>;
  firstFailureCode: string | null;
  classification: 'SYSTEM_FIX' | 'AUTO_RESOLVABLE' | 'USER_REQUIRED' | 'UNKNOWN' | 'READY';
}

async function main() {
  const startTime = Date.now();

  // 1️⃣ Find Trendyol marketplace
  const ttMarketplace = await prisma.marketplace.findFirst({
    where: { key: 'tt', active: true },
    select: { id: true, key: true, name: true },
  });
  if (!ttMarketplace) {
    console.error('Trendyol marketplace not found');
    process.exit(1);
  }
  const marketplaceId = ttMarketplace.id;

  // 2️⃣ Load ALL category mappings (active, for TT) — DB-only
  const categoryMappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId, active: true },
    select: { categoryId: true, externalId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const catExtMap = new Map<string, number>();
  const catExtDetailMap = new Map<string, { externalId: string; parsed: number | null }>();
  for (const cm of categoryMappings) {
    if (!cm.categoryId) continue;
    if (!catExtMap.has(cm.categoryId)) {
      const parsed = parsePositiveInt(cm.externalId);
      catExtMap.set(cm.categoryId, parsed ?? 0);
      catExtDetailMap.set(cm.categoryId, { externalId: cm.externalId ?? '', parsed });
    }
  }

  // 3️⃣ Load ALL listing templates (active, for TT) — DB-only
  const templates = await prisma.listingTemplate.findMany({
    where: { marketplaceId, active: true },
    select: { id: true, productId: true, categoryId: true, brandId: true },
  });
  const productTemplates = new Set(templates.filter(t => t.productId).map(t => t.productId));
  const categoryTemplates = new Set(templates.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneralTemplate = templates.some(t => !t.productId && !t.categoryId && !t.brandId);

  // 4️⃣ Load ALL pricing rules (active, for TT) — DB-only
  const pricingRules = await prisma.marketplacePricingRule.findMany({
    where: {
      marketplaceId,
      active: true,
      OR: [{ xmlSourceId: null }, { xmlSourceId: { not: null } }],
    },
    select: { minPrice: true, maxPrice: true, profitMargin: true, fixedAmount: true, xmlSourceId: true, rounding: true },
    orderBy: { minPrice: 'asc' },
  });

  function checkPriceGate(salePrice: number | null, xmlSourceId: string | null): GateResult {
    if (salePrice === null || salePrice === undefined || !Number.isFinite(salePrice) || salePrice <= 0) {
      return { status: 'FAIL', reasonCode: 'PRICE_DATA_MISSING', reasonMessage: 'salePrice geçersiz/null' };
    }
    const applicableRules = pricingRules.filter(r => r.xmlSourceId === null || r.xmlSourceId === xmlSourceId);
    if (applicableRules.length === 0) {
      return { status: 'FAIL', reasonCode: 'PRICE_RULE_NOT_FOUND', reasonMessage: 'Hiç fiyat kuralı yok' };
    }
    const matches = applicableRules.filter(r => {
      const inLower = salePrice >= r.minPrice;
      const inUpper = r.maxPrice === 0 || salePrice <= r.maxPrice;
      return inLower && inUpper;
    });
    if (matches.length === 0) {
      return { status: 'FAIL', reasonCode: 'PRICE_RULE_NOT_FOUND', reasonMessage: `salePrice=${salePrice} için uygun bant yok` };
    }
    if (matches.length > 1) {
      return { status: 'FAIL', reasonCode: 'PRICE_RULE_AMBIGUOUS', reasonMessage: 'Birden fazla fiyat bandı çakışıyor' };
    }
    return { status: 'PASS', reasonCode: null, reasonMessage: null };
  }

  // 5️⃣ Load ALL products with relations — FULL SNAPSHOT
  console.error('Loading all products...');
  const allProducts = await prisma.product.findMany({
    where: {
      NOT: { status: 'DELETED' },
      xmlSourceId: { not: null },
    },
    select: {
      id: true,
      title: true,
      sku: true,
      barcode: true,
      categoryId: true,
      brandId: true,
      xmlSourceId: true,
      salePrice: true,
      purchasePrice: true,
      status: true,
      categoryMatch: true,
      brandMatch: true,
      variantMatch: true,
      templateMatch: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true, externalId: true } },
      variants: { select: { id: true } },
      marketplaceStates: {
        where: { marketplaceId },
        select: { status: true, listingId: true },
      },
    },
  });
  console.error(`Total products with XML source: ${allProducts.length}`);

  // 6️⃣ Load ALL TrendyolProductAttribute records — DB-only
  const allTpa = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { productId: true, attributeId: true, attributeValueId: true, attributeValue: true },
  });
  const tpaByProduct = new Map<string, { count: number; withValue: number }>();
  for (const tpa of allTpa) {
    const existing = tpaByProduct.get(tpa.productId) || { count: 0, withValue: 0 };
    existing.count++;
    if (tpa.attributeValueId !== null) existing.withValue++;
    tpaByProduct.set(tpa.productId, existing);
  }

  // 7️⃣ Evaluate each product through all 5 gates — PURE DB
  const results: ProductGateAnalysis[] = [];
  const stats = {
    totalProducts: allProducts.length,
    readyProducts: 0,
    blockedProducts: 0,
    gate1CategoryFail: 0,
    gate2BrandFail: 0,
    gate3VariantFail: 0,
    gate4ListingFail: 0,
    gate5PriceFail: 0,
  };

  const categoryFailProducts: string[] = [];
  const brandFailProducts: string[] = [];
  const variantFailProducts: string[] = [];
  const listingFailProducts: string[] = [];
  const priceFailProducts: string[] = [];

  // Blocker groups
  const blockerGroups = new Map<string, { code: string; message: string; classification: string; count: number; productIds: string[] }>();

  for (const product of allProducts) {
    const steps: Record<string, GateResult> = {};
    const allBlockerReasons: string[] = [];

    // GATE 1: CATEGORY
    const catExt = product.categoryId ? catExtMap.get(product.categoryId) : 0;
    if (!product.categoryId || !catExt || catExt <= 0) {
      const detail = product.categoryId
        ? (catExtDetailMap.get(product.categoryId) || { externalId: 'N/A', parsed: null })
        : { externalId: 'no-category', parsed: null };
      steps.category = {
        status: 'FAIL',
        reasonCode: 'CATEGORY_MAPPING_NOT_FOUND',
        reasonMessage: !product.categoryId
          ? 'Ürünün categoryId\'si yok'
          : `CategoryMapping externalId geçersiz: "${detail.externalId}" (parsed: ${detail.parsed})`,
      };
      allBlockerReasons.push('CATEGORY_MAPPING_NOT_FOUND');
    } else {
      steps.category = { status: 'PASS', reasonCode: null, reasonMessage: null };
    }

    // GATE 2: BRAND
    const brandExtId = product.brand?.externalId ?? null;
    const brandNumericId = parsePositiveInt(brandExtId);
    if (!brandNumericId) {
      steps.brand = {
        status: 'FAIL',
        reasonCode: 'BRAND_MAPPING_NOT_FOUND',
        reasonMessage: !brandExtId
          ? 'Brand externalId yok'
          : `Brand externalId geçersiz: "${brandExtId}"`,
      };
      allBlockerReasons.push('BRAND_MAPPING_NOT_FOUND');
    } else {
      steps.brand = { status: 'PASS', reasonCode: null, reasonMessage: null };
    }

    // GATE 3: VARIANT/ATTRIBUTE (DB-only proxy)
    // Check if product has TrendyolProductAttribute records
    const tpaInfo = tpaByProduct.get(product.id) || { count: 0, withValue: 0 };
    if (product.variants.length > 0) {
      if (tpaInfo.count === 0) {
        steps.variant = {
          status: 'FAIL',
          reasonCode: 'REQUIRED_ATTRIBUTE_MISSING',
          reasonMessage: `Ürünün ${product.variants.length} varyantı var ama Trendyol attribute kaydı yok`,
        };
        allBlockerReasons.push('REQUIRED_ATTRIBUTE_MISSING');
      } else {
        steps.variant = { status: 'PASS', reasonCode: null, reasonMessage: null };
      }
    } else {
      // Varyantsız ürün — TPA kaydı gerekebilir
      if (tpaInfo.count === 0) {
        steps.variant = {
          status: 'FAIL',
          reasonCode: 'REQUIRED_ATTRIBUTE_MISSING',
          reasonMessage: 'Varyantsız ürün ama Trendyol attribute kaydı yok',
        };
        allBlockerReasons.push('REQUIRED_ATTRIBUTE_MISSING');
      } else {
        steps.variant = { status: 'PASS', reasonCode: null, reasonMessage: null };
      }
    }

    // GATE 4: LISTING TEMPLATE
    if (productTemplates.has(product.id)) {
      steps.listing = { status: 'PASS', reasonCode: null, reasonMessage: null };
    } else if (product.categoryId && categoryTemplates.has(product.categoryId)) {
      steps.listing = { status: 'PASS', reasonCode: null, reasonMessage: null };
    } else if (hasGeneralTemplate) {
      steps.listing = { status: 'PASS', reasonCode: null, reasonMessage: null };
    } else {
      steps.listing = {
        status: 'FAIL',
        reasonCode: 'TEMPLATE_NOT_FOUND',
        reasonMessage: 'Ürün/kategori/genel şablon bulunamadı',
      };
      allBlockerReasons.push('TEMPLATE_NOT_FOUND');
    }

    // GATE 5: PRICE
    const priceCheck = checkPriceGate(product.salePrice, product.xmlSourceId);
    steps.price = priceCheck;
    if (priceCheck.status === 'FAIL') {
      allBlockerReasons.push(priceCheck.reasonCode!);
    }

    // Determine first failure
    const gateOrder = ['category', 'brand', 'variant', 'listing', 'price'];
    let firstFailureCode: string | null = null;
    let firstFailureMessage: string | null = null;
    for (const gateName of gateOrder) {
      if (steps[gateName].status === 'FAIL') {
        firstFailureCode = steps[gateName].reasonCode;
        firstFailureMessage = steps[gateName].reasonMessage;
        break;
      }
    }

    // Classification
    let classification: ProductGateAnalysis['classification'] = 'READY';
    if (firstFailureCode) {
      classification = classifyBlocker(firstFailureCode, product, tpaInfo);
    }

    if (firstFailureCode) {
      stats.blockedProducts++;
      if (steps.category.status === 'FAIL') { stats.gate1CategoryFail++; categoryFailProducts.push(product.id); }
      if (steps.brand.status === 'FAIL') { stats.gate2BrandFail++; brandFailProducts.push(product.id); }
      if (steps.variant.status === 'FAIL') { stats.gate3VariantFail++; variantFailProducts.push(product.id); }
      if (steps.listing.status === 'FAIL') { stats.gate4ListingFail++; listingFailProducts.push(product.id); }
      if (steps.price.status === 'FAIL') { stats.gate5PriceFail++; priceFailProducts.push(product.id); }
    } else {
      stats.readyProducts++;
    }

    // Group by blocker code
    for (const reason of allBlockerReasons) {
      const key = reason;
      if (!blockerGroups.has(key)) {
        blockerGroups.set(key, {
          code: reason,
          message: steps[gateOrder.find(g => steps[g].reasonCode === reason) || 'category']?.reasonMessage || '',
          classification: classification,
          count: 0,
          productIds: [],
        });
      }
      const group = blockerGroups.get(key)!;
      group.count++;
      if (group.productIds.length < 5) group.productIds.push(product.id);
    }

    results.push({
      productId: product.id,
      title: product.title,
      sku: product.sku,
      barcode: product.barcode,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? null,
      brandId: product.brandId,
      brandName: product.brand?.name ?? null,
      brandExternalId: brandExtId,
      xmlSourceId: product.xmlSourceId,
      salePrice: product.salePrice,
      purchasePrice: product.purchasePrice,
      status: product.status,
      variantCount: product.variants.length,
      hasTrendyolAttributes: tpaInfo.count > 0,
      trendyolAttributeCount: tpaInfo.count,
      trendyolAttributesWithValue: tpaInfo.withValue,
      pmsStatus: product.marketplaceStates[0]?.status ?? null,
      allBlockerReasons,
      steps,
      firstFailureCode,
      classification,
    });
  }

  // 8️⃣ Compute intersection sets
  const readySet = new Set(results.filter(r => r.classification === 'READY').map(r => r.productId));
  const systemFixSet = new Set(results.filter(r => r.classification === 'SYSTEM_FIX').map(r => r.productId));
  const autoResolvableSet = new Set(results.filter(r => r.classification === 'AUTO_RESOLVABLE').map(r => r.productId));
  const userRequiredSet = new Set(results.filter(r => r.classification === 'USER_REQUIRED').map(r => r.productId));
  const unknownSet = new Set(results.filter(r => r.classification === 'UNKNOWN').map(r => r.productId));

  // READY_AFTER_AUTO_FIX = READY ∪ AUTO_FIXABLE (distinct)
  const readyAfterAutoFix = new Set([...readySet, ...autoResolvableSet]);

  // 9️⃣ Detailed breakdowns
  const byFirstFailure: Record<string, { count: number; classification: string; sampleIds: string[]; message: string }> = {};
  for (const r of results) {
    if (!r.firstFailureCode) continue;
    if (!byFirstFailure[r.firstFailureCode]) {
      byFirstFailure[r.firstFailureCode] = { count: 0, classification: r.classification, sampleIds: [], message: r.steps[Object.keys(r.steps).find(g => r.steps[g].reasonCode === r.firstFailureCode) || 'category']?.reasonMessage || '' };
    }
    byFirstFailure[r.firstFailureCode].count++;
    if (byFirstFailure[r.firstFailureCode].sampleIds.length < 10) {
      byFirstFailure[r.firstFailureCode].sampleIds.push(r.productId);
    }
  }

  // 🔟 Multi-blocker analysis (products blocked by more than one gate)
  const multiBlockerProducts = results.filter(r => r.allBlockerReasons.length > 1);

  // Category fail detail
  const categoryFailDetail: Record<string, { count: number; sampleIds: string[] }> = {};
  for (const r of results) {
    if (r.steps.category.status !== 'FAIL') continue;
    const msg = r.steps.category.reasonMessage || 'unknown';
    if (!categoryFailDetail[msg]) categoryFailDetail[msg] = { count: 0, sampleIds: [] };
    categoryFailDetail[msg].count++;
    if (categoryFailDetail[msg].sampleIds.length < 5) categoryFailDetail[msg].sampleIds.push(r.productId);
  }

  // Brand fail detail
  const brandFailDetail: Record<string, { count: number; sampleIds: string[] }> = {};
  for (const r of results) {
    if (r.steps.brand.status !== 'FAIL') continue;
    const msg = r.steps.brand.reasonMessage || 'unknown';
    if (!brandFailDetail[msg]) brandFailDetail[msg] = { count: 0, sampleIds: [] };
    brandFailDetail[msg].count++;
    if (brandFailDetail[msg].sampleIds.length < 5) brandFailDetail[msg].sampleIds.push(r.productId);
  }

  // Price fail detail
  const priceFailDetail: Record<string, { count: number; sampleIds: string[] }> = {};
  for (const r of results) {
    if (r.steps.price.status !== 'FAIL') continue;
    const msg = r.steps.price.reasonMessage || 'unknown';
    if (!priceFailDetail[msg]) priceFailDetail[msg] = { count: 0, sampleIds: [] };
    priceFailDetail[msg].count++;
    if (priceFailDetail[msg].sampleIds.length < 5) priceFailDetail[msg].sampleIds.push(r.productId);
  }

  const elapsed = Date.now() - startTime;

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      elapsedMs: elapsed,
      database: 'SQLite (READ-ONLY)',
      trendlyolApiCalls: 0,
      method: 'Pure DB gate evaluation (5 steps, zero external API)',
    },
    snapshot: {
      totalProductsWithXml: allProducts.length,
      readyNow: stats.readyProducts,
      blockedNow: stats.blockedProducts,
      checksumReadyBlocked: stats.readyProducts + stats.blockedProducts,
    },
    gateFailures: {
      gate1_category: { count: stats.gate1CategoryFail, percentage: stats.blockedProducts > 0 ? ((stats.gate1CategoryFail / stats.blockedProducts) * 100).toFixed(1) + '%' : '0%' },
      gate2_brand: { count: stats.gate2BrandFail, percentage: stats.blockedProducts > 0 ? ((stats.gate2BrandFail / stats.blockedProducts) * 100).toFixed(1) + '%' : '0%' },
      gate3_variant: { count: stats.gate3VariantFail, percentage: stats.blockedProducts > 0 ? ((stats.gate3VariantFail / stats.blockedProducts) * 100).toFixed(1) + '%' : '0%' },
      gate4_listing: { count: stats.gate4ListingFail, percentage: stats.blockedProducts > 0 ? ((stats.gate4ListingFail / stats.blockedProducts) * 100).toFixed(1) + '%' : '0%' },
      gate5_price: { count: stats.gate5PriceFail, percentage: stats.blockedProducts > 0 ? ((stats.gate5PriceFail / stats.blockedProducts) * 100).toFixed(1) + '%' : '0%' },
    },
    categoryFailDetail,
    brandFailDetail,
    priceFailDetail,
    classification: {
      READY: readySet.size,
      SYSTEM_FIX: systemFixSet.size,
      AUTO_RESOLVABLE: autoResolvableSet.size,
      USER_REQUIRED: userRequiredSet.size,
      UNKNOWN: unknownSet.size,
      READY_AFTER_AUTO_FIX: readyAfterAutoFix.size,
    },
    blockerGroups: Array.from(blockerGroups.values()).sort((a, b) => b.count - a.count),
    byFirstFailure,
    multiBlocker: {
      count: multiBlockerProducts.length,
      products: multiBlockerProducts.slice(0, 20).map(r => ({
        productId: r.productId,
        title: r.title,
        allBlockerReasons: r.allBlockerReasons,
      })),
    },
  };

  console.log(JSON.stringify(output, null, 2));
  await prisma.$disconnect();
}

function classifyBlocker(
  code: string,
  product: any,
  tpaInfo: { count: number; withValue: number }
): 'SYSTEM_FIX' | 'AUTO_RESOLVABLE' | 'USER_REQUIRED' | 'UNKNOWN' {
  switch (code) {
    case 'CATEGORY_MAPPING_NOT_FOUND':
      return 'SYSTEM_FIX'; // Kategori mapping'i oluşturulmalı
    case 'BRAND_MAPPING_NOT_FOUND':
      return 'SYSTEM_FIX'; // Marka mapping'i oluşturulmalı
    case 'REQUIRED_ATTRIBUTE_MISSING':
      return 'AUTO_RESOLVABLE'; // TrendyolProductAttribute kaydedilmeli
    case 'VARIANT_ATTRIBUTE_NOT_FOUND':
      return 'USER_REQUIRED'; // Kullanıcı attribute eşleştirmeli
    case 'TEMPLATE_NOT_FOUND':
      return 'SYSTEM_FIX'; // Şablon oluşturulmalı
    case 'PRICE_DATA_MISSING':
      return 'USER_REQUIRED'; // Satış fiyatı girilmeli
    case 'PRICE_RULE_NOT_FOUND':
      return 'SYSTEM_FIX'; // Fiyat kuralı oluşturulmalı
    case 'PRICE_RULE_AMBIGUOUS':
      return 'SYSTEM_FIX'; // Fiyat kuralı çakışması giderilmeli
    default:
      return 'UNKNOWN';
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
