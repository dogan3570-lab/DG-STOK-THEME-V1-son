import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  const navs = ['dashboard','products','prep-categories','prep-brands','prep-variants','prep-listings','ready-to-ship','marketplace'];
  for (const n of navs) {
    await page.click(`#nav-${n}`).catch(()=>{});
    await page.waitForTimeout(500);
  }
  await page.click('#nav-profit-engine').catch(()=>{});
  await page.waitForTimeout(500);
  await page.click('#nav-dashboard').catch(()=>{});
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(500);
  await page.click('#nav-profit-engine').catch(()=>{});
  await page.waitForTimeout(500);
  console.log('ERRORS:', JSON.stringify(errors));
  await browser.close();
})();