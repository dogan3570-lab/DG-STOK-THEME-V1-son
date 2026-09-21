// scripts/rt-market-filter-test.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { document.getElementById('nav-send-results').click(); });
await page.waitForTimeout(3000);

const cards = await page.evaluate(() => [...document.querySelectorAll('#sr-mpgrid .sr-mp .sr-nm')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('MARKETPLACE CARDS (dynamic):', JSON.stringify(cards));

async function rows() { return await page.evaluate(() => document.querySelectorAll('#sr-tbody tr').length); }
async function rowMps() { return await page.evaluate(() => [...document.querySelectorAll('#sr-tbody tr')].map(tr => tr.children[3].textContent.trim())); }
async function clickMp(key) { await page.evaluate(k => { const el = [...document.querySelectorAll('#sr-mpgrid .sr-mp')].find(e => e.getAttribute('data-mp') === k); if (el) el.click(); }, key); await page.waitForTimeout(500); }

console.log('ALL rows:', await rows());
await clickMp('tt'); console.log('Trendyol rows:', await rows(), '| all Trendyol?', (await rowMps()).every(m => m === 'Trendyol'));
await clickMp('he'); console.log('Hepsiburada rows:', await rows());
await clickMp('n11'); console.log('N11 rows:', await rows());
await clickMp('tt'); console.log('back Trendyol rows:', await rows());

// search test (barcode)
await page.evaluate(() => { const s = document.getElementById('sr-search'); s.value = '7256195572668'; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(400);
console.log('search barcode 7256195572668 rows:', await rows(), '| barcode:', await page.evaluate(() => { const c = document.querySelector('#sr-tbody .sr-bcode'); return c ? c.textContent : null; }));
await page.evaluate(() => { const s = document.getElementById('sr-search'); s.value = ''; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(300);

// category options
const catOpts = await page.evaluate(() => [...document.getElementById('sr-cat').options].map(o => o.textContent));
console.log('category options:', JSON.stringify(catOpts));
console.log('Console errors:', errors.length ? errors.slice(0, 5) : 'NONE');
await b.close();
