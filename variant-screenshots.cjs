const { chromium } = require('playwright');
const jwt = require('./server/node_modules/jsonwebtoken');
const JWT_SECRET = 'a-very-secure-secret-key-that-is-at-least-32-characters-long!';
const ADMIN_USER_ID = 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const token = jwt.sign({ role: 'ADMIN', sub: ADMIN_USER_ID }, JWT_SECRET, { expiresIn: '1h' });
  await page.context().addCookies([{ name: 'token', value: token, url: 'http://localhost:4000' }]);
  await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Variant sayfasına git — otomatik XML+Trendyol seçimi + dashboard + liste yüklenir
  await page.evaluate(() => showPage('prep-variants'));
  await page.waitForTimeout(4500);

  await page.screenshot({ path: 'variant-01-dashboard.png', fullPage: false });
  console.log('variant-01-dashboard.png');

  await page.screenshot({ path: 'variant-02-product-list.png', fullPage: false });
  console.log('variant-02-product-list.png');

  // Page size 200
  await page.selectOption('#var-page-size', '200');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'variant-03-page-size.png', fullPage: false });
  console.log('variant-03-page-size.png');

  // Checkbox (ilk satırı seç)
  const firstCb = await page.$('#var-products-body input[type="checkbox"]');
  if (firstCb) await firstCb.check();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'variant-04-checkbox.png', fullPage: false });
  console.log('variant-04-checkbox.png');

  // Select all
  await page.check('#var-select-all');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'variant-05-select-all.png', fullPage: false });
  console.log('variant-05-select-all.png');
  await page.uncheck('#var-select-all');

  // AUTO button loading + result
  await page.evaluate(() => { prepVariantAutoMatch(); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'variant-06-auto-button.png', fullPage: false });
  console.log('variant-06-auto-button.png');
  await page.waitForTimeout(6000);

  // AI button
  await page.evaluate(() => { prepVariantAiMatch(); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'variant-07-ai-button.png', fullPage: false });
  console.log('variant-07-ai-button.png');
  await page.waitForTimeout(8000);

  // Page 2
  await page.evaluate(() => { prepVariantPageNext(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'variant-08-pagination.png', fullPage: false });
  console.log('variant-08-pagination.png');

  // 1.901 kontrolü
  const bodyText = await page.evaluate(() => document.getElementById('page-prep-variants').innerText);
  console.log('HAS 1.901:', bodyText.includes('1.901'));
  console.log('MANUAL value:', await page.evaluate(() => document.getElementById('var-manual').textContent));
  console.log('WAITING value:', await page.evaluate(() => document.getElementById('var-waiting').textContent));

  await browser.close();
  console.log('SCREENSHOTS DONE');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
