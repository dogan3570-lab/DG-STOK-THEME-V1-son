// scripts/rt-add-nav.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html';
let c = readFileSync(p, 'utf8');
if (c.includes('nav-send-results')) { console.log('already present'); process.exit(0); }
const anchor = '<i class="fa-solid fa-plane-up-slash w-4"></i> Pazaryerine Gitmeyen';
const idx = c.indexOf(anchor);
if (idx < 0) { console.log('anchor NOT FOUND'); process.exit(1); }
const closeIdx = c.indexOf('</a>', idx);
const insertAt = closeIdx + 4;
const link = '\r\n                            <a href="/send-results.html" id="nav-send-results" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all"><i class="fa-solid fa-satellite-dish w-4"></i> Pazaryeri Sonuç Merkezi</a>';
c = c.slice(0, insertAt) + link + c.slice(insertAt);
writeFileSync(p, c);
console.log('inserted at', insertAt);
