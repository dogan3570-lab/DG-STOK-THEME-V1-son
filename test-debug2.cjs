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
  
  console.log('=== DEBUGGING WARNING COUNT ===\n');
  
  // Count visible warnings
  const visibleGuards = await page.$$('#cat-guard-warn:not(.hidden)');
  const visibleModals = await page.$$('#cat-warning-modal:not(.hidden)');
  console.log('Visible cat-guard-warn count:', visibleGuards.length);
  console.log('Visible cat-warning-modal count:', visibleModals.length);
  console.log('Total visible warnings:', visibleGuards.length + visibleModals.length);
  
  // Check individual element hidden status
  const catGuardWarn = await page.$('#cat-guard-warn');
  if (catGuardWarn) {
    const guardHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catGuardWarn);
    console.log('cat-guard-warn has hidden class:', guardHidden);
  }
  
  const catModal = await page.$('#cat-warning-modal');
  if (catModal) {
    const modalHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catModal);
    console.log('cat-warning-modal has hidden class:', modalHidden);
  }
  
  // Check if showPage context early return code ran
  // by checking the table body
  const catTable = await page.$('#cat-table-body');
  if (catTable) {
    const tableHTML = await page.evaluate(function(el) { return el.innerHTML; }, catTable);
    console.log('cat-table-body innerHTML:', tableHTML.substring(0, 200));
    console.log('Has "Context seçilmedi":', tableHTML.includes('Context seçilmedi'));
  }
  
  // Check toolbar and stepper
  const catToolbar = await page.$('#cat-toolbar');
  if (catToolbar) {
    const toolbarHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catToolbar);
    console.log('cat-toolbar hidden:', toolbarHidden);
  }
  
  const catStepper = await page.$('#cat-stepper');
  if (catStepper) {
    const stepperHidden = await page.evaluate(function(el) { return el.classList.contains('hidden'); }, catStepper);
    console.log('cat-stepper hidden:', stepperHidden);
  }
  
  await page.waitForTimeout(3000);
  await browser.close();
})();