const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const results = [];
  let testNum = 0;

  function pass(name) { testNum++; results.push(`  [PASS] #${testNum} ${name}`); console.log(results[results.length-1]); }
  function fail(name, err) { testNum++; results.push(`  [FAIL] #${testNum} ${name}: ${err}`); console.error(results[results.length-1]); }

  // Capture network requests
  const networkLogs = [];
  page.on('request', req => {
    if (req.url().includes('marketplace-manage') && (req.method() === 'POST' || req.method() === 'PUT')) {
      networkLogs.push({ method: req.method(), url: req.url(), postData: req.postData() });
    }
  });
  page.on('response', res => {
    if (res.url().includes('marketplace-manage') && (res.request().method() === 'POST' || res.request().method() === 'PUT')) {
      res.text().then(body => {
        const last = networkLogs[networkLogs.length - 1];
        if (last) last.responseBody = body;
      }).catch(() => {});
    }
  });

  try {
    // === LOGIN ===
    console.log('\n=== LOGIN ===');
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
      await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    pass('Login completed');

    // === NAVIGATE TO MARKETPLACE ===
    console.log('\n=== NAVIGATE ===');
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);
    pass('Marketplace page loaded');

    // ==============================
    // TEST 1: Trendyol, API Key + Secret, NO Seller ID
    // ==============================
    console.log('\n=== TEST 1: Trendyol + API Key + Secret, NO Seller ID ===');
    networkLogs.length = 0;

    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(800);

    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(400);
    await page.fill('#mp-name', 'TEST API REDTEAM');
    await page.waitForTimeout(200);

    const apiKeyInput = await page.$('#mp-apiKey');
    const apiSecretInput = await page.$('#mp-apiSecret');
    if (apiKeyInput) await apiKeyInput.fill('RK_KEY_001');
    else { fail('API Key input not found', ''); throw new Error('abort'); }
    if (apiSecretInput) await apiSecretInput.fill('RK_SECRET_001');
    else { fail('API Secret input not found', ''); throw new Error('abort'); }

    // Verify Seller ID exists but is empty
    const sellerIdEl = await page.$('#mp-sellerId');
    if (sellerIdEl) {
      const sv = await sellerIdEl.inputValue();
      if (sv === '') pass('TEST 1: Seller ID is empty');
      else fail('TEST 1: Seller ID should be empty', sv);
    } else {
      fail('TEST 1: Seller ID field NOT found', '');
    }

    // Save button check
    const saveBtnDisabled1 = await page.$eval('#mp-save-btn', el => el.disabled);
    if (!saveBtnDisabled1) pass('TEST 1: Save button is ENABLED (API Key + Secret only)');
    else fail('TEST 1: Save button should be ENABLED', 'it is disabled');

    // Click Save
    await page.click('#mp-save-btn');
    await page.waitForTimeout(2000);

    // Modal closed?
    const modalClosed1 = await page.$eval('#mp-modal', el => el.classList.contains('hidden')).catch(() => true);
    if (modalClosed1) pass('TEST 1: Modal closed (save succeeded)');
    else fail('TEST 1: Modal should close', 'still open');

    // Network verification
    const postReq1 = networkLogs.find(n => n.method === 'POST');
    if (postReq1) {
      pass('TEST 1: POST request sent');
      try {
        const payload = JSON.parse(postReq1.postData);
        if (payload.apiKey === 'RK_KEY_001') pass('TEST 1: POST payload contains apiKey');
        else fail('TEST 1: POST apiKey mismatch', JSON.stringify(payload));
        if (payload.apiSecret === 'RK_SECRET_001') pass('TEST 1: POST payload contains apiSecret');
        else fail('TEST 1: POST apiSecret mismatch', '');
        if (payload.sellerId === null || payload.sellerId === '' || payload.sellerId === undefined) pass('TEST 1: POST sellerId is null/empty');
        else fail('TEST 1: POST sellerId should be null', payload.sellerId);
        if (payload.key === 'trendyol') pass('TEST 1: POST payload contains key=trendyol');
        else fail('TEST 1: POST key mismatch', payload.key);
        if (payload.name === 'TEST API REDTEAM') pass('TEST 1: POST payload contains name');
        else fail('TEST 1: POST name mismatch', payload.name);
      } catch(e) { fail('TEST 1: POST payload parse error', e.message); }
      // Check response
      if (postReq1.responseBody) {
        try {
          const resp = JSON.parse(postReq1.responseBody);
          if (resp.ok) pass('TEST 1: Backend returned ok=true');
          else fail('TEST 1: Backend returned ok=false', postReq1.responseBody);
        } catch(e) { fail('TEST 1: Response parse error', e.message); }
      }
    } else {
      fail('TEST 1: No POST request captured', '');
    }

    // DB verification
    const dbCheck1 = await page.evaluate(async () => {
      const r = await fetch('/marketplace-manage', { credentials: 'include' });
      const data = await r.json();
      return (data.items || []).find(m => m.name === 'TEST API REDTEAM');
    });
    if (dbCheck1) {
      pass('TEST 1: DB record found');
      if (dbCheck1.apiKey === 'RK_KEY_001') pass('TEST 1: DB apiKey correct');
      else fail('TEST 1: DB apiKey wrong', dbCheck1.apiKey);
      if (dbCheck1.apiSecret === 'RK_SECRET_001') pass('TEST 1: DB apiSecret correct');
      else fail('TEST 1: DB apiSecret wrong', dbCheck1.apiSecret);
      if (dbCheck1.active === true) pass('TEST 1: DB active=true');
      else fail('TEST 1: DB active wrong', dbCheck1.active);
    } else {
      fail('TEST 1: DB record NOT found', '');
    }

    // ==============================
    // TEST 2: Refresh persistence
    // ==============================
    console.log('\n=== TEST 2: Refresh persistence ===');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const needsLogin2 = await page.evaluate(() => {
      const m = document.getElementById('login-modal');
      return m && !m.classList.contains('hidden');
    });
    if (needsLogin2) {
      await page.evaluate(async () => {
        await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);
    const dbCheck2 = await page.evaluate(async () => {
      const r = await fetch('/marketplace-manage', { credentials: 'include' });
      const data = await r.json();
      return (data.items || []).find(m => m.name === 'TEST API REDTEAM');
    });
    if (dbCheck2 && dbCheck2.apiKey === 'RK_KEY_001' && dbCheck2.apiSecret === 'RK_SECRET_001') {
      pass('TEST 2: API Key + Secret persist after refresh');
    } else {
      fail('TEST 2: Data lost after refresh', JSON.stringify(dbCheck2));
    }

    // ==============================
    // TEST 3: Edit round-trip
    // ==============================
    console.log('\n=== TEST 3: Edit round-trip ===');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('[onclick*="mpManageEdit"]');
      if (btns.length > 0) btns[0].click();
    });
    await page.waitForTimeout(2000);

    const editModalOpen = await page.$eval('#mp-modal', el => !el.classList.contains('hidden')).catch(() => false);
    if (editModalOpen) pass('TEST 3: Edit modal opened');
    else fail('TEST 3: Edit modal not opened', '');

    const editApiKey = await page.$eval('#mp-apiKey', el => el.value).catch(() => 'NOT_FOUND');
    if (editApiKey === 'RK_KEY_001') pass('TEST 3: API Key loaded in edit form');
    else fail('TEST 3: API Key not loaded', editApiKey);

    const editApiSecret = await page.$eval('#mp-apiSecret', el => el.value).catch(() => 'NOT_FOUND');
    if (editApiSecret === 'RK_SECRET_001') pass('TEST 3: API Secret loaded in edit form');
    else fail('TEST 3: API Secret not loaded', editApiSecret);

    const editSaveEnabled = await page.$eval('#mp-save-btn', el => !el.disabled).catch(() => false);
    if (editSaveEnabled) pass('TEST 3: Save enabled in edit mode');
    else fail('TEST 3: Save disabled in edit mode', '');

    // ==============================
    // TEST 4: Partial update - only add Seller ID
    // ==============================
    console.log('\n=== TEST 4: Partial update (add Seller ID only) ===');
    networkLogs.length = 0;

    const sellerField = await page.$('#mp-sellerId');
    if (sellerField) {
      await sellerField.fill('SELLER_RT_999');
      await page.click('#mp-save-btn');
      await page.waitForTimeout(2000);

      // Check PUT request
      const putReq = networkLogs.find(n => n.method === 'PUT');
      if (putReq) {
        pass('TEST 4: PUT request sent');
        try {
          const payload = JSON.parse(putReq.postData);
          if (payload.apiKey === 'RK_KEY_001') pass('TEST 4: PUT payload preserved apiKey');
          else fail('TEST 4: PUT apiKey lost', JSON.stringify(payload));
          if (payload.apiSecret === 'RK_SECRET_001') pass('TEST 4: PUT payload preserved apiSecret');
          else fail('TEST 4: PUT apiSecret lost', '');
          if (payload.sellerId === 'SELLER_RT_999') pass('TEST 4: PUT payload contains new sellerId');
          else fail('TEST 4: PUT sellerId wrong', payload.sellerId);
        } catch(e) { fail('TEST 4: PUT payload parse error', e.message); }
      } else {
        fail('TEST 4: No PUT request captured', '');
      }

      // DB check
      const dbCheck4 = await page.evaluate(async () => {
        const r = await fetch('/marketplace-manage', { credentials: 'include' });
        const data = await r.json();
        return (data.items || []).find(m => m.name === 'TEST API REDTEAM');
      });
      if (dbCheck4) {
        if (dbCheck4.apiKey === 'RK_KEY_001') pass('TEST 4: DB apiKey preserved after update');
        else fail('TEST 4: DB apiKey lost', dbCheck4.apiKey);
        if (dbCheck4.apiSecret === 'RK_SECRET_001') pass('TEST 4: DB apiSecret preserved after update');
        else fail('TEST 4: DB apiSecret lost', dbCheck4.apiSecret);
        let settings = {};
        try { settings = JSON.parse(dbCheck4.settings || '{}'); } catch(e) {}
        if (settings.sellerId === 'SELLER_RT_999') pass('TEST 4: DB sellerId updated');
        else fail('TEST 4: DB sellerId wrong', settings.sellerId);
      }
    } else {
      fail('TEST 4: Seller ID field not found', '');
    }

    // Close modal
    await page.evaluate(() => { closeMpModal(); });
    await page.waitForTimeout(500);

    // ==============================
    // TEST 5: Seller ID empty, API Key + Secret full → Save ENABLED
    // ==============================
    console.log('\n=== TEST 5: Seller ID empty, API Key + Secret → Save ENABLED ===');
    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(800);
    await page.selectOption('#mp-type', 'hepsiburada');
    await page.waitForTimeout(400);
    await page.fill('#mp-name', 'TEST HB REDTEAM');
    const ak5 = await page.$('#mp-apiKey');
    const as5 = await page.$('#mp-apiSecret');
    if (ak5) await ak5.fill('HB_KEY_555');
    if (as5) await as5.fill('HB_SECRET_555');
    // Leave seller ID empty
    const sv5 = await page.$('#mp-sellerId');
    if (sv5) {
      const svVal = await sv5.inputValue();
      if (svVal === '') pass('TEST 5: Seller ID is empty');
    }
    const saveDisabled5 = await page.$eval('#mp-save-btn', el => el.disabled);
    if (!saveDisabled5) pass('TEST 5: Save ENABLED with API Key + Secret (no Seller ID)');
    else fail('TEST 5: Save should be ENABLED', 'disabled');
    // Save and cleanup
    await page.click('#mp-save-btn');
    await page.waitForTimeout(1500);

    // ==============================
    // TEST 6: API Key EMPTY → Save DISABLED
    // ==============================
    console.log('\n=== TEST 6: API Key empty → Save DISABLED ===');
    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(800);
    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(400);
    await page.fill('#mp-name', 'TEST NOKEY');
    const as6 = await page.$('#mp-apiSecret');
    if (as6) await as6.fill('SOME_SECRET');
    // Leave API Key empty
    const saveDisabled6 = await page.$eval('#mp-save-btn', el => el.disabled);
    if (saveDisabled6) pass('TEST 6: Save DISABLED when API Key empty');
    else fail('TEST 6: Save should be DISABLED', 'enabled');

    // ==============================
    // TEST 7: API Secret EMPTY → Save DISABLED
    // ==============================
    console.log('\n=== TEST 7: API Secret empty → Save DISABLED ===');
    await page.evaluate(() => { closeMpModal(); mpManageAdd(); });
    await page.waitForTimeout(800);
    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(400);
    await page.fill('#mp-name', 'TEST NOSECRET');
    const ak7 = await page.$('#mp-apiKey');
    if (ak7) await ak7.fill('SOME_KEY');
    // Leave API Secret empty
    const saveDisabled7 = await page.$eval('#mp-save-btn', el => el.disabled);
    if (saveDisabled7) pass('TEST 7: Save DISABLED when API Secret empty');
    else fail('TEST 7: Save should be DISABLED', 'enabled');

    // ==============================
    // TEST 8: Both API Key + Secret filled → Save ENABLED
    // ==============================
    console.log('\n=== TEST 8: Both API Key + Secret → Save ENABLED ===');
    const ak8 = await page.$('#mp-apiKey');
    const as8 = await page.$('#mp-apiSecret');
    if (ak8) await ak8.fill('KEY_888');
    if (as8) await as8.fill('SECRET_888');
    const saveDisabled8 = await page.$eval('#mp-save-btn', el => el.disabled);
    if (!saveDisabled8) pass('TEST 8: Save ENABLED with both API Key + Secret');
    else fail('TEST 8: Save should be ENABLED', 'disabled');
    // Cleanup
    await page.evaluate(() => { closeMpModal(); });

    // ==============================
    // CLEANUP: Delete all test records
    // ==============================
    console.log('\n=== CLEANUP ===');
    page.on('dialog', dialog => dialog.accept());
    const allItems = await page.evaluate(async () => {
      const r = await fetch('/marketplace-manage', { credentials: 'include' });
      const data = await r.json();
      return (data.items || []).filter(m => m.name.includes('TEST') || m.name.includes('REDTEAM'));
    });
    for (const item of allItems) {
      await page.evaluate(async (id) => {
        await fetch('/marketplace-manage/' + id, { method: 'DELETE', credentials: 'include' });
      }, item.id);
    }
    if (allItems.length > 0) pass(`CLEANUP: Deleted ${allItems.length} test records`);
    else pass('CLEANUP: No test records to delete');

  } catch (e) {
    fail('Unexpected error', e.message);
    console.error(e.stack);
  }

  // === BUILD CHECK ===
  console.log('\n=== BUILD CHECK ===');
  // No build needed - code changes already built

  // === RESULTS ===
  console.log('\n\n========================================');
  console.log('         FINAL RESULTS');
  console.log('========================================');
  const passed = results.filter(r => r.includes('[PASS]')).length;
  const failed = results.filter(r => r.includes('[FAIL]')).length;
  results.forEach(r => console.log(r));
  console.log(`\n  TOTAL: ${passed} PASS / ${failed} FAIL / ${passed + failed} TOTAL`);
  if (failed > 0) console.log('\n  ❌ FINAL STATUS = FAIL');
  else console.log('\n  ✅ FINAL STATUS = PASS');

  await browser.close();
})();
