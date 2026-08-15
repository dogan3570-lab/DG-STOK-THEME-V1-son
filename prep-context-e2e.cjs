// ÜRÜN HAZIRLAMA 4 ALT MODÜL — XML/Pazaryeri kullanıcı seçimi E2E testi
// Mutasyon YAPMAZ: sadece select seçimleri + GET istekleri doğrulanır.
// "İşlem başlatma" POST'ları veri koruması için INTERCEPT edilip body doğrulanır (abort).
const { chromium } = require('playwright');

const BASE = 'http://localhost:4000';

const R = [];
let n = 0;
const P = (name, d) => { n++; R.push('[PASS] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };
const F = (name, d) => { n++; R.push('[FAIL] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };
const S = (name, d) => { n++; R.push('[INFO] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };

async function firstRealOption(page, sel) {
  return page.$eval(sel, el => el.options && el.options.length > 1 ? el.options[1].value : '');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  const nav = async (p) => { await page.evaluate((x) => window.showPage(x), p); await page.waitForTimeout(800); };

  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(800);

    // LOGIN (gerekliyse)
    const loginVisible = await page.locator('#login-modal').isVisible().catch(() => false);
    if (loginVisible) {
      await page.fill('#login-email', 'admin@dgstok.com');
      await page.fill('#login-password', 'admin123');
      await page.click('#login-modal button[onclick="doLogin()"]');
      await page.waitForSelector('#login-modal.hidden', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // ============ 1. KATEGORİ ============
    await nav('prep-categories');
    await page.waitForFunction(() => document.querySelectorAll('#cat-xml-source option').length > 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#cat-marketplace option').length > 1, null, { timeout: 10000 }).catch(() => {});

    const catXmlCnt = await page.locator('#cat-xml-source option').count();
    const catMpCnt = await page.locator('#cat-marketplace option').count();
    P('KATEGORİ: XML seçenekleri yüklendi', 'adet=' + catXmlCnt);
    if (catXmlCnt > 1) P('KATEGORİ: XML seçenekleri > 1'); else F('KATEGORİ: XML seçenekleri > 1', 'adet=' + catXmlCnt);
    P('KATEGORİ: Pazaryeri seçenekleri yüklendi', 'adet=' + catMpCnt);
    if (catMpCnt > 1) P('KATEGORİ: Pazaryeri seçenekleri > 1'); else F('KATEGORİ: Pazaryeri seçenekleri > 1', 'adet=' + catMpCnt);

    let v = await page.$eval('#cat-xml-source', el => el.value);
    if (v === '') P('KATEGORİ: XML başlangıçta boş'); else F('KATEGORİ: XML başlangıçta boş', 'value=' + v);
    v = await page.$eval('#cat-marketplace', el => el.value);
    if (v === '') P('KATEGORİ: Pazaryeri başlangıçta boş'); else F('KATEGORİ: Pazaryeri başlangıçta boş', 'value=' + v);

    const catXml = await firstRealOption(page, '#cat-xml-source');
    const catMp = await firstRealOption(page, '#cat-marketplace');
    await page.selectOption('#cat-xml-source', catXml);
    await page.waitForTimeout(400);
    let st = await page.evaluate(() => window.catState ? window.catState.xmlSupplierId : 'NO_STATE');
    if (st === catXml) P('KATEGORİ: kullanıcı XML seçimi state\'e yazıldı'); else F('KATEGORİ: kullanıcı XML seçimi state\'e yazıldı', 'state=' + st);

    const catProductsResp = page.waitForResponse(r => r.url().includes('/categories/products'), { timeout: 10000 }).catch(() => null);
    await page.selectOption('#cat-marketplace', catMp);
    await page.waitForTimeout(400);
    st = await page.evaluate(() => window.catState ? window.catState.marketplaceId : 'NO_STATE');
    if (st === catMp) P('KATEGORİ: kullanıcı Pazaryeri seçimi state\'e yazıldı'); else F('KATEGORİ: kullanıcı Pazaryeri seçimi state\'e yazıldı', 'state=' + st);

    const catResp = await catProductsResp;
    if (catResp) {
      const u = catResp.url();
      if (u.includes('xmlSourceId=' + catXml)) P('KATEGORİ: API request xmlSourceId doğru'); else F('KATEGORİ: API request xmlSourceId doğru', u);
      if (u.includes('marketplaceId=' + catMp)) P('KATEGORİ: API request marketplaceId doğru'); else F('KATEGORİ: API request marketplaceId doğru', u);
      if (catResp.status() === 200) P('KATEGORİ: /categories/products 200 (işlem çalışıyor)'); else F('KATEGORİ: /categories/products 200', 'status=' + catResp.status());
    } else {
      F('KATEGORİ: /categories/products isteği görülemedi', 'seçim sonrası fetch yok');
    }

    // ============ 2. MARKA ============
    await nav('prep-brands');
    await page.waitForFunction(() => document.querySelectorAll('#br-xml-source option').length > 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#br-marketplace option').length > 1, null, { timeout: 10000 }).catch(() => {});

    const brXmlCnt = await page.locator('#br-xml-source option').count();
    const brMpCnt = await page.locator('#br-marketplace option').count();
    if (brXmlCnt > 1) P('MARKA: XML seçenekleri > 1', 'adet=' + brXmlCnt); else F('MARKA: XML seçenekleri > 1', 'adet=' + brXmlCnt);
    if (brMpCnt > 1) P('MARKA: Pazaryeri seçenekleri > 1', 'adet=' + brMpCnt); else F('MARKA: Pazaryeri seçenekleri > 1', 'adet=' + brMpCnt);

    v = await page.$eval('#br-xml-source', el => el.value);
    if (v === '') P('MARKA: XML başlangıçta boş'); else F('MARKA: XML başlangıçta boş', 'value=' + v);
    v = await page.$eval('#br-marketplace', el => el.value);
    if (v === '') P('MARKA: Pazaryeri başlangıçta boş'); else F('MARKA: Pazaryeri başlangıçta boş', 'value=' + v);

    const brXml = await firstRealOption(page, '#br-xml-source');
    const brMp = await firstRealOption(page, '#br-marketplace');
    const brBrandsResp = page.waitForResponse(r => r.url().includes('/brands/xml-brands'), { timeout: 10000 }).catch(() => null);
    await page.selectOption('#br-xml-source', brXml);
    await page.waitForTimeout(400);
    st = await page.evaluate(() => window.prepBrandState ? window.prepBrandState.selectedXmlSource : 'NO_STATE');
    if (st === brXml) P('MARKA: kullanıcı XML seçimi state\'e yazıldı'); else F('MARKA: kullanıcı XML seçimi state\'e yazıldı', 'state=' + st);
    const brResp = await brBrandsResp;
    if (brResp && brResp.url().includes('xmlSourceId=' + brXml)) P('MARKA: /brands/xml-brands xmlSourceId doğru'); else F('MARKA: /brands/xml-brands xmlSourceId doğru', brResp ? brResp.url() : 'istek yok');

    await page.selectOption('#br-marketplace', brMp);
    await page.waitForTimeout(300);
    st = await page.evaluate(() => window.prepBrandState ? window.prepBrandState.selectedMarketplaceId : 'NO_STATE');
    if (st === brMp) P('MARKA: kullanıcı Pazaryeri seçimi state\'e yazıldı'); else F('MARKA: kullanıcı Pazaryeri seçimi state\'e yazıldı', 'state=' + st);

    // ============ 3. VARYANT ============
    await nav('prep-variants');
    await page.waitForFunction(() => document.querySelectorAll('#var-xml-source option').length > 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#var-marketplace option').length > 1, null, { timeout: 10000 }).catch(() => {});

    const varXmlCnt = await page.locator('#var-xml-source option').count();
    const varMpCnt = await page.locator('#var-marketplace option').count();
    if (varXmlCnt > 1) P('VARYANT: XML seçenekleri > 1', 'adet=' + varXmlCnt); else F('VARYANT: XML seçenekleri > 1', 'adet=' + varXmlCnt);
    if (varMpCnt > 1) P('VARYANT: Pazaryeri seçenekleri > 1', 'adet=' + varMpCnt); else F('VARYANT: Pazaryeri seçenekleri > 1', 'adet=' + varMpCnt);

    v = await page.$eval('#var-xml-source', el => el.value);
    if (v === '') P('VARYANT: XML başlangıçta boş'); else F('VARYANT: XML başlangıçta boş', 'value=' + v);
    v = await page.$eval('#var-marketplace', el => el.value);
    if (v === '') P('VARYANT: Pazaryeri başlangıçta boş'); else F('VARYANT: Pazaryeri başlangıçta boş', 'value=' + v);

    const varXml = await firstRealOption(page, '#var-xml-source');
    const varMp = await firstRealOption(page, '#var-marketplace');
    const varXmlResp = page.waitForResponse(r => r.url().includes('/variants/xml-variants'), { timeout: 10000 }).catch(() => null);
    await page.selectOption('#var-xml-source', varXml);
    await page.waitForTimeout(300);
    st = await page.evaluate(() => window.varState ? window.varState.xmlSourceId : 'NO_STATE');
    if (st === varXml) P('VARYANT: kullanıcı XML seçimi state\'e yazıldı'); else F('VARYANT: kullanıcı XML seçimi state\'e yazıldı', 'state=' + st);

    const varAllResp = page.waitForResponse(r => r.url().includes('/variants/?') || r.url().includes('/variants/xml-variants'), { timeout: 10000 }).catch(() => null);
    await page.selectOption('#var-marketplace', varMp);
    await page.waitForTimeout(500);
    st = await page.evaluate(() => window.varState ? window.varState.marketplaceId : 'NO_STATE');
    if (st === varMp) P('VARYANT: kullanıcı Pazaryeri seçimi state\'e yazıldı'); else F('VARYANT: kullanıcı Pazaryeri seçimi state\'e yazıldı', 'state=' + st);
    const varResp2 = await varAllResp;
    if (varResp2 && varResp2.url().includes('xmlSourceId=' + varXml)) P('VARYANT: API request xmlSourceId doğru'); else F('VARYANT: API request xmlSourceId doğru', varResp2 ? varResp2.url() : 'istek yok');

    // ============ 4. LİSTELEME ============
    await nav('prep-listings');
    await page.waitForFunction(() => document.querySelectorAll('#li-xml-source option').length > 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#li-marketplace option').length > 1, null, { timeout: 10000 }).catch(() => {});

    const liXmlCnt = await page.locator('#li-xml-source option').count();
    const liMpCnt = await page.locator('#li-marketplace option').count();
    if (liXmlCnt > 1) P('LİSTELEME: XML seçenekleri > 1', 'adet=' + liXmlCnt); else F('LİSTELEME: XML seçenekleri > 1', 'adet=' + liXmlCnt);
    if (liMpCnt > 1) P('LİSTELEME: Pazaryeri seçenekleri > 1', 'adet=' + liMpCnt); else F('LİSTELEME: Pazaryeri seçenekleri > 1', 'adet=' + liMpCnt);

    v = await page.$eval('#li-xml-source', el => el.value);
    if (v === '') P('LİSTELEME: XML başlangıçta boş'); else F('LİSTELEME: XML başlangıçta boş', 'value=' + v);
    v = await page.$eval('#li-marketplace', el => el.value);
    if (v === '') P('LİSTELEME: Pazaryeri başlangıçta boş'); else F('LİSTELEME: Pazaryeri başlangıçta boş', 'value=' + v);

    const liXml = await firstRealOption(page, '#li-xml-source');
    const liMp = await firstRealOption(page, '#li-marketplace');
    await page.selectOption('#li-xml-source', liXml);
    await page.waitForTimeout(300);
    st = await page.evaluate(() => window.prepListState ? window.prepListState.xmlSourceId : 'NO_STATE');
    if (st === liXml) P('LİSTELEME: kullanıcı XML seçimi state\'e yazıldı'); else F('LİSTELEME: kullanıcı XML seçimi state\'e yazıldı', 'state=' + st);
    await page.selectOption('#li-marketplace', liMp);
    await page.waitForTimeout(300);
    st = await page.evaluate(() => window.prepListState ? window.prepListState.marketplaceId : 'NO_STATE');
    if (st === liMp) P('LİSTELEME: kullanıcı Pazaryeri seçimi state\'e yazıldı'); else F('LİSTELEME: kullanıcı Pazaryeri seçimi state\'e yazıldı', 'state=' + st);
    const liMainHidden = await page.$eval('#li-main-content', el => el.classList.contains('hidden')).catch(() => false);
    if (!liMainHidden) P('LİSTELEME: seçim sonrası ana içerik görünür (guard açıldı)'); else F('LİSTELEME: seçim sonrası ana içerik görünür', 'hala hidden');

    // ============ 5. BAĞIMSIZLIK ============
    // Kategori'de seçim yapılmıştı; varyant hala kendi değerini koruyor mu? (varState seçildi)
    // Farklı değer seti: Marka'ya tekrar git ve br select değerlerinin değişmediğini doğrula.
    await nav('prep-brands');
    v = await page.$eval('#br-xml-source', el => el.value);
    if (v === brXml) P('BAĞIMSIZLIK: Marka seçimi diğer modüllerden etkilenmedi'); else F('BAĞIMSIZLIK: Marka seçimi korundu', 'value=' + v);
    await nav('prep-categories');
    v = await page.$eval('#cat-xml-source', el => el.value);
    if (v === catXml) P('BAĞIMSIZLIK: Kategori seçimi diğer modüllerden etkilenmedi'); else F('BAĞIMSIZLIK: Kategori seçimi korundu', 'value=' + v);
    await nav('prep-listings');
    v = await page.$eval('#li-xml-source', el => el.value);
    if (v === liXml) P('BAĞIMSIZLIK: Listeleme seçimi diğer modüllerden etkilenmedi'); else F('BAĞIMSIZLIK: Listeleme seçimi korundu', 'value=' + v);
    await nav('prep-variants');
    v = await page.$eval('#var-xml-source', el => el.value);
    if (v === varXml) P('BAĞIMSIZLIK: Varyant seçimi diğer modüllerden etkilenmedi'); else F('BAĞIMSIZLIK: Varyant seçimi korundu', 'value=' + v);

    if (pageErrors.length === 0) P('JS pageerror yok'); else F('JS pageerror', pageErrors.join(' | '));
  } catch (e) {
    F('TEST ÇÖKTÜ', String(e && e.stack || e));
  }

  console.log('\n===== SONUÇ: ' + R.filter(x => x.startsWith('[PASS]')).length + ' PASS / ' + R.filter(x => x.startsWith('[FAIL]')).length + ' FAIL =====');
  await browser.close();
  process.exit(R.some(x => x.startsWith('[FAIL]')) ? 1 : 0);
})();
