import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // login
  await page.fill('#login-email', 'admin@dg-stok.local');
  await page.fill('#login-password', 'CHANGE_ME_NOW');
  await page.click('button:has-text("Giriş Yap")');
  await page.waitForTimeout(3000);
  // navigate profit engine
  await page.click('#nav-profit-engine');
  await page.waitForTimeout(3000);
  const status = await page.locator('#profit-engine-status').innerText().catch(()=> 'no-status');
  const revenueText = await page.locator('text=Toplam Gelir').locator('..').locator('.text-2xl').innerText().catch(()=> 'no-revenue');
  console.log('Errors:', errors);
  console.log('Status:', status);
  console.log('Revenue:', revenueText);
  await browser.close();
})();