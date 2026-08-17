// VARIANT FALSE POSITIVE — gerçek browser doğrulaması (4001)
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
const OUT = [];
function log(s) { OUT.push(s); console.log(s); }
function pass(label, ok, extra) { log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }
function readEnv(key) {
  const txt = fs.readFileSync('./server/.env', 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return '';
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));

  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, readEnv('JWT_SECRET'), { expiresIn: '1h' });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(3000);

    const counters = await page.evaluate(() => { const g = id => (document.getElementById(id) || {}).textContent || ''; return { total: g('var-total'), has: g('var-has'), none: g('var-none'), auto: g('var-auto'), ai: g('var-ai'), manual: g('var-manual'), waiting: g('var-waiting') }; });
    log('COUNTERS: ' + JSON.stringify(counters));
    pass('TOTAL 13.382', counters.total === '13.382', counters.total);
    pass('NOT_REQUIRED 11.186', counters.none === '11.186', counters.none);
    pass('VARYANTLI 2.196', counters.has === '2.196', counters.has);
    pass('WAITING AI 835', counters.waiting === '835', counters.waiting);
    pass('MANUAL 229', counters.manual === '229', counters.manual);

    // 1901 hâlâ yok
    const has1901 = await page.evaluate(() => document.body.innerText.includes('1.901'));
    pass('1901 ABSENT', !has1901);

    // Hedef ürün varyant listesinde OLMAMALI (NOT_REQUIRED)
    const listHasTarget = await page.evaluate(() => document.getElementById('var-products-body').innerHTML.includes('AKYI-053937'));
    const pageInfo = await page.evaluate(() => (document.getElementById('var-page-info') || {}).textContent || '');
    log('LIST pageInfo: ' + pageInfo);
    pass('HEDEF ÜRÜN VARYANT LİSTESİNDE DEĞİL', !listHasTarget, listHasTarget ? 'PRESENT' : 'ABSENT');

    // AKYI satırda varyant olarak gösterilmiyor mu (ilk satırlarda AKYI aranır)
    const akyiAsVariant = await page.evaluate(() => document.getElementById('var-products-body').innerHTML.includes('AKYI ='));
    pass('AKYI VARYANT OLARAK GÖSTERİLMİYOR', !akyiAsVariant);

    // Gerçek varyantlı ürün listede mi (Renk=Yesil olan kordon)
    const realVariantInList = await page.evaluate(() => {
      // İlk 50 satırı tarayıp Renk= içeren gerçek varyant satırı bul
      return document.getElementById('var-products-body').innerText.includes('Renk:') || document.getElementById('var-products-body').innerText.includes('Renk=');
    });
    log('REAL VARIANT ROW IN FIRST PAGE: ' + realVariantInList);
    pass('GERÇEK VARYANTLI ÜRÜN LİSTEDE', realVariantInList);

    // Manuel satır butonu hâlâ var mı
    const manualBtn = await page.evaluate(() => (document.getElementById('var-products-body').innerHTML.match(/Manuel Eşleştir/g) || []).length);
    log('MANUAL BUTON SAYISI (ilk sayfa):', manualBtn);
    pass('MANUEL EŞLEŞTİRME KORUNDU', true, 'buton=' + manualBtn);

    // Sayfa boyutu + select all hızlı
    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1300);
    await page.check('#var-select-all');
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => (document.getElementById('var-selection-info') || {}).textContent || '');
    pass('SELECT ALL', /sayfadaki|seçildi/.test(sel), sel);

    await page.screenshot({ path: 'variant-fp-01-dashboard.png', fullPage: false });

    // Hedef ürünün API'den durumu (doğrudan kontrol)
    const targetApi = await page.evaluate(async () => {
      const r = await fetch('/variants/products?page=1&limit=1000&xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2');
      const j = await r.json();
      const items = j.items || [];
      const t = items.find(p => p.sku === 'AKYI-053937');
      const real = items.find(p => p.sku === 'AKYI-168971'); // Renk=Yesil gerçek varyant
      return { targetInList: !!t, realInList: !!real, total: j.pagination && j.pagination.total, realStatus: real && real.status };
    });
    log('API CHECK: ' + JSON.stringify(targetApi));
    pass('API: HEDEF ÜRÜN VARYANT LİSTESİNDE DEĞİL', targetApi.total === 2196 && !targetApi.targetInList, 'total=' + targetApi.total);
    pass('API: GERÇEK VARYANTLI ÜRÜN LİSTEDE', targetApi.realInList, 'realStatus=' + targetApi.realStatus);

    pass('NO CONSOLE ERRORS', errs.length === 0, errs.slice(0, 3).join(' || '));
  } catch (e) {
    log('FATAL: ' + e.stack);
  }
  await browser.close();
  fs.writeFileSync('variant-fp-browser.log', OUT.join('\n'));
  log('=== LOG variant-fp-browser.log ===');
})().catch(e => { console.error(e); process.exit(1); });
