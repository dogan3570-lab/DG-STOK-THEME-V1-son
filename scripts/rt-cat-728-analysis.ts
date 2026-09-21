// scripts/rt-cat-728-analysis.ts
// READ-ONLY: Analyze 728 categoryId=NULL products for bulk category mapping
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const out: Record<string, any> = {};

  // ═══ STEP 1: 728 products with categoryId=NULL ═══
  const nullCatProducts = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: {
      id: true, title: true, supplierCategory: true, xmlSourceId: true,
      salePrice: true, brandId: true, categoryMatch: true, matchedBy: true,
    },
  });

  out.totalNullCategory = nullCatProducts.length;

  // ═══ STEP 2: Group by supplierCategory ═══
  const bySupplierCat = new Map<string, typeof nullCatProducts>();
  for (const p of nullCatProducts) {
    const key = p.supplierCategory || '<NULL_SUPPLIER_CATEGORY>';
    if (!bySupplierCat.has(key)) bySupplierCat.set(key, []);
    bySupplierCat.get(key)!.push(p);
  }

  // Sort by count descending
  const sorted = [...bySupplierCat.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('728 CATEGORY=NULL ANALYSIS — ROOT CAUSE + BULK MAPPING PLAN');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total products with categoryId=NULL: ${nullCatProducts.length}`);
  console.log(`Distinct supplierCategory values: ${sorted.length}`);
  console.log('');

  // ═══ STEP 3: Null supplierCategory check ═══
  const nullSupplierCat = sorted.find(([k]) => k === '<NULL_SUPPLIER_CATEGORY>');
  if (nullSupplierCat) {
    console.log(`⚠️  Products with NULL supplierCategory: ${nullSupplierCat[1].length}`);
    for (const p of nullSupplierCat[1].slice(0, 5)) {
      console.log(`    ${p.id.substring(0, 8)} — "${p.title?.substring(0, 50)}"`);
    }
    console.log('');
  }

  // ═══ STEP 4: Existing Category tree ═══
  const allCats = await prisma.category.findMany({
    select: { id: true, name: true, externalId: true, parentId: true, variantRequired: true },
  });
  const catByName = new Map(allCats.map(c => [c.name.toLowerCase(), c]));
  const catByExtId = new Map(allCats.filter(c => c.externalId).map(c => [Number(c.externalId), c]));
  const leafCats = allCats.filter(c => !allCats.some(p => p.parentId === c.id));

  console.log(`DG-STOK Category tree: ${allCats.length} total, ${leafCats.length} leaves`);
  console.log('');

  // ═══ STEP 5: Existing CategoryMapping ═══
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: MP, active: true },
    select: { categoryId: true, externalId: true, externalName: true, externalPath: true, source: true, confidence: true },
  });
  const mappedCatIds = new Set(mappings.map(m => m.categoryId));

  console.log(`Active CategoryMapping records: ${mappings.length}`);
  console.log('');

  // ═══ STEP 6: Match analysis ═══
  const results: Array<{
    supplierCat: string;
    count: number;
    leafSegment: string;
    matchedCatId: string | null;
    matchedCatName: string | null;
    matchedCatExtId: number | null;
    hasMapping: boolean;
    confidence: string;
    autoAssignable: boolean;
  }> = [];

  let exactCount = 0, highCount = 0, reviewCount = 0, noMatchCount = 0;

  for (const [supplierCat, products] of sorted) {
    if (supplierCat === '<NULL_SUPPLIER_CATEGORY>') {
      results.push({
        supplierCat,
        count: products.length,
        leafSegment: '<YOK>',
        matchedCatId: null,
        matchedCatName: null,
        matchedCatExtId: null,
        hasMapping: false,
        confidence: 'NO_MATCH',
        autoAssignable: false,
      });
      noMatchCount += products.length;
      continue;
    }

    const parts = supplierCat.split(' > ').map(s => s.trim()).filter(Boolean);
    const leafSegment = parts[parts.length - 1] || '';
    const leafNorm = leafSegment.toLowerCase();

    // Try exact leaf name match
    const exactMatch = catByName.get(leafNorm);
    if (exactMatch) {
      const hasMapping = mappedCatIds.has(exactMatch.id);
      results.push({
        supplierCat,
        count: products.length,
        leafSegment,
        matchedCatId: exactMatch.id,
        matchedCatName: exactMatch.name,
        matchedCatExtId: exactMatch.externalId ? Number(exactMatch.externalId) : null,
        hasMapping,
        confidence: hasMapping ? 'EXACT' : 'HIGH_CONFIDENCE',
        autoAssignable: hasMapping,
      });
      if (hasMapping) exactCount += products.length;
      else highCount += products.length;
      continue;
    }

    // Try fuzzy: partial match
    const fuzzyMatches = allCats.filter(c => {
      const cn = c.name.toLowerCase();
      return cn.includes(leafNorm) || leafNorm.includes(cn);
    });
    if (fuzzyMatches.length === 1) {
      const m = fuzzyMatches[0];
      const hasMapping = mappedCatIds.has(m.id);
      results.push({
        supplierCat,
        count: products.length,
        leafSegment,
        matchedCatId: m.id,
        matchedCatName: m.name,
        matchedCatExtId: m.externalId ? Number(m.externalId) : null,
        hasMapping,
        confidence: hasMapping ? 'HIGH_CONFIDENCE' : 'NEEDS_REVIEW',
        autoAssignable: false, // fuzzy = needs review
      });
      reviewCount += products.length;
      continue;
    }
    if (fuzzyMatches.length > 1) {
      results.push({
        supplierCat,
        count: products.length,
        leafSegment,
        matchedCatId: null,
        matchedCatName: fuzzyMatches.map(m => m.name).join(' | '),
        matchedCatExtId: null,
        hasMapping: false,
        confidence: 'NEEDS_REVIEW',
        autoAssignable: false,
      });
      reviewCount += products.length;
      continue;
    }

    // No match
    results.push({
      supplierCat,
      count: products.length,
      leafSegment,
      matchedCatId: null,
      matchedCatName: null,
      matchedCatExtId: null,
      hasMapping: false,
      confidence: 'NO_MATCH',
      autoAssignable: false,
    });
    noMatchCount += products.length;
  }

  // ═══ STEP 7: Print results ═══
  console.log('┌────┬───────────────────────────────────────────────┬──────┬──────────────────────────────────────────┬────────┬──────────┬──────────┐');
  console.log('│ #  │ XML Supplier Category                        │ Count│ DG-STOK Category                         │ ExtID  │ Mapping  │ Confidence│');
  console.log('├────┼───────────────────────────────────────────────┼──────┼──────────────────────────────────────────┼────────┼──────────┼──────────┤');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const confIcon = r.confidence === 'EXACT' ? '🟢' : r.confidence === 'HIGH_CONFIDENCE' ? '🔵' : r.confidence === 'NEEDS_REVIEW' ? '🟡' : '🔴';
    console.log(
      `│ ${(i+1).toString().padStart(2)} │ ${(r.supplierCat || '').substring(0, 45).padEnd(45)} │  ${(r.count.toString()).padStart(3)} │ ${(r.matchedCatName || '---').substring(0, 40).padEnd(40)} │ ${(r.matchedCatExtId?.toString() || '---').padStart(6)} │ ${r.hasMapping ? '✅' : '❌'}      │ ${confIcon} ${(r.confidence).padEnd(9)} │`
    );
  }

  console.log('└────┴───────────────────────────────────────────────┴──────┴──────────────────────────────────────────┴────────┴──────────┴──────────┘');

  // ═══ STEP 8: Summary ═══
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CONFIDENCE DISTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  🟢 EXACT (leaf+mapping match):      ${exactCount.toString().padStart(4)} products`);
  console.log(`  🔵 HIGH_CONFIDENCE (leaf match):     ${highCount.toString().padStart(4)} products`);
  console.log(`  🟡 NEEDS_REVIEW (fuzzy/partial):     ${reviewCount.toString().padStart(4)} products`);
  console.log(`  🔴 NO_MATCH (no candidate):          ${noMatchCount.toString().padStart(4)} products`);
  console.log(`  TOTAL:                               ${(exactCount+highCount+reviewCount+noMatchCount).toString().padStart(4)} products`);
  console.log('');

  // ═══ STEP 9: Root cause ═══
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ROOT CAUSE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('XML import flow (xmlImport.ts:606-610):');
  console.log('  supplierCategory = "Top > Main > Sub > Leaf"');
  console.log('  catName = leaf.toLowerCase().trim()');
  console.log('  categoryId = categoryMap.get(catName) ?? defaultCategory.id');
  console.log('');
  console.log('categoryMap is built from ALL Category.name records.');
  console.log('If leaf name does not exactly match any Category.name → fallback to "Genel".');
  console.log('');
  console.log('These 728 products have categoryId=NULL meaning:');
  console.log('  1. supplierCategory leaf does NOT match any Category.name (case-insensitive), OR');
  console.log('  2. defaultCategory ("Genel") was deleted or not found at import time');
  console.log('');
  
  // Check if Genel exists
  const genel = catByName.get('genel');
  console.log(`  "Genel" category exists: ${genel ? `YES (id=${genel.id.substring(0,8)})` : 'NO'}`);
  console.log('');

  // ═══ STEP 10: XML source breakdown ═══
  const bySource = new Map<string, number>();
  for (const p of nullCatProducts) {
    bySource.set(p.xmlSourceId || 'null', (bySource.get(p.xmlSourceId || 'null') || 0) + 1);
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('XML SOURCE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const [src, cnt] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    const srcInfo = await prisma.xmlSource.findUnique({ where: { id: src }, select: { name: true, company: true } });
    console.log(`  ${src.substring(0, 8)} (${srcInfo?.name || '?'} / ${srcInfo?.company || '?'}): ${cnt} products`);
  }
  console.log('');

  // ═══ STEP 11: Trendyol tree overlap ═══
  const trendyolCats = allCats.filter(c => c.externalId);
  const supplierSegments = new Set<string>();
  for (const [sc] of sorted) {
    if (sc === '<NULL_SUPPLIER_CATEGORY>') continue;
    const parts = sc.split(' > ').map(s => s.trim().toLowerCase());
    for (const p of parts) supplierSegments.add(p);
  }

  const inTrendyolTree = [...supplierSegments].filter(s => trendyolCats.some(tc => tc.name.toLowerCase() === s));
  const notInTree = [...supplierSegments].filter(s => !trendyolCats.some(tc => tc.name.toLowerCase() === s));

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SEGMENT ANALYSIS vs TRENDYOL TREE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Unique segments in supplierCategory paths: ${supplierSegments.size}`);
  console.log(`  Found in Trendyol tree: ${inTrendyolTree.length}`);
  console.log(`  NOT found in Trendyol tree: ${notInTree.length}`);
  if (notInTree.length > 0 && notInTree.length <= 30) {
    console.log(`  Missing: ${notInTree.join(', ')}`);
  }
  console.log('');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
