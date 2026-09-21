// scripts/rt-results-filter.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4000/send-results.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
async function rows() { return await page.evaluate(() => document.querySelectorAll('#tbody tr').length); }
console.log('ALL rows:', await rows());
await page.click('.chip[data-rf="APPROVAL_PENDING"]'); await page.waitForTimeout(300);
console.log('Onay Bekleyen rows:', await rows());
await page.click('.chip[data-rf="REJECTED"]'); await page.waitForTimeout(300);
console.log('Reddedilen rows:', await rows());
await page.click('.chip[data-rf=""]'); await page.waitForTimeout(300);
await page.click('.chip[data-mp="tt"]'); await page.waitForTimeout(300);
console.log('Trendyol rows:', await rows());
await page.click('.chip[data-mp="n11"]'); await page.waitForTimeout(300);
console.log('N11 rows:', await rows());
// AI panel behavior: open drawer, click AI, ensure button disabled
await page.click('.chip[data-mp=""]'); await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#tbody tr').click()); await page.waitForTimeout(400);
const aiBtn = await page.evaluate(() => { const btns=[...document.querySelectorAll('#d-body button')]; const ai=btns.find(b=>/AI/i.test(b.textContent)); return ai?ai.textContent.trim():null; });
console.log('drawer AI button:', aiBtn);
console.log('Console errors:', errors.length ? errors.slice(0,3) : 'NONE');
await b.close();
