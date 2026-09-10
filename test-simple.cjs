const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(function() { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(1000);
  
  // Call the guard function explicitly
  await page.evaluate(function() { if (typeof catRenderGuardWarn === 'function') catRenderGuardWarn(); });
  await page.waitForTimeout(1000);
  
  console.log('=== SIMPLE VERIFICATION (with guard + delay) ===\n');
  
  // Check cat-guard-warn
  const catGuardWarn = await page.$('#cat-guard-warn');
  if (catGuardWarn) {
    const guardHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn);
    console.log('1. cat-guard-warn hidden:', guardHidden);
  } else {
    console.log('1. cat-guard-warn: NOT FOUND');
  }
  
  // Check cat-warning-modal
  const catModal = await page.$('#cat-warning-modal');
  if (catModal) {
    const modalHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catModal);
    console.log('2. cat-warning-modal hidden:', modalHidden);
  } else {
    console.log('2. cat-warning-modal: NOT FOUND');
  }
  
  // Check category table visibility
  const catTable = await page.$('#cat-table-body');
  if (catTable) {
    const tableHTML = await page.evaluate(function(el) { return el.innerHTML; }, catTable);
    console.log('3. cat-table-body has content:', tableHTML.length > 0);
    console.log('   Has "Context seçilmedi":', tableHTML.includes('Context seçilmedi'));
    // Check if it's the "Context seçilmedi" message
    const isContextMsg = tableHTML.trim() === '<div class="text-center py-12 text-slate-400">Context seçilmedi</div>';
    console.log('   Is "Context seçilmedi" message:', isContextMsg);
  } else {
    console.log('3. cat-table-body: NOT FOUND');
  }
  
  // Check toolbar
  const catToolbar = await page.$('#cat-toolbar');
  if (catToolbar) {
    const toolbarHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catToolbar);
    console.log('4. cat-toolbar hidden:', toolbarHidden);
  }
  
  // Check stepper
  const catStepper = await page.$('#cat-stepper');
  if (catStepper) {
    const stepperHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catStepper);
    console.log('5. cat-stepper hidden:', stepperHidden);
  }
  
  // Also check page visibility
  const pageCat = await page.$('#page-prep-categories');
  if (pageCat) {
    const pageHasHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, pageCat);
    console.log('6. page-prep-categories hidden:', pageHasHidden);
  }
  
  await page.waitForTimeout(2000);
  await browser.close();
})();