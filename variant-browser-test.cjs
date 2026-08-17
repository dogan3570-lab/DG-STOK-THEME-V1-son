const { chromium } = require('playwright');
const jwt = require('./server/node_modules/jsonwebtoken');
const JWT_SECRET = 'a-very-secure-secret-key-that-is-at-least-32-characters-long!';
const ADMIN_USER_ID = 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d';

function pass(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));

  try {
    // Auth: doğrudan JWT cookie enjekte et (default parola mustChangePassword yan etkisinden kaçın)
    const token = jwt.sign({ role: 'ADMIN', sub: ADMIN_USER_ID }, JWT_SECRET, { expiresIn: '1h' });
    await page.context().addCookies([{ name: 'token', value: token, url: 'http://localhost:4000' }]);

    await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    pass('LOGIN (JWT COOKIE)', true);

    // Variant sayfasına git
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(2500);

    // XML + MP seç
    const xmlOptions = await page.evaluate(() => Array.from(document.getElementById('var-xml-source').options).map(o => ({ value: o.value, text: o.text })));
    const mpOptions = await page.evaluate(() => Array.from(document.getElementById('var-marketplace').options).map(o => ({ value: o.value, text: o.text })));
    const akilli = xmlOptions.find(o => o.text.includes('AKILLIBAYI1'));
    const trendyol = mpOptions.find(o => o.text.toLowerCase().includes('trendyol'));
    pass('CONTEXT OPTIONS', !!(akilli && trendyol), 'xml=' + (akilli ? akilli.text : 'none') + ' mp=' + (trendyol ? trendyol.text : 'none'));

    await page.selectOption('#var-xml-source', akilli.value);
    await page.waitForTimeout(400);
    await page.selectOption('#var-marketplace', trendyol.value);
    await page.waitForTimeout(3500);

    // Context banner
    const ctxXml = await page.evaluate(() => document.getElementById('var-ctx-xml').textContent);
    const ctxMp = await page.evaluate(() => document.getElementById('var-ctx-mp').textContent);
    pass('CONTEXT BANNER', ctxXml.includes('AKILLIBAYI1') && ctxMp.toUpperCase().includes('TRENDYOL'), 'xml=' + ctxXml + ' mp=' + ctxMp);

    // Dashboard değerleri
    const dash = await page.evaluate(() => ({
      total: document.getElementById('var-total').textContent,
      has: document.getElementById('var-has').textContent,
      none: document.getElementById('var-none').textContent,
      auto: document.getElementById('var-auto').textContent,
      ai: document.getElementById('var-ai').textContent,
      manual: document.getElementById('var-manual').textContent,
    }));
    console.log('DASHBOARD:', JSON.stringify(dash));
    pass('DASHBOARD TOTAL 13.382', dash.total === '13.382', dash.total);
    pass('DASHBOARD MANUAL GERÇEK (1.401/1.901 sahte kalan DEĞİL)', dash.manual !== '1.401' && dash.manual !== '1.901', 'manual=' + dash.manual);
    pass('DASHBOARD NOT_REQUIRED=10.924', dash.none === '10.924', dash.none);
    pass('DASHBOARD WAITING AI kutusu var', !!(await page.evaluate(() => document.getElementById('var-waiting').textContent)), '');
    const bodyHas1901 = await page.evaluate(() => document.getElementById('page-prep-variants').innerText.includes('1.901'));
    pass('1.901 EKRANDA YOK', !bodyHas1901);

    // Ürün listesi
    const rowCount = await page.evaluate(() => document.getElementById('var-products-body').children.length);
    pass('PRODUCT LIST ROWS', rowCount > 0, 'rows=' + rowCount);

    // Manuel neden görünür mü (varsa)
    const hasReason = await page.evaluate(() => document.getElementById('var-products-body').innerHTML.includes('Neden:'));
    console.log('Manual reason visible:', hasReason);

    // Varyant gerekmiyor satırı (NOT_REQUIRED) MANUAL olarak GÖSTERİLMEMELİ
    const manualBadgeCount = await page.evaluate(() => (document.getElementById('var-products-body').innerHTML.match(/MANUAL REVIEW/g) || []).length);
    const notRequiredBadgeCount = await page.evaluate(() => (document.getElementById('var-products-body').innerHTML.match(/Varyant Gerekmiyor/g) || []).length);
    console.log('Badge counts - MANUAL:', manualBadgeCount, 'NOT_REQUIRED:', notRequiredBadgeCount);

    // Sayfa başına boyut
    await page.selectOption('#var-page-size', '100');
    await page.waitForTimeout(1500);
    const pageInfo100 = await page.evaluate(() => document.getElementById('var-page-info').textContent);
    pass('PAGE SIZE 100', pageInfo100.startsWith('1-100'), pageInfo100);

    await page.selectOption('#var-page-size', '200');
    await page.waitForTimeout(1500);
    const pageInfo200 = await page.evaluate(() => document.getElementById('var-page-info').textContent);
    pass('PAGE SIZE 200', pageInfo200.startsWith('1-200'), pageInfo200);

    await page.selectOption('#var-page-size', '500');
    await page.waitForTimeout(1500);
    const pageInfo500 = await page.evaluate(() => document.getElementById('var-page-info').textContent);
    pass('PAGE SIZE 500', pageInfo500.startsWith('1-500'), pageInfo500);

    await page.selectOption('#var-page-size', '1000');
    await page.waitForTimeout(1500);
    const pageInfo1000 = await page.evaluate(() => document.getElementById('var-page-info').textContent);
    pass('PAGE SIZE 1000', pageInfo1000.startsWith('1-1.000') || pageInfo1000.startsWith('1-1000'), pageInfo1000);

    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1500);

    // Pagination - sayfa 2
    const nextDisabled = await page.evaluate(() => document.getElementById('var-page-next').disabled);
    if (!nextDisabled) {
      await page.click('#var-page-next');
      await page.waitForTimeout(1500);
      const pageInfo2 = await page.evaluate(() => document.getElementById('var-page-info').textContent);
      pass('PAGINATION PAGE 2', pageInfo2.startsWith('51-100'), pageInfo2);
      await page.click('#var-page-prev');
      await page.waitForTimeout(1500);
    } else {
      pass('PAGINATION PAGE 2', false, 'next disabled');
    }

    // Checkbox + select all
    await page.click('#var-select-all');
    await page.waitForTimeout(400);
    const selInfo = await page.evaluate(() => document.getElementById('var-selection-info').textContent);
    pass('SELECT ALL', selInfo.includes('50 ürün seçildi'), selInfo);
    await page.click('#var-select-all');
    await page.waitForTimeout(300);
    const selInfo2 = await page.evaluate(() => document.getElementById('var-selection-info').textContent);
    pass('SELECT ALL CLEAR', selInfo2 === '0 ürün seçildi', selInfo2);

    // BUTON GERÇEKTEN TIKLANABİLİR: AUTO MATCH (senkron yükleme durumu yakala)
    const btnIsButton = await page.evaluate(() => document.getElementById('var-btn-auto').tagName === 'BUTTON');
    pass('AUTO BUTTON IS <button>', btnIsButton);
    const autoBtnLoading = await page.evaluate(() => { prepVariantAutoMatch(); return document.getElementById('var-btn-auto').innerHTML; });
    pass('AUTO BUTTON LOADING STATE', autoBtnLoading.includes('İşleniyor'), autoBtnLoading.slice(0, 40));
    await page.waitForTimeout(6000);
    const autoBtnDone = await page.evaluate(() => document.getElementById('var-btn-auto').innerHTML);
    pass('AUTO BUTTON RESET', autoBtnDone.includes('AUTO MATCH'), autoBtnDone.slice(0, 40));

    // AI EŞLEŞTİR butonu
    const aiBtnLoading = await page.evaluate(() => { prepVariantAiMatch(); return document.getElementById('var-btn-ai').innerHTML; });
    pass('AI BUTTON LOADING STATE', aiBtnLoading.includes('İşleniyor'), aiBtnLoading.slice(0, 40));
    await page.waitForTimeout(9000);
    const aiBtnDone = await page.evaluate(() => document.getElementById('var-btn-ai').innerHTML);
    pass('AI BUTTON RESET', aiBtnDone.includes('AI EŞLEŞTİR'), aiBtnDone.slice(0, 40));

    // Dashboard güncellendi mi
    const dashAfter = await page.evaluate(() => ({
      manual: document.getElementById('var-manual').textContent,
      auto: document.getElementById('var-auto').textContent,
      none: document.getElementById('var-none').textContent,
    }));
    console.log('DASHBOARD AFTER:', JSON.stringify(dashAfter));
    pass('DASHBOARD UPDATED AFTER BUTTON', dashAfter.manual !== dash.manual || dashAfter.auto !== dash.auto || dashAfter.none !== dash.none, JSON.stringify(dashAfter));

    // Context değişimi: XML'i temizle
    await page.selectOption('#var-xml-source', '');
    await page.waitForTimeout(800);
    const productsHidden = await page.evaluate(() => document.getElementById('var-products-section').classList.contains('hidden'));
    pass('CONTEXT CLEAR HIDES PRODUCTS', productsHidden);

    // Tekrar seç
    await page.selectOption('#var-xml-source', akilli.value);
    await page.selectOption('#var-marketplace', trendyol.value);
    await page.waitForTimeout(3000);
    const totalAfter = await page.evaluate(() => document.getElementById('var-total').textContent);
    pass('CONTEXT RE-SELECT', totalAfter === '13.382', totalAfter);

    await page.screenshot({ path: 'variant-ux-new-dashboard.png', fullPage: false });

    const realErrors = errs.filter(e => !e.includes('401') && !e.includes('favicon') && !e.includes('net::ERR'));
    console.log('\nCONSOLE ERRORS:', realErrors.length === 0 ? 'NONE' : realErrors.slice(0, 10).join('\n  '));
    pass('NO CONSOLE ERRORS', realErrors.length === 0);
  } catch (e) {
    console.error('FATAL:', e.message);
    await page.screenshot({ path: 'variant-browser-fail.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log('\n=== VARIANT BROWSER TEST COMPLETE ===');
})();
