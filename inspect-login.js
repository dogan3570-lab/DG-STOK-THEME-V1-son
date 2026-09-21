import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:4000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const loginModal = await page.locator('#login-modal').count();
  const loginModalHidden = await page.locator('#login-modal').evaluate(el => el.classList.contains('hidden')).catch(()=> 'no');
  const bodyHtml = await page.content();
  console.log('loginModal count:', loginModal);
  console.log('loginModal hidden:', loginModalHidden);
  // list nav links
  const navs = await page.locator('nav a[id^="nav-"]').evaluateAll(els => els.map(e => ({ id: e.id, text: e.innerText })));
  console.log('navs:', navs);
  await browser.close();
})();