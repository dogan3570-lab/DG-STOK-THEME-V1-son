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
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  function log(name, condition, detail) {
    if (condition) {
      console.log('PASS: ' + name);
      testsPassed++;
    } else {
      console.log('FAIL: ' + name + ' - ' + detail);
      testsFailed++;
    }
  }
  
  // Helper to check if element is hidden
  async function isHidden(selector) {
    const el = await page.$(selector);
    if (!el) return true; // Not found = considered hidden
    return await page.evaluate(el => el.classList.contains('hidden'), el);
  }
  
  async function getWarningCount() {
    const guards = await page.$$('#cat-guard-warn:not(.hidden)');
    const modals = await page.$$('#cat-warning-modal:not(.hidden)');
    return { guardCount: guards.length, modalCount: modals.length };
  }
  
  // Helper to check if category content is visible
  async function isCategoryContentVisible() {
    const table = await page.$('#cat-table-body');
    if (!table) return false;
    const html = await page.evaluate(el => el.innerHTML, table);
    return html.trim().length > 0 && !html.includes('Context seçilmedi');
  }
  
  // ==================== TEST 1: Context empty (initial load) ====================
  console.log('\n=== TEST 1: Başlangıç - Context Boş ===');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(2000);
  
  const { guardCount: gc1, modalCount: mc1 } = await getWarningCount();
  log('TEST 1a: Uyarı sayısı = 1 (tek uyarı)', gc1 + mc1 === 1, 'Uyarı sayısı: ' + (gc1 + mc1));
  log('TEST 1b: cat-guard-warn hidden', await isHidden('#cat-guard-warn'), 'isHidden');
  log('TEST 1c: cat-warning-modal hidden', await isHidden('#cat-warning-modal'), 'isHidden');
  log('TEST 1d: Kategori içerik GİZLİ', !await isCategoryContentVisible(), 'content visible');
  
  await page.screenshot({ path: '01-categories-context-empty.png', fullPage: true });
  
  // ==================== TEST 2: Only XML selected ====================
  console.log('\n=== TEST 2: Sadece XML Seçili ===');
  
  // Select XML from context
  await page.evaluate(() => {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
  });
  await page.waitForTimeout(1000);
  
  const { guardCount: gc2, modalCount: mc2 } = await getWarningCount();
  log('TEST 2a: Uyarı sayısı = 1 (tek uyarı)', gc2 + mc2 === 1, 'Uyarı sayısı: ' + (gc2 + mc2));
  log('TEST 2b: cat-guard-warn hidden', await isHidden('#cat-guard-warn'));
  log('TEST 2c: cat-warning-modal hidden', await isHidden('#cat-warning-modal'));
  log('TEST 2d: Kategori içerik GİZLİ (marketplace boş)', !await isCategoryContentVisible(), 'content visible');
  
  await page.screenshot({ path: '02-categories-xml-only.png', fullPage: true });
  
  // ==================== TEST 3: Only Marketplace selected ====================
  console.log('\n=== TEST 3: Sadece Pazaryeri Seçili ===');
  
  // Select marketplace from context
  await page.evaluate(() => {
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(1000);
  
  const { guardCount: gc3, modalCount: mc3 } = await getWarningCount();
  log('TEST 3a: Uyarı sayısı = 1 (tek uyarı)', gc3 + mc3 === 1, 'Uyarı sayısı: ' + (gc3 + mc3));
  log('TEST 3b: cat-guard-warn hidden', await isHidden('#cat-guard-warn'));
  log('TEST 3c: cat-warning-modal hidden', await isHidden('#cat-warning-modal'));
  log('TEST 3d: Kategori içerik GİZLİ (XML boş)', !await isCategoryContentVisible(), 'content visible');
  
  await page.screenshot({ path: '03-categories-mp-only.png', fullPage: true });
  
  // ==================== TEST 4: XML + Marketplace selected ====================
  console.log('\n=== TEST 4: XML + Marketplace Seçili ===');
  
  // Both should already be selected from previous tests, but let's ensure
  // If not, select them
  await page.evaluate(() => {
    const xmlSel = document.getElementById('context-xml-source');
    const mpSel = document.getElementById('context-marketplace');
    if (xmlSel && xmlSel.value) {
      // Already have selection
    }
  });
  await page.waitForTimeout(1000);
  
  // Call the context change handlers to ensure state is synced
  await page.evaluate(() => {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(1000);
  
  const { guardCount: gc4, modalCount: mc4 } = await getWarningCount();
  log('TEST 4a: Uyarı sayısı = 0 (uyarı gizli)', gc4 + mc4 === 0, 'Uyarı sayısı: ' + (gc4 + mc4));
  log('TEST 4b: cat-guard-warn hidden', await isHidden('#cat-guard-warn'));
  log('TEST 4c: cat-warning-modal hidden', await isHidden('#cat-warning-modal'));
  log('TEST 4d: Kategori içerik GÖRÜNÜR', await isCategoryContentVisible(), 'content visible');
  log('TEST 4e: Tablo gözetebilir', await page.$eval('#cat-table-body', el => el.innerHTML.trim().length > 0));
  log('TEST 4f: Adım atlama elementi gözetebilir', await page.$eval('#cat-stepper', el => !el.classList.contains('hidden')));
  
  await page.screenshot({ path: '04-categories-full-context.png', fullPage: true });
  
  // ==================== TEST 5: Context cleared ====================
  console.log('\n=== TEST 5: Context Temizle ===');
  await page.evaluate(() => { if (typeof clearContext === 'function') clearContext(); });
  await page.waitForTimeout(2000);
  
  const { guardCount: gc5, modalCount: mc5 } = await getWarningCount();
  log('TEST 5a: Uyarı sayısı = 1 (tek uyarı)', gc5 + mc5 === 1, 'Uyarı sayısı: ' + (gc5 + mc5));
  log('TEST 5b: cat-guard-warn visible', !await isHidden('#cat-guard-warn'), 'should be visible');
  log('TEST 5c: cat-warning-modal hidden', await isHidden('#cat-warning-modal'), 'should be hidden');
  log('TEST 5d: Kategori içerik GİZLİ', !await isCategoryContentVisible(), 'content visible');
  
  await page.screenshot({ path: '05-categories-cleared.png', fullPage: true });
  
  // ==================== TEST 6: Context changed ====================
  console.log('\n=== TEST 6: Context Değiştir ===');
  
  // First, select new XML + marketplace
  await page.evaluate(() => {
    if (typeof showPage === 'function') showPage('prep-categories');
  });
  await page.waitForTimeout(1000);
  
  // Select XML
  await page.evaluate(() => {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
  });
  await page.waitForTimeout(500);
  
  // Select marketplace
  await page.evaluate(() => {
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(500);
  
  // Verify state
  const { guardCount: gc6, modalCount: mc6 } = await getWarningCount();
  log('TEST 6a: Uyarı sayısı = 0 (uyarı gizli)', gc6 + mc6 === 0, 'Uyarı sayısı: ' + (gc6 + mc6));
  log('TEST 6b: Kategori içerik güncellendi', await isCategoryContentVisible(), 'content visible');
  
  await page.screenshot({ path: '06-categories-context-changed.png', fullPage: true });
  
  await page.waitForTimeout(2000);
  await browser.close();
  
  console.log('\n====================');
  console.log('TEST BAŞARILARI: ' + testsPassed);
  console.log('TEST BAŞARISIZLARI: ' + testsFailed);
  console.log('====================');
  
  if (testsFailed > 0) process.exit(1);
})();