// AUDIT ONLY — read-only browser E2E via Playwright. No data mutations.
const { chromium } = require('playwright');

const BASE = 'http://localhost:4000';
const R = [];
let n = 0;
const P = (name, d) => { n++; R.push('[PASS] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };
const F = (name, d) => { n++; R.push('[FAIL] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };
const S = (name, d) => { n++; R.push('[INFO] #' + n + ' ' + name + (d ? ' :: ' + d : '')); console.log(R[R.length - 1]); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const shot = async (name) => { await page.screenshot({ path: 'audit-' + name + '.png', fullPage: false }).catch(() => {}); };

  try {
    // 1. Open app
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    const loginVisible = await page.locator('#login-modal').isVisible().catch(() => false);
    if (loginVisible) P('Login modal açılıyor (unauth)'); else F('Login modal açılıyor', 'modal gizli');

    // 2. Login
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-modal button[onclick="doLogin()"]');
    await page.waitForSelector('#login-modal.hidden', { timeout: 15000 }).catch(() => {});
    const modalHidden = await page.locator('#login-modal').evaluate(el => el.classList.contains('hidden')).catch(() => true);
    if (modalHidden) P('Login başarılı, modal kapandı'); else F('Login', 'modal hala açık');
    await shot('01-dashboard-dark');

    // 3. Dashboard KPIs loaded
    const kpiTotal = await page.locator('#kpi-total-products').textContent().catch(() => '');
    const mpCount = await page.locator('#mp-count').textContent().catch(() => '');
    if (kpiTotal && kpiTotal.trim() !== '' && kpiTotal.trim() !== '0') P('Dashboard KPI yüklendi', 'toplam ürün=' + kpiTotal.trim()); else S('Dashboard KPI', 'değer=' + kpiTotal);
    if (mpCount && mpCount.includes('pazaryeri')) P('Pazaryeri listesi yüklendi', mpCount); else S('Pazaryeri listesi', mpCount);

    // 4. Header / sidebar / theme
    const sidebarVisible = await page.locator('aside, #sidebar, nav').first().isVisible().catch(() => false);
    if (sidebarVisible) P('Sidebar görünür'); else F('Sidebar görünür', 'bulunamadı');
    const themeIcon = await page.locator('#theme-icon').count();
    if (themeIcon > 0) P('Header tema butonu mevcut'); else F('Header tema butonu', 'yok');

    // Dark -> Light
    await page.click('#theme-icon');
    await page.waitForTimeout(300);
    const isLight = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
    if (isLight) P('Tema: Dark -> Light geçişi'); else F('Tema: Dark -> Light geçişi');
    await shot('02-dashboard-light');

    // Light -> Dark
    await page.click('#theme-icon');
    await page.waitForTimeout(300);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark) P('Tema: Light -> Dark geçişi'); else F('Tema: Light -> Dark geçişi');

    // 5. Context seçimi (read-only)
    const xmlOpts = await page.locator('#context-xml-source option').count();
    if (xmlOpts > 1) {
      await page.selectOption('#context-xml-source', { index: 1 });
      await page.waitForTimeout(500);
      const mpDisabled = await page.locator('#context-marketplace').isDisabled().catch(() => true);
      if (!mpDisabled) {
        await page.selectOption('#context-marketplace', { index: 1 });
        await page.waitForTimeout(800);
        P('Context seçimi (XML + Pazaryeri)');
      } else F('Context seçimi', 'pazaryeri select hala disabled');
    } else S('Context seçimi', 'XML kaynağı yok, atlandı');

    // 6. Sayfa navigasyonu
    const pages = [
      ['dashboard', 'page-dashboard'],
      ['xml', 'page-xml'],
      ['products', 'page-products'],
      ['prep-categories', 'page-prep-categories'],
      ['prep-brands', 'page-prep-brands'],
      ['prep-variants', 'page-prep-variants'],
      ['prep-listings', 'page-prep-listings'],
      ['ready-to-ship', 'page-ready-to-ship'],
      ['marketplace', 'page-marketplace'],
      ['orders', 'page-orders'],
      ['reports', 'page-reports'],
      ['settings', 'page-settings'],
      ['ai-image', 'page-ai-image'],
      ['ai-sales', 'page-ai-sales'],
      ['ai-copilot', 'page-ai-copilot'],
      ['ai-control', 'page-ai-control'],
    ];

    for (const [key, containerId] of pages) {
      const nav = await page.locator('#nav-' + key).count();
      if (!nav) { S('Nav ' + key, 'nav öğesi yok, atlandı'); continue; }
      // Ürün Hazırlama alt menüsü açılır
      if (key.startsWith('prep-')) {
        const subVisible = await page.locator('#urunhazirlama-sub').evaluate(el => !el.classList.contains('hidden')).catch(() => false);
        if (!subVisible) {
          await page.evaluate(() => toggleSubmenu(null, 'urunhazirlama-sub', 'urunhazirlama-arrow'));
          await page.waitForTimeout(300);
        }
      }
      await page.click('#nav-' + key);
      await page.waitForTimeout(700);
      const visible = await page.locator('#' + containerId).evaluate(el => !el.classList.contains('hidden')).catch(() => false);
      if (visible) P('Navigasyon: ' + key, 'sayfa açıldı'); else F('Navigasyon: ' + key, containerId + ' görünür değil');
    }

    // 7. Ürün tablosu (context seçilmişse) kontrol
    const productTableRows = await page.locator('#page-products table tbody tr').count();
    S('Ürün sayfası tablo satırı', productTableRows + ' satır');
    await shot('03-products');

    // 8. Kategori sayfası
    await page.click('#nav-prep-categories');
    await page.waitForTimeout(1000);
    await shot('04-categories');

    // 9. Marketplace sayfası
    await page.click('#nav-marketplace');
    await page.waitForTimeout(800);
    const mpRows = await page.locator('#page-marketplace table tbody tr').count().catch(() => 0);
    S('Marketplace tablo satırı', mpRows + ' satır');
    await shot('05-marketplace');

    // 10. Responsive (mobil) davranış
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const mobileSidebarVisible = await page.locator('nav').first().isVisible().catch(() => false);
    S('Mobil viewport sidebar durumu', mobileSidebarVisible ? 'görünür' : 'gizli/overflow olabilir');
    await shot('06-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });

    // 11. Boş durum / guard: context gerektiren sayfada context yoksa uyarı
    // (context seçildiyse bu test anlamsız olur; bilgi olarak kaydedildi)

    // 12. Logout kontrolü (varsa)
    const logoutBtn = await page.locator('[onclick*="logout"], #logout').count();
    S('Logout butonu', logoutBtn > 0 ? 'mevcut' : 'bulunamadı (SPA token bazlı)');
  } catch (e) {
    F('Playwright akışı', e.message);
    await shot('99-crash');
  }

  console.log('\n===== CONSOLE ERRORS =====');
  if (consoleErrors.length === 0) console.log('(yok)');
  else consoleErrors.forEach(e => console.log(' * ' + e));

  console.log('===== PAGE ERRORS =====');
  if (pageErrors.length === 0) console.log('(yok)');
  else pageErrors.forEach(e => console.log(' * ' + e));

  const pass = R.filter(l => l.startsWith('[PASS]')).length;
  const fail = R.filter(l => l.startsWith('[FAIL]')).length;
  console.log('\n===== SUMMARY ===== PASS=' + pass + ' FAIL=' + fail + ' INFO=' + (R.length - pass - fail));

  await browser.close();
  process.exit(fail > 0 ? 2 : 0);
})().catch(async (e) => { console.error('SCRIPT CRASH', e); process.exit(3); });
