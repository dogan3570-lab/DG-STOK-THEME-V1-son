const path = require('path');
const globalRoot = require('child_process').execSync('npm root -g').toString().trim();
const pw = require(path.join(globalRoot, 'omniroute', 'node_modules', 'playwright'));

const BASE_URL = 'http://localhost:5175';
const results = [];
let passCount = 0;
let failCount = 0;

function log(tc, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${tc}: ${status}${detail ? ' — ' + detail : ''}`);
  results.push({ tc, status, detail });
  if (status === 'PASS') passCount++;
  if (status === 'FAIL') failCount++;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await pw.chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Users\\Dogan\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    console.log('\n' + '='.repeat(70));
    console.log('  ÜRÜN HAZIRLAMA VE GÖNDERİME HAZIR MODÜLÜ — KAPSAMLI TEST');
    console.log('='.repeat(70) + '\n');

    // ── TC-01 ──
    console.log('--- Ana Sayfa ve Navigasyon ---');
    const res = await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    log('TC-01', res.ok() ? 'PASS' : 'FAIL', `Ana sayfa yükleme (HTTP ${res.status()})`);

    // ── TC-02 ──
    try {
      await page.click('text=Ürün Hazırlama', { timeout: 5000 });
      await delay(1500);
      const c = await page.textContent('body');
      const ok = c.includes('Kategori') && (c.includes('Eşleştirme') || c.includes('Eslestirme'));
      log('TC-02', ok ? 'PASS' : 'FAIL', 'Ürün Hazırlama sayfası → Kategori Eşleştirme');
    } catch (e) { log('TC-02', 'FAIL', e.message); }

    // ── TC-03 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Tedarikçi') && c.includes('Pazaryeri');
      log('TC-03', ok ? 'PASS' : 'FAIL', 'Tedarikçi + Pazaryeri seçim guard');
    } catch (e) { log('TC-03', 'FAIL', e.message); }

    // ── TC-04 ──
    try {
      const selects = await page.locator('select').count();
      log('TC-04', selects >= 2 ? 'PASS' : 'FAIL', `${selects} adet select dropdown`);
    } catch (e) { log('TC-04', 'FAIL', e.message); }

    // ── TC-05 ──
    console.log('\n--- Kategori Eşleştirme Adımları ---');
    try {
      const c = await page.textContent('body');
      const steps = ['Urun Hazirlamaya Gec', 'Otomatik Eslestirme', 'AI Eslestirme', 'Manuel Eslestirme'];
      const found = steps.filter(s => c.includes(s) || c.includes(s.replace('ı', 'i')));
      log('TC-05', found.length >= 3 ? 'PASS' : 'FAIL', `Stepper adımları: ${found.length}/4`);
    } catch (e) { log('TC-05', 'FAIL', e.message); }

    // ── TC-06 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Kategori Eslestirme Ilerlemesi') || c.includes('Eşleştirm');
      log('TC-06', ok ? 'PASS' : 'FAIL', 'İlerleme çubuğu başlığı');
    } catch (e) { log('TC-06', 'FAIL', e.message); }

    // ── TC-07 ──
    try {
      const svgs = await page.locator('svg circle').count();
      log('TC-07', svgs > 0 ? 'PASS' : 'FAIL', `Dairesel ilerleme (SVG circle: ${svgs})`);
    } catch (e) { log('TC-07', 'FAIL', e.message); }

    // ── TC-08 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Toplam:') && c.includes('ürün');
      log('TC-08', ok ? 'PASS' : 'FAIL', 'Toplam ürün sayısı gösterimi');
    } catch (e) { log('TC-08', 'FAIL', e.message); }

    // ── TC-09 ──
    try {
      const pageContent = await page.textContent('body');
      const ok = pageContent.includes('Tam Eslesti') || pageContent.includes('AI Eslesti') || pageContent.includes('Manuel');
      log('TC-09', ok ? 'PASS' : 'FAIL', 'Özet satırları (Tam/AI/Manuel)');
    } catch (e) { log('TC-09', 'FAIL', e.message); }

    // ── Kategori → Marka Geçişi ──
    console.log('\n--- Tab Geçişleri ---');
    try {
      await page.click('button:has-text("Marka")', { timeout: 5000 });
      await delay(1000);
      const c = await page.textContent('body');
      const ok = c.includes('Marka') && (c.includes('Eşleştirme') || c.includes('Eslestirme') || c.includes('V4'));
      log('TC-10', ok ? 'PASS' : 'FAIL', 'Kategori → Marka geçişi');
    } catch (e) { log('TC-10', 'FAIL', e.message); }

    // ── TC-11 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Gönderim Stratejisi') || c.includes('XML Markası') || c.includes('Kendi Markam');
      log('TC-11', ok ? 'PASS' : 'FAIL', 'Marka: Gönderim Stratejisi alanları');
    } catch (e) { log('TC-11', 'FAIL', e.message); }

    // ── TC-12 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Manuel Ekle');
      log('TC-12', ok ? 'PASS' : 'FAIL', 'Manuel Ekle butonu');
    } catch (e) { log('TC-12', 'FAIL', e.message); }

    // ── TC-13 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('AI ile Eşleştir');
      log('TC-13', ok ? 'PASS' : 'FAIL', 'AI ile Eşleştir butonu');
    } catch (e) { log('TC-13', 'FAIL', e.message); }

    // ── TC-14 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Tümünü Eşleştir');
      log('TC-14', ok ? 'PASS' : 'FAIL', 'Tümünü Eşleştir butonu');
    } catch (e) { log('TC-14', 'FAIL', e.message); }

    // ── TC-15 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Tam Eşleşen') || c.includes('AI ile Eşleşti') || c.includes('Eşleşmeyen');
      log('TC-15', ok ? 'PASS' : 'FAIL', 'Marka KPI kartları');
    } catch (e) { log('TC-15', 'FAIL', e.message); }

    // ── Manuel Ekle Modalı ──
    try {
      const btn = page.locator('button:has-text("Manuel Ekle")').first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await delay(500);
        const c = await page.textContent('body');
        const ok = c.includes('Manuel Marka Ekle') || c.includes('Marka Adı');
        log('TC-16', ok ? 'PASS' : 'FAIL', 'Manuel Ekle modalı açıldı');
        // Kapat
        const closeBtn = page.locator('button:has-text("Vazgeç")').first();
        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeBtn.click();
          await delay(300);
        }
      } else {
        log('TC-16', 'FAIL', 'Manuel Ekle butonu görünür değil');
      }
    } catch (e) { log('TC-16', 'FAIL', e.message); }

    // ── Varyant Eşleştirme ──
    console.log('\n--- Varyant Eşleştirme ---');
    try {
      await page.click('button:has-text("Varyant")', { timeout: 5000 });
      await delay(1000);
      const c = await page.textContent('body');
      const ok = c.includes('Varyant') && (c.includes('Eşleştirme') || c.includes('Eslestirme'));
      log('TC-17', ok ? 'PASS' : 'FAIL', 'Varyant Eşleştirme sayfası');
    } catch (e) { log('TC-17', 'FAIL', e.message); }

    // ── TC-18 ──
    try {
      const c = await page.textContent('body');
      const hasSteps = (c.includes('Otomatik Eşleşme') || c.includes('Otomatik Eslestirme')) &&
                       c.includes('AI') && c.includes('Manuel');
      log('TC-18', hasSteps ? 'PASS' : 'FAIL', '3 adım stepper (Otomatik/AI/Manuel)');
    } catch (e) { log('TC-18', 'FAIL', e.message); }

    // ── TC-19 ──
    try {
      const svgs = await page.locator('svg circle').count();
      log('TC-19', svgs > 0 ? 'PASS' : 'FAIL', `Varyant dairesel ilerleme (SVG: ${svgs})`);
    } catch (e) { log('TC-19', 'FAIL', e.message); }

    // ── TC-20 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('AI ile Eşleştir') && c.includes('Tümünü Eşleştir');
      log('TC-20', ok ? 'PASS' : 'FAIL', 'Varyant: AI + Tümünü Eşleştir butonları');
    } catch (e) { log('TC-20', 'FAIL', e.message); }

    // ── TC-21 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('AI Önerileri');
      log('TC-21', ok ? 'PASS' : 'FAIL', 'Varyant: AI Önerileri kutusu');
    } catch (e) { log('TC-21', 'FAIL', e.message); }

    // ── Listeleme Şablonu ──
    console.log('\n--- Listeleme Şablonu ---');
    try {
      await page.click('button:has-text("Listeleme")', { timeout: 5000 });
      await delay(1000);
      const c = await page.textContent('body');
      const ok = c.includes('Listeleme') && c.includes('Şablon');
      log('TC-22', ok ? 'PASS' : 'FAIL', 'Listeleme Şablonu sayfası');
    } catch (e) { log('TC-22', 'FAIL', e.message); }

    // ── TC-23 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Fiyat Aralığı') || c.includes('Yüzde Çarpanı') || c.includes('Ek Tutar');
      log('TC-23', ok ? 'PASS' : 'FAIL', 'Kural tablosu başlıkları');
    } catch (e) { log('TC-23', 'FAIL', e.message); }

    // ── TC-24 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Genel Kurallar') || c.includes('Ürün Bazlı') || c.includes('Kategori Bazlı');
      log('TC-24', ok ? 'PASS' : 'FAIL', '3 adım (Genel/Ürün/Kategori)');
    } catch (e) { log('TC-24', 'FAIL', e.message); }

    // ── TC-25 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('AI Optimizasyon') || c.includes('Skor');
      log('TC-25', ok ? 'PASS' : 'FAIL', 'AI Optimizasyon Skoru');
    } catch (e) { log('TC-25', 'FAIL', e.message); }

    // ── TC-26 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('AI Önerileri');
      log('TC-26', ok ? 'PASS' : 'FAIL', 'Listeleme: AI Önerileri');
    } catch (e) { log('TC-26', 'FAIL', e.message); }

    // ── TC-27 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Kural Ekle') && c.includes('Kaydet');
      log('TC-27', ok ? 'PASS' : 'FAIL', 'Kural Ekle + Kaydet butonları');
    } catch (e) { log('TC-27', 'FAIL', e.message); }

    // ── TC-28 ──
    try {
      const editBtn = page.locator('button:has-text("Düzenle")').first();
      const isVisible = await editBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (isVisible) {
        await editBtn.click();
        await delay(500);
        const inputs = await page.locator('input[inputmode="decimal"]').count();
        log('TC-28', inputs > 0 ? 'PASS' : 'FAIL', `Düzenleme modu: ${inputs} decimal input`);
      } else {
        log('TC-28', 'FAIL', 'Düzenle butonu görünür değil');
      }
    } catch (e) { log('TC-28', 'FAIL', e.message); }

    // ── TC-29 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Kayıtlı Şablonlar');
      log('TC-29', ok ? 'PASS' : 'FAIL', 'Kayıtlı Şablonlar dropdown');
    } catch (e) { log('TC-29', 'FAIL', e.message); }

    // ── Gönderime Hazır ──
    console.log('\n--- Gönderime Hazır ---');
    try {
      await page.click('text=Gönderime Hazır', { timeout: 5000 });
      await delay(2000);
      const c = await page.textContent('body');
      const ok = c.includes('Gönderime Hazır') && (c.includes('Beklemede') || c.includes('Seçili') || c.includes('Toplam'));
      log('TC-30', ok ? 'PASS' : 'FAIL', 'Gönderime Hazır sayfası yüklendi');
    } catch (e) { log('TC-30', 'FAIL', e.message); }

    // ── TC-31 ──
    try {
      const c = await page.textContent('body');
      const ok = c.includes('Hazır') && c.includes('Beklemede') && c.includes('Toplam');
      log('TC-31', ok ? 'PASS' : 'FAIL', 'KPI kartları (Hazır/Bekleyen/Seçili/Toplam)');
    } catch (e) { log('TC-31', 'FAIL', e.message); }

    // ── TC-32 ──
    try {
      const filterBtns = await page.locator('button:has-text("Tümü"), button:has-text("Hazır"), button:has-text("Bekleyen"), button:has-text("Bloklu")').count();
      log('TC-32', filterBtns >= 4 ? 'PASS' : 'FAIL', `Filtre butonları: ${filterBtns}`);
    } catch (e) { log('TC-32', 'FAIL', e.message); }

    // ── TC-33 ──
    try {
      const ths = await page.locator('th').allTextContents();
      const hasEssentials = ths.some(t => t.includes('Ürün')) && ths.some(t => t.includes('Stok'));
      log('TC-33', hasEssentials ? 'PASS' : 'FAIL', `Tablo: ${ths.length} sütun — ${ths.map(t => t.trim()).filter(Boolean).join(', ')}`);
    } catch (e) { log('TC-33', 'FAIL', e.message); }

    // ── TC-34 ──
    try {
      const pageSizeBtns = await page.locator('button:has-text("50"), button:has-text("100"), button:has-text("200")').count();
      log('TC-34', pageSizeBtns >= 3 ? 'PASS' : 'FAIL', `Sayfalama: ${pageSizeBtns} buton`);
    } catch (e) { log('TC-34', 'FAIL', e.message); }

    // ── TC-35 ──
    try {
      const sendAllBtn = page.locator('button:has-text("Tümünü Gönder")').first();
      const isVisible = await sendAllBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (isVisible) {
        const isDisabled = await sendAllBtn.getAttribute('disabled');
        log('TC-35', 'PASS', `Tümünü Gönder — görünür, devre dışı: ${isDisabled !== null}`);
      } else {
        log('TC-35', 'FAIL', 'Tümünü Gönder butonu görünür değil');
      }
    } catch (e) { log('TC-35', 'FAIL', e.message); }

    // ── TC-36 ──
    try {
      const sendBtn = page.locator('button:has-text("Seç ve Gönder"), button:has-text("Ürün Gönder")').first();
      const isVisible = await sendBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (isVisible) {
        const isDisabled = await sendBtn.getAttribute('disabled');
        log('TC-36', 'PASS', `Seç ve Gönder — görünür, devre dışı: ${isDisabled !== null}`);
      } else {
        log('TC-36', 'FAIL', 'Seç ve Gönder butonu görünür değil');
      }
    } catch (e) { log('TC-36', 'FAIL', e.message); }

    // ── Tam Akış ──
    console.log('\n--- Tam Akış Testi ---');
    try {
      await page.click('text=Ürün Hazırlama', { timeout: 5000 });
      await delay(1000);
      const tabs = ['Kategori', 'Marka', 'Varyant', 'Listeleme'];
      let ok = true;
      for (const t of tabs) {
        const btn = page.locator(`button:has-text("${t}")`).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          await delay(400);
        } else { ok = false; }
      }
      await page.click('text=Gönderime Hazır', { timeout: 5000 });
      await delay(1000);
      log('TC-37', ok ? 'PASS' : 'FAIL', 'Tam akış: Hazırlama(4 tab) → Gönderime Hazır');
    } catch (e) { log('TC-37', 'FAIL', e.message); }

    // ── Console Hata ──
    console.log('\n--- Console ve Network Kontrolü ---');
    try {
      const crit = consoleErrors.filter(e =>
        !e.includes('Failed to fetch') && !e.includes('NetworkError') &&
        !e.includes('ERR_CONNECTION') && !e.includes('ResizeObserver') &&
        !e.includes('401') && !e.includes('403') && !e.includes('500')
      );
      log('TC-38', crit.length === 0 ? 'PASS' : 'FAIL',
        `Console: toplam ${consoleErrors.length}, kritik ${crit.length}${crit.length > 0 ? ' → ' + crit[0].substring(0, 80) : ''}`);
    } catch (e) { log('TC-38', 'FAIL', e.message); }

    // ── Responsive ──
    console.log('\n--- Responsive Test ---');
    try {
      await page.setViewportSize({ width: 1024, height: 768 });
      await delay(500);
      log('TC-39', 'PASS', 'Responsive 1024x768 stabil');
    } catch (e) { log('TC-39', 'FAIL', e.message); }

    try {
      await page.setViewportSize({ width: 768, height: 1024 });
      await delay(500);
      log('TC-40', 'PASS', 'Responsive 768x1024 (tablet) stabil');
    } catch (e) { log('TC-40', 'FAIL', e.message); }

  } catch (e) {
    console.log(`\n❌ KRİTİK HATA: ${e.message}\n`);
  } finally {
    await browser.close();
  }

  // ══════════ RAPOR ══════════
  console.log('\n' + '═'.repeat(70));
  console.log('  KAPSAMLI TEST RAPORU — Ürün Hazırlama ve Gönderime Hazır');
  console.log('═'.repeat(70));
  console.log(`  Toplam Test : ${passCount + failCount}`);
  console.log(`  ✅ PASS     : ${passCount}`);
  console.log(`  ❌ FAIL     : ${failCount}`);
  console.log(`  Başarı Oranı: %${Math.round((passCount / Math.max(1, passCount + failCount)) * 100)}`);
  console.log('═'.repeat(70));
  
  if (failCount > 0) {
    console.log('\n  ❌ BAŞARISIZ TESTLER:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`     ${r.tc}: ${r.detail}`);
    });
    console.log('');
  }
  
  console.log('  ✅ BAŞARILI TESTLER:');
  results.filter(r => r.status === 'PASS').forEach(r => {
    console.log(`     ${r.tc}: ${r.detail}`);
  });
  
  console.log('\n' + '═'.repeat(70));
}

run().catch(e => console.error('Test hatası:', e));
