// scripts/rt-listing-ui.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:4000';
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const s = await page.evaluate(async () => { const r = await fetch('/api/listings/stats/summary', { credentials: 'include' }); return await r.json(); });
  console.log('/api/listings/stats/summary =>', JSON.stringify(s));
  const rules = await page.evaluate(async () => { const r = await fetch('/api/listing-v2/rules', { credentials: 'include' }); return await r.json(); });
  console.log('/api/listing-v2/rules count =>', (rules.items||[]).length);
  // open listings page
  await page.evaluate(async () => { if (typeof window.showPage === 'function') window.showPage('prep-listings'); });
  await page.waitForTimeout(2500);
  const loaded = await page.evaluate(async () => { for (const f of ['prepListStats','prepListingsLoadData','prepListingsLoad']) { if (typeof window[f]==='function'){try{await window[f]();}catch(e){}} } return 'done'; });
  console.log('loader:', loaded);
  await page.waitForTimeout(2000);
  const kpi = await page.evaluate(() => { const ids=['li-stat-total','li-stat-active','li-stat-inactive','li-stat-rules','li-stat-logs']; const o={}; for(const id of ids){const e=document.getElementById(id); o[id]=e?e.textContent.trim():'(missing)';} return o; });
  console.log('UI KPIs:', JSON.stringify(kpi));
  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/listing-ui.png' });
  console.log('Console errors:', errors.length ? errors.slice(0,5) : 'NONE');
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
