// CATEGORY + VARIANT UX RED-TEAM BROWSER TESTİ — gerçek Playwright/Chromium + gerçek server + gerçek DB.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4000';
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, JWT_SECRET, { expiresIn: '1h' });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);

    // ============ CATEGORY MAPPING ============
    log('=== CATEGORY MAPPING ===');
    await page.evaluate(() => showPage('prep-categories'));
    await page.waitForTimeout(2200);

    // XML + Pazaryeri seç
    await page.evaluate(() => {
      const xs = document.getElementById('cat-xml-source');
      const mp = document.getElementById('cat-marketplace');
      xs.value = '949855eb-d68c-4920-b378-c622a6a665e2';
      mp.value = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
      catOnXmlSourceChange();
    });
    await page.waitForTimeout(3000);

    // Manuel adıma geç (step 3)
    await page.evaluate(() => { catState.step = 3; catState.currentPage = 1; catRenderAll(); });
    await page.waitForTimeout(1500);

    const catInfo = await page.evaluate(() => {
      const tbody = document.getElementById('cat-table-body');
      const btns = Array.from(tbody.querySelectorAll('button')).filter(b => b.textContent.includes('Manuel Eşleştir'));
      const summary = {
        totalProducts: (document.getElementById('cat-total-products') || {}).textContent || '',
        totalGroups: (document.getElementById('cat-total-groups') || {}).textContent || '',
        manualSum: (document.getElementById('cat-sum-manual') || {}).textContent || '',
        manualButtons: btns.length,
        firstBtnOnclick: btns[0] ? btns[0].getAttribute('onclick') : '',
      };
      return summary;
    });
    log('CAT_SUMMARY: ' + JSON.stringify(catInfo));
    pass('CATEGORY MANUAL BUTTON REAL', catInfo.manualButtons > 0, String(catInfo.manualButtons));
    const catToolbar = await page.evaluate(() => {
      const sa = document.getElementById('cat-select-all');
      const psb = document.getElementById('cat-page-size-buttons');
      const pn = document.getElementById('cat-page-numbers');
      return { selectAll: !!sa, pageSizes: psb ? psb.querySelectorAll('button').length : 0, pageNumbers: pn ? pn.querySelectorAll('button').length : 0 };
    });
    log('CAT_TOOLBAR: ' + JSON.stringify(catToolbar));
    pass('CATEGORY CHECKBOX/SELECT ALL PRESENT', catToolbar.selectAll, '');
    pass('CATEGORY PAGE SIZE PRESENT', catToolbar.pageSizes >= 5, String(catToolbar.pageSizes));
    pass('CATEGORY PAGINATION PRESENT', catToolbar.pageNumbers > 0, String(catToolbar.pageNumbers));

    // İlk ürün bazlı Manuel Eşleştir butonuna tıkla
    const clicked = await page.evaluate(() => {
      const tbody = document.getElementById('cat-table-body');
      const btn = Array.from(tbody.querySelectorAll('button')).find(b => b.textContent.includes('Manuel Eşleştir'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await page.waitForTimeout(2500);

    const catModal = await page.evaluate(() => {
      const modal = document.getElementById('cat-picker-modal');
      const info = document.getElementById('cat-picker-product-info');
      const tree = document.getElementById('cat-picker-tree');
      const sub = (document.getElementById('cat-picker-sub') || {}).textContent || '';
      const title = (document.getElementById('cat-picker-title') || {}).textContent || '';
      return {
        modalVisible: modal && !modal.classList.contains('hidden'),
        infoVisible: info && !info.classList.contains('hidden'),
        infoText: info ? info.innerText.slice(0, 500) : '',
        treeNodeCount: tree ? tree.querySelectorAll('[role="button"]').length : 0,
        sub, title,
      };
    });
    log('CAT_MODAL: ' + JSON.stringify(catModal));
    pass('PRODUCT INFO VISIBLE (CATEGORY)', catModal.infoVisible && catModal.infoText.includes('ÜRÜN BİLGİSİ'), (catModal.infoText || '').split('\n')[0]);
    pass('PRODUCT SKU VISIBLE (CATEGORY)', catModal.infoText.includes('SKU'), '');
    pass('CATEGORY TREE VISIBLE', catModal.treeNodeCount > 0, String(catModal.treeNodeCount));
    await page.screenshot({ path: 'cv-ux-01-category-modal.png', fullPage: false });
    log('SCREENSHOT cv-ux-01-category-modal.png');

    // Modal kapat
    await page.evaluate(() => catClosePicker());

    // ============ VARIANT MAPPING ============
    log('=== VARIANT MAPPING ===');
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(2500);

    // Gerçek MANUAL ürünün sayfasını API'den bul (kategori eşlenmiş tercih)
    const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
    let manualPage = 1;
    let manualProductId = '';
    for (let pg = 1; pg <= 40; pg++) {
      const r = await fetch(`${BASE}/variants/products?page=${pg}&limit=50&xmlSourceId=${xsId}`, { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      const items = (d && d.items) || [];
      const m = items.find((p) => p.status === 'MANUAL' && p.categoryId);
      if (m) { manualPage = pg; manualProductId = m.id; break; }
      if (items.length === 0) break;
    }
    log('MANUAL_PRODUCT: ' + manualProductId + ' @page ' + manualPage);

    // O sayfaya git ve gerçek butona tıkla
    await page.evaluate((pg) => { varState.currentPage = pg; }, manualPage);
    await page.evaluate(() => prepVariantLoadProducts());
    await page.waitForTimeout(2000);

    const varSummary = await page.evaluate(() => {
      const body = document.getElementById('var-products-body');
      const btns = Array.from(body.querySelectorAll('button')).filter(b => b.textContent.includes('Manuel Eşleştir'));
      return {
        total: (document.getElementById('var-total') || {}).textContent || '',
        manual: (document.getElementById('var-manual') || {}).textContent || '',
        manualButtons: btns.length,
      };
    });
    log('VAR_SUMMARY: ' + JSON.stringify(varSummary));
    pass('VARIANT MANUAL BUTTON REAL', varSummary.manualButtons > 0, String(varSummary.manualButtons));

    const varClicked = await page.evaluate(() => {
      const body = document.getElementById('var-products-body');
      const btn = Array.from(body.querySelectorAll('button')).find(b => b.textContent.includes('Manuel Eşleştir'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    log('MANUAL CLICK: ' + varClicked);
    pass('MANUAL CLICK', varClicked, '');
    await page.waitForTimeout(2500);

    const varModal = await page.evaluate(() => {
      const modal = document.getElementById('var-manual-modal');
      const product = (document.getElementById('var-manual-product') || {}).textContent || '';
      const meta = (document.getElementById('var-manual-product-meta') || {}).innerHTML || '';
      const xml = (document.getElementById('var-manual-xml') || {}).innerHTML || '';
      const fields = document.getElementById('var-manual-fields');
      return {
        modalVisible: modal && !modal.classList.contains('hidden'),
        product,
        meta,
        xml,
        fieldsVisible: fields && !fields.classList.contains('hidden'),
        attrOptions: document.getElementById('var-manual-attr') ? document.getElementById('var-manual-attr').options.length : 0,
      };
    });
    log('VAR_MODAL: ' + JSON.stringify(varModal));
    pass('PRODUCT INFO VISIBLE (VARIANT)', !!varModal.product, varModal.product.slice(0, 60));
    pass('PRODUCT META VISIBLE (SKU/BARKOD/XML)', varModal.meta.includes('SKU') || varModal.meta.includes('Barkod') || varModal.meta.includes('XML'), varModal.meta.slice(0, 120));
    pass('XML VARIANTS VISIBLE', !!varModal.xml && !varModal.xml.includes('tespit edilemedi'), varModal.xml.slice(0, 80));
    pass('TRENDYOL VARIANT FIELDS VISIBLE', varModal.fieldsVisible, 'attr options: ' + varModal.attrOptions);
    await page.screenshot({ path: 'cv-ux-02-variant-modal.png', fullPage: false });
    log('SCREENSHOT cv-ux-02-variant-modal.png');

    // Kategori eşlenmiş + gerçek Trendyol varyant attribute'u olan ürünle TRENDYOL alanlarını kanıtla
    const mappedId = 'f09c3b1c-aba4-427d-ba7c-15692778ef24'; // Tiras Makinesi (externalId 474) → Renk attribute
    await page.evaluate((id) => prepVariantOpenManual(id), mappedId);
    await page.waitForTimeout(3000);
    const mappedModal = await page.evaluate(() => {
      const modal = document.getElementById('var-manual-modal');
      const fields = document.getElementById('var-manual-fields');
      const attr = document.getElementById('var-manual-attr');
      const hint = (document.getElementById('var-manual-cat-hint') || {}).textContent || '';
      return {
        modalVisible: modal && !modal.classList.contains('hidden'),
        fieldsVisible: fields && !fields.classList.contains('hidden'),
        attrOptions: attr ? Array.from(attr.options).map((o) => o.text) : [],
        hint,
      };
    });
    log('MAPPED_VARIANT_MODAL: ' + JSON.stringify(mappedModal));
    pass('TRENDYOL VARIANT FIELDS VISIBLE (MAPPED CATEGORY)', mappedModal.fieldsVisible && mappedModal.attrOptions.length > 1, JSON.stringify(mappedModal.attrOptions));
    // Gerçek attribute'u seç ve değerleri yükle
    await page.evaluate(() => {
      const sel = document.getElementById('var-manual-attr');
      const opts = Array.from(sel.options).filter((o) => o.value);
      if (opts.length > 0) { sel.value = opts[0].value; prepVariantManualLoadValues(); }
    });
    await page.waitForTimeout(2500);
    const values = await page.evaluate(() => {
      const val = document.getElementById('var-manual-value');
      return val ? Array.from(val.options).map((o) => o.text) : [];
    });
    log('TRENDYOL VALUES: ' + JSON.stringify(values.slice(0, 12)));
    pass('TRENDYOL REAL VALUES LOADED', values.length > 1, String(values.length));
    await page.screenshot({ path: 'cv-ux-03-variant-mapped.png', fullPage: false });
    log('SCREENSHOT cv-ux-03-variant-mapped.png');

    log('CONSOLE_ERRORS: ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : 'none'));
  } catch (e) {
    log('FATAL: ' + e.message);
    await page.screenshot({ path: 'cv-ux-error.png', fullPage: false });
  } finally {
    fs.writeFileSync('cv-ux-browser-test.log', OUT.join('\n'), 'utf8');
    await browser.close();
  }
})();
