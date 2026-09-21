// scripts/rt-debug-renk.ts
// Why does Renk (attr 47) return 0 values for some categories?
import { fetchTrendyolAttributeValues } from '../server/src/services/trendyolCatalog.ts';
const cats = [4573, 2840, 2546, 4675, 5187, 1884, 869, 1877, 2830, 3617, 4702, 2191, 2799, 4824, 1056, 3933, 1579, 904];
async function main() {
  for (const cat of cats) {
    const vals = await fetchTrendyolAttributeValues(cat, 47, 300);
    console.log(`cat=${cat} Renk(47) values=${vals.length} ${vals.length > 0 ? 'first=' + JSON.stringify(vals[0]) : ''}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
