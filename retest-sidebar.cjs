const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  const apiCalls = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('PAGE_ERROR: ' + err.message));
  page.on('request', req => {
    if (req.url().includes('/profit-engine')) {
      apiCalls.push({ method: req.method(), url: req.url() });
    }
  });

  // STEP 1: Load app
  console.log('=== STEP 1: Load app ===');
  await page.goto('http://localhost:5175');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'retest-01-load.png', fullPage: false });
  
  // Debug: dump full page HTML structure
  const allText = await page.textContent('body');
  console.log('Body text:', allText.substring(0, 500));

  // STEP 2: Find and fill login form
  console.log('\n=== STEP 2: Login ===');
  
  // List ALL inputs on page
  const inputs = await page.$$('input');
  console.log('Total inputs:', inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const type = await inputs[i].getAttribute('type');
    const placeholder = await inputs[i].getAttribute('placeholder');
    const visible = await inputs[i].isVisible();
    console.log(`  [${i}] type="${type}" placeholder="${placeholder}" visible=${visible}`);
  }

  // Try filling by placeholder
  try {
    const emailInput = await page.locator('input[placeholder*="posta"], input[placeholder*="mail"], input[type="email"]').first();
    const passInput = await page.locator('input[type="password"]').first();
    
    console.log('Email input found:', await emailInput.count() > 0);
    console.log('Pass input found:', await passInput.count() > 0);
    
    await emailInput.fill('admin@dgstok.com');
    await passInput.fill('admin123');
    await page.screenshot({ path: 'retest-02-filled.png', fullPage: false });
    
    // Find login button
    const buttons = await page.$$('button');
    console.log('Total buttons:', buttons.length);
    for (let i = 0; i < buttons.length; i++) {
      const text = await buttons[i].textContent();
      const visible = await buttons[i].isVisible();
      console.log(`  btn[${i}] text="${text.trim()}" visible=${visible}`);
    }
    
    // Click login button
    const loginBtn = await page.locator('button:has-text("Giriş"), button:has-text("Giriş Yap"), button[type="submit"]').first();
    await loginBtn.click();
    console.log('Login button clicked');
    await page.waitForTimeout(4000);
    console.log('After login URL:', page.url());
    await page.screenshot({ path: 'retest-03-after-login.png', fullPage: false });
  } catch (e) {
    console.log('Login error:', e.message.substring(0, 200));
    await page.screenshot({ path: 'retest-02-error.png', fullPage: false });
  }

  // STEP 3: Check sidebar
  console.log('\n=== STEP 3: Sidebar check ===');
  const bodyText = await page.textContent('body');
  const hasKarZarar = bodyText.includes('Kâr/Zarar');
  console.log('Body has "Kâr/Zarar":', hasKarZarar);
  
  // Also look for aside/sidebar
  const aside = await page.$('aside');
  if (aside) {
    const asideText = await aside.textContent();
    console.log('Aside text:', asideText.substring(0, 300));
    console.log('Aside has Kâr/Zarar:', asideText.includes('Kâr/Zarar'));
  } else {
    console.log('No aside element found');
  }
  await page.screenshot({ path: 'retest-04-sidebar.png', fullPage: false });

  if (!hasKarZarar) {
    console.log('\nFAIL: Kâr/Zarar not found');
    console.log('Body text:', bodyText.substring(0, 500));
    console.log('Errors:', consoleErrors);
    await browser.close();
    process.exit(1);
  }

  // STEP 4: Click Kâr/Zarar
  console.log('\n=== STEP 4: Click Kâr/Zarar ===');
  try {
    await page.locator('button:has-text("Kâr/Zarar")').first().click();
    await page.waitForTimeout(4000);
    console.log('After click URL:', page.url());
    await page.screenshot({ path: 'retest-05-after-click.png', fullPage: false });
  } catch (e) {
    console.log('Click error:', e.message.substring(0, 200));
  }

  // STEP 5: Verify content
  console.log('\n=== STEP 5: Page content ===');
  const pageText = await page.textContent('body');
  const hasFinans = pageText.includes('Finans');
  const hasHesaplama = pageText.includes('Hesaplama');
  const hasKar = pageText.includes('Kâr') || pageText.includes('Kar');
  console.log('Finans:', hasFinans, '| Hesaplama:', hasHesaplama, '| Kâr:', hasKar);
  await page.screenshot({ path: 'retest-06-page.png', fullPage: false });

  // STEP 6: API calls
  console.log('\n=== STEP 6: API ===');
  console.log('Profit-engine API calls:', apiCalls.length);
  apiCalls.forEach(a => console.log('  ', a.method, a.url));

  // STEP 7: Errors
  console.log('\n=== STEP 7: Errors ===');
  const relevant = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('devtools') && !e.includes('HMR')
    && !e.includes('React DevTools') && !e.includes('[vite]')
  );
  console.log(relevant.length > 0 ? relevant : 'No errors');

  // FINAL
  console.log('\n========== RESULT ==========');
  const pass = hasKarZarar && (hasFinans || hasHesaplama || hasKar);
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
})();
