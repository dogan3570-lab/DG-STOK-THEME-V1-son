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
  
  // Navigate to categories
  await page.evaluate(function() { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(3000);
  
  console.log('=== ACTUAL DOM STATE ===\n');
  
  // cat-guard-warn
  const catGuardWarn = await page.$('#cat-guard-warn');
  if (catGuardWarn) {
    const guardHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn);
    console.log('1. cat-guard-warn hidden:', guardHidden);
    // Check the parent div that contains the text
    const parent = catGuardWarn.parentNode;
    if (parent) {
      console.log('   parent outerHTML (first 400):', parent.outerHTML.substring(0, 400));
    }
  } else {
    console.log('1. cat-guard-warn: NOT FOUND');
  }
  
  // cat-warning-modal
  const catModal = await page.$('#cat-warning-modal');
  if (catModal) {
    const modalHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catModal);
    console.log('2. cat-warning-modal hidden:', modalHidden);
  } else {
    console.log('2. cat-warning-modal: NOT FOUND');
  }
  
  // cat-toolbar
  const catToolbar = await page.$('#cat-toolbar');
  if (catToolbar) {
    const toolbarHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catToolbar);
    console.log('3. cat-toolbar hidden:', toolbarHidden);
  }
  
  // cat-stepper
  const catStepper = await page.$('#cat-stepper');
  if (catStepper) {
    const stepperHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catStepper);
    console.log('4. cat-stepper hidden:', stepperHidden);
  }
  
  // cat-table-body
  const catTable = await page.$('#cat-table-body');
  if (catTable) {
    const tableHTML = await page.evaluate(function(el) { return el.innerHTML; }, catTable);
    console.log('5. cat-table-body HTML length:', tableHTML.length);
    console.log('   Has "Context seçilmedi":', tableHTML.includes('Context seçilmedi'));
    console.log('   First 300 chars:', tableHTML.substring(0, 300));
  } else {
    console.log('5. cat-table-body: NOT FOUND');
  }
  
  // Check page-prep-categories visibility
  const pageCat = await page.$('#page-prep-categories');
  if (pageCat) {
    const pageHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, pageCat);
    console.log('6. page-prep-categories hidden:', pageHidden);
  }
  
  console.log('\n=== ANALYSIS ===');
  console.log('cat-guard-warn is', catGuardWarn ? (await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn) ? 'HIDDEN' : 'VISIBLE') : 'NOT FOUND');
  console.log('cat-warning-modal is', catModal ? (await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catModal) ? 'HIDDEN' : 'VISIBLE') : 'NOT FOUND');
  
  await browser.close();
})();