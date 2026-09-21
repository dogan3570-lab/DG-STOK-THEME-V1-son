// scripts/rt-573-summary.ts
import { readFileSync } from 'node:fs';
const dry = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/573-dryrun.json', 'utf8'));
const applied = new Set(JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE').map((r: any) => r.productId));

const isA = (d: any) => d.dataset === 'A_no_source';
const ap = dry.filter((d: any) => applied.has(d.productId));
const rem = dry.filter((d: any) => !applied.has(d.productId));

console.log('APPLIED 45: A(no-source)=', ap.filter(isA).length, ' B(has-source)=', ap.filter((d:any)=>!isA(d)).length);
console.log('REMAINING 528: A=', rem.filter(isA).length, ' B=', rem.filter((d:any)=>!isA(d)).length);
console.log('');
for (const ds of ['A', 'B']) {
  const set = rem.filter((d: any) => (ds === 'A' ? isA(d) : !isA(d)));
  const rc = new Map<string, number>();
  for (const d of set) rc.set(d.reason, (rc.get(d.reason) || 0) + 1);
  console.log(`REMAINING ${ds}: total=${set.length}`, JSON.stringify([...rc]));
}
