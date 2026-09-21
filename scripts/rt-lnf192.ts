// scripts/rt-lnf192.ts
import { readFileSync, writeFileSync } from 'node:fs';
const deep = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', 'utf8'));
const l = deep.filter((d: any) => d.decision === 'LEAF_NOT_FOUND');
console.log(`LEAF_NOT_FOUND: ${l.length} (A=${l.filter((d:any)=>d.dataset==='A').length} B=${l.filter((d:any)=>d.dataset==='B').length})`);
writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json', JSON.stringify(l, null, 2), 'utf8');
const bySc = new Map<string, any[]>();
for (const d of l) { const k = d.supplierCategory || '(null)'; if (!bySc.has(k)) bySc.set(k, []); bySc.get(k)!.push(d); }
console.log(`\nSupplierCategory groups: ${bySc.size}`);
for (const [k, arr] of [...bySc.entries()].sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\n### ${arr.length}x  SC="${k}"`);
  for (const r of arr) console.log(`   ${r.xmlKey} | ${String(r.title).slice(0,80)}`);
}
