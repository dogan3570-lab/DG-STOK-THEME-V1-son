// scripts/rt-diagnose-20.ts
// READ-ONLY: Calls real evaluateTrendyolSendGate for each of 20 remaining products.
// ZERO DB writes, ZERO Trendyol API bulk calls.

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.ts';
import { fetchTrendyolCategoryAttributes } from '../server/src/services/trendyolCatalog.ts';

const prisma = new PrismaClient();

const REMAINING_20 = [
  '04eaa732-d4a8-452d-b639-50aa9a7b210f',
  '4f9fd098-1f7e-4e8c-9361-d3e4d86aa3a7',
  'b71b0ff2-59ae-4744-a7e5-49eb9e61d46e',
  '58a38a2c-a314-488c-a4ab-334709b8df89',
  'a888911f-f3e2-46cb-bdae-7bd8e59e9f28',
  'fd7bd9bc-5e67-4310-a322-5aa5dc4f5437',
  '3e157316-8abf-479e-afe1-3f991bd075b2',
  '42c12366-493d-4502-8652-dd375f106224',
  '31e2118f-650b-4dc7-9071-1d125a2a1e29',
  'df3a553f-16c5-44d5-8301-aa277274fca0',
  'f90b51ae-850a-428c-b9a3-57329f5dd6ed',
  'ada0a4cb-d9be-493e-8ee8-7b0832929f40',
  '9233bb5f-b0ba-4b7a-a014-cf4c899913d7',
  '0d5c993a-c483-4a88-bdce-7f5b16cd77fa',
  'a081b629-4a27-4471-935a-c98a17d29ca6',
  '6e8439c3-5fea-4b34-83b4-94ea1ddb7c9c',
  '6116041c-3692-4dd1-8939-4d49a281b574',
  '803067a3-c191-40b6-8312-070b27f27c71',
  '9f80f4e5-ce6f-43a9-9904-d75fd15eaafa',
  'cbe538cb-5cce-4c84-a718-825cb667e759',
];

