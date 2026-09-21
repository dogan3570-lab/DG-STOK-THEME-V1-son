// scripts/rt-extract-dist.mjs
import { readFileSync } from 'node:fs';
const c = readFileSync('C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html', 'utf8');
for (const needle of ["'var-auto'", "'var-has'", "var-waiting", "var-manual", "var-ai"]) {
  const i = c.indexOf(needle);
  if (i < 0) { console.log(`\n### ${needle} NOT FOUND`); continue; }
  console.log(`\n### ${needle} @${i}`);
  console.log(c.substring(Math.max(0, i - 500), i + 900));
}
