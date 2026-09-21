// scripts/rt-results-ui.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4000/send-results.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
const cards = await page.evaluate(() => ({ approved: document.getElementById('c-approved').textContent, pending: document.getElementById('c-pending').textContent, rejected: document.getElementById('c-rejected').textContent, fix: document.getElementById('c-fix').textContent }));
const rows = await page.evaluate(() => document.querySelectorAll('#tbody tr').length);
const firstBarcode = await page.evaluate(() => { const el = document.querySelector('#tbody .bcode'); return el ? el.textContent : null; });
console.log('CARDS:', JSON.stringify(cards));
console.log('ROWS:', rows, 'firstBarcode:', firstBarcode);
// open drawer for first row
await page.evaluate(() => { const tr = document.querySelector('#tbody tr'); tr.click(); });
await page.waitForTimeout(800);
const drawer = await page.evaluate(() => { const d = document.getElementById('drawer'); return { open: d.classList.contains('on'), title: document.getElementById('d-title').textContent, sub: document.getElementById('d-sub').textContent, hasTimeline: !!document.querySelector('#d-body .timeline'), hasTech: !!document.querySelector('#d-body details') }; });
console.log('DRAWER:', JSON.stringify(drawer));
await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/results-ui.png' });
console.log('Console errors:', errors.length ? errors.slice(0, 5) : 'NONE');
await b.close();
