// scripts/rt-results-v2.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4000/send-results.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
const s = await page.evaluate(() => ({
  approved: document.getElementById('n-approved').textContent,
  pending: document.getElementById('n-pending').textContent,
  rejected: document.getElementById('n-rejected').textContent,
  action: document.getElementById('n-action').textContent,
  chartTotal: (document.querySelector('#donut text')||{}).textContent,
  legend: [...document.querySelectorAll('#legend .lg')].map(e=>e.innerText.replace(/\s+/g,' ').trim()),
  mp: [...document.querySelectorAll('#mpgrid .mp')].map(e=>e.innerText.replace(/\s+/g,' ').trim()),
  issuesHidden: document.getElementById('issues-wrap').style.display==='none',
  actionsText: document.getElementById('actions').innerText.replace(/\s+/g,' ').trim().slice(0,160),
  rows: document.querySelectorAll('#tbody tr').length,
}));
console.log(JSON.stringify(s, null, 2));
await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/results-v2.png' });
// 3-second test: are top numbers visible without scroll?
const aboveFold = await page.evaluate(() => { const ids=['n-approved','n-pending','n-rejected','n-action']; return ids.every(id=>{const e=document.getElementById(id); const r=e.getBoundingClientRect(); return r.top>=0 && r.bottom<=window.innerHeight;}); });
console.log('3s test — tüm 4 sayı ekranın görünür alanında:', aboveFold);
console.log('Console errors:', errors.length ? errors.slice(0,5) : 'NONE');
await b.close();
