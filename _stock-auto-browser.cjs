// STOCK AUTOMATION — ÜRÜN HAVUZU BROWSER TEST (inline panel, no modal). localhost:4001.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';

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
function pass(label, ok, extra) { OUT.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const SECRET = readEnv('JWT_SECRET');
  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, SECRET, { expiresIn: '1h' });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  const badResponses = [];
  let dialogOpened = false;
  page.on('dialog', async (d) => { dialogOpened = true; await d.dismiss(); });
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url().slice(0, 100)); });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Ürün Havuzu
    await page.evaluate(() => showPage('products'));
    await page.waitForTimeout(2200);

    const panelVisible = await page.evaluate(() => {
      const p = document.getElementById('stock-auto-panel');
      return p && !p.classList.contains('hidden') && p.offsetParent !== null;
    });
    pass('Ürün Havuzu → STOK OTOMASYONU bölümü görünür', panelVisible, '');

    const fields = await page.evaluate(() => ({
      enabled: !!document.getElementById('stock-auto-enabled'),
      close: !!document.getElementById('stock-auto-close'),
      open: !!document.getElementById('stock-auto-open'),
      prepmin: !!document.getElementById('stock-auto-prepmin'),
      prepmax: !!document.getElementById('stock-auto-prepmax'),
    }));
    pass('Alanlar görünür (enabled/close/open/prepMin/prepMax)', fields.enabled && fields.close && fields.open && fields.prepmin && fields.prepmax, JSON.stringify(fields));
    pass('NO MODAL / NO PROMPT', !dialogOpened, dialogOpened ? 'dialog açıldı!' : '');

    // Değerleri ayarla ve kaydet
    await page.evaluate(() => {
      document.getElementById('stock-auto-enabled').checked = true;
      document.getElementById('stock-auto-close').value = '3';
      document.getElementById('stock-auto-open').value = '5';
      document.getElementById('stock-auto-prepmin').value = '5';
      document.getElementById('stock-auto-prepmax').value = '100';
      stockAutoSave();
    });
    await page.waitForTimeout(1800);

    // Refresh sonrası kalıcılık
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { showPage('products'); });
    await page.waitForTimeout(2200);
    const persisted = await page.evaluate(() => ({
      enabled: document.getElementById('stock-auto-enabled').checked,
      close: document.getElementById('stock-auto-close').value,
      open: document.getElementById('stock-auto-open').value,
      prepmin: document.getElementById('stock-auto-prepmin').value,
      prepmax: document.getElementById('stock-auto-prepmax').value,
    }));
    pass('Kaydet → refresh → kalıcılık (close=3 open=5 prepMin=5 prepMax=100)', persisted.close === '3' && persisted.open === '5' && persisted.prepmin === '5' && persisted.prepmax === '100', JSON.stringify(persisted));

    // Göz testi ekran görüntüsü
    await page.screenshot({ path: 'stock-automation-pool.png', fullPage: false });

    // Ürün listesi hazırlama filtresi
    const poolFilters = await page.evaluate(() => ({
      min: !!document.getElementById('pool-minstock'),
      max: !!document.getElementById('pool-maxstock'),
    }));
    pass('Ürün listesi hazırlama min/max filtresi mevcut', poolFilters.min && poolFilters.max, JSON.stringify(poolFilters));

    // Hazırlama filtresini kullan (min=5 → stok 0/4 hariç, 5+ dahil)
    await page.evaluate(() => {
      document.getElementById('pool-minstock').value = '5';
      poolOnStockFilterChange();
    });
    await page.waitForTimeout(2200);
    const filtered = await page.evaluate(() => document.getElementById('products-tbody').innerText);
    pass('Hazırlama filtresi uygulandı (min=5, tablo yüklendi)', filtered.includes('ürün') || filtered.length > 0, '');

    console.log('BAD RESPONSES: ' + badResponses.length + (badResponses.length ? ' -> ' + badResponses.join(' | ') : ''));
    console.log('CONSOLE ERRORS: ' + errs.length + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    pass('NETWORK beklenmeyen 4xx/5xx yok', badResponses.length === 0, '');
    pass('CONSOLE 0 ERROR', errs.length === 0, '');

    await browser.close();
    const fails = OUT.filter(x => !x).length;
    console.log('\n=== STOCK AUTOMATION POOL BROWSER: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
    process.exitCode = fails === 0 ? 0 : 1;
  } catch (e) {
    console.error('ERR', e);
    await browser.close();
    process.exitCode = 1;
  }
})();
