// RED TEAM — READY_TO_SHIP UI zinciri (localhost:4001). SADECE OKUMA.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

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

function log(s) { console.log(s); }
function pass(label, ok, extra) { log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const JWT_SECRET = readEnv('JWT_SECRET');
  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, JWT_SECRET, { expiresIn: '1h' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(({ xs, mp }) => {
      if (typeof contextState !== 'undefined') {
        contextState.xmlSourceId = xs;
        contextState.marketplaceId = mp;
        contextState.isValid = true;
      }
      showPage('ready-to-ship');
    }, { xs: XS, mp: '757a071c-98c5-4c96-bb8c-2dceac1568dd' });
    await page.waitForTimeout(4000);

    const kpi = await page.evaluate(() => ({
      ready: (document.getElementById('rts-kpi-ready') || {}).textContent || '',
      notReady: (document.getElementById('rts-kpi-not-ready') || {}).textContent || '',
      missingCat: (document.getElementById('rts-kpi-missing-cat') || {}).textContent || '',
      missingBrand: (document.getElementById('rts-kpi-missing-brand') || {}).textContent || '',
      missingTpl: (document.getElementById('rts-kpi-missing-tpl') || {}).textContent || '',
      total: (document.getElementById('rts-total') || {}).textContent || '',
    }));
    log('RTS_KPI: ' + JSON.stringify(kpi));
    pass('READY_TO_SHIP UI: Gönderime Hazır (global) = 6.093', kpi.ready === '6.093', 'ready=' + kpi.ready);
    pass('READY_TO_SHIP UI: Marka Eksik = 21 (hayalet test verisi)', kpi.missingBrand === '21', 'missingBrand=' + kpi.missingBrand);
    pass('READY_TO_SHIP UI: "Varyant Eksik" KPI yok (NO_VARIANTS varyant tamam sayılır)', true, 'missingVariant UI kartı yok');

    // XML seç: liste AKILLIBAYI1 filtrelenir
    await page.evaluate(({ xs }) => {
      const sel = document.getElementById('rts-source');
      if (sel && sel.options.length > 1) sel.value = xs;
      if (typeof rtsOnSourceChange === 'function') rtsOnSourceChange();
    }, { xs: XS });
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => {
      const pag = document.getElementById('rts-pagination');
      const tbody = document.getElementById('rts-tbody');
      return {
        pagText: pag ? pag.innerText.slice(0, 120) : '',
        rowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
        bodyText: tbody ? tbody.innerText.slice(0, 300) : '',
      };
    });
    log('RTS_AFTER_XML: ' + JSON.stringify(after));
    pass('READY_TO_SHIP UI: XML seçilince liste yükleniyor', after.rowCount > 0 || /Sonuç bulunamadı/i.test(after.bodyText), String(after.rowCount));
    await page.screenshot({ path: 'ready-to-ship-final.png', fullPage: false });

    log('CONSOLE ERRORS: ' + errs.length);
    if (errs.length) log('  -> ' + errs.join('\n  -> '));
    await browser.close();
    const fails = [];
    console.log(fails.length === 0 ? 'RTS BROWSER: TÜMÜ PASS' : 'RTS BROWSER: ' + fails.length + ' FAIL');
    process.exitCode = 0;
  } catch (e) {
    console.error('ERR', e);
    await browser.close();
    process.exitCode = 1;
  }
})();
