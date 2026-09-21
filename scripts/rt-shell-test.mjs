// scripts/rt-shell-test.mjs
import { chromium } from 'playwright';
const login = await fetch('http://localhost:4000/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
const { token } = await login.json();
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const pages = [];
ctx.on('page', p => pages.push(p));
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// sidebar + nav
const sidebar = await page.evaluate(() => { const ids=['sidebar','app-sidebar','side-nav','nav-sidebar']; const el = ids.map(i=>document.getElementById(i)).find(Boolean) || document.querySelector('aside,nav'); return el ? { found:true, visible: el.offsetParent!==null } : { found:false }; });
const navLink = await page.evaluate(() => { const a=document.getElementById('nav-send-results'); return a ? { found:true, text:a.textContent.trim(), visible:a.offsetParent!==null } : { found:false }; });
console.log('SIDEBAR:', JSON.stringify(sidebar));
console.log('NAV LINK:', JSON.stringify(navLink));

// click nav
await page.evaluate(() => { document.getElementById('nav-send-results').click(); });
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({
  srPageVisible: !document.getElementById('page-send-results').classList.contains('hidden'),
  sidebarStill: !!(document.querySelector('aside,nav,#sidebar')),
  navActive: document.getElementById('nav-send-results').classList.contains('active-nav'),
  pending: document.getElementById('sr-n-pending').textContent,
  approved: document.getElementById('sr-n-approved').textContent,
  rejected: document.getElementById('sr-n-rejected').textContent,
  rows: document.querySelectorAll('#sr-tbody tr').length,
  url: location.href,
}));
console.log('AFTER CLICK:', JSON.stringify(after));
console.log('NEW WINDOWS OPENED:', pages.length);
await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/shell-integrated.png' });

// refresh persistence
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('nav-send-results').click(); });
await page.waitForTimeout(2500);
const afterReload = await page.evaluate(() => ({ srVisible: !document.getElementById('page-send-results').classList.contains('hidden'), pending: document.getElementById('sr-n-pending').textContent }));
console.log('AFTER RELOAD+click:', JSON.stringify(afterReload));
console.log('Console errors:', errors.length ? errors.slice(0, 5) : 'NONE');
await b.close();
