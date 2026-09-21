// scripts/rt-ui-verify2.mjs
// Playwright E2E with injected auth cookie
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4000';
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

  console.log('1) Opening', BASE, '(with auth cookie)');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const me = await page.evaluate(async () => {
    const r = await fetch('/auth/me', { credentials: 'include' });
    try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status }; }
  });
  console.log('2) /auth/me =>', JSON.stringify(me).substring(0, 200));

  // Force category board load
  await page.evaluate(async () => { if (typeof window.catBoardLoad === 'function') await window.catBoardLoad(); }).catch(() => {});
  await page.waitForTimeout(2500);

  const board = await page.evaluate(() => {
    const el = document.getElementById('cat-board');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(cat-board not found)';
  });
  console.log('3) #cat-board text =>', board.substring(0, 400));

  const stats = await page.evaluate(async () => {
    const r = await fetch('/api/categories/stats', { credentials: 'include' });
    return { status: r.status, body: await r.json() };
  });
  console.log('4) /api/categories/stats (same-origin in browser) =>', JSON.stringify({
    total: stats.body?.TOTAL_PRODUCTS, matched: stats.body?.MATCHED, unmatched: stats.body?.UNMATCHED,
    aiSuggested: stats.body?.AI_SUGGESTED, insufficientInput: stats.body?.INSUFFICIENT_INPUT, manualReview: stats.body?.MANUAL_REVIEW,
  }));

  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/ui-cat-1.png', fullPage: false });

  // Refresh persistence
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { if (typeof window.catBoardLoad === 'function') await window.catBoardLoad(); }).catch(() => {});
  await page.waitForTimeout(1500);
  const stats2 = await page.evaluate(async () => {
    const r = await fetch('/api/categories/stats', { credentials: 'include' });
    return await r.json();
  });
  const board2 = await page.evaluate(() => { const el = document.getElementById('cat-board'); return el ? el.innerText.replace(/\s+/g,' ').trim() : ''; });
  const persistOk = stats2.UNMATCHED === stats.body?.UNMATCHED && stats2.TOTAL_PRODUCTS === stats.body?.TOTAL_PRODUCTS && stats2.MATCHED === stats.body?.MATCHED;
  console.log('5) After reload =>', JSON.stringify({ total: stats2.TOTAL_PRODUCTS, matched: stats2.MATCHED, unmatched: stats2.UNMATCHED }), 'persistOk=' + persistOk);
  console.log('   #cat-board after reload =>', board2.substring(0, 300));
  await page.screenshot({ path: 'C:/Users/Dogan/AppData/Local/Temp/opencode/ui-cat-2-reload.png', fullPage: false });

  console.log('6) Console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'NONE');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
