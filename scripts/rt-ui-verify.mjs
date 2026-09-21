// scripts/rt-ui-verify.mjs
// Playwright E2E: login → category board → stats → persistence
import { chromium } from 'playwright';

const BASE = 'http://localhost:4000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  console.log('1) Opening', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Login if form present
  const emailInput = page.locator('input[type="email"], input[name="email"], #login-email').first();
  if (await emailInput.count() > 0 && await emailInput.isVisible().catch(() => false)) {
    console.log('   Login form detected — logging in...');
    await emailInput.fill('admin@dgstok.com');
    const pw = page.locator('input[type="password"], #login-password').first();
    await pw.fill('admin123');
    const btn = page.locator('button[type="submit"], button:has-text("Giriş"), button:has-text("Giris")').first();
    await btn.click().catch(async () => { await pw.press('Enter'); });
    await page.waitForTimeout(4000);
  } else {
    console.log('   No login form visible (maybe already authed).');
  }

  // Verify session
  const me = await page.evaluate(async () => {
    const r = await fetch('/auth/me', { credentials: 'include' });
    try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status }; }
  });
  console.log('2) /auth/me =>', JSON.stringify(me).substring(0, 160));

  // Read the category board DOM
  await page.waitForTimeout(3000);
  const board = await page.evaluate(() => {
    const el = document.getElementById('cat-board');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(cat-board not found)';
  });
  console.log('3) #cat-board text =>', board.substring(0, 300));

  // Fetch stats same-origin (authoritative)
  const stats = await page.evaluate(async () => {
    const r = await fetch('/api/categories/stats', { credentials: 'include' });
    return { status: r.status, body: await r.json() };
  });
  console.log('4) /api/categories/stats =>', JSON.stringify({
    total: stats.body?.TOTAL_PRODUCTS,
    matched: stats.body?.MATCHED,
    unmatched: stats.body?.UNMATCHED,
    aiSuggested: stats.body?.AI_SUGGESTED,
    insufficientInput: stats.body?.INSUFFICIENT_INPUT,
    manualReview: stats.body?.MANUAL_REVIEW,
  }));

  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/ui-cat-board.png', fullPage: false });
  console.log('5) Screenshot saved.');

  // Refresh persistence
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const stats2 = await page.evaluate(async () => {
    const r = await fetch('/api/categories/stats', { credentials: 'include' });
    return await r.json();
  });
  const persistOk = stats2.UNMATCHED === stats.body.UNMATCHED && stats2.TOTAL_PRODUCTS === stats.body.TOTAL_PRODUCTS;
  console.log('6) After reload =>', JSON.stringify({ total: stats2.TOTAL_PRODUCTS, matched: stats2.MATCHED, unmatched: stats2.UNMATCHED }), 'persistOk=' + persistOk);

  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/ui-cat-board-after-reload.png', fullPage: false });

  console.log('7) Console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'NONE');

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
