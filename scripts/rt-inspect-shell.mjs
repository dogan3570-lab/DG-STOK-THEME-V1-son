// scripts/rt-inspect-shell.mjs
import { readFileSync } from 'node:fs';
const c = readFileSync('C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html', 'utf8');
function ctx(needle, before = 300, after = 700) { const i = c.indexOf(needle); if (i < 0) return `NOT FOUND: ${needle}`; return `@${i}\n` + c.substring(Math.max(0, i - before), i + after); }
console.log('=== showPage def ===');
console.log(ctx('function showPage', 50, 900));
console.log('\n=== prep-not-going page container ===');
console.log(ctx('id="page-prep-not-going', 100, 300));
console.log('\n=== prep-not-going occurrences ===');
let idx = -1; const occ = []; while ((idx = c.indexOf('prep-not-going', idx + 1)) >= 0) occ.push(idx);
console.log(occ.join(', '));
for (const o of occ) console.log(`  @${o}: ${JSON.stringify(c.substring(o - 30, o + 60))}`);
