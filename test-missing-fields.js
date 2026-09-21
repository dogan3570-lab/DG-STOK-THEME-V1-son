const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('=== PLAYWRIGHT E2E TEST - Missing Fields ===\n');
  
  // 1. Login
  console.log('1. Login...');
  await page.goto('http://localhost:4000/login');
  await page.waitForTimeout(2000);
  
  // Check if already logged in
  const url = page.url();
  if (url.includes('/login')) {
    await page.fill('input[type="email"]', 'admin@dgstok.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  
  console.log('  URL after login:', page.url());
  
  // 2. Navigate to Product Preparation
  console.log('\n2. Navigating to Product Preparation...');
  await page.goto('http://localhost:4000/urun-havuzu');
  await page.waitForTimeout(3000);
  
  // 3. Click "Hazırlık" tab
  console.log('\n3. Looking for Preparation tab...');
  const hazirlikTab = await page.locator('text=Hazırlık').first();
  if (await hazirlikTab.isVisible()) {
    await hazirlikTab.click();
    await page.waitForTimeout(2000);
    console.log('  Clicked Hazırlık tab');
  } else {
    console.log('  Hazırlık tab not found, trying direct URL...');
    await page.goto('http://localhost:4000/urun-havuzu?tab=hazirlik');
    await page.waitForTimeout(3000);
  }
  
  // 4. Look for "Zorunlu Alanlar" tab
  console.log('\n4. Looking for Zorunlu Alanlar tab...');
  const zorunluTab = await page.locator('text=Zorunlu Alanlar').first();
  if (await zorunluTab.isVisible()) {
    console.log('  ✅ Zorunlu Alanlar tab FOUND');
    await zorunluTab.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('  ❌ Zorunlu Alanlar tab NOT FOUND');
    // Try to find all tabs
    const allButtons = await page.locator('button').allTextContents();
    console.log('  Available buttons:', allButtons.filter(t => t.length > 0 && t.length < 50).join(' | '));
  }
  
  // 5. Check badge/count
  console.log('\n5. Checking badge/count...');
  const badgeText = await page.locator('text=Kullanıcı müdahalesi gereken').first().textContent().catch(() => null);
  if (badgeText) {
    console.log('  Badge text:', badgeText);
  } else {
    // Try alternative
    const anyNumber = await page.locator('[class*="badge"], [class*="rounded-full"]').allTextContents();
    console.log('  Badge candidates:', anyNumber.filter(t => t.trim()).join(' | '));
  }
  
  // 6. Check "Eksik Zorunlu Alanları Gör" button
  console.log('\n6. Looking for detail button...');
  const detailBtn = await page.locator('text=Eksik Zorunlu Alanları Gör').first();
  if (await detailBtn.isVisible()) {
    console.log('  ✅ Detail button FOUND, clicking...');
    await detailBtn.click();
    await page.waitForTimeout(5000);
  } else {
    console.log('  ❌ Detail button NOT FOUND');
    const allBtns = await page.locator('button').allTextContents();
    console.log('  Available buttons:', allBtns.filter(t => t.length > 0 && t.length < 60).join(' | '));
  }
  
  // 7. Check if list appeared
  console.log('\n7. Checking if product list appeared...');
  const listItems = await page.locator('[class*="border"][class*="rounded"]').count();
  console.log('  Potential list items:', listItems);
  
  // Take a screenshot
  await page.screenshot({ path: 'C:\\Users\\Dogan\\AppData\\Local\\Temp\\opencode\\missing-fields-test.png', fullPage: true });
  console.log('\n  Screenshot saved to missing-fields-test.png');
  
  // 8. Check filter tabs
  console.log('\n8. Checking filter tabs...');
  const filterTabs = await page.locator('button').allTextContents();
  const fieldFilters = filterTabs.filter(t => 
    ['Tümü', 'Model', 'Beden', 'Boyut', 'Duy', 'Kamera', 'Hacim', 'Voltaj', 'Frekans'].some(f => t.includes(f))
  );
  console.log('  Field filters found:', fieldFilters.length > 0 ? fieldFilters.join(' | ') : 'NONE');
  
  // 9. Try gate detail modal
  console.log('\n9. Looking for gate detail buttons...');
  const attrButtons = await page.locator('button[title]').count();
  console.log('  Attribute buttons with title:', attrButtons);
  
  // Final state
  console.log('\n=== FINAL STATE ===');
  console.log('URL:', page.url());
  
  await browser.close();
  console.log('\nDone!');
})().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
