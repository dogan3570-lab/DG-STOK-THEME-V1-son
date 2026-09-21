// scripts/rt-summary-528.ts
import { readFileSync } from 'node:fs';
const deep = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', 'utf8'));
const applied = new Set(JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-528-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE').map((r: any) => r.productId));
const rem = deep.filter((d: any) => !applied.has(d.productId));
for (const ds of ['A', 'B']) {
  const set = rem.filter((d: any) => d.dataset === ds);
  const rc = new Map<string, number>();
  for (const d of set) rc.set(d.decision, (rc.get(d.decision) || 0) + 1);
  const visual = set.filter((d: any) => d.visualEvidence).length;
  console.log(`${ds}: remaining=${set.length} | ${JSON.stringify([...rc])} | visualAvailable=${visual}`);
}
console.log('applied (26) A/B:', deep.filter((d:any)=>applied.has(d.productId)&&d.dataset==='A').length, deep.filter((d:any)=>applied.has(d.productId)&&d.dataset==='B').length);
