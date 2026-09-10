// RED TEAM BROWSER TESTİ (FINAL) — localhost:4001 + Playwright/Chromium.
// SADECE OKUMA. Eşleştirme KAYDEDİLMEZ.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';
const MP = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
const OUT = [];
function log(s) { OUT.push(s); console.log(s); }
function pass(label, ok, extra) { log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

function readEnv(key) {
  try {
    const txt = fs.readFileSync('./server/.env', 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return '';
}

(async () => {
  const JWT_SECRET = readEnv('JWT_SECRET');
  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, JWT_SECRET, { expiresIn: '1h' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 300)));
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // ============ ÜRÜN HAVUZU (XML seçili) ============
    log('=== ÜRÜN HAVUZU (XML seçili) ===');
    await page.evaluate(() => showPage('products'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs }) => {
      var sel = document.getElementById('pool-source');
      if (sel && sel.options.length > 1) sel.value = xs;
      if (typeof poolState !== 'undefined') poolState.xmlSourceId = xs;
      if (typeof poolOnSourceChange === 'function') poolOnSourceChange();
      else { if (typeof poolLoad === 'function') poolLoad(); if (typeof poolLoadStats === 'function') poolLoadStats(); }
    }, { xs: XS });
    await page.waitForTimeout(3000);
    const pool = await page.evaluate(() => ({
      kpiCat: (document.getElementById('kpi-cat') || {}).textContent || '',
      kpiTotal: (document.getElementById('kpi-total') || {}).textContent || '',
      kpiVariant: (document.getElementById('kpi-variant') || {}).textContent || '',
    }));
    log('POOL_KPI: ' + JSON.stringify(pool));
    pass('ÜRÜN HAVUZU (XML=AKILLIBAYI1) Kategori Bekleyen = 30', pool.kpiCat === '30', 'kpi-cat=' + pool.kpiCat);
    pass('ÜRÜN HAVUZU (XML) Toplam = 13.382', pool.kpiTotal === '13.382', 'kpi-total=' + pool.kpiTotal);
    await page.screenshot({ path: 'category-final.png', fullPage: false });

    // ============ CATEGORY ============
    log('=== CATEGORY MAPPING ===');
    await page.evaluate(() => showPage('prep-categories'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs, mp }) => {
      const xsEl = document.getElementById('cat-xml-source');
      const mpEl = document.getElementById('cat-marketplace');
      if (xsEl) xsEl.value = xs;
      if (mpEl) mpEl.value = mp;
      if (typeof catOnXmlSourceChange === 'function') catOnXmlSourceChange();
    }, { xs: XS, mp: MP });
    await page.waitForTimeout(7000);

    const catSum = await page.evaluate(() => ({
      auto: (document.getElementById('cat-sum-auto') || {}).textContent || '',
      ai: (document.getElementById('cat-sum-ai') || {}).textContent || '',
      manual: (document.getElementById('cat-sum-manual') || {}).textContent || '',
      totalProducts: (document.getElementById('cat-total-products') || {}).textContent || '',
    }));
    log('CAT_SUMMARY: ' + JSON.stringify(catSum));
    pass('CATEGORY Tam Eşleşti (Ürün) = 13.352', catSum.auto === '13.352', 'auto=' + catSum.auto);
    pass('CATEGORY Manuel Bekleyen (Ürün) = 30 — DB/API/POOL ile AYNI', catSum.manual === '30', 'manual=' + catSum.manual);
    pass('CATEGORY toplam ürün = 13.382', catSum.totalProducts === '13.382', 'total=' + catSum.totalProducts);

    // Manuel adım + modal
    await page.evaluate(() => { catState.step = 3; catState.currentPage = 1; catRenderAll(); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const tbody = document.getElementById('cat-table-body');
      const btn = Array.from((tbody || document).querySelectorAll('button')).find(b => (b.textContent || '').includes('Manuel Eşleştir'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(2500);
    const catModal = await page.evaluate(() => {
      const modal = document.getElementById('cat-picker-modal');
      const info = document.getElementById('cat-picker-product-info');
      const tree = document.getElementById('cat-picker-tree');
      return {
        modalVisible: modal && !modal.classList.contains('hidden'),
        infoVisible: info && !info.classList.contains('hidden'),
        infoText: info ? info.innerText.slice(0, 400) : '',
        treeNodes: tree ? tree.querySelectorAll('[role="button"],button').length : 0,
      };
    });
    log('CAT_MODAL: ' + JSON.stringify({ modalVisible: catModal.modalVisible, infoVisible: catModal.infoVisible, treeNodes: catModal.treeNodes }));
    pass('CATEGORY modal: ÜRÜN BİLGİSİ + SKU/Barkod/Marka/XML', catModal.modalVisible && catModal.infoVisible && catModal.infoText.includes('SKU'), '');
    pass('CATEGORY ağacı görünür', catModal.treeNodes > 0, String(catModal.treeNodes));
    await page.screenshot({ path: 'category-product-modal-final.png', fullPage: false });
    await page.evaluate(() => { if (typeof catClosePicker === 'function') catClosePicker(); });

    // ============ VARIANT ============
    log('=== VARIANT MAPPING ===');
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs, mp }) => {
      const xsEl = document.getElementById('var-xml-source');
      const mpEl = document.getElementById('var-marketplace');
      if (xsEl) xsEl.value = xs;
      if (mpEl) mpEl.value = mp;
      if (typeof prepVariantOnSourceChange === 'function') prepVariantOnSourceChange();
    }, { xs: XS, mp: MP });
    await page.waitForTimeout(3000);

    const varDom = await page.evaluate(() => {
      const body = document.getElementById('var-products-body');
      const hint = document.getElementById('var-action-hint');
      return {
        has: (document.getElementById('var-has') || {}).textContent || '',
        none: (document.getElementById('var-none') || {}).textContent || '',
        total: (document.getElementById('var-total') || {}).textContent || '',
        manual: (document.getElementById('var-manual') || {}).textContent || '',
        waiting: (document.getElementById('var-waiting') || {}).textContent || '',
        bodyText: body ? body.innerText.slice(0, 300) : '',
        hintText: hint ? hint.innerText.slice(0, 200) : '',
        hasHedef: body ? /Siyah-Beyaz/i.test(body.innerText) : false,
        has1901: document.body.innerText.includes('1.901'),
        has1401: document.body.innerText.includes('1.401'),
      };
    });
    log('VAR_DOM: ' + JSON.stringify(varDom));
    pass('VARIANT Varyantlı = 0', varDom.has === '0', 'var-has=' + varDom.has);
    pass('VARIANT Varyantsız = 13.382', varDom.none === '13.382', 'var-none=' + varDom.none);
    pass('VARIANT Manuel Bekliyor = 0 (621/1281 sahte sayı YOK)', varDom.manual === '0' && varDom.waiting === '0', 'manual=' + varDom.manual + ' waiting=' + varDom.waiting);
    pass('VARIANT "VARYANT GEREKMİYOR" sade state görünür', /VARYANT GEREKMİYOR/i.test(varDom.bodyText), '');
    pass('VARIANT action hint "gerekmiyor" bilgisi görünür', /gerekmiyor/i.test(varDom.hintText), varDom.hintText);
    pass('HEDEF ürün Variant listesinde YOK (DOM)', !varDom.hasHedef, '');
    pass('1901 UI ABSENT', !varDom.has1901, '');
    pass('1401 UI ABSENT', !varDom.has1401, '');
    await page.screenshot({ path: 'variant-final.png', fullPage: false });

    log('CONSOLE ERRORS: ' + errs.length);
    if (errs.length) log('  -> ' + errs.join('\n  -> '));

    await browser.close();
    console.log('\n=== SONUÇ ===');
    const fails = OUT.filter(l => l.startsWith('FAIL'));
    console.log((fails.length === 0 ? 'BROWSER RED TEAM: TÜMÜ PASS' : 'BROWSER RED TEAM: ' + fails.length + ' FAIL'));
    process.exitCode = fails.length === 0 ? 0 : 1;
  } catch (e) {
    console.error('BROWSER TEST ERROR:', e);
    await browser.close();
    process.exitCode = 1;
  }
})();
