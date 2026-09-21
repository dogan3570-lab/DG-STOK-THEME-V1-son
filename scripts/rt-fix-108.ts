// scripts/rt-fix-108.ts
// STEP 1: Add pricing rule for salePrice > 20000
// STEP 2: Run autoResolveMissingFields for 87 attribute products
// STEP 3: Verify all 108 products pass gates
//STEP 4: Full gate retest

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

const TT_XML_SOURCE = '2fe5e126-3e1e-43a6-9b28-b77826300688';

const PRICE_BLOCKED_IDS = [
  '49d591b9-d1b9-4eb2-a739-40d798d0669a','cbecc681-8e6b-45ad-a199-14df00da63e7',
  '429f6352-7277-4f32-a718-7c2777c26312','a176dbc7-95c1-477a-b132-e59e2a0b7df9',
  '01f127bd-2052-4b75-b62e-33f4fb4f3064','831719f8-dd75-4a1a-b1a9-b2a999f01f7c',
  '69ffa09d-fbe0-4514-8811-56aefbb25fa1','567354a4-677b-4414-b230-bf248555c2a1',
  '65440352-fa8a-4185-96a4-8614fee8e510','614dbe13-4100-4b88-b479-ab4aeb3cae9f',
  '870c5be4-6fe9-47fa-a4e8-5b9b26d66c0e','a9b863a8-e8bc-4cf0-822d-f08f9a08e13b',
  '8496f336-ce42-40de-80c4-df055d3275d5','c1034ed5-ec09-4cf3-9521-7b308d7e14a9',
  'c4e810c3-d766-42f0-9a53-0bf6f167b3d6','271ddbec-5cd7-41b4-a037-ad6319448bb1',
  '34743225-d4f6-4cce-97ec-7edba203ae03','11bb31b0-5d2d-460a-837a-938d6e4a21c7',
  'd455aab4-ca3a-49dc-9a75-97d4a4555bc4','a79fdd5c-b171-4c36-af00-97f77dccf449',
  '71c465ba-6bde-4f7b-b51a-d3db99da9ac5',
];