function parsePositiveInt(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('RED TEAM DIAGNOSTIC — 20 REMAINING PRODUCTS — REAL GATE vs SIMPLIFIED GATE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // ── SIMPLIFIED GATE (rt-blocked-verify-108.ts logic) ──
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

  const tpaRows = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt', productId: { in: REMAINING_20 } },
    select: { productId: true, attributeId: true },
  });
  const tpaByProduct = new Map<string, Set<number>>();
  for (const r of tpaRows) {
    if (!tpaByProduct.has(r.productId)) tpaByProduct.set(r.productId, new Set());
    tpaByProduct.get(r.productId)!.add(r.attributeId);
  }

  const tpls = await prisma.listingTemplate.findMany({
    where: { marketplaceId: MP, active: true },
    select: { productId: true, categoryId: true, brandId: true },
  });
  const prodTpls = new Set(tpls.filter(t => t.productId).map(t => t.productId));
  const catTpls = new Set(tpls.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneral = tpls.some(t => !t.productId && !t.categoryId && !t.brandId);

  const rules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: MP, active: true, OR: [{ xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688' }, { xmlSourceId: null }] },
    select: { minPrice: true, maxPrice: true },
    orderBy: { minPrice: 'asc' },
  });

  // ── RESULTS ──
  const results: Array<{
    id: string;
    shortId: string;
    title: string;
    categoryId: string | null;
    categoryExtId: number | null;
    variantCount: number;
    tpaCount: number;
    requiredAttrsTotal: number;
    requiredAttrsMissing: number;
    simplifiedBlocker: string | null;
    realGateOk: boolean;
    realGateBlockerCode: string | null;
    realGateBlockerMsg: string | null;
    gateStepResults: Record<string, string>;
  }> = [];

  let passCount = 0;
  let failCount = 0;

  for (const pid of REMAINING_20) {
    const prod = await prisma.product.findUnique({
      where: { id: pid },
      select: {
        id: true, title: true, categoryId: true, salePrice: true, xmlSourceId: true,
        brand: { select: { externalId: true } },
        variants: { select: { id: true } },
      },
    });
    if (!prod) { console.error(`PRODUCT NOT FOUND: ${pid}`); continue; }

    // ── Simplified gate blocker (rt-blocked-verify-108.ts logic) ──
    let simplifiedBlocker: string | null = null;
    if (!prod.categoryId || !catExtMap.has(prod.categoryId)) {
      simplifiedBlocker = 'CATEGORY_MAPPING_NOT_FOUND';
    } else {
      const b = prod.brand?.externalId ? Number(prod.brand.externalId) : NaN;
      if (!Number.isInteger(b) && b > 0) simplifiedBlocker = 'BRAND_MAPPING_NOT_FOUND';
    }
    if (!simplifiedBlocker) {
      const tpa = tpaByProduct.get(pid) || new Set();
      if ((prod.variants.length > 0 || tpa.size === 0) && tpa.size === 0) {
        simplifiedBlocker = 'REQUIRED_ATTRIBUTE_MISSING';
      }
    }
    if (!simplifiedBlocker && !prodTpls.has(pid) && !(prod.categoryId && catTpls.has(prod.categoryId)) && !hasGeneral) {
      simplifiedBlocker = 'TEMPLATE_NOT_FOUND';
    }
    if (!simplifiedBlocker) {
      if (prod.salePrice == null || !Number.isFinite(prod.salePrice) || prod.salePrice <= 0) {
        simplifiedBlocker = 'PRICE_DATA_MISSING';
      } else {
        const m = rules.filter(r => prod.salePrice! >= r.minPrice && (r.maxPrice === 0 || prod.salePrice! <= r.maxPrice));
        if (m.length === 0) simplifiedBlocker = 'PRICE_RULE_NOT_FOUND';
        else if (m.length > 1) simplifiedBlocker = 'PRICE_RULE_AMBIGUOUS';
      }
    }

    // ── REAL GATE (evaluateTrendyolSendGate) ──
    const gate = await evaluateTrendyolSendGate({
      productId: pid,
      marketplaceId: MP,
      xmlSourceId: prod.xmlSourceId || '',
    });

    const stepResults: Record<string, string> = {};
    for (const [step, data] of Object.entries(gate.steps)) {
      stepResults[step] = `${data.status}${data.reasonCode ? `(${data.reasonCode})` : ''}`;
    }

    // ── Required attr info from Trendyol catalog ──
    const catExtId = catExtMap.get(prod.categoryId || '') || null;
    let requiredAttrsTotal = 0;
    let requiredAttrsMissing = 0;

    if (catExtId) {
      try {
        const defs = await fetchTrendyolCategoryAttributes(catExtId);
        const required = (defs as any[]).filter(d => d.required === true);
        requiredAttrsTotal = required.length;
        // How many are missing per real gate logic?
        const persistedIds = new Set(tpaRows.filter(r => r.productId === pid).map(r => r.attributeId));
        requiredAttrsMissing = required.filter((a: any) => !persistedIds.has(a.attribute.id)).length;
      } catch (e) {
        requiredAttrsTotal = -1; // error
      }
    }

    if (gate.ok) passCount++; else failCount++;

    results.push({
      id: pid,
      shortId: pid.substring(0, 8),
      title: prod.title?.substring(0, 55) || '?',
      categoryId: prod.categoryId,
      categoryExtId: catExtId,
      variantCount: prod.variants.length,
      tpaCount: tpaByProduct.get(pid)?.size || 0,
      requiredAttrsTotal,
      requiredAttrsMissing,
      simplifiedBlocker,
      realGateOk: gate.ok,
      realGateBlockerCode: gate.firstFailureCode,
      realGateBlockerMsg: gate.firstFailureMessage?.substring(0, 100) || null,
      gateStepResults: stepResults,
    });
  }

  // ── PRINT TABLE ──
  console.log('');
  console.log('┌────┬──────────┬───────────────────────────────┬──────┬─────┬──────┬──────┬──────────────────────────┬──────────┬───────────────────────┐');
  console.log('│ #  │ ID       │ Title                         │ CatID│ Var │ TPA  │ ReqM │ Simplified Blocker       │ RealGate │ Real Blocker          │');
  console.log('├────┼──────────┼───────────────────────────────┼──────┼─────┼──────┼──────┼──────────────────────────┼──────────┼───────────────────────┤');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const simplifiedDisplay = r.simplifiedBlocker || '✅ NONE';
    const realDisplay = r.realGateOk ? '✅ PASS' : `❌ ${r.realGateBlockerCode}`;
    const mismatch = (r.simplifiedBlocker && r.realGateOk) || (!r.simplifiedBlocker && !r.realGateOk);
    const flag = mismatch ? ' ⚠️  MISMATCH' : '';

    console.log(
      `│ ${(i+1).toString().padStart(2)} │ ${r.shortId} │ ${(r.title || '').padEnd(29).substring(0,29)} │ ${(r.categoryExtId?.toString() || 'NULL').padStart(4)} │  ${(r.variantCount.toString()).padStart(2)} │  ${(r.tpaCount.toString()).padStart(3)} │  ${(r.requiredAttrsMissing.toString()).padStart(3)} │ ${simplifiedDisplay.padEnd(26)} │ ${realDisplay.padEnd(8)} │ ${(r.realGateBlockerMsg || 'N/A').padEnd(21).substring(0,21)} │${flag}`
    );
  }

  console.log('└────┴──────────┴───────────────────────────────┴──────┴─────┴──────┴──────┴──────────────────────────┴──────────┴───────────────────────┘');

  // ── SUMMARY ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Real Gate PASS: ${passCount}`);
  console.log(`Real Gate FAIL: ${failCount}`);
  console.log(`Simplified says BLOCKED: ${results.filter(r => r.simplifiedBlocker).length}`);
  console.log(`Simplified says PASS:    ${results.filter(r => !r.simplifiedBlocker).length}`);

  const mismatches = results.filter(r => (r.simplifiedBlocker && r.realGateOk) || (!r.simplifiedBlocker && !r.realGateOk));
  console.log(`MISMATCHES: ${mismatches.length}`);
  for (const m of mismatches) {
    console.log(`  ${m.shortId}: simplified="${m.simplifiedBlocker}" vs real="${m.realGateOk ? 'PASS' : m.realGateBlockerCode}"`);
    console.log(`    Category extId=${m.categoryExtId}, requiredTotal=${m.requiredAttrsTotal}, requiredMissing=${m.requiredAttrsMissing}, tpa=${m.tpaCount}, variants=${m.variantCount}`);
    console.log(`    Gate steps: ${Object.entries(m.gateStepResults).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  }

  // ── ROOT CAUSE ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ROOT CAUSE OF CLASSIFICATION ERROR');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('rt-blocked-verify-108.ts uses SIMPLIFIED gate:');
  console.log('  if (tpa.size === 0) → REQUIRED_ATTRIBUTE_MISSING');
  console.log('');
  console.log('Real gate at sendReadiness.ts uses:');
  console.log('  1. fetchTrendyolCategoryAttributes(categoryId) → get required attrs');
  console.log('  2. resolveTrendyolAttributes() → check if required attrs are covered');
  console.log('  3. If category has 0 required attrs → emptyResolution() → OK');
  console.log('');
  console.log('SIMPLIFIED gate does NOT call Trendyol catalog API.');
  console.log('It assumes ALL products with tpaCount=0 are blocked.');
  console.log('But categories with 0 required attrs pass the real gate with 0 TPA records.');
  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('CORRECTED TOTALS (real gate):');

  // Full re-eval with simplified for ALL 3189
  const allP = await prisma.product.findMany({
    where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: { id: true, categoryId: true, salePrice: true, xmlSourceId: true },
  });
  const allTpa = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { productId: true },
  });
  const allTpaCount = new Map<string, number>();
  for (const r of allTpa) allTpaCount.set(r.productId, (allTpaCount.get(r.productId) || 0) + 1);

  let simplifiedReady = 0, simplifiedBlocked = 0;
  const simplifiedCodes: Record<string, number> = {};
  for (const p of allP) {
    let f: string | null = null;
    if (!p.categoryId || !catExtMap.has(p.categoryId)) f = 'CATEGORY_MAPPING_NOT_FOUND';
    if (!f) { if ((allTpaCount.get(p.id) || 0) === 0) f = 'REQUIRED_ATTRIBUTE_MISSING'; }
    if (!f) { if (p.salePrice == null || !Number.isFinite(p.salePrice) || p.salePrice <= 0) f = 'PRICE_DATA_MISSING'; }
    if (!f) { const m = rules.filter(r => p.salePrice! >= r.minPrice && (r.maxPrice === 0 || p.salePrice! <= r.maxPrice)); if (m.length === 0) f = 'PRICE_RULE_NOT_FOUND'; }
    if (f) { simplifiedBlocked++; simplifiedCodes[f] = (simplifiedCodes[f] || 0) + 1; } else simplifiedReady++;
  }

  console.log(`  Simplified gate: ready=${simplifiedReady}, blocked=${simplifiedBlocked}`);
  console.log(`  Simplified blocked by code: ${JSON.stringify(simplifiedCodes)}`);
  console.log(`  Real gate (correct): ready=${simplifiedReady + passCount}, blocked=${simplifiedBlocked - passCount}`);
  console.log(`  Checksum: ${allP.length} (pass=${simplifiedReady + passCount + (simplifiedBlocked - passCount) === allP.length})`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
