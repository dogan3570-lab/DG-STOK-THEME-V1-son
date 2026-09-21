// scripts/rt-brand-ui.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:4000';
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  // same-origin API
  const stats = await page.evaluate(async () => { const r = await fetch('/api/brands/stats', { credentials: 'include' }); return { status: r.status, body: await r.json() }; });
  console.log('API /api/brands/stats =>', JSON.stringify({ total: stats.body?.totalProducts, matched: stats.body?.matchedProducts, unmatched: stats.body?.unmatchedProducts, systemBrands: stats.body?.totalSystemBrands, mappings: stats.body?.totalMappings, dg: stats.body?.dgBrandUsage, xml: stats.body?.xmlBrandUsage }));
  // products list for brand HOBİBAHÇEM
  const prods = await page.evaluate(async () => { const r = await fetch('/api/brands/products?page=1&limit=3', { credentials: 'include' }); return { status: r.status, body: await r.json() }; });
  console.log('API /api/brands/products => status', prods.status, 'total', prods.body?.pagination?.total, 'first', JSON.stringify(prods.body?.items?.[0] && { xmlKey: prods.body.items[0].xmlKey, brand: prods.body.items[0].brand?.name, xmlBrandName: prods.body.items[0].xmlBrandName }));
  // look for any brand board / counter in DOM
  const dom = await page.evaluate(() => {
    const ids = ['brand-board','brandStats','brand-stats','brand-count','prep-brands'];
    const found = {};
    for (const id of ids) { const el = document.getElementById(id); if (el) found[id] = el.innerText.replace(/\s+/g,' ').trim().slice(0,200); }
    return found;
  });
  console.log('DOM brand elements:', JSON.stringify(dom));
  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/brand-ui.png' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const stats2 = await page.evaluate(async () => { const r = await fetch('/api/brands/stats', { credentials: 'include' }); return await r.json(); });
  const persist = stats2.matchedProducts === stats.body?.matchedProducts && stats2.totalProducts === stats.body?.totalProducts;
  console.log('After reload =>', JSON.stringify({ total: stats2.totalProducts, matched: stats2.matchedProducts }), 'persistOk=' + persist);
  console.log('Console errors:', errors.length ? errors.slice(0,5) : 'NONE');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
