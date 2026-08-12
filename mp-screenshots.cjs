const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  try {
    // Login
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
      await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Navigate to marketplace
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);
    
    // Screenshot: Marketplace page
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-marketplace-page.png', fullPage: false });
    console.log('Screenshot 1: Marketplace page saved');

    // Open Add modal
    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(1000);
    
    // Screenshot: Add modal (before type selection)
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-marketplace-modal-empty.png', fullPage: false });
    console.log('Screenshot 2: Modal empty (no type selected) saved');

    // Check if credential fields are visible
    const credVisible1 = await page.evaluate(() => {
      const el = document.getElementById('mp-credential-fields');
      return el ? { hidden: el.classList.contains('hidden'), display: getComputedStyle(el).display } : 'NOT FOUND';
    });
    console.log('Credential fields before type selection:', JSON.stringify(credVisible1));

    // Select Trendyol
    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(800);

    // Screenshot: After selecting Trendyol
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-marketplace-modal-trendyol.png', fullPage: false });
    console.log('Screenshot 3: Modal with Trendyol selected saved');

    // Check credential fields now
    const credVisible2 = await page.evaluate(() => {
      const el = document.getElementById('mp-credential-fields');
      const apiFields = document.getElementById('mp-api-fields');
      const sellerFields = document.getElementById('mp-seller-fields');
      return {
        credHidden: el ? el.classList.contains('hidden') : 'NOT FOUND',
        apiFieldsHTML: apiFields ? apiFields.innerHTML.substring(0, 500) : 'NOT FOUND',
        sellerFieldsHTML: sellerFields ? sellerFields.innerHTML.substring(0, 500) : 'NOT FOUND'
      };
    });
    console.log('Credential fields after Trendyol:', JSON.stringify(credVisible2, null, 2));

    // Check specific inputs
    const inputCheck = await page.evaluate(() => {
      return {
        apiKey: document.getElementById('mp-apiKey') ? { exists: true, type: document.getElementById('mp-apiKey').type } : { exists: false },
        apiSecret: document.getElementById('mp-apiSecret') ? { exists: true, type: document.getElementById('mp-apiSecret').type } : { exists: false },
        sellerId: document.getElementById('mp-sellerId') ? { exists: true, type: document.getElementById('mp-sellerId').type } : { exists: false },
        storeId: document.getElementById('mp-storeId') ? { exists: true, type: document.getElementById('mp-storeId').type } : { exists: false }
      };
    });
    console.log('Input elements:', JSON.stringify(inputCheck, null, 2));

    // Fill and screenshot
    await page.fill('#mp-name', 'DG Test Mağazası');
    const ak = await page.$('#mp-apiKey');
    if (ak) await ak.fill('test-api-key-123');
    const as = await page.$('#mp-apiSecret');
    if (as) await as.fill('test-api-secret-456');
    const sv = await page.$('#mp-sellerId');
    if (sv) await sv.fill('12345');
    await page.waitForTimeout(500);

    // Screenshot: Filled form
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-marketplace-modal-filled.png', fullPage: false });
    console.log('Screenshot 4: Filled form saved');

    // Check save button
    const saveState = await page.$eval('#mp-save-btn', el => ({ disabled: el.disabled, text: el.textContent.trim() }));
    console.log('Save button:', JSON.stringify(saveState));

  } catch (e) {
    console.error('Error:', e.message);
  }

  await browser.close();
})();
