const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  try {
    console.log('=== 1. SAYFA ACILIYOR ===');
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Login - use API login directly
    console.log('=== 2. LOGIN ===');
    await page.evaluate(async () => {
      await fetch('/auth/login', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) 
      });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    console.log('Login OK');

    // 3. Pazaryeri sayfasına git
    console.log('=== 3. PAZARYERI ===');
    await page.evaluate(() => { if (typeof showPage === 'function') showPage('marketplace'); });
    await page.waitForTimeout(2000);

    // 4. Modal aç
    console.log('=== 4. MODAL AC ===');
    await page.evaluate(() => { if (typeof mpManageAdd === 'function') mpManageAdd(); });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-opera-1-modal.png' });

    // Modal durumu
    const s1 = await page.evaluate(() => {
      const m = document.getElementById('mp-modal');
      const c = document.getElementById('mp-credential-fields');
      return {
        modalHidden: m?.classList.contains('hidden'),
        credHidden: c?.classList.contains('hidden'),
        type: document.getElementById('mp-type')?.value
      };
    });
    console.log('Modal açıldı, credential gizli:', JSON.stringify(s1));

    // 5. Trendyol seç
    console.log('=== 5. TRENDYOL ===');
    await page.selectOption('#mp-type', 'trendyol');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-opera-2-trendyol.png' });

    const s2 = await page.evaluate(() => {
      const c = document.getElementById('mp-credential-fields');
      const ak = document.getElementById('mp-apiKey');
      const as = document.getElementById('mp-apiSecret');
      const si = document.getElementById('mp-sellerId');
      return {
        credHidden: c?.classList.contains('hidden'),
        credDisplay: c ? getComputedStyle(c).display : 'N/A',
        apiKeyExists: !!ak,
        apiSecretExists: !!as,
        sellerIdExists: !!si,
        apiKeyVisible: ak ? ak.offsetParent !== null : false,
        apiSecretVisible: as ? as.offsetParent !== null : false,
        sellerIdVisible: si ? si.offsetParent !== null : false
      };
    });
    console.log('Credential alanları:', JSON.stringify(s2, null, 2));

    if (!s2.apiKeyExists) {
      console.log('*** API Key ALANI BULUNAMADI! ***');
      console.log('mp-api-fields HTML:', await page.evaluate(() => document.getElementById('mp-api-fields')?.innerHTML?.substring(0, 500)));
      console.log('mp-seller-fields HTML:', await page.evaluate(() => document.getElementById('mp-seller-fields')?.innerHTML?.substring(0, 500)));
    }

    // 6. Doldur ve kaydet
    console.log('=== 6. DOLDUR ===');
    await page.fill('#mp-name', 'OPERA TEST MP');
    const akEl = await page.$('#mp-apiKey');
    const asEl = await page.$('#mp-apiSecret');
    if (akEl) await akEl.fill('OPERA_KEY_123');
    if (asEl) await asEl.fill('OPERA_SECRET_456');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-opera-3-dolu.png' });

    const saveState = await page.evaluate(() => {
      const btn = document.getElementById('mp-save-btn');
      return btn ? { disabled: btn.disabled } : 'NOT FOUND';
    });
    console.log('Save butonu:', JSON.stringify(saveState));

    // 7. Kaydet
    if (!saveState.disabled) {
      console.log('=== 7. KAYDET ===');
      await page.click('#mp-save-btn');
      await page.waitForTimeout(2000);
      
      const afterSave = await page.evaluate(async () => {
        const r = await fetch('/marketplace-manage', { credentials: 'include' });
        const d = await r.json();
        return (d.items || []).map(m => ({ name: m.name, key: m.key, apiKey: m.apiKey, active: m.active }));
      });
      console.log('DB items:', JSON.stringify(afterSave, null, 2));
      await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\ss-opera-4-kayitli.png' });
    }

    // JS hataları
    if (errors.length > 0) {
      console.log('\n=== JS HATALARI ===');
      errors.forEach(e => console.log('  ', e));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  }

  await browser.close();
})();
