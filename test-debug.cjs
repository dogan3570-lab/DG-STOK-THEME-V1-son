const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Navigate to categories
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(2000);
  
  // Check the actual DOM classes
  const catGuardWarn = await page.$('#cat-guard-warn');
  const catGuardClass = catGuardWarn ? await page.evaluate(function(el) { return el.className; }, catGuardWarn) : 'NOT_FOUND';
  console.log('cat-guard-warn className:', catGuardClass);
  
  const catWarningModal = await page.$('#cat-warning-modal');
  const catModalClass = catWarningModal ? await page.evaluate(function(el) { return el.className; }, catWarningModal) : 'NOT_FOUND';
  console.log('cat-warning-modal className:', catModalClass);
  
  // Check if hidden class is present
  const catHasHidden = catGuardWarn ? await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn) : false;
  console.log('cat-guard-warn has hidden class:', catHasHidden);
  
  const catModalHasHidden = catWarningModal ? await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catWarningModal) : false;
  console.log('cat-warning-modal has hidden class:', catModalHasHidden);
  
  // Now try calling the guard function manually
  await page.evaluate(function() {
    if (typeof catRenderGuardWarn === 'function') catRenderGuardWarn();
  });
  
  const catGuardWarn2 = await page.$('#cat-guard-warn');
  const catGuardClass2 = catGuardWarn2 ? await page.evaluate(function(el) { return el.className; }, catGuardWarn2) : 'NOT_FOUND';
  console.log('After catRenderGuardWarn() - cat-guard-warn className:', catGuardClass2);
  
  const catHasHidden2 = catGuardWarn2 ? await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn2) : false;
  console.log('After catRenderGuardWarn() - cat-guard-warn has hidden class:', catHasHidden2);
  
  await page.screenshot({ path: 'debug-dom.png', fullPage: true });
  
  await browser.close();
})();