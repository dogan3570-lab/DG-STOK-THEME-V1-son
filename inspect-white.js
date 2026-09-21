import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    errors.push({ type: msg.type(), text: msg.text() });
  });
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // click profit engine nav
  await page.click('#nav-profit-engine').catch(e => console.log('click error', e));
  await page.waitForTimeout(3000);
  const exists = await page.locator('#page-profit-engine').count();
  const hidden = await page.locator('#page-profit-engine').evaluate(el => el.classList.contains('hidden'));
  const innerHTML = await page.locator('#page-profit-engine').innerHTML().catch(()=> 'NO_ELEMENT');
  const status = await page.locator('#profit-engine-status').innerText().catch(()=> 'NO_STATUS');
  const contentHTML = await page.locator('#profit-engine-content').innerHTML().catch(()=> 'NO_CONTENT');
  // check main content visibility
  const mainHtml = await page.locator('main').innerHTML();
  console.log('Errors:', JSON.stringify(errors, null, 2));
  console.log('exists:', exists);
  console.log('hidden:', hidden);
  console.log('innerHTML length:', innerHTML.length);
  console.log('status:', status);
  console.log('contentHTML:', contentHTML.slice(0,500));
  await browser.close();
})();