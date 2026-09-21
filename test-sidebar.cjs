const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  // 1. Login
  console.log('--- STEP 1: Login ---');
  await page.goto('http://localhost:5175');
  await page.waitForTimeout(2000);
  
  const emailInput = await page.$('input[type="email"]');
  if (emailInput) {
    await emailInput.fill('admin@dgstok.com');
    const passInput = await page.$('input[type="password"]');
    if (passInput) await passInput.fill('admin123');
    const btn = await page.$('button[type="submit"]');
    if (btn) await btn.click();
    await page.waitForTimeout(3000);
    console.log('Login done. URL:', page.url());
  } else {
    console.log('No email input found. Checking if already logged in...');
    console.log('Body text:', (await page.textContent('body')).substring(0, 300));
  }

  await page.screenshot({ path: 'test-01-after-login.png', fullPage: false });

  // 2. SIDEBAR KONTROL: "Kâr/Zarar Motoru" görünüyor mu?
  console.log('--- STEP 2: Sidebar check ---');
  const sidebarText = await page.textContent('aside');
  const hasKarZarar = sidebarText && sidebarText.includes('Kâr/Zarar');
  console.log('Sidebar has "Kâr/Zarar":', hasKarZarar);
  if (!hasKarZarar) {
    console.log('FAIL: Sidebar missing Kar/Zarar menu item');
    console.log('Sidebar text:', sidebarText);
    await browser.close();
    process.exit(1);
  }
  await page.screenshot({ path: 'test-02-sidebar.png', fullPage: false });

  // 3. TIKLA: Menüye tıkla
  console.log('--- STEP 3: Click kar-zarar menu ---');
  const karZararBtn = await page.locator('button:has-text("Kâr/Zarar")').first();
  if (karZararBtn) {
    await karZararBtn.click();
    await page.waitForTimeout(3000);
    console.log('After click URL:', page.url());
  } else {
    console.log('FAIL: Could not find kar-zarar button');
    await browser.close();
    process.exit(1);
  }
  await page.screenshot({ path: 'test-03-after-click.png', fullPage: false });

  // 4. SAYFA KONTROL: Profit Engine sayfası render edildi mi?
  console.log('--- STEP 4: Page content check ---');
  const bodyText = await page.textContent('body');
  const hasProfitEngine = bodyText.includes('Kâr/Zarar') || bodyText.includes('Hesaplama') || bodyText.includes('Finans');
  console.log('Page has profit engine content:', hasProfitEngine);
  if (!hasProfitEngine) {
    console.log('FAIL: Profit engine page not rendered');
    console.log('Body text snippet:', bodyText.substring(0, 500));
    await browser.close();
    process.exit(1);
  }
  await page.screenshot({ path: 'test-04-profit-engine.png', fullPage: false });

  // 5. API KONTROL: /api/profit-engine/* çağrıları gitti mi?
  console.log('--- STEP 5: API calls check ---');
  const apiRequests = [];
  page.on('request', req => {
    if (req.url().includes('/profit-engine')) {
      apiRequests.push(req.url());
    }
  });
  
  // Sayfayı yenile ve API çağrılarını izle
  await page.reload();
  await page.waitForTimeout(5000);
  console.log('API requests captured:', apiRequests.length);
  apiRequests.forEach(url => console.log('  ->', url));
  
  await page.screenshot({ path: 'test-05-api-calls.png', fullPage: false });

  // 6. Console error kontrolü
  console.log('--- STEP 6: Console errors ---');
  const relevantErrors = consoleErrors.filter(e => 
    !e.includes('favicon') && 
    !e.includes('devtools') && 
    !e.includes('HMR') &&
    !e.includes('Download the React DevTools')
  );
  if (relevantErrors.length > 0) {
    console.log('Console errors found:');
    relevantErrors.forEach(e => console.log('  ERROR:', e));
  } else {
    console.log('No relevant console errors');
  }

  // FINAL
  console.log('\n=== FINAL RESULT ===');
  const pass = hasKarZarar && hasProfitEngine && apiRequests.some(u => u.includes('/profit-engine'));
  console.log(pass ? 'PASS' : 'FAIL');
  
  await browser.close();
})();
