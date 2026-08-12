const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const results = [];
  let testNum = 0;

  function pass(name) { testNum++; results.push(`  [PASS] #${testNum} ${name}`); console.log(results[results.length-1]); }
  function fail(name, err) { testNum++; results.push(`  [FAIL] #${testNum} ${name}: ${err}`); console.error(results[results.length-1]); }

  try {
    // === LOAD PAGE ===
    console.log('\n=== LOAD PAGE ===');
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Debug: check what's on the page
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Page text:', bodyText);
    
    // Check for login modal visibility
    const loginModalVisible = await page.evaluate(() => {
      const m = document.getElementById('login-modal');
      return m ? { hidden: m.classList.contains('hidden'), display: getComputedStyle(m).display } : 'not found';
    });
    console.log('Login modal:', JSON.stringify(loginModalVisible));

    // Try to find any email/password inputs
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type, id: i.id, name: i.name, placeholder: i.placeholder, visible: i.offsetParent !== null
      }));
    });
    console.log('All inputs:', JSON.stringify(inputs, null, 2));

    // Try API login directly
    console.log('\n=== API LOGIN ===');
    const loginResult = await page.evaluate(async () => {
      try {
        const r = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' })
        });
        const data = await r.json();
        return { status: r.status, data };
      } catch(e) { return { error: e.message }; }
    });
    console.log('Login result:', JSON.stringify(loginResult));
    
    // Reload after login
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // Check if we're logged in
    const authCheck = await page.evaluate(async () => {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' });
        return await r.json();
      } catch(e) { return { error: e.message }; }
    });
    console.log('Auth check:', JSON.stringify(authCheck));

    // Navigate to marketplace
    console.log('\n=== NAVIGATE TO MARKETPLACE ===');
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');
    
    const mpContent = await page.evaluate(() => {
      const mpPage = document.getElementById('page-marketplace');
      return mpPage ? mpPage.innerText.substring(0, 300) : 'not found';
    });
    console.log('Marketplace page:', mpContent);

    // Check if marketplace table has content
    const tableRows = await page.evaluate(() => {
      const tbody = document.getElementById('mp-manage-tbody');
      return tbody ? tbody.innerHTML.substring(0, 500) : 'not found';
    });
    console.log('Table rows:', tableRows);

    // === TEST A: Open Add Modal ===
    console.log('\n=== TEST A: Open Add Modal ===');
    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(1000);
    
    const modalVisible = await page.$eval('#mp-modal', el => !el.classList.contains('hidden')).catch(() => false);
    if (modalVisible) pass('Add modal opened');
    else fail('Add modal not visible', 'modal still hidden');

    // Check save button disabled
    const saveDisabled = await page.$eval('#mp-save-btn', el => el.disabled).catch(() => true);
    if (saveDisabled) pass('Save button disabled initially');
    else fail('Save button should be disabled', 'enabled with empty form');

    // Select Trendyol
    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(500);
    await page.fill('#mp-name', 'TEST MARKETPLACE E2E');
    await page.waitForTimeout(300);

    // Check API Key field exists
    const apiKeyExists = await page.$('#mp-apiKey');
    if (apiKeyExists) {
      await apiKeyExists.fill('TEST_KEY_001');
      pass('API Key field exists and filled');
    } else {
      fail('API Key field NOT found', 'mp-apiKey missing');
    }

    // Check API Secret field exists
    const apiSecretExists = await page.$('#mp-apiSecret');
    if (apiSecretExists) {
      await apiSecretExists.fill('TEST_SECRET_001');
      pass('API Secret field exists and filled');
    } else {
      fail('API Secret field NOT found', 'mp-apiSecret missing');
    }

    // Check Seller ID field exists
    const sellerIdExists = await page.$('#mp-sellerId');
    if (sellerIdExists) {
      pass('Seller ID field exists');
      const sellerVal = await sellerIdExists.inputValue();
      if (sellerVal === '') pass('Seller ID is empty (not required for save)');
      else console.log('  Seller ID has value:', sellerVal);
    } else {
      fail('Seller ID field NOT found', 'mp-sellerId missing');
    }

    // Save should be enabled now
    await page.waitForTimeout(500);
    const saveEnabledAfterCreds = await page.$eval('#mp-save-btn', el => !el.disabled).catch(() => false);
    if (saveEnabledAfterCreds) pass('Save button ENABLED with API Key + API Secret (Seller ID empty)');
    else fail('Save button should be ENABLED', 'still disabled');

    // === TEST B: Save ===
    console.log('\n=== TEST B: Save marketplace ===');
    await page.click('#mp-save-btn');
    await page.waitForTimeout(3000);
    const modalClosedAfterSave = await page.$eval('#mp-modal', el => el.classList.contains('hidden')).catch(() => true);
    if (modalClosedAfterSave) pass('Modal closed after save');
    else fail('Modal should close', 'still open');

    // Check list
    await page.waitForTimeout(1000);
    const hasTestMp = await page.evaluate(() => document.body.innerText.includes('TEST MARKETPLACE E2E'));
    if (hasTestMp) pass('Marketplace appears in list');
    else fail('Marketplace not in list', '');

    // === TEST C: Verify via API ===
    console.log('\n=== TEST C: Verify via API ===');
    const apiData = await page.evaluate(async () => {
      const r = await fetch('/marketplace-manage', { credentials: 'include' });
      return r.json();
    });
    const testMp = (apiData.items || []).find(m => m.name === 'TEST MARKETPLACE E2E');
    if (testMp) {
      pass('Marketplace found in GET /marketplace-manage');
      if (testMp.apiKey === 'TEST_KEY_001') pass('API Key persisted in DB');
      else fail('API Key mismatch', `got: ${testMp.apiKey}`);
      if (testMp.apiSecret === 'TEST_SECRET_001') pass('API Secret persisted in DB');
      else fail('API Secret mismatch', `got: ${testMp.apiSecret}`);
      if (testMp.active === true) pass('Marketplace is active');
      else fail('Should be active', `active=${testMp.active}`);
      let settings = {};
      try { settings = JSON.parse(testMp.settings || '{}'); } catch(e) {}
      if (!settings.sellerId) pass('Seller ID empty in settings (expected)');
      else fail('Seller ID should be empty', settings.sellerId);
    } else {
      fail('Marketplace NOT found in API', '');
    }

    // === TEST D: Refresh persistence ===
    console.log('\n=== TEST D: Refresh persistence ===');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    // Re-login if needed
    const needsLogin = await page.evaluate(() => {
      const m = document.getElementById('login-modal');
      return m && !m.classList.contains('hidden');
    });
    if (needsLogin) {
      await page.evaluate(async () => {
        await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);
    const afterRefresh = await page.evaluate(() => document.body.innerText.includes('TEST MARKETPLACE E2E'));
    if (afterRefresh) pass('Marketplace persists after refresh');
    else fail('Marketplace LOST after refresh', '');

    // === TEST E: Edit ===
    console.log('\n=== TEST E: Edit ===');
    await page.evaluate(() => {
      const items = document.querySelectorAll('[onclick*="mpManageEdit"]');
      if (items.length > 0) items[0].click();
    });
    await page.waitForTimeout(2000);
    const editModalOpen = await page.$eval('#mp-modal', el => !el.classList.contains('hidden')).catch(() => false);
    if (editModalOpen) pass('Edit modal opened');
    else fail('Edit modal not opened', '');

    const editApiKey = await page.$eval('#mp-apiKey', el => el.value).catch(() => '');
    if (editApiKey === 'TEST_KEY_001') pass('API Key loaded in edit form');
    else fail('API Key not loaded', `got: ${editApiKey}`);

    const editApiSecret = await page.$eval('#mp-apiSecret', el => el.value).catch(() => '');
    if (editApiSecret === 'TEST_SECRET_001') pass('API Secret loaded in edit form');
    else fail('API Secret not loaded', `got: ${editApiSecret}`);

    const editSaveEnabled = await page.$eval('#mp-save-btn', el => !el.disabled).catch(() => false);
    if (editSaveEnabled) pass('Save enabled in edit mode');
    else fail('Save should be enabled in edit mode', 'disabled');

    // === TEST F: Update seller ID ===
    console.log('\n=== TEST F: Update seller ID ===');
    const sellerField = await page.$('#mp-sellerId');
    if (sellerField) {
      await sellerField.fill('SELLER_12345');
      await page.click('#mp-save-btn');
      await page.waitForTimeout(2000);
      const apiAfter = await page.evaluate(async () => {
        const r = await fetch('/marketplace-manage', { credentials: 'include' });
        return r.json();
      });
      const updated = (apiAfter.items || []).find(m => m.name === 'TEST MARKETPLACE E2E');
      if (updated) {
        let s = {};
        try { s = JSON.parse(updated.settings || '{}'); } catch(e) {}
        if (s.sellerId === 'SELLER_12345') pass('Seller ID updated in DB');
        else fail('Seller ID not updated', JSON.stringify(s));
        if (updated.apiKey === 'TEST_KEY_001') pass('API Key preserved after update');
        else fail('API Key lost', updated.apiKey);
        if (updated.apiSecret === 'TEST_SECRET_001') pass('API Secret preserved after update');
        else fail('API Secret lost', updated.apiSecret);
      }
    } else {
      fail('Seller ID field not found in edit', '');
    }

    // === TEST G: Delete ===
    console.log('\n=== TEST G: Delete ===');
    page.on('dialog', dialog => dialog.accept());
    await page.evaluate(() => { closeMpModal(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const btns = document.querySelectorAll('[onclick*="mpManageDelete"]');
      if (btns.length > 0) btns[0].click();
    });
    await page.waitForTimeout(2000);
    const afterDelete = await page.evaluate(() => document.body.innerText.includes('TEST MARKETPLACE E2E'));
    if (!afterDelete) pass('Marketplace removed from list');
    else fail('Marketplace still in list', '');

    const apiFinal = await page.evaluate(async () => {
      const r = await fetch('/marketplace-manage', { credentials: 'include' });
      return r.json();
    });
    const deleted = (apiFinal.items || []).find(m => m.name === 'TEST MARKETPLACE E2E');
    if (!deleted) pass('Marketplace deleted from DB');
    else fail('Marketplace still in DB', '');

  } catch (e) {
    fail('Unexpected error', e.message);
    console.error(e.stack);
  }

  console.log('\n\n=== RESULTS ===');
  const passed = results.filter(r => r.includes('[PASS]')).length;
  const failed = results.filter(r => r.includes('[FAIL]')).length;
  results.forEach(r => console.log(r));
  console.log(`\nPASSED: ${passed}/${passed + failed}`);
  if (failed > 0) console.log(`FAILED: ${failed}`);
  else console.log('ALL TESTS PASSED');

  await browser.close();
})();
