// scripts/rt-573-groups.ts
// READ-ONLY: summarize all 165 AUTO_CANDIDATE groups for manual verification
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/573-dryrun.json', 'utf8'));
const cand = rows.filter((r: any) => r.reason === 'AUTO_CANDIDATE');
const byLeaf = new Map<string, any[]>();
for (const c of cand) { const k = `${c.targetLeaf}|${c.targetExt}`; if (!byLeaf.has(k)) byLeaf.set(k, []); byLeaf.get(k)!.push(c); }
const arr = [...byLeaf.entries()].sort((a,b)=>b[1].length-a[1].length);
console.log(`Groups: ${arr.length}, products: ${cand.length}`);
for (const [k, g] of arr) {
  console.log(`${String(g.length).padStart(3)}x ${k}  | e.g. ${String(g[0].title).slice(0,70)}`);
}
