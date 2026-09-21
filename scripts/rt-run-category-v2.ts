// scripts/rt-run-category-v2.ts
// Runs the REAL product-level V2 pipeline. Mode via ARG: dry | apply
import { runCategoryCoreV2 } from '../server/src/services/categoryCoreV2.ts';

const mode = process.argv[2] === 'apply' ? 'apply' : 'dry';
const SRC = '2fe5e126-3e1e-43a6-9b28-b77826300688';

async function main() {
  console.log(`═══ CATEGORY CORE V2 — mode=${mode} (aiLimit=0) ═══`);
  const metrics = await runCategoryCoreV2({
    xmlSourceId: SRC,
    limit: 20000,
    apply: mode === 'apply',
    aiLimit: 0,          // AI KAPALI → yalnız deterministik sistem kuralları
    includeMatched: false,
  });

  const { decisions, ...summary } = metrics;
  console.log(JSON.stringify(summary, null, 2));
  console.log('');

  // Breakdown by decisionMethod
  const byMethod = new Map<string, number>();
  const byClass = new Map<string, number>();
  for (const d of decisions) {
    byMethod.set(d.decisionMethod, (byMethod.get(d.decisionMethod) || 0) + 1);
    byClass.set(d.classification, (byClass.get(d.classification) || 0) + 1);
  }
  console.log('By decisionMethod:');
  for (const [k, v] of [...byMethod.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);
  console.log('By classification:');
  for (const [k, v] of [...byClass.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);
  console.log('');

  const autos = decisions.filter(d => d.isAuto && d.newCategoryId);
  console.log(`AUTO (would write): ${autos.length}`);
  for (const d of autos) {
    console.log(`  ${d.xmlKey} | ${d.decisionMethod} | conf=${d.confidence} | "${d.supplierCategory}" -> ${d.newCategoryName}`);
  }
  console.log('');
  console.log(`NOT auto (stay unmatched/review): ${decisions.length - autos.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
