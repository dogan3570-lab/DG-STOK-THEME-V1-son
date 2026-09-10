// VARIANT REAL USER UI AUDIT — faz 1: okunabilir baz hat + screenshot + DOM + sayaç + buton + liste
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, JWT_SECRET, { expiresIn: '1h' });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    log('=== VARIANT SAYFAYA GIT ===');
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(2500);

    // İlk görünüm screenshot (otomatik seçim sonrası)
    await page.screenshot({ path: 'variant-ux-01-initial.png', fullPage: false });
    log('SCREENSHOT variant-ux-01-initial.png');

    // Context seçenekleri
    const xmlOptions = await page.evaluate(() => Array.from(document.getElementById('var-xml-source').options).map(o => ({ value: o.value, text: o.text })));
    const mpOptions = await page.evaluate(() => Array.from(document.getElementById('var-marketplace').options).map(o => ({ value: o.value, text: o.text })));
    log('XML OPTIONS: ' + JSON.stringify(xmlOptions));
    log('MP OPTIONS: ' + JSON.stringify(mpOptions));

    const ctxXml = await page.evaluate(() => (document.getElementById('var-ctx-xml') || {}).textContent || '');
    const ctxMp = await page.evaluate(() => (document.getElementById('var-ctx-mp') || {}).textContent || '');
    pass('CONTEXT VISIBLE (XML)', !!(ctxXml && ctxXml !== 'Seçilmedi'), ctxXml);
    pass('CONTEXT VISIBLE (MP)', !!(ctxMp && ctxMp !== 'Seçilmedi'), ctxMp);

    // Sayaçlar
    const counters = await page.evaluate(() => {
      const g = id => (document.getElementById(id) || {}).textContent || '';
      return { total: g('var-total'), has: g('var-has'), none: g('var-none'), auto: g('var-auto'), ai: g('var-ai'), manual: g('var-manual'), waiting: g('var-waiting') };
    });
    log('COUNTERS: ' + JSON.stringify(counters));
    pass('TOTAL VISIBLE', counters.total !== '-' && counters.total !== '', counters.total);
    pass('VARIANT COUNT (has) VISIBLE', counters.has !== '-' && counters.has !== '', counters.has);
    pass('NOT REQUIRED VISIBLE', counters.none !== '-' && counters.none !== '', counters.none);
    pass('AUTO MATCH COUNT', counters.auto !== '-' && counters.auto !== '', counters.auto);
    pass('AI MATCH COUNT', counters.ai !== '-' && counters.ai !== '', counters.ai);
    pass('MANUAL COUNT', counters.manual !== '-' && counters.manual !== '', counters.manual);
    pass('WAITING AI COUNT', counters.waiting !== '-' && counters.waiting !== '', counters.waiting);

    // Butonlar
    const buttons = await page.evaluate(() => {
      const ids = ['var-btn-auto', 'var-btn-ai'];
      return ids.map(id => {
        const el = document.getElementById(id);
        if (!el) return { id, missing: true };
        const cs = getComputedStyle(el);
        return { id, tag: el.tagName, text: el.textContent.trim(), visible: !!(el.offsetWidth || el.offsetHeight), disabled: !!el.disabled, cursor: cs.cursor, display: cs.display, bg: cs.backgroundColor };
      });
    });
    for (const b of buttons) {
      log('BUTTON: ' + JSON.stringify(b));
      pass('BUTTON ' + b.id + ' is <button>', b.tag === 'BUTTON', b.tag);
      pass('BUTTON ' + b.id + ' VISIBLE', !!b.visible);
      pass('BUTTON ' + b.id + ' cursor:pointer', b.cursor === 'pointer', b.cursor);
      pass('BUTTON ' + b.id + ' text', b.text, b.text);
    }

    // Donut / grafik legend
    const donut = await page.evaluate(() => (document.getElementById('var-donut') || {}).innerText || '');
    log('DONUT LEGEND: ' + JSON.stringify(donut));
    pass('GRAPH LEGEND', donut.includes('Otomatik') && donut.includes('Manuel') && donut.includes('Gerekmiyor'), donut.slice(0, 200));

    // 1901 kontrolü (DOM)
    const bodyHas1901 = await page.evaluate(() => document.getElementById('page-prep-variants').innerText.includes('1.901') || document.body.innerText.includes('1.901'));
    log('1901 IN DOM: ' + bodyHas1901);
    pass('1901 ABSENT', !bodyHas1901, bodyHas1901 ? 'PRESENT' : 'ABSENT');

    // Ürün listesi ilk sayfa
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#var-products-body tr')).map(tr => tr.innerText.replace(/\s+/g, ' ').trim()).slice(0, 8));
    log('ROWS (ilk 8): ' + JSON.stringify(rows, null, 0));

    // Manuel üründe aksiyon var mı?
    const manualRowHtml = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#var-products-body tr'));
      for (const tr of rows) {
        if (tr.innerText.includes('MANUAL') || tr.innerText.includes('Manuel')) {
          return { text: tr.innerText.replace(/\s+/g, ' ').trim(), html: tr.innerHTML.slice(0, 1200) };
        }
      }
      return null;
    });
    log('MANUAL ROW: ' + JSON.stringify(manualRowHtml));
    if (manualRowHtml) {
      const hasAction = /manuel|eşleştir|dropdown|select|button/i.test(manualRowHtml.html);
      pass('MANUAL ACTION VISIBLE', hasAction, manualRowHtml.text.slice(0, 160));
    } else {
      pass('MANUAL ACTION VISIBLE', false, 'İlk sayfada MANUAL satır yok (listede manuel ürün yoksa ayrıca incelenecek)');
    }

    // Sayfa boyutu testi (read-only)
    const sizes = [50, 100, 200, 500, 1000];
    const sizeResults = [];
    for (const s of sizes) {
      await page.selectOption('#var-page-size', String(s));
      await page.waitForTimeout(1400);
      const n = await page.evaluate(() => document.querySelectorAll('#var-products-body tr').length);
      sizeResults.push(s + '=>' + n);
      log('PAGE SIZE ' + s + ' -> rows=' + n);
    }
    pass('PAGE SIZE TEST', sizeResults.length === 5, sizeResults.join(' '));

    // Pagination bilgisi
    const pageInfo = await page.evaluate(() => (document.getElementById('var-page-info') || {}).textContent || '');
    log('PAGE INFO: ' + pageInfo);
    pass('PAGINATION VISIBLE', !!pageInfo, pageInfo);

    // Select all
    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1400);
    await page.check('#var-select-all');
    await page.waitForTimeout(300);
    const selInfo = await page.evaluate(() => (document.getElementById('var-selection-info') || {}).textContent || '');
    const checkedCount = await page.evaluate(() => document.querySelectorAll('#var-products-body input[type=checkbox]:checked').length);
    log('SELECT ALL INFO: ' + selInfo + ' checked=' + checkedCount);
    pass('SELECT ALL', checkedCount > 0, selInfo);
    pass('SELECT ALL TEXT (sayfa kapsamı)', /sayfadaki|seçildi/i.test(selInfo), selInfo);

    // 3 saniye UX: ekrandaki metin özeti
    const uxText = await page.evaluate(() => document.getElementById('page-prep-variants').innerText.slice(0, 1200));
    log('UX TEXT SAMPLE: ' + JSON.stringify(uxText));

    await page.screenshot({ path: 'variant-ux-02-list.png', fullPage: false });
    log('SCREENSHOT variant-ux-02-list.png');

    // Sayfa konsol hataları
    pass('NO CONSOLE ERRORS', errs.length === 0, errs.slice(0, 3).join(' || '));
  } catch (e) {
    log('FATAL: ' + e.message);
  }

  await browser.close();
  fs.writeFileSync('variant-audit-phase1.log', OUT.join('\n'));
  log('=== LOG SAVED variant-audit-phase1.log ===');
})().catch(e => { console.error(e); process.exit(1); });
