// scripts/rt-send-select-test.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errors = []; const toasts = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
let lastDialog = null;
page.on('dialog', async d => { lastDialog = d.message(); await d.accept(); });
await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(() => document.getElementById('nav-send-results').click());
for (let i = 0; i < 40; i++) { await page.waitForTimeout(400); const v = await page.evaluate(() => document.getElementById('sr-n-pending').textContent); if (v && v !== '-') break; }

const sendBtn = () => page.evaluate(() => ({ disabled: document.getElementById('sr-sendbtn').disabled, text: document.getElementById('sr-sendbtn').textContent, info: document.getElementById('sr-selinfo').textContent }));
console.log('initial:', JSON.stringify(await sendBtn()));

// select Trendyol
await page.evaluate(() => { const el = [...document.querySelectorAll('#sr-mpgrid .sr-mp')].find(e => e.getAttribute('data-mp') === 'tt'); el.click(); });
await page.waitForTimeout(400);
console.log('after Trendyol select:', JSON.stringify(await sendBtn()));

// check first row
await page.evaluate(() => { const cb = document.querySelector('#sr-tbody tr input[type=checkbox]'); cb.click(); });
await page.waitForTimeout(300);
console.log('1 row checked:', JSON.stringify(await sendBtn()));

// select all
await page.evaluate(() => { const sa = document.getElementById('sr-selall'); sa.click(); });
await page.waitForTimeout(300);
console.log('select-all:', JSON.stringify(await sendBtn()));

// switch to Hepsiburada -> selection must clear
await page.evaluate(() => { const el = [...document.querySelectorAll('#sr-mpgrid .sr-mp')].find(e => e.getAttribute('data-mp') === 'he'); el.click(); });
await page.waitForTimeout(400);
console.log('switch to Hepsiburada:', JSON.stringify(await sendBtn()));

// back to Trendyol, select all, click GÖNDER (real pipeline; expect blocked duplicate since SENDING)
await page.evaluate(() => { const el = [...document.querySelectorAll('#sr-mpgrid .sr-mp')].find(e => e.getAttribute('data-mp') === 'tt'); el.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('sr-selall').click());
await page.waitForTimeout(300);
// capture the send POST response
const respPromise = page.waitForResponse(r => r.url().includes('/api/ready-to-ship/send') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
await page.evaluate(() => document.getElementById('sr-sendbtn').click());
const resp = await respPromise;
if (resp) { console.log('SEND HTTP:', resp.status(), 'body:', (await resp.text()).slice(0, 300)); }
await page.waitForTimeout(2000);
console.log('dialog shown:', JSON.stringify(lastDialog));
console.log('after send attempt:', JSON.stringify(await sendBtn()));
console.log('Console errors:', errors.length ? errors.slice(0, 5) : 'NONE');
await b.close();
