const { chromium } = require('playwright');
const http = require('http');

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 4000, method, path, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve(b); } }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  
  // Login
  await page.goto('http://localhost:4000', { timeout: 15000 });
  await page.evaluate(() => { doLogin(); });
  await page.waitForTimeout(3000);
  
  // Navigate to brand matching
  await page.evaluate(() => { showPage('prep-brands'); });
  await page.waitForTimeout(1500);
  
  console.log('=== TEST 1: XML Kaynağı → XML Markası ===');
  // Select AKILLIBAYI1 (index 2 since sources ordered by API: RT_TEST_XML_UPD=1, AKILLIBAYI1=2)
  const sourceOptions = await page.evaluate(() => {
    const el = document.getElementById('br-xml-source');
    return Array.from(el.options).map((o, i) => i + '=' + o.textContent);
  });
  console.log('Source options:', sourceOptions);
  const akilliIdx = sourceOptions.findIndex(o => o.includes('AKILLIBAYI'));
  console.log('AKILLIBAYI index:', akilliIdx);
  await page.selectOption('#br-xml-source', { index: akilliIdx });
  await page.waitForTimeout(1500);
  const xmlBrandOptions = await page.evaluate(() => {
    const el = document.getElementById('br-xml-brand');
    return Array.from(el.options).map(o => o.textContent);
  });
  check('TEST 1a: XML brands loaded', xmlBrandOptions.length > 1, 'Options: ' + xmlBrandOptions.join(', '));
  check('TEST 1b: HOBİBAHÇEM not in XML brands', !xmlBrandOptions.some(o => o.includes('HOBİBAHÇEM')), 'Options: ' + xmlBrandOptions.join(', '));
  check('TEST 1c: akilli bayi in XML brands', xmlBrandOptions.some(o => o.includes('akilli bayi')), 'Options: ' + xmlBrandOptions.join(', '));
  
  // Select akilli bayi brand (first option after placeholder)
  const brandOptions = await page.evaluate(() => {
    const el = document.getElementById('br-xml-brand');
    return Array.from(el.options).map((o, i) => i + '=' + o.textContent);
  });
  console.log('Brand options:', brandOptions);
  const akilliBrandIdx = brandOptions.findIndex(o => o.includes('akilli bayi'));
  console.log('akilli bayi index:', akilliBrandIdx);
  await page.selectOption('#br-xml-brand', { index: akilliBrandIdx });
  await page.waitForTimeout(1500);
  
  console.log('=== TEST 2: Manuel Marka + Button state ===');
  const matchBtnDisabled = await page.locator('#br-match-btn').isDisabled();
  check('TEST 2a: Match button disabled without manual brand', matchBtnDisabled);
  
  await page.fill('#br-manual-brand', 'TEST MARKA');
  await page.waitForTimeout(500);
  const matchBtnEnabled = !(await page.locator('#br-match-btn').isDisabled());
  check('TEST 2b: Match button enabled after manual brand', matchBtnEnabled);
  
  console.log('=== TEST 3: Marka Eşleştir (Preview) ===');
  await page.click('#br-match-btn');
  await page.waitForTimeout(3000);
  
  const summaryVisible = await page.evaluate(() => {
    const el = document.getElementById('br-summary');
    return el && !el.className.includes('hidden');
  });
  check('TEST 3a: Summary visible after match', summaryVisible);
  
  const saveBtnDisabled = await page.locator('#br-save-btn').isDisabled();
  check('TEST 3b: Save button enabled after preview', !saveBtnDisabled);
  
  const productsVisible = await page.evaluate(() => {
    const el = document.getElementById('br-products-section');
    return el && !el.className.includes('hidden');
  });
  check('TEST 3c: Products section visible', productsVisible);
  
  const productDisplay = await page.evaluate(() => {
    const rows = document.querySelectorAll('#br-products-body tr');
    if (rows.length === 0) return null;
    const firstCell = rows[0].querySelector('td:nth-child(2)');
    return firstCell ? firstCell.textContent : null;
  });
  check('TEST 3d: Product shows MARKA ® format', productDisplay && productDisplay.includes('®'), 'Display: ' + (productDisplay || '').substring(0, 60));
  
  console.log('=== TEST 4: Kaydet (Save) ===');
  await page.click('#br-save-btn');
  await page.waitForTimeout(8000);
  
  const afterSave = await page.evaluate(() => {
    const statusEl = document.getElementById('br-sum-status');
    return statusEl ? statusEl.textContent : null;
  });
  check('TEST 4a: Status shows "Kaydedildi"', afterSave && afterSave.includes('Kaydedildi'), 'Status: ' + afterSave);
  
  console.log('=== TEST 5: DB persist after reload ===');
  await page.reload({ timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { doLogin(); });
  await page.waitForTimeout(2000);
  
  const login2 = await apiCall('POST', '/auth/login', { email: 'admin@dgstok.com', password: 'admin123' });
  const t = login2.token;
  const dbCheck = await apiCall('GET', '/brands?search=' + encodeURIComponent('TEST MARKA'), null, t);
  const testBrand = (dbCheck.items || []).find(b => b.name === 'TEST MARKA');
  check('TEST 5a: Brand exists in DB', !!testBrand, 'Brand: ' + JSON.stringify(testBrand?.name));
  
  console.log('=== TEST 6: DB product brand update ===');
  if (testBrand) {
    const products = await apiCall('GET', '/brands/products?page=1&limit=3&xmlBrandName=' + encodeURIComponent('akilli bayi'), null, t);
    const total = products.pagination?.total || 0;
    check('TEST 6a: Products with xmlBrandName=akilli bayi exist', total > 0, 'Total: ' + total);
  }
  
  console.log('=== TEST 7: Pagination ===');
  await page.evaluate(() => { showPage('prep-brands'); });
  await page.waitForTimeout(1500);
  await page.selectOption('#br-xml-source', { index: akilliIdx });
  await page.waitForTimeout(1500);
  const brandOpts2 = await page.evaluate(() => {
    const el = document.getElementById('br-xml-brand');
    return Array.from(el.options).map((o, i) => i + '=' + o.textContent);
  });
  const akilliBrandIdx2 = brandOpts2.findIndex(o => o.includes('akilli bayi'));
  await page.selectOption('#br-xml-brand', { index: akilliBrandIdx2 });
  await page.waitForTimeout(1500);
  
  const pageInfo = await page.evaluate(() => {
    const info = document.getElementById('br-page-info');
    return info ? info.textContent : null;
  });
  check('TEST 7a: Page info shows count', pageInfo && pageInfo.includes('ürün'), 'Page info: ' + pageInfo);
  
  // Test size buttons
  const sizeBtns = await page.locator('.br-size-btn').count();
  check('TEST 7b: Size buttons exist (5)', sizeBtns === 5, 'Count: ' + sizeBtns);
  
  console.log('=== TEST 8: Tümünü Seç ===');
  const selectAllExists = await page.locator('#br-select-all').count();
  check('TEST 8a: Select All checkbox exists', selectAllExists === 1);
  
  console.log('=== TEST 9: XML kaynağı değiştir ===');
  await page.selectOption('#br-xml-source', { index: 0 });
  await page.waitForTimeout(500);
  const xmlBrandReset = await page.evaluate(() => {
    const el = document.getElementById('br-xml-brand');
    return el.disabled;
  });
  check('TEST 9a: XML brand select disabled after source change', xmlBrandReset);
  
  console.log('=== TEST 10: Yeni Marka Ekle kaldırıldı ===');
  const addBrandBtn = await page.locator('#br-add-brand-btn').count();
  check('TEST 10a: Yeni Marka Ekle button removed', addBrandBtn === 0);
  
  const manualModal = await page.locator('#br-manual-modal').count();
  check('TEST 10b: Manual modal removed', manualModal === 0);
  
  console.log('=== TEST 11: Dark/Light tema ===');
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  check('TEST 11a: Theme state exists', typeof isDark === 'boolean', 'isDark: ' + isDark);
  
  console.log('=== TEST 12: Diğer modüller ===');
  const pages = ['dashboard', 'xml', 'products', 'prep-categories', 'prep-variants', 'prep-listings', 'ready-to-ship', 'marketplace', 'orders', 'reports', 'settings'];
  let allPagesOk = true;
  for (const p of pages) {
    await page.evaluate((pg) => { showPage(pg); }, p);
    await page.waitForTimeout(300);
    const visible = await page.evaluate((pg) => {
      const el = document.getElementById('page-' + pg);
      return el && !el.className.includes('hidden');
    }, p);
    if (!visible) { allPagesOk = false; console.log('  Page ' + p + ' NOT visible'); }
  }
  check('TEST 12a: All other modules accessible', allPagesOk);
  
  // Cleanup test brand
  console.log('=== CLEANUP ===');
  if (testBrand) {
    const del = await apiCall('DELETE', '/brands/' + testBrand.id, null, t);
    console.log('Cleanup: DELETE ' + testBrand.name + ' → ' + (del === '' || del === null ? '204' : JSON.stringify(del)));
  }
  
  console.log('\n========================================');
  console.log('  RED TEAM BRAND RESULTS');
  console.log('========================================');
  console.log('TOTAL: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('FINAL STATUS = ' + (fail === 0 ? 'PASS' : 'FAIL'));
  if (errors.length) console.log('JS Errors:', errors);
  
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
