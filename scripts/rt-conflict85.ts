// scripts/rt-conflict85.ts
// READ-ONLY: extract the 85 CONFLICT products
import { readFileSync, writeFileSync } from 'node:fs';
const deep = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', 'utf8'));
const c = deep.filter((d: any) => d.decision === 'CONFLICT');
console.log(`CONFLICT: ${c.length}`);
writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/conflict85.json', JSON.stringify(c, null, 2), 'utf8');
// group by supplierCategory
const bySc = new Map<string, any[]>();
for (const d of c) { const k = d.supplierCategory || '(null)'; if (!bySc.has(k)) bySc.set(k, []); bySc.get(k)!.push(d); }
console.log(`\nSupplierCategory groups: ${bySc.size}`);
for (const [k, arr] of [...bySc.entries()].sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\n### ${arr.length}x  SC="${k}"`);
  for (const r of arr) console.log(`   ${r.xmlKey} | cand=${r.target} | ${String(r.title).slice(0,78)}`);
}
