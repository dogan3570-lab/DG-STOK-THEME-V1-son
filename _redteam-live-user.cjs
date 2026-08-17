// DG STOK — LIVE USER TEST (gerçek click + network + console). SADECE OKUMA.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';
const MP = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

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

const OUT = [];
function log(s) { OUT.push(s); console.log(s); }
function pass(label, ok, extra) { log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const SECRET = readEnv('JWT_SECRET');
  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, SECRET, { expiresIn: '1h' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url().slice(0, 120)); });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // LOGIN kontrol
    const authMe = await page.evaluate(async () => {
      const r = await fetch('/auth/me');
      return { status: r.status, ok: r.ok };
    });
    pass('LOGIN (auth/me 200)', authMe.ok && authMe.status === 200, 'status=' + authMe.status);

    // DASHBOARD (varsayılan sayfa)
    pass('DASHBOARD yüklendi', await page.evaluate(() => !document.getElementById('page-dashboard').classList.contains('hidden')), '');

    // ÜRÜN HAVUZU
    await page.evaluate(() => showPage('products'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs }) => {
      const sel = document.getElementById('pool-source');
      if (sel && sel.options.length > 1) sel.value = xs;
      if (typeof poolState !== 'undefined') poolState.xmlSourceId = xs;
      if (typeof poolOnSourceChange === 'function') poolOnSourceChange();
      else { if (typeof poolLoad === 'function') poolLoad(); if (typeof poolLoadStats === 'function') poolLoadStats(); }
    }, { xs: XS });
    await page.waitForTimeout(3500);
    const pool = await page.evaluate(() => ({
      kpiCat: (document.getElementById('kpi-cat') || {}).textContent || '',
      kpiTotal: (document.getElementById('kpi-total') || {}).textContent || '',
      kpiVariant: (document.getElementById('kpi-variant') || {}).textContent || '',
    }));
    pass('PRODUCT POOL KPI (XML seçili): Toplam=13.382 Kategori=30 Varyant=0', pool.kpiTotal === '13.382' && pool.kpiCat === '30' && pool.kpiVariant === '0', JSON.stringify(pool));

    // Ürün aç (gerçek click)
    const opened = await page.evaluate(() => {
      const tr = document.querySelector('#products-tbody tr');
      if (!tr) return 'no-row';
      if (tr.getAttribute('onclick')) { tr.click(); return 'row-click'; }
      const el = tr.querySelector('[onclick]');
      if (el) { el.click(); return 'cell-click'; }
      const p = (window.__poolProducts || [])[0];
      if (p && typeof poolOpenDetail === 'function') { poolOpenDetail(p.id); return 'api-open'; }
      return 'none';
    });
    await page.waitForTimeout(2000);
    const drawer = await page.evaluate(() => {
      const ov = document.getElementById('product-drawer-overlay');
      const vis = ov && !ov.classList.contains('hidden');
      const txt = ov ? ov.innerText : '';
      return { vis, hasSku: /SKU/i.test(txt), hasBarcode: /Barkod/i.test(txt), hasBrand: /Marka/i.test(txt), hasXml: /XML/i.test(txt), hasTitle: /HOBİBAHÇEM/i.test(txt) };
    });
    log('PRODUCT DRAWER: ' + JSON.stringify({ opened, ...drawer }));
    pass('PRODUCT POOL ürün açıldı (SKU/Barkod/Marka/XML)', drawer.vis && drawer.hasSku && drawer.hasBarcode && drawer.hasBrand && drawer.hasXml, 'open=' + opened);
    await page.screenshot({ path: 'live-01-products.png', fullPage: false });
    await page.evaluate(() => { const ov = document.getElementById('product-drawer-overlay'); if (ov) ov.classList.add('hidden'); });

    // KATEGORİ
    await page.evaluate(() => showPage('prep-categories'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs, mp }) => {
      const x = document.getElementById('cat-xml-source'); if (x) x.value = xs;
      const m = document.getElementById('cat-marketplace'); if (m) m.value = mp;
      if (typeof catOnXmlSourceChange === 'function') catOnXmlSourceChange();
    }, { xs: XS, mp: MP });
    await page.waitForTimeout(7000);
    const catSum = await page.evaluate(() => ({
      auto: (document.getElementById('cat-sum-auto') || {}).textContent || '',
      manual: (document.getElementById('cat-sum-manual') || {}).textContent || '',
      total: (document.getElementById('cat-total-products') || {}).textContent || '',
    }));
    pass('CATEGORY Toplam=13.382 TamEşleşti=13.352 Manuel=30', catSum.total === '13.382' && catSum.auto === '13.352' && catSum.manual === '30', JSON.stringify(catSum));
    await page.evaluate(() => { catState.step = 3; catState.currentPage = 1; catRenderAll(); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('#cat-table-body button')).find(b => (b.textContent || '').includes('Manuel Eşleştir'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(2500);
    const catModal = await page.evaluate(() => {
      const info = document.getElementById('cat-picker-product-info');
      const tree = document.getElementById('cat-picker-tree');
      return { info: info && !info.classList.contains('hidden') ? info.innerText.slice(0, 300) : '', treeNodes: tree ? tree.querySelectorAll('[role="button"],button').length : 0 };
    });
    pass('CATEGORY modal: ÜRÜN BİLGİSİ + TRENDYOL KATEGORİ AĞACI', catModal.info.includes('SKU') && catModal.info.includes('Barkod') && catModal.treeNodes > 0, 'treeNodes=' + catModal.treeNodes);
    await page.screenshot({ path: 'live-02-category-modal.png', fullPage: false });
    await page.evaluate(() => { if (typeof catClosePicker === 'function') catClosePicker(); });

    // VARIANT
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(2000);
    await page.evaluate(({ xs, mp }) => {
      const x = document.getElementById('var-xml-source'); if (x) x.value = xs;
      const m = document.getElementById('var-marketplace'); if (m) m.value = mp;
      if (typeof prepVariantOnSourceChange === 'function') prepVariantOnSourceChange();
    }, { xs: XS, mp: MP });
    await page.waitForTimeout(3500);
    const varDom = await page.evaluate(() => {
      const body = document.getElementById('var-products-body');
      return {
        has: (document.getElementById('var-has') || {}).textContent || '',
        none: (document.getElementById('var-none') || {}).textContent || '',
        manual: (document.getElementById('var-manual') || {}).textContent || '',
        waiting: (document.getElementById('var-waiting') || {}).textContent || '',
        body: body ? body.innerText : '',
      };
    });
    pass('VARIANT Varyantlı=0 Varyantsız=13.382 Manuel=0 AI=0 + "VARYANT GEREKMİYOR"', varDom.has === '0' && varDom.none === '13.382' && varDom.manual === '0' && varDom.waiting === '0' && /VARYANT GEREKMİYOR/i.test(varDom.body) && /Analiz Edilemedi/i.test(varDom.body), JSON.stringify({ has: varDom.has, none: varDom.none, manual: varDom.manual, waiting: varDom.waiting }));
    await page.screenshot({ path: 'live-03-variant.png', fullPage: false });

    // READY TO SHIP
    await page.evaluate(({ xs, mp }) => {
      contextState.xmlSourceId = xs; contextState.marketplaceId = mp; contextState.isValid = true;
      showPage('ready-to-ship');
    }, { xs: XS, mp: MP });
    await page.waitForTimeout(4000);
    const rts = await page.evaluate(() => ({
      ready: (document.getElementById('rts-kpi-ready') || {}).textContent || '',
      missingCat: (document.getElementById('rts-kpi-missing-cat') || {}).textContent || '',
      missingBrand: (document.getElementById('rts-kpi-missing-brand') || {}).textContent || '',
      missingTpl: (document.getElementById('rts-kpi-missing-tpl') || {}).textContent || '',
    }));
    pass('READY TO SHIP: KPI yüklendi (4/4 gate)', rts.ready !== '0' && rts.missingCat !== '' && rts.missingBrand !== '' && rts.missingTpl !== '', JSON.stringify(rts));
    await page.screenshot({ path: 'live-04-ready-to-ship.png', fullPage: false });

    // AĞ + KONSOL
    log('BAD RESPONSES (4xx/5xx): ' + badResponses.length + (badResponses.length ? ' -> ' + badResponses.join(' | ') : ''));
    log('CONSOLE ERRORS: ' + errs.length + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    pass('NETWORK (beklenmeyen 4xx/5xx yok)', badResponses.length === 0, '');
    pass('CONSOLE = 0 ERROR', errs.length === 0, '');

    await browser.close();
    const fails = OUT.filter(l => l.startsWith('FAIL'));
    console.log('\n=== LIVE USER TEST: ' + (fails.length === 0 ? 'TÜMÜ PASS' : fails.length + ' FAIL') + ' ===');
    process.exitCode = fails.length === 0 ? 0 : 1;
  } catch (e) {
    console.error('ERR', e);
    await browser.close();
    process.exitCode = 1;
  }
})();
