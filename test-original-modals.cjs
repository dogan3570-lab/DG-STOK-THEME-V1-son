const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(async () => {
    await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  console.log('=== ORIGINAL MODAL SYSTEM TEST ===\n');
  
  // Test 1: Context empty - check if category modal appears
  console.log('TEST 1: Kategoriler sayfası, context boş');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(2000);
  
  const catModal = await page.$('#cat-warning-modal');
  const catModalVisible = catModal ? await page.evaluate(el => !el.classList.contains('hidden'), catModal) : false;
  console.log('Category modal visible (context empty): ' + catModalVisible);
  
  const varModal = await page.$('#var-warning-modal');
  const varModalVisible = varModal ? await page.evaluate(el => !el.classList.contains('hidden'), varModal) : false;
  console.log('Variant modal visible (context empty on variants page): ' + varModalVisible);
  
  await page.screenshot({ path: '01-empty.png', fullPage: true });
  
  // Test 2: Go to variants, context empty
  console.log('\nTEST 2: Varyant sayfası, context boş');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-variants'); });
  await page.waitForTimeout(2000);
  
  const varModal2 = await page.$('#var-warning-modal');
  const varModalVisible2 = varModal2 ? await page.evaluate(el => !el.classList.contains('hidden'), varModal2) : false;
  console.log('Variant modal visible (variants page, context empty): ' + varModalVisible2);
  
  const varWarning = await page.$('#var-warning');
  const varWarningVisible = varWarning ? await page.evaluate(el => !el.classList.contains('hidden'), varWarning) : false;
  console.log('Var warning div visible (variants page, context empty): ' + varWarningVisible);
  
  await page.screenshot({ path: '02-only-xml.png', fullPage: true });
  
  // Test 3: Select context, modals should disappear
  console.log('\nTEST 3: Context seçildikten sonra modals');
  
  // Select XML from context
  await page.evaluate(() => {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(2000);
  
  const catModal3 = await page.$('#cat-warning-modal');
  const catModalVisible3 = catModal3 ? await page.evaluate(el => !el.classList.contains('hidden'), catModal3) : true;
  console.log('Category modal hidden (after context select): ' + !catModalVisible3);
  
  const varModal3 = await page.$('#var-warning-modal');
  const varModalVisible3 = varModal3 ? await page.evaluate(el => !el.classList.contains('hidden'), varModal3) : true;
  console.log('Variant modal hidden (after context select): ' + !varModalVisible3);
  
  // Check that new messages are hidden
  const catGuardWarn = await page.$('#cat-guard-warn');
  const catGuardHidden = catGuardWarn ? await page.evaluate(el => el.classList.contains('hidden'), catGuardWarn) : true;
  console.log('New cat-guard-warn hidden: ' + catGuardHidden);
  
  const varWarning2 = await page.$('#var-warning');
  const varWarningHidden = varWarning2 ? await page.evaluate(el => el.classList.contains('hidden'), varWarning2) : true;
  console.log('New var-warning hidden: ' + varWarningHidden);
  
  await page.screenshot({ path: '03-both-selected.png', fullPage: true });
  
  // Test 4: Clear context, modals should reappear
  console.log('\nTEST 4: Context temizle, modals tekrar görünmeli');
  await page.evaluate(() => { if (typeof clearContext === 'function') clearContext(); });
  await page.waitForTimeout(2000);
  
  const catModal4 = await page.$('#cat-warning-modal');
  const catModalVisible4 = catModal4 ? await page.evaluate(el => !el.classList.contains('hidden'), catModal4) : false;
  console.log('Category modal visible (after clear): ' + catModalVisible4);
  
  const varModal4 = await page.$('#var-warning-modal');
  const varModalVisible4 = varModal4 ? await page.evaluate(el => !el.classList.contains('hidden'), varModal4) : false;
  console.log('Variant modal visible (after clear): ' + varModalVisible4);
  
  await page.screenshot({ path: '05-cleared.png', fullPage: true });
  
  await page.waitForTimeout(2000);
  await browser.close();
  console.log('\n=== TEST TAMAM ===');
})();