import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  // Login
  await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  await page.evaluate(async () => {
    await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  console.log('=== TEST 1: Context Empty ===');
  // Check context selector is empty
  const xmlSource = await page.$('#context-xml-source');
  const mpSource = await page.$('#context-marketplace');
  const xmlVal = await xmlSource?.evaluate(el => el.value);
  const mpVal = await mpSource?.evaluate(el => el.value);
  
  console.log('XML Source value:', xmlVal);
  console.log('Marketplace value:', mpVal);
  
  // Take screenshot
  await page.screenshot({ path: '01-context-empty.png', fullPage: true });
  console.log('Screenshot: 01-context-empty.png');
  
  // Check if context required warning is visible
  const contextRequired = await page.$('#context-required');
  const contextRequiredVisible = await contextRequired?.evaluate(el => el.classList.contains('hidden'));
  console.log('context-required hidden:', contextRequiredVisible);
  
  await page.waitForTimeout(2000);
  await browser.close();
  console.log('Test 1 complete');
})().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});