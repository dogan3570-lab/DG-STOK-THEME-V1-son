// scripts/rt-final-report.ts
// Produces per-product disposition for all 728 + regression snapshot
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { resolveCategoryCandidates } from '../server/src/services/categoryCanonical.ts';
import { writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const leafCount = tree.leaves.length;

  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, categoryId: true, categoryMatch: true, matchedBy: true, status: true, aiSuggestedCategoryId: true, aiScore: true },
    orderBy: { xmlKey: 'asc' },
  });

  const rows: string[] = [];
  rows.push('productId,xmlKey,supplierCategory,currentCategoryId,disposition,targetCategory,method,confidence,status');

  let noSource = 0, genericNoLeaf = 0, hasCandidate = 0;
  for (const p of prods) {
    if (!p.supplierCategory) {
      noSource++;
      rows.push([p.id, p.xmlKey, '', '', 'NO_SOURCE_CATEGORY', '', 'none', '', p.status].map(csv).join(','));
      continue;
    }
    const r = resolveCategoryCandidates(p, tree, MP);
    let disp: string, target = '', method = r.method, conf = '';
    if (r.confidence < 0.6 || !r.topCandidate) {
      disp = 'MANUAL_REVIEW_LOW_CONFIDENCE';
      conf = String(r.confidence);
      genericNoLeaf++;
    } else {
      disp = 'NEEDS_AI_VERIFICATION'; // candidate exists but not deterministic-safe
      target = r.topCandidate?.name ?? '';
      conf = String(r.confidence);
      hasCandidate++;
    }
    rows.push([p.id, p.xmlKey, p.supplierCategory, '', disp, target, method, conf, p.status].map(csv).join(','));
  }

  const out = 'C:/Users/Dogan/AppData/Local/Temp/opencode/728-disposition.csv';
  writeFileSync(out, rows.join('\n'), 'utf8');
  console.log(`Wrote ${prods.length} rows -> ${out}`);
  console.log('');
  console.log('DISPOSITION SUMMARY (728):');
  console.log(`  NO_SOURCE_CATEGORY (supplierCategory null): ${noSource}`);
  console.log(`  MANUAL_REVIEW_LOW_CONFIDENCE:               ${genericNoLeaf}`);
  console.log(`  NEEDS_AI_VERIFICATION (has candidate):      ${hasCandidate}`);
  console.log(`  TOTAL: ${noSource + genericNoLeaf + hasCandidate}`);
  console.log('');
  console.log(`Trendyol tree leaves (candidate pool): ${leafCount}`);

  // Regression snapshot
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const nullCat = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null } });
  const nullSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, supplierCategory: null } });
  const matched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const vari = await prisma.variant.count();
  const brands = await prisma.brand.count();
  const cats = await prisma.category.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const maps = await prisma.categoryMapping.count();
  const rules = await prisma.marketplacePricingRule.count();
  console.log('');
  console.log('REGRESSION SNAPSHOT (whole DB):');
  console.log(JSON.stringify({ total, matched, nullCat, nullSc, vari, brands, cats, tpa, maps, rules }));
  await prisma.$disconnect();
}

function csv(v: unknown): string {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

main().catch(e => { console.error(e); process.exit(1); });
