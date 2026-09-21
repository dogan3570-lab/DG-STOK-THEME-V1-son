// scripts/rt-variant-ui.mjs
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
  // same-origin API calls the UI uses
  const dash = await page.evaluate(async () => { const r = await fetch('/api/variants/dashboard?xmlSourceId=&marketplaceId=', { credentials: 'include' }); return await r.json(); });
  console.log('UI dashboard fetch =>', JSON.stringify({ total: dash.totalProducts, hasVariant: dash.hasVariant, notRequired: dash.notRequired, autoMatched: dash.autoMatched, aiMatched: dash.aiMatched, manualReview: dash.manualReview, waitingAi: dash.waitingAi }));
  // navigate to variants screen via nav (find a link/button)
  const nav = await page.evaluate(() => { const els=[...document.querySelectorAll('[onclick]')].map(e=>e.getAttribute('onclick')); return els.filter(x=>x&&/variant|prep-variant/i.test(x)).slice(0,5); });
  console.log('nav handlers with variant:', JSON.stringify(nav));
  // force open variants page if function exists
  const opened = await page.evaluate(async () => { if (typeof window.showPage === 'function') { try { window.showPage('prep-variants'); return 'showPage'; } catch(e){} } if (typeof window.navigate === 'function') { try { window.navigate('prep-variants'); return 'navigate'; } catch(e){} } return 'none'; });
  console.log('open page via:', opened);
  await page.waitForTimeout(3000);
  // explicitly trigger the variant dashboard load
  const loaded = await page.evaluate(async () => {
    const fns = ['prepVariantFetchDashboard','prepVariantFetchAll','prepVariantLoadAll','prepVariantReload'];
    for (const f of fns) { if (typeof window[f] === 'function') { try { await window[f](); return f; } catch(e){ return f+':ERR '+e.message; } } }
    return 'none';
  });
  console.log('loader called:', loaded);
  await page.waitForTimeout(2500);
  const counters = await page.evaluate(() => { const ids=['var-total','var-has','var-none','var-auto','var-ai','var-manual','var-waiting']; const o={}; for(const id of ids){const e=document.getElementById(id); o[id]=e?e.textContent.trim():'(missing)';} return o; });
  console.log('UI counters:', JSON.stringify(counters));
  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/variant-ui.png' });
  console.log('Console errors:', errors.length ? errors.slice(0,5) : 'NONE');
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
