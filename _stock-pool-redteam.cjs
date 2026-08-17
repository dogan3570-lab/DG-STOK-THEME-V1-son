// DG STOK — STOK OTOMASYONU ÜRÜN HAVUZU + CROSS-MODULE RED TEAM (Playwright/Chromium).
// localhost:4001 üzerinde gerçek click ile: görünürlük, alanlar, NO MODAL,
// kaydet + refresh persistence, Ayarlar ↔ Ürün Havuzu senkronizasyonu.
const { chromium } = require('playwright');
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');
const { PrismaClient } = require('./server/node_modules/@prisma/client');

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
  const DATABASE_URL = readEnv('DATABASE_URL') || 'file:./dev.db';
  process.env.DATABASE_URL = DATABASE_URL;
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  await prisma.$disconnect();
  if (!admin) { console.error('ERR admin user bulunamadı'); process.exitCode = 1; return; }
  const token = jwt.sign({ role: admin.role, sub: admin.id }, SECRET, { expiresIn: '1h' });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  const badResponses = [];
  let dialogOpened = false;
  page.on('dialog', async (d) => { dialogOpened = true; await d.dismiss(); });
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));
  page.on('response', (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 400) {
      // /auth/me 401 yalnızca token yoksa normaldir; biz geçerli token veriyoruz, bu yüzden beklenmeyen sayılır
      badResponses.push(s + ' ' + u.slice(0, 120));
    }
  });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 1) Ürün Havuzu'na gerçek click ile git
    await page.locator('#nav-products').click();
    await page.waitForTimeout(2500);

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
    pass('NO MODAL / NO PROMPT (Ürün Havuzu)', !dialogOpened, dialogOpened ? 'dialog açıldı!' : '');

    // 2) Değerleri gir + gerçek click ile Kaydet
    await page.check('#stock-auto-enabled');
    await page.fill('#stock-auto-close', '3');
    await page.fill('#stock-auto-open', '5');
    await page.fill('#stock-auto-prepmin', '5');
    await page.fill('#stock-auto-prepmax', '100');
    await page.locator('#stock-auto-panel button').first().click(); // Kaydet
    await page.waitForTimeout(1800);

    // 3) Refresh sonrası kalıcılık (Ürün Havuzu)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.locator('#nav-products').click();
    await page.waitForTimeout(2500);
    const persisted = {
      enabled: await page.isChecked('#stock-auto-enabled'),
      close: await page.inputValue('#stock-auto-close'),
      open: await page.inputValue('#stock-auto-open'),
      prepmin: await page.inputValue('#stock-auto-prepmin'),
      prepmax: await page.inputValue('#stock-auto-prepmax'),
    };
    pass('Kaydet → refresh → kalıcılık (close=3 open=5 prep=5-100)', persisted.close === '3' && persisted.open === '5' && persisted.prepmin === '5' && persisted.prepmax === '100', JSON.stringify(persisted));

    // Göz testi ekran görüntüsü (Ürün Havuzu)
    await page.screenshot({ path: 'stock-automation-pool.png', fullPage: false });

    // 4) Ayarlar → Stok sekmesine gerçek click; aynı değerler görünmeli
    await page.locator('#nav-settings').click();
    await page.waitForTimeout(2200);
    await page.locator('#set-tab-stock').click();
    await page.waitForTimeout(1500);

    const settingsPanel = await page.evaluate(() => {
      const p = document.getElementById('set-panel-stock');
      return p && !p.classList.contains('hidden') && p.offsetParent !== null;
    });
    pass('Ayarlar → Stok sekmesi görünür', settingsPanel, '');

    const settingsVals = {
      enabled: await page.isChecked('#set-stock-enabled'),
      close: await page.inputValue('#set-stock-close'),
      open: await page.inputValue('#set-stock-open'),
      prepmin: await page.inputValue('#set-stock-prepmin'),
      prepmax: await page.inputValue('#set-stock-prepmax'),
    };
    pass('Ayarlar → Stok, Ürün Havuzu ile AYNI değerleri gösterir', settingsVals.close === '3' && settingsVals.open === '5' && settingsVals.prepmin === '5' && settingsVals.prepmax === '100', JSON.stringify(settingsVals));

    await page.screenshot({ path: 'stock-automation-settings.png', fullPage: false });

    // 5) Ayarlar'dan değer değiştir + Kaydet → Ürün Havuzu'na yansısın
    await page.fill('#set-stock-close', '2');
    await page.fill('#set-stock-open', '4');
    await page.fill('#set-stock-prepmin', '20');
    await page.fill('#set-stock-prepmax', '200');
    await page.locator('#set-panel-stock button').first().click(); // Kaydet
    await page.waitForTimeout(1800);

    await page.locator('#nav-products').click();
    await page.waitForTimeout(2500);
    const crossModule = {
      close: await page.inputValue('#stock-auto-close'),
      open: await page.inputValue('#stock-auto-open'),
      prepmin: await page.inputValue('#stock-auto-prepmin'),
      prepmax: await page.inputValue('#stock-auto-prepmax'),
    };
    pass('Ayarlar degisimi Urun Havuzuna yansir (close=2 open=4 prep=20-200)', crossModule.close === '2' && crossModule.open === '4' && crossModule.prepmin === '20' && crossModule.prepmax === '200', JSON.stringify(crossModule));
    pass('NO MODAL / NO PROMPT (tüm akış)', !dialogOpened, dialogOpened ? 'dialog açıldı!' : '');

    // 6) Final config'i geri yükle (API üzerinden)
    await page.evaluate(async () => {
      await fetch('/stock-automation', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, closeAt: 3, openAt: 5, prepMin: 1, prepMax: 999999 }),
      });
    });
    await page.waitForTimeout(1200);

    console.log('BAD RESPONSES: ' + badResponses.length + (badResponses.length ? ' -> ' + badResponses.join(' | ') : ''));
    console.log('CONSOLE ERRORS: ' + errs.length + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    pass('NETWORK beklenmeyen 4xx/5xx yok', badResponses.length === 0, '');
    pass('CONSOLE 0 ERROR', errs.length === 0, '');

    await browser.close();
    const fails = OUT.filter(x => !x).length;
    console.log('\n=== STOCK POOL + CROSS-MODULE BROWSER: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
    process.exitCode = fails === 0 ? 0 : 1;
  } catch (e) {
    console.error('ERR', e);
    await browser.close();
    process.exitCode = 1;
  }
})();
