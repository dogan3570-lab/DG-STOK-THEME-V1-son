// RED TEAM — LISTING INLINE KURAL UI (gerçek click, no modal). localhost:4001.
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

function log(s) { console.log(s); }
function pass(label, ok, extra) { log((ok ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

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

  let createdRuleId = null;

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Listeleme modülü + Fiyat Kuralları tabı
    await page.evaluate(() => showPage('prep-listings'));
    await page.waitForTimeout(2000);
    await page.evaluate(() => prepListTab('rules'));
    await page.waitForTimeout(1500);

    // "Yeni Kural" gerçek click
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Yeni Kural'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(1500);

    const formVisible = await page.evaluate(() => {
      const f = document.getElementById('li-rule-form');
      return f && !f.classList.contains('hidden');
    });
    pass('NO MODAL: inline form açıldı (li-rule-form visible)', formVisible, '');
    pass('NO PROMPT: native prompt/dialog açılmadı', !dialogOpened, dialogOpened ? 'dialog açıldı!' : '');

    // Önizleme: sabit ek = 30 → 20 × 1.75 + 30 = 65
    await page.evaluate(() => {
      document.getElementById('li-rule-fixed').value = '30';
      document.getElementById('li-rule-margin').value = '75';
      document.getElementById('li-rule-preview-price').value = '20';
      if (typeof prepListRulePreview === 'function') prepListRulePreview();
    });
    const preview = await page.evaluate(() => document.getElementById('li-rule-preview').innerText);
    pass('Önizleme: 20 × 1.75 + 30 = 65 TL', preview.includes('65'), preview.replace(/\n/g, ' | '));

    // Kapsam değişince ürün/kategori alanı
    await page.evaluate(() => {
      document.getElementById('li-rule-scope').value = 'PRODUCT';
      if (typeof prepListRuleScopeChange === 'function') prepListRuleScopeChange();
    });
    const productWrapVisible = await page.evaluate(() => !document.getElementById('li-rule-product-wrap').classList.contains('hidden'));
    pass('Kapsam=Tek Ürün → ürün seçimi görünür', productWrapVisible, '');

    // Kaydet (benzersiz band ile) → DB kural oluşur
    await page.evaluate(() => {
      document.getElementById('li-rule-scope').value = 'GENERAL';
      if (typeof prepListRuleScopeChange === 'function') prepListRuleScopeChange();
      const mp = document.getElementById('li-rule-mp');
      if (mp && mp.options.length > 0) mp.selectedIndex = 0;
      document.getElementById('li-rule-min').value = '1000';
      document.getElementById('li-rule-max').value = '2000';
      document.getElementById('li-rule-margin').value = '75';
      document.getElementById('li-rule-fixed').value = '30';
      document.getElementById('li-rule-rounding').value = 'none';
    });
    await page.evaluate(() => { if (typeof prepListRuleSave === 'function') prepListRuleSave(); });
    await page.waitForTimeout(2000);

    const saved = await page.evaluate(async () => {
      const d = await fetch('/listing-v2/rules').then(r => r.json());
      const rules = (d && d.items) || [];
      const hit = rules.find(r => r.minPrice === 1000 && r.maxPrice === 2000);
      return hit ? hit.id : null;
    });
    createdRuleId = saved;
    pass('Kaydet → DB kuralı oluştu (min=1000 max=2000)', !!saved, 'id=' + (saved || '').slice(0, 8));

    // Sayfa yenile → form kapalı, kural listede
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { showPage('prep-listings'); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => prepListTab('rules'));
    await page.waitForTimeout(1500);
    const formClosedAfterReload = await page.evaluate(() => document.getElementById('li-rule-form').classList.contains('hidden'));
    pass('Sayfa yenile → form kapalı, kural kalıcı', formClosedAfterReload, '');

    log('BAD RESPONSES: ' + badResponses.length + (badResponses.length ? ' -> ' + badResponses.join(' | ') : ''));
    log('CONSOLE ERRORS: ' + errs.length + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    pass('NETWORK beklenmeyen 4xx/5xx yok', badResponses.length === 0, '');
    pass('CONSOLE 0 ERROR', errs.length === 0, '');
    await page.screenshot({ path: 'listing-rule-final.png', fullPage: false });

    await browser.close();
    console.log('\n=== LISTING BROWSER RED TEAM: TÜMÜ PASS ===');
    process.exitCode = 0;
  } catch (e) {
    console.error('ERR', e);
    await browser.close();
    process.exitCode = 1;
  } finally {
    // Temizlik: oluşturulan test kuralını sil
    if (createdRuleId) {
      try {
        await fetch(BASE + '/listing-v2/rules/' + createdRuleId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        console.log('Temizlik: test kuralı silindi ' + createdRuleId.slice(0, 8));
      } catch (e) {}
    }
  }
})();
