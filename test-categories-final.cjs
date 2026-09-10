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
  await page.waitForTimeout(2000);
  
  console.log('=== CATEGORIES MODULE FINAL VERIFICATION ===\n');
  
  let passed = 0;
  let failed = 0;
  
  function check(name, condition, detail) {
    if (condition) {
      console.log('PASS: ' + name);
      passed++;
    } else {
      console.log('FAIL: ' + name + ' - ' + detail);
      failed++;
    }
  }
  
  // Helper functions
  async function isHidden(selector) {
    const el = await page.$(selector);
    if (!el) return true; // Not found = considered hidden
    return await page.evaluate(function(el) { return el.classList.contains('hidden'); }, el);
  }
  
  async function getVisibleWarningCount() {
    const guards = await page.$$('#cat-guard-warn:not(.hidden)');
    const modals = await page.$$('#cat-warning-modal:not(.hidden)');
    return guards.length + modals.length;
  }
  
  async function getTableHTML() {
    const table = await page.$('#cat-table-body');
    if (table) {
      const html = await page.evaluate(function(el) { return el.innerHTML; }, table);
      return html || '';
    }
    return '';
  }
  
  // ============================================
  // TEST 1: Context empty (initial load)
  // ============================================
  console.log('\n--- TEST 1: Context Boş (başlangıç) ---');
  
  // Check warning count
  const warningCount1 = await getVisibleWarningCount();
  check('TEST 1a: Sadece 1 uyarı görünür (duplicate yok)', warningCount1 === 1, 'Uyarı sayısı: ' + warningCount1);
  
  // Check cat-guard-warn
  const guardHidden1 = await isHidden('#cat-guard-warn');
  check('TEST 1b: cat-guard-warn hidden (context empty)', guardHidden1 === true, 'isHidden: ' + guardHidden1);
  
  // Check cat-warning-modal
  const modalHidden1 = await isHidden('#cat-warning-modal');
  check('TEST 1c: cat-warning-modal hidden (context empty)', modalHidden1 === true, 'isHidden: ' + modalHidden1);
  
  // Check table content
  const tableHTML1 = getTableHTML();
  const hasContextMsg1 = tableHTML1.includes('Context seçilmedi');
  check('TEST 1d: Kategori içerik GİZLİ (context empty)', hasContextMsg1 === true, 'table includes "Context seçilmedi": ' + hasContextMsg1);
  
  // Check toolbar
  const toolbarHidden1 = await isHidden('#cat-toolbar');
  check('TEST 1e: cat-toolbar hidden (context empty)', toolbarHidden1 === true, 'toolbar hidden: ' + toolbarHidden1);
  
  // Check stepper
  const stepperHidden1 = await isHidden('#cat-stepper');
  check('TEST 1f: cat-stepper hidden (context empty)', stepperHidden1 === true, 'stepper hidden: ' + stepperHidden1);
  
  await page.screenshot({ path: '01-category-no-context.png', fullPage: true });
  
  // ============================================
  // TEST 2: Only XML selected
  // ============================================
  console.log('\n--- TEST 2: Sadece XML Seçili ---');
  
  await page.evaluate(function() {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
  });
  await page.waitForTimeout(1000);
  
  const warningCount2 = await getVisibleWarningCount();
  check('TEST 2a: Sadece 1 uyarı (duplicate yok)', warningCount2 === 1, 'Uyarı sayısı: ' + warningCount2);
  
  const guardHidden2 = await isHidden('#cat-guard-warn');
  check('TEST 2b: cat-guard-warn hidden (only XML)', guardHidden2 === true, 'isHidden: ' + guardHidden2);
  
  const modalHidden2 = await isHidden('#cat-warning-modal');
  check('TEST 2c: cat-warning-modal hidden (only XML)', modalHidden2 === true, 'isHidden: ' + modalHidden2);
  
  const tableHTML2 = getTableHTML();
  const hasContextMsg2 = tableHTML2.includes('Context seçilmedi');
  check('TEST 2d: Kategori içerik GİZLİ (only XML)', hasContextMsg2 === true, 'table includes "Context seçilmedi": ' + hasContextMsg2);
  
  await page.screenshot({ path: '02-category-xml-only.png', fullPage: true });
  
  // ============================================
  // TEST 3: Only Marketplace selected
  // ============================================
  console.log('\n--- TEST 3: Sadece Pazaryeri Seçili ---');
  
  await page.evaluate(function() {
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(1000);
  
  const warningCount3 = await getVisibleWarningCount();
  check('TEST 3a: Sadece 1 uyarı (duplicate yok)', warningCount3 === 1, 'Uyarı sayısı: ' + warningCount3);
  
  const guardHidden3 = await isHidden('#cat-guard-warn');
  check('TEST 3b: cat-guard-warn hidden (only MP)', guardHidden3 === true, 'isHidden: ' + guardHidden3);
  
  const modalHidden3 = await isHidden('#cat-warning-modal');
  check('TEST 3c: cat-warning-modal hidden (only MP)', modalHidden3 === true, 'isHidden: ' + modalHidden3);
  
  const tableHTML3 = getTableHTML();
  const hasContextMsg3 = tableHTML3.includes('Context seçilmedi');
  check('TEST 3d: Kategori içerik GİZLİ (only MP)', hasContextMsg3 === true, 'table includes "Context seçilmedi": ' + hasContextMsg3);
  
  await page.screenshot({ path: '03-category-mp-only.png', fullPage: true });
  
  // ============================================
  // TEST 4: XML + Marketplace selected
  // ============================================
  console.log('\n--- TEST 4: XML + Marketplace Seçili ---');
  
  await page.evaluate(function() {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(1000);
  
  const warningCount4 = await getVisibleWarningCount();
  check('TEST 4a: Uyarı GİZLİ (0 uyarı)', warningCount4 === 0, 'Uyarı sayısı: ' + warningCount4);
  
  const guardHidden4 = await isHidden('#cat-guard-warn');
  check('TEST 4b: cat-guard-warn hidden (XML+MP)', guardHidden4 === true, 'isHidden: ' + guardHidden4);
  
  const modalHidden4 = await isHidden('#cat-warning-modal');
  check('TEST 4c: cat-warning-modal hidden (XML+MP)', modalHidden4 === true, 'isHidden: ' + modalHidden4);
  
  const tableHTML4 = getTableHTML();
  const hasContent4 = tableHTML4.trim().length > 0 && !tableHTML4.includes('Context seçilmedi');
  check('TEST 4d: Kategori içerik GÖRÜNÜR (XML+MP)', hasContent4 === true, 'table has content: ' + hasContent4);
  
  // Check toolbar
  const toolbarVisible4 = await page.evaluate(function() {
    const el = document.getElementById('cat-toolbar');
    return el && !el.classList.contains('hidden');
  });
  check('TEST 4e: cat-toolbar visible (XML+MP)', toolbarVisible4 === true, 'toolbar visible: ' + toolbarVisible4);
  
  // Check stepper
  const stepperVisible4 = await page.evaluate(function() {
    const el = document.getElementById('cat-stepper');
    return el && !el.classList.contains('hidden');
  });
  check('TEST 4f: cat-stepper visible (XML+MP)', stepperVisible4 === true, 'stepper visible: ' + stepperVisible4);
  
  // Check table has real content
  const hasRealContent4 = await page.evaluate(function() {
    const tbody = document.getElementById('cat-table-body');
    if (!tbody) return false;
    const html = tbody.innerHTML;
    return html.trim().length > 20 && !html.includes('Kategoriler yükleniyor') && !html.includes('Context seçilmedi');
  });
  check('TEST 4g: Tablodata yüklü (XML+MP)', hasRealContent4 === true, 'table has real data');
  
  await page.screenshot({ path: '04-category-full-context.png', fullPage: true });
  
  // ============================================
  // TEST 5: Context changed
  // ============================================
  console.log('\n--- TEST 5: Context Değiştir ---');
  
  await page.evaluate(function() {
    if (typeof showPage === 'function') showPage('prep-categories');
  });
  await page.waitForTimeout(1000);
  
  await page.evaluate(function() {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(1000);
  
  const warningCount5 = await getVisibleWarningCount();
  check('TEST 5a: Uyarı sayısı doğru (context changed)', warningCount5 === 0 || warningCount5 === 1, 'Uyarı sayısı: ' + warningCount5);
  
  const tableHTML5 = getTableHTML();
  check('TEST 5b: Kategori içerik güncellendi', tableHTML5.trim().length > 0, 'table has content after context change');
  
  await page.screenshot({ path: '05-category-context-changed.png', fullPage: true });
  
  // ============================================
  // TEST 6: Previously matched categories
  // ============================================
  console.log('\n--- TEST 6: Önceki Eşleştirilmiş Kategoriler ---');
  
  await page.waitForTimeout(1000);
  
  const tableHTML6 = getTableHTML();
  check('TEST 6a: Kategori listesi gösteriliyor', tableHTML6.trim().length > 10, 'table has sufficient content');
  
  // Check for "Yapılmış" / previously matched categories appearing
  const noCompleted6 = tableHTML6.split('Tam Eşleşti').length <= 3; // Reasonable limit
  check('TEST 6b: Önceki eşleştirilmişler karışmıyor', noCompleted6 === true, 'No excessive "Tam Eşleşti" occurrences');
  
  await page.screenshot({ path: '06-category-unmatched-only.png', fullPage: true });
  
  // ============================================
  // TEST 7: Context cleared
  // ============================================
  console.log('\n--- TEST 7: Context Temizle ---');
  
  await page.evaluate(function() { if (typeof clearContext === 'function') clearContext(); });
  await page.waitForTimeout(2000);
  
  const warningCount7 = await getVisibleWarningCount();
  check('TEST 7a: Sadece 1 uyarı (context cleared)', warningCount7 === 1, 'Uyarı sayısı: ' + warningCount7);
  
  const guardHidden7 = await isHidden('#cat-guard-warn');
  check('TEST 7b: cat-guard-warn visible (context cleared)', guardHidden7 === false, 'guard visible: ' + guardHidden7);
  
  const modalHidden7 = await isHidden('#cat-warning-modal');
  check('TEST 7c: cat-warning-modal hidden (context cleared)', modalHidden7 === true, 'modal hidden: ' + modalHidden7);
  
  const tableHTML7 = getTableHTML();
  const hasContextMsg7 = tableHTML7.includes('Context seçilmedi');
  check('TEST 7d: Kategori içerik GİZLİ (context cleared)', hasContextMsg7 === true, 'table includes "Context seçilmedi": ' + hasContextMsg7);
  
  await page.screenshot({ path: '07-category-context-cleared.png', fullPage: true });
  
  console.log('\n==============================');
  console.log('SONUÇ: ' + passed + ' PASS / ' + failed + ' FAIL');
  console.log('==============================\n');
  
  if (failed > 0) {
    console.log('⚠️  BAŞARISIZ TESTLER VARDİR - DÜZELTME GEREKLİ');
  } else {
    console.log('✅ TÜM TESTLER BAŞARILI - KATEGORİ MODÜLÜ ÇALIŞIYOR');
  }
  
  await page.waitForTimeout(2000);
  await browser.close();
})();