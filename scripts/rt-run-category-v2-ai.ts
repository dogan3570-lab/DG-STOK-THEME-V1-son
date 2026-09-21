// scripts/rt-run-category-v2-ai.ts
// AI-assisted V2 pipeline. Mode: dry | apply ; argv[3] = aiLimit
import { runCategoryCoreV2 } from '../server/src/services/categoryCoreV2.ts';

const mode = process.argv[2] === 'apply' ? 'apply' : 'dry';
const aiLimit = Number(process.argv[3] ?? 728);
const SRC = '2fe5e126-3e1e-43a6-9b28-b77826300688';

async function main() {
  console.log(`═══ CATEGORY CORE V2 — mode=${mode} aiLimit=${aiLimit} ═══`);
  const t0 = Date.now();
  const m = await runCategoryCoreV2({
    xmlSourceId: SRC,
    limit: 20000,
    apply: mode === 'apply',
    aiLimit,
    includeMatched: false,
  });
  const { decisions, ...s } = m;
  console.log(JSON.stringify(s, null, 2));
  console.log(`elapsed=${Math.round((Date.now()-t0)/1000)}s`);
  console.log('');

  const autos = decisions.filter(d => d.isAuto && d.newCategoryId);
  console.log(`AUTO(count): ${autos.length}`);
  for (const d of autos) {
    console.log(`  ${d.xmlKey} | ${d.decisionMethod} | conf=${d.confidence} | "${d.supplierCategory}" -> ${d.newCategoryName} (${d.newCategoryId?.substring(0,8)})`);
  }
  console.log('');
  // Non-auto breakdown with reasons (first 20)
  const nonAuto = decisions.filter(d => !d.isAuto);
  const byReason = new Map<string, number>();
  for (const d of nonAuto) byReason.set(d.decisionMethod, (byReason.get(d.decisionMethod) || 0) + 1);
  console.log('NON-AUTO by method:', JSON.stringify([...byReason]));
}

main().catch(e => { console.error(e); process.exit(1); });
