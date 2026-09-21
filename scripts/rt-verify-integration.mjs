// scripts/rt-verify-integration.mjs
import { readFileSync } from 'node:fs';
const c = readFileSync('C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html', 'utf8');
const checks = {
  'page-send-results div': c.includes('id="page-send-results"'),
  'sr-style css': c.includes('id="sr-style"'),
  'sr-script js': c.includes('id="sr-script"'),
  'pages array has send-results': c.includes("'prep-not-going', 'send-results', 'ready-to-ship'"),
  'load hook': c.includes("if (name === 'send-results') srLoad();"),
  'nav onclick showPage': c.includes("onclick=\"showPage('send-results'); return false;\""),
  'nav no longer points to file': !c.includes('href="/send-results.html"'),
  'nav id present': c.includes('id="nav-send-results"'),
};
for (const [k, v] of Object.entries(checks)) console.log((v ? 'PASS' : 'FAIL') + ' — ' + k);
