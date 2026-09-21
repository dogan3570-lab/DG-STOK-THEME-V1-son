const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  
  // Login page
  await page.goto('http://localhost:5175');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-01-login.png', fullPage: false });
  console.log('Page title:', await page.title());
  console.log('URL:', page.url());
  
  // Find login form
  const inputs = await page.$$('input');
  console.log('Input count:', inputs.length);
  
  // Try login
  try {
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.fill('admin@dgstok.com');
      const passInput = await page.$('input[type="password"]');
      if (passInput) await passInput.fill('admin123');
      const btn = await page.$('button[type="submit"], button:has-text("Giriş"), button:has-text("Login")');
      if (btn) await btn.click();
      await page.waitForTimeout(3000);
      console.log('After login URL:', page.url());
      await page.screenshot({ path: 'test-02-dashboard.png', fullPage: false });
    }
  } catch (e) {
    console.log('Login error:', e.message);
  }
  
  // Navigate to kar-zarar
  await page.goto('http://localhost:5175/#/kar-zarar');
  await page.waitForTimeout(3000);
  console.log('Profit engine URL:', page.url());
  await page.screenshot({ path: 'test-03-profit-engine.png', fullPage: false });
  
  // Check page content
  const bodyText = await page.textContent('body');
  if (bodyText.includes('Finans') || bodyText.includes('Kâr') || bodyText.includes('kar')) {
    console.log('PASS: Profit engine page content found');
  } else {
    console.log('FAIL: Profit engine page content NOT found');
    console.log('Body text snippet:', bodyText.substring(0, 500));
  }
  
  if (errors.length) {
    console.log('Console errors:', errors.slice(0, 5));
  } else {
    console.log('No console errors');
  }
  
  await browser.close();
  console.log('DONE');
})();
