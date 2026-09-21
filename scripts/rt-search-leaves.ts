// scripts/rt-search-leaves.ts
// READ-ONLY: search Trendyol leaves by keyword to name correct targets
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';

const KEYWORDS = process.argv.slice(2);

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u');
}

(async () => {
  const tree = await loadTrendyolTree();
  for (const kw of KEYWORDS) {
    const f = foldTr(kw);
    const hits = tree.leaves.filter(l => foldTr(l.name).includes(f)).slice(0, 12);
    console.log(`### "${kw}" -> ${hits.length} leaves`);
    for (const h of hits) console.log(`   ${h.name} | ext=${h.externalId} | ${h.fullPath}`);
  }
})();
