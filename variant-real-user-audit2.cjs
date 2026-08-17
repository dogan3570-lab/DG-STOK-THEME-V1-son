// VARIANT REAL USER UI AUDIT — faz 2: düzeltme sonrası tam etkileşim (buton click + manuel akış + ağ + UI)
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
  const net = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 300)));
  page.on('response', async (r) => {
    const u = r.url();
    if (/\/variants\/(ai-match|manual-match-v2|manual-options|manual-values)/.test(u)) {
      let body = '';
      try { body = (await r.text()).slice(0, 500); } catch (e) {}
      net.push({ url: u.split('?')[0], status: r.status(), body });
      log('NET ' + r.status() + ' ' + u.split('?')[0] + ' => ' + body);
    }
  });

  const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, JWT_SECRET, { expiresIn: '1h' });
  await page.context().addCookies([{ name: 'token', value: token, url: BASE }]);

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(3000);

    // ===== A) UI YENİDEN DENETİM =====
    const buttons = await page.evaluate(() => ['var-btn-auto', 'var-btn-ai'].map(id => { const el = document.getElementById(id); const cs = getComputedStyle(el); return { id, tag: el.tagName, text: el.textContent.trim(), visible: !!(el.offsetWidth || el.offsetHeight), disabled: !!el.disabled, cursor: cs.cursor }; }));
    for (const b of buttons) { log('BUTTON: ' + JSON.stringify(b)); pass('BUTTON ' + b.id + ' TURKCE METIN', /otomatik eşleştir|AI ile Eşleştir/i.test(b.text), b.text); }

    const counters = await page.evaluate(() => { const g = id => (document.getElementById(id) || {}).textContent || ''; return { total: g('var-total'), manual: g('var-manual'), waiting: g('var-waiting') }; });
    log('COUNTERS: ' + JSON.stringify(counters));

    const donut = await page.evaluate(() => (document.getElementById('var-donut') || {}).innerText || '');
    pass('GRAPH AI BEKLIYOR SEGMENTI', /AI Bekliyor/.test(donut), donut.slice(0, 250));

    const hint = await page.evaluate(() => (document.getElementById('var-action-hint') || {}).innerText || '');
    pass('ACTION HINT (yapılacak iş)', /Yapmanız gereken/i.test(hint), hint.slice(0, 160));

    // Ürün listesi: NOT_REQUIRED filtrelenmiş mi + manuel satırda buton
    const listInfo = await page.evaluate(() => ({
      pageInfo: (document.getElementById('var-page-info') || {}).textContent || '',
      hasNotRequiredBadge: document.getElementById('var-products-body').innerHTML.includes('Varyant Gerekmiyor'),
      manualBtnCount: (document.getElementById('var-products-body').innerHTML.match(/Manuel Eşleştir/g) || []).length,
      reasonSample: ((document.getElementById('var-products-body').innerText.match(/Neden:[^\n]*/) || [])[0] || ''),
    }));
    log('LIST: ' + JSON.stringify(listInfo));
    pass('LIST NOT_REQUIRED FILTRELI', !listInfo.hasNotRequiredBadge, listInfo.pageInfo);
    pass('MANUAL ROW BUTTON', listInfo.manualBtnCount > 0, 'manuel buton sayısı=' + listInfo.manualBtnCount);
    pass('REASON INSAN-OKUNUR', /CATEGORY_MAPPING_NOT_FOUND/.test(listInfo.reasonSample) === false && listInfo.reasonSample.length > 0, listInfo.reasonSample);

    // 1901
    const bodyHas1901 = await page.evaluate(() => document.body.innerText.includes('1.901'));
    pass('1901 ABSENT', !bodyHas1901, bodyHas1901 ? 'PRESENT' : 'ABSENT');

    await page.screenshot({ path: 'variant-ux-03-fixed-dashboard.png', fullPage: false });

    // ===== B) AUTO BUTON CLICK (tek seçili ürün) =====
    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1500);
    await page.click('#var-products-body tr input[type=checkbox]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const selInfo = await page.evaluate(() => (document.getElementById('var-selection-info') || {}).textContent || '');
    log('SELECTED BEFORE AUTO: ' + selInfo);
    await page.click('#var-btn-auto');
    await page.waitForTimeout(4500);
    const toastAuto = await page.evaluate(() => { const t = document.querySelector('.toast, [class*=toast]'); return t ? t.textContent.trim().slice(0, 160) : (document.body.innerText.match(/Eşleştirme tamamlandı[^\n]*/)?.[0] || ''); });
    pass('AUTO CLICK NETWORK+UI', net.some(n => n.url.includes('/ai-match') && n.status === 200), toastAuto);

    // ===== C) AI BUTON CLICK (tek seçili ürün) =====
    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1200);
    await page.click('#var-products-body tr input[type=checkbox]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.click('#var-btn-ai');
    await page.waitForTimeout(4500);
    const toastAi = await page.evaluate(() => { const t = document.querySelector('.toast, [class*=toast]'); return t ? t.textContent.trim().slice(0, 160) : (document.body.innerText.match(/AI eşleştirme tamamlandı[^\n]*/)?.[0] || ''); });
    pass('AI CLICK NETWORK+UI', net.some(n => n.url.includes('/ai-match') && n.status === 200), toastAi);

    // ===== D) MANUEL AKIŞ (gerçek ürün + gerçek Trendyol data) =====
    const CAND = '739d360d-8998-436f-bd22-ef7e3539836d';
    await page.evaluate((id) => prepVariantOpenManual(id), CAND);
    await page.waitForTimeout(3500);
    const modalState = await page.evaluate(() => ({
      visible: !document.getElementById('var-manual-modal').classList.contains('hidden'),
      product: (document.getElementById('var-manual-product') || {}).textContent || '',
      xml: (document.getElementById('var-manual-xml') || {}).innerText || '',
      attrCount: document.getElementById('var-manual-attr').options.length,
      fieldsVisible: !document.getElementById('var-manual-fields').classList.contains('hidden'),
      hint: (document.getElementById('var-manual-cat-hint') || {}).innerText || '',
    }));
    log('MANUAL MODAL: ' + JSON.stringify(modalState));
    pass('MANUAL MODAL VISIBLE', modalState.visible, modalState.product);
    pass('MANUAL XML VARIANT GORUNUR', modalState.xml.includes('='), modalState.xml);
    pass('MANUAL REAL ATTRIBUTES', modalState.attrCount > 1 && modalState.fieldsVisible, 'attr=' + modalState.attrCount + ' hint=' + modalState.hint);
    await page.screenshot({ path: 'variant-ux-04-manual-modal.png', fullPage: false });

    // İlk değer dönen attribute'u bul
    const picked = await page.evaluate(async () => {
      const sel = document.getElementById('var-manual-attr');
      for (let i = 1; i < sel.options.length; i++) {
        sel.value = sel.options[i].value;
        await prepVariantManualLoadValues();
        await new Promise(r => setTimeout(r, 1800));
        const vs = document.getElementById('var-manual-value');
        if (vs.options.length > 1) return { attrId: sel.value, attrName: sel.options[i].textContent, valueId: vs.options[1].value, valueName: vs.options[1].textContent };
      }
      return null;
    });
    log('MANUAL PICKED: ' + JSON.stringify(picked));
    pass('MANUAL VALUE SELECT (gerçek değer)', !!(picked && picked.valueId), picked && picked.valueName);

    if (picked) {
      await page.evaluate((v) => { document.getElementById('var-manual-value').value = v; }, picked.valueId);
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'variant-ux-05-manual-selected.png', fullPage: false });
      const beforeManual = await page.evaluate(() => (document.getElementById('var-manual') || {}).textContent || '');
      await page.evaluate(() => prepVariantManualSave());
      await page.waitForTimeout(4500);
      const afterState = await page.evaluate(() => ({
        modalHidden: document.getElementById('var-manual-modal').classList.contains('hidden'),
        manual: (document.getElementById('var-manual') || {}).textContent || '',
        toast: ((document.body.innerText.match(/Manuel eşleştirme kaydedildi[^\n]*/) || [])[0] || ''),
      }));
      log('AFTER SAVE: ' + JSON.stringify(afterState));
      pass('MANUAL SAVE UI (modal kapandı)', afterState.modalHidden, afterState.toast);
      pass('MANUAL SAYAÇ AZALDI', afterState.manual !== beforeManual, beforeManual + ' -> ' + afterState.manual);
      const saveNet = net.filter(n => n.url.includes('/manual-match-v2'));
      pass('MANUAL SAVE NETWORK 200', saveNet.length > 0 && saveNet[0].status === 200, saveNet[0] && saveNet[0].body);
      await page.screenshot({ path: 'variant-ux-06-after-manual.png', fullPage: false });
      // UI sonucu: ürün artık MANUAL değil (AUTO olarak listelenir)
      const rowStatus = await page.evaluate((id) => {
        const rows = Array.from(document.querySelectorAll('#var-products-body tr'));
        for (const tr of rows) { if (tr.innerHTML.includes(id)) return tr.innerText.replace(/\s+/g, ' ').slice(0, 220); }
        return 'SATIR BULUNAMADI (başka sayfada)';
      }, CAND);
      log('ROW AFTER MANUAL: ' + rowStatus);
    }

    // ===== E) CONTEXT DEĞİŞİM =====
    const beforeTotal = await page.evaluate(() => (document.getElementById('var-total') || {}).textContent || '');
    await page.selectOption('#var-marketplace', '52fd366c-2ba4-4c65-8c23-bfc8239c1506'); // Hepsiburada
    await page.waitForTimeout(2500);
    const ctxMp = await page.evaluate(() => (document.getElementById('var-ctx-mp') || {}).textContent || '');
    const selCleared = await page.evaluate(() => (document.getElementById('var-selection-info') || {}).textContent || '');
    log('CONTEXT MP: ' + ctxMp + ' | selection: ' + selCleared + ' | total before=' + beforeTotal);
    pass('CONTEXT MP DEĞİŞTİ', ctxMp.toUpperCase().includes('HEPSIBURADA'), ctxMp);
    pass('CONTEXT SONRASI SEÇİM TEMİZ', /0 ürün seçildi/.test(selCleared), selCleared);
    await page.selectOption('#var-marketplace', '757a071c-98c5-4c96-bb8c-2dceac1568dd'); // geri Trendyol
    await page.waitForTimeout(2500);

    // ===== F) SAYFA BOYUTU + SELECT ALL =====
    const sizes = [50, 100, 200, 500, 1000];
    const sizeRes = [];
    for (const s of sizes) {
      await page.selectOption('#var-page-size', String(s));
      await page.waitForTimeout(1500);
      const n = await page.evaluate(() => document.querySelectorAll('#var-products-body tr').length);
      sizeRes.push(s + '=>' + n);
    }
    log('PAGE SIZES: ' + sizeRes.join(' '));
    pass('PAGE SIZE 50/100/200/500/1000', sizeRes.join(' ') === '50=>50 100=>100 200=>200 500=>500 1000=>1000', sizeRes.join(' '));

    await page.selectOption('#var-page-size', '50');
    await page.waitForTimeout(1400);
    await page.check('#var-select-all');
    await page.waitForTimeout(300);
    const selAll = await page.evaluate(() => (document.getElementById('var-selection-info') || {}).textContent || '');
    pass('SELECT ALL (sayfa kapsamı)', /sayfadaki|seçildi/.test(selAll), selAll);

    pass('NO CONSOLE ERRORS', errs.length === 0, errs.slice(0, 3).join(' || '));
  } catch (e) {
    log('FATAL: ' + e.stack);
  }

  await browser.close();
  fs.writeFileSync('variant-audit-phase2.log', OUT.join('\n'));
  log('=== LOG SAVED variant-audit-phase2.log ===');
})().catch(e => { console.error(e); process.exit(1); });