const ATTR_BLOCKED_IDS = [
  '94931112-1287-4376-8c9e-fdda2ee4e860','1cea01f3-a7ea-4f1e-a1be-98dd2e0e7cd5',
  'd104b3c3-6e14-4541-9911-015ee37450cf','2755030d-fb07-45ba-87e1-cafa90a1449b',
  'f2667457-b621-4b5e-8449-d458c83d7d52','ee2be0a0-3fe9-4ab2-8bcc-c5b4e0be9b4e',
  'cb6c2091-287d-4ea7-81e5-36f423398137','711881d8-ecca-4794-817b-10b5532c3cca',
  '53a7bedc-2f3e-4393-9807-83d23f00a264','670e7314-e327-48f8-a47a-627f91af06b6',
  '04eaa732-d4a8-452d-b639-50aa9a7b210f','ad290261-5ed6-4208-b52b-f3a1c43486b5',
  'b5e61b3c-7513-455a-ab24-17da48fca9ba','4f9fd098-1f7e-4e8c-9361-d3e4d86aa3a7',
  'a30a68a4-fe13-4511-901a-08f320c0649f','6a21b88b-1786-4411-a873-02274c7b1eac',
  '517606b9-fb5e-41ae-bb4f-10bb420e072c','e47331c6-1a53-49ce-a36d-5cc1c6d0e2b8',
  'e2f68948-1c75-428b-9a38-07a398f01c4b','4352bb73-ea90-4e96-b691-183df2db8c62',
  '381eaadd-e64b-480f-893e-6f2de918acc0','2e9c50fe-4ea1-412f-b713-32f25677f02e',
  '318ab7a9-c7dc-468a-813f-deb2907edbe7','74dfb062-e815-401e-afa5-39987c5b4a62',
  'd331036d-9a8f-46d6-9c47-115d3dc3a5ef','0f509864-653f-4801-994f-d995ca0ff653',
  'fdcf5acb-d213-4b07-848a-99d689222b54','f919200f-5ed4-4170-8e36-a58412628c69',
  '00861890-75c4-4f2e-ad43-91d9d01a891d','f4165230-d026-4982-a10f-ef1fbff102ea',
  'c8add7d7-6a3e-4d03-97d6-ab24ee4dd079','bb019714-e351-4bfc-9f9a-c30f4cb7415d',
  '47dc5758-9d4b-4f0d-9587-7a92ee87c973','f24a0957-ff29-4677-a750-546184ea408a',
  'eeb5bfa6-6420-4a38-8d11-3158b8720a0e','66f66e26-b4c2-4694-955e-465eb14ff300',
  '801ebcd6-1322-4b08-933e-5aa7325f4aa4','16c2e52e-c6c8-4fb8-97cc-90f2c78dedbc',
  '30163dd8-ccfe-4fd0-9614-7a7686d09ba2','1b50cf4e-3142-44ae-8562-86fee0596d35',
  'ff6bc2ce-e1ce-4254-aa0f-c45bfa1880be','d785911e-dcbd-4927-90c0-553c98845802',
  'e259ff35-f80c-49fc-9f61-40a81f26f77e','95fc1009-fd71-4e5e-bbb9-37e70acc1810',
  '73008f27-e14b-44ca-a8a0-5a811f791c49','b71b0ff2-59ae-4744-a7e5-49eb9e61d46e',
  '58e6a257-48a2-46e3-afaa-52a73893f26e','69cd2c4b-d8a7-4097-a6a4-d52bb34cc5f2',
  '64c72b8c-d8e4-4d83-bc8b-db98b748d8f7','58a38a2c-a314-488c-a4ab-334709b8df89',
  '23f0b341-8b9d-462a-9fc3-72461a817bb7','a888911f-f3e2-46cb-bdae-7bd8e59e9f28',
  '7715fe66-3f6a-4cc5-a225-97a8ddc41ee7','3284de9a-db39-419c-9241-5c3eb064ce77',
  '9df6510d-8750-4138-aa37-0e99a15ec068','fd7bd9bc-5e67-4310-a322-5aa5dc4f5437',
  '8bcc1429-08d9-4cc9-ba00-8e3e812792a8','aeae7507-24e1-4f44-b282-08d33cab2741',
  '6f16f01f-d894-43ba-bb48-5cbd024c9cf1','7ef22123-7aae-46e0-b9a0-c917bc012fd3',
  '3e157316-8abf-479e-afe1-3f991bd075b2','5ac73227-8aa2-4e0e-ace9-7cb316e5c99a',
  '42c12366-493d-4502-8652-dd375f106224','4a95c1c7-4edc-4169-a293-4daf8c75fa54',
  '31e2118f-650b-4dc7-9071-1d125a2a1e29','df3a553f-16c5-44d5-8301-aa277274fca0',
  'f90b51ae-850a-428c-b9a3-57329f5dd6ed','ada0a4cb-d9be-493e-8ee8-7b0832929f40',
  '9233bb5f-b0ba-4b7a-a014-cf4c899913d7','0d5c993a-c483-4a88-bdce-7f5b16cd77fa',
  'a081b629-4a27-4471-935a-c98a17d29ca6','6e8439c3-5fea-4b34-83b4-94ea1ddb7c9c',
  '6116041c-3692-4dd1-8939-4d49a281b574','803067a3-c191-40b6-8312-070b27f27c71',
  '7eca9696-33e3-46f7-a788-cdefb1a90045','7d0279ff-a2e8-4a04-b796-715dfe0e8232',
  '30acbbe5-b52e-4e25-9f74-64aaf13bb8f9','2b64db8f-4231-4466-8edd-07693ad012b0',
  '89c28f6c-4fab-44fa-87e2-208028ae7d31','c0c98f29-f0e7-4984-bb42-e2d05b47dcbf',
  '9f80f4e5-ce6f-43a9-9904-d75fd15eaafa','54b2da99-59f9-4f39-9347-ff0565ee1ff1',
  'cbe538cb-5cce-4c84-a718-825cb667e759','ccfcda69-f0e8-4c4d-9e88-a8adf37a6474',
  '9de25a3b-a9e3-4c7f-8424-e6afe4e929f7','db20d707-8940-4703-ab5d-c293291ae665',
  'da69eeac-7844-4448-a144-c8682c20d747',
];

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const result: Record<string, unknown> = {};

  // ═══════════════════════════════════════════════════════════
  // PHASE 0: BEFORE snapshot
  // ═══════════════════════════════════════════════════════════
  const beforeRules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: MP, active: true },
    select: { id: true, minPrice: true, maxPrice: true },
    orderBy: { minPrice: 'asc' },
  });
  result['before_rules'] = beforeRules;

  const beforeTpaCount = await prisma.trendyolProductAttribute.count({ where: { marketplaceKey: 'tt' } });
  result['before_tpa_count'] = beforeTpaCount;

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: Add pricing rule for > 20000
  // ═══════════════════════════════════════════════════════════
  console.error('Phase 1: Adding pricing rule...');

  // Check if rule already exists
  const existing = await prisma.marketplacePricingRule.findFirst({
    where: {
      marketplaceId: MP,
      active: true,
      minPrice: 20001,
      xmlSourceId: TT_XML_SOURCE,
    },
  });

  let newRule;
  if (existing) {
    console.error('Rule already exists, skipping insert');
    newRule = existing;
  } else {
    newRule = await prisma.marketplacePricingRule.create({
      data: {
        marketplaceId: MP,
        xmlSourceId: TT_XML_SOURCE,
        minPrice: 20001,
        maxPrice: 0,  // 0 = unbounded (verified in listingPriceResolver.ts:115)
        profitMargin: 75,
        fixedAmount: 175.96,
        rounding: 'none',
        applyVat: true,
        active: true,
        priority: 3,
      },
    });
    console.error(`Created pricing rule: ${newRule.id}`);
  }
  result['new_rule'] = { id: newRule.id, min: newRule.minPrice, max: newRule.maxPrice, margin: newRule.profitMargin, fixed: newRule.fixedAmount };

  // ═══════════════════════════════════════════════════════════
  // PHASE 1-VERIFY: Check 21 products match new rule
  // ═══════════════════════════════════════════════════════════
  console.error('Phase 1-Verify: Checking 21 price products...');

  const allRules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: MP, active: true, OR: [{ xmlSourceId: TT_XML_SOURCE }, { xmlSourceId: null }] },
    orderBy: { minPrice: 'asc' },
  });

  const priceProducts = await prisma.product.findMany({
    where: { id: { in: PRICE_BLOCKED_IDS } },
    select: { id: true, salePrice: true, xmlSourceId: true },
  });

  const priceVerify: Array<{ id: string; salePrice: number; matchRule: string | null; pass: boolean }> = [];
  for (const p of priceProducts) {
    const matches = allRules.filter(r => {
      const lo = p.salePrice! >= r.minPrice;
      const hi = r.maxPrice === 0 || p.salePrice! <= r.maxPrice;
      return lo && hi;
    });
    priceVerify.push({
      id: p.id,
      salePrice: p.salePrice!,
      matchRule: matches.length === 1 ? `min=${matches[0].minPrice} max=${matches[0].maxPrice}` : matches.length > 1 ? 'AMBIGUOUS' : null,
      pass: matches.length === 1,
    });
  }

  const pricePassed = priceVerify.filter(p => p.pass).length;
  const priceFailed = priceVerify.filter(p => !p.pass);
  result['price_verify'] = {
    total: priceVerify.length,
    passed: pricePassed,
    failed: priceFailed.length,
    failedDetails: priceFailed,
    allPass: pricePassed === 21,
  };
  console.error(`Price verify: ${pricePassed}/21 passed`);

  if (pricePassed !== 21) {
    console.error('FATAL: Not all 21 price products pass. ABORTING.');
    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: autoResolveMissingFields for 87 attribute products
  // ═══════════════════════════════════════════════════════════
  console.error('Phase 2: Running autoResolve for 87 attribute products...');

  // Import the service dynamically
  const { autoResolveMissingFields, invalidateMissingFieldsCache } = await import('../server/src/services/missingFieldsService.js');

  // First, invalidate cache to ensure fresh data
  invalidateMissingFieldsCache();

  // Run auto-resolve — this calls proposeForProduct which uses AI + deterministic matching
  // It only writes to TrendyolProductAttribute (TPA) — does NOT change product/title/brand/category/price/stock
  const autoResult = await autoResolveMissingFields({
    useAI: true,
    maxProducts: 87,
    batchSize: 10,
    waitMs: 1500,
  });

  result['auto_resolve'] = {
    processed: autoResult.processed,
    deterministic: autoResult.deterministic,
    ai: autoResult.ai,
    unresolved: autoResult.unresolved,
    rejected: autoResult.rejected,
    errors: autoResult.errors,
    remainingProducts: autoResult.remainingProducts,
    remainingMissing: autoResult.remainingMissing,
    lastAt: new Date(autoResult.lastAt).toISOString(),
  };
  console.error(`Auto-resolve: processed=${autoResult.processed}, det=${autoResult.deterministic}, ai=${autoResult.ai}, unresolved=${autoResult.unresolved}`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 2-VERIFY: Check TPA records for 87 products
  // ═══════════════════════════════════════════════════════════
  console.error('Phase 2-Verify: Checking TPA records...');

  const afterTpaCount = await prisma.trendyolProductAttribute.count({ where: { marketplaceKey: 'tt' } });
  result['after_tpa_count'] = afterTpaCount;
  result['tpa_new_rows'] = afterTpaCount - beforeTpaCount;

  // Check each of 87 products
  const tpaCheck = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt', productId: { in: ATTR_BLOCKED_IDS } },
    select: { productId: true, attributeId: true, attributeValueId: true },
  });
  const tpaByProduct = new Map<string, number>();
  for (const t of tpaCheck) {
    tpaByProduct.set(t.productId, (tpaByProduct.get(t.productId) || 0) + 1);
  }

  const attrVerify: Array<{ id: string; tpaCount: number; hasValue: boolean; pass: boolean }> = [];
  for (const id of ATTR_BLOCKED_IDS) {
    const count = tpaByProduct.get(id) || 0;
    const hasValue = tpaCheck.some(t => t.productId === id && t.attributeValueId !== null);
    attrVerify.push({ id, tpaCount: count, hasValue, pass: count > 0 });
  }

  const attrPassed = attrVerify.filter(a => a.pass).length;
  const attrFailed = attrVerify.filter(a => !a.pass);
  result['attr_verify'] = {
    total: attrVerify.length,
    passed: attrPassed,
    failed: attrFailed.length,
    failedIds: attrFailed.map(a => a.id),
    allPass: attrPassed === 87,
  };
  console.error(`Attr verify: ${attrPassed}/87 passed`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: Full gate retest (DB-only, same as rt-blocked-verify-108.ts)
  // ═══════════════════════════════════════════════════════════
  console.error('Phase 3: Full gate retest...');

  function parsePositiveInt(v: string | null | undefined): number | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

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

  const tpls = await prisma.listingTemplate.findMany({
    where: { marketplaceId: MP, active: true },
    select: { productId: true, categoryId: true, brandId: true },
  });
  const prodTpls = new Set(tpls.filter(t => t.productId).map(t => t.productId));
  const catTpls = new Set(tpls.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneral = tpls.some(t => !t.productId && !t.categoryId && !t.brandId);

  // Reload TPA after auto-resolve
  const tpaAfter = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { productId: true, attributeId: true },
  });
  const tpaSetAfter = new Map<string, Set<number>>();
  for (const r of tpaAfter) {
    if (!tpaSetAfter.has(r.productId)) tpaSetAfter.set(r.productId, new Set());
    tpaSetAfter.get(r.productId)!.add(r.attributeId);
  }

  const allP = await prisma.product.findMany({
    where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: {
      id: true, categoryId: true, salePrice: true, xmlSourceId: true,
      brand: { select: { externalId: true } },
      variants: { select: { id: true } },
    },
  });

  let readyNow = 0, blockedNow = 0;
  const blockedByCode: Record<string, number> = {};
  const blockedIds = new Set<string>();
  const readyIds = new Set<string>();

  for (const p of allP) {
    let firstFailure: string | null = null;

    // Gate 1
    if (!p.categoryId || !catExtMap.has(p.categoryId)) {
      firstFailure = 'CATEGORY_MAPPING_NOT_FOUND';
    }
    // Gate 2
    else {
      const bExt = parsePositiveInt(p.brand?.externalId);
      if (!bExt) firstFailure = 'BRAND_MAPPING_NOT_FOUND';
    }
    // Gate 3
    if (!firstFailure) {
      const tpa = tpaSetAfter.get(p.id) || new Set();
      if (p.variants.length > 0 || tpa.size === 0) {
        if (tpa.size === 0) firstFailure = 'REQUIRED_ATTRIBUTE_MISSING';
      }
    }
    // Gate 4
    if (!firstFailure) {
      if (!prodTpls.has(p.id) && !(p.categoryId && catTpls.has(p.categoryId)) && !hasGeneral) {
        firstFailure = 'TEMPLATE_NOT_FOUND';
      }
    }
    // Gate 5
    if (!firstFailure) {
      if (p.salePrice == null || !Number.isFinite(p.salePrice) || p.salePrice <= 0) {
        firstFailure = 'PRICE_DATA_MISSING';
      } else {
        const applicable = allRules.filter(r => r.xmlSourceId === null || r.xmlSourceId === p.xmlSourceId);
        const matches = applicable.filter(r => {
          const lo = p.salePrice! >= r.minPrice;
          const hi = r.maxPrice === 0 || p.salePrice! <= r.maxPrice;
          return lo && hi;
        });
        if (matches.length === 0) firstFailure = 'PRICE_RULE_NOT_FOUND';
        else if (matches.length > 1) firstFailure = 'PRICE_RULE_AMBIGUOUS';
      }
    }

    if (firstFailure) {
      blockedNow++;
      blockedIds.add(p.id);
      blockedByCode[firstFailure] = (blockedByCode[firstFailure] || 0) + 1;
    } else {
      readyNow++;
      readyIds.add(p.id);
    }
  }

  result['retest'] = {
    totalProducts: allP.length,
    readyNow,
    blockedNow,
    checksum: readyNow + blockedNow,
    checksumPass: readyNow + blockedNow === allP.length,
    blockedByCode,
  };

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: Cross-check 108 specific products
  // ═══════════════════════════════════════════════════════════
  const all108 = [...PRICE_BLOCKED_IDS, ...ATTR_BLOCKED_IDS];
  const all108Set = new Set(all108);
  const verify108: Array<{ id: string; group: string; beforeBlocker: string; nowPass: boolean }> = [];

  for (const id of PRICE_BLOCKED_IDS) {
    verify108.push({ id, group: 'PRICE', beforeBlocker: 'PRICE_RULE_NOT_FOUND', nowPass: readyIds.has(id) });
  }
  for (const id of ATTR_BLOCKED_IDS) {
    verify108.push({ id, group: 'ATTRIBUTE', beforeBlocker: 'REQUIRED_ATTRIBUTE_MISSING', nowPass: readyIds.has(id) });
  }

  const opened108 = verify108.filter(v => v.nowPass).length;
  const stillBlocked108 = verify108.filter(v => !v.nowPass);
  result['verify_108'] = {
    total: verify108.length,
    uniqueIds: all108Set.size,
    opened: opened108,
    stillBlocked: stillBlocked108.length,
    stillBlockedDetails: stillBlocked108,
    allOpened: opened108 === 108,
  };

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  result['summary'] = {
    before: { ready: 2353, blocked: 836, total: 3189 },
    after: { ready: readyNow, blocked: blockedNow, total: allP.length },
    opened: readyNow - 2353,
    priceOpened: PRICE_BLOCKED_IDS.filter(id => readyIds.has(id)).length,
    attrOpened: ATTR_BLOCKED_IDS.filter(id => readyIds.has(id)).length,
    categoryUnchanged: blockedByCode['CATEGORY_MAPPING_NOT_FOUND'] || 0,
    categoryBefore: 728,
    categoryAfterSame: (blockedByCode['CATEGORY_MAPPING_NOT_FOUND'] || 0) === 728,
  };

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
