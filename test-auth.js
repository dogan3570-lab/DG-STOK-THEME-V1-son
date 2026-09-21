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
  const responses = [];
  page.on('response', r => {
    if (r.url().includes('/api/profit-engine/dashboard')) {
      responses.push({ url: r.url(), status: r.status() });
    }
  });
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('#nav-profit-engine').catch(()=>{});
  await page.waitForTimeout(3000);
  console.log('Errors:', errors);
  console.log('Responses:', responses);
  await browser.close();
})();