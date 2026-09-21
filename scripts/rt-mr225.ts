// scripts/rt-mr225.ts
// READ-ONLY: extract the 225 MANUAL_REVIEW products (incl. unproven AUTO_SAFE), group by candidate
import { readFileSync, writeFileSync } from 'node:fs';
const deep = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', 'utf8'));
const applied = new Set(JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-528-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE').map((r: any) => r.productId));
const mr = deep.filter((d: any) => !applied.has(d.productId) && (d.decision === 'MANUAL_REVIEW' || d.decision === 'AUTO_SAFE'));
console.log(`MANUAL_REVIEW population (225): ${mr.length}  (A=${mr.filter(d=>d.dataset==='A').length} B=${mr.filter(d=>d.dataset==='B').length})`);
writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/mr225.json', JSON.stringify(mr, null, 2), 'utf8');

// group by target leaf name (candidate)
const byLeaf = new Map<string, any[]>();
for (const d of mr) { const k = d.target || '(no candidate)'; if (!byLeaf.has(k)) byLeaf.set(k, []); byLeaf.get(k)!.push(d); }
console.log(`\nCandidate groups: ${byLeaf.size}`);
for (const [k, arr] of [...byLeaf.entries()].sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`${String(arr.length).padStart(3)}x ${k} | e.g. ${String(arr[0].title).slice(0,72)}`);
}
