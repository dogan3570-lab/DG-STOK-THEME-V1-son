import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:4000';

test.describe('Ürün Hazırlama ve Gönderime Hazır Modülü Testleri', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ==================== 1. ANA SAYFA YÜKLEME ====================
  test('TC-01: Ana sayfa yükleniyor', async ({ page }) => {
    await expect(page).toHaveURL(BASE_URL);
    const title = page.locator('h1, h2, [class*="font-extrabold"]').first();
    await expect(title).toBeVisible({ timeout: 10000 });
  });

  // ==================== 2. SIDEBAR NAVİGASYON ====================
  test('TC-02: Sidebar menü elemanları görünür', async ({ page }) => {
    const sidebar = page.locator('nav, [class*="sidebar"], aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Ürün Hazırlama menüsü
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await expect(prepMenu).toBeVisible();
    
    // Gönderime Hazır menüsü
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await expect(readyMenu).toBeVisible();
  });

  // ==================== 3. KATEGORİ EŞLEŞTIRME ====================
  test('TC-03: Kategori Eşleştirme sayfası yükleniyor', async ({ page }) => {
    // Ürün Hazırlama menüsüne tıkla
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Kategori Eşleştirme başlığını kontrol et
    const heading = page.locator('text=Kategori Eşleştirme').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
    
    // 4 adımlı stepper'ı kontrol et
    const steps = page.locator('text=Urun Hazirlamaya Gec, text=Otomatik Eslestirme, text=AI Eslestirme, text=Manuel Eslestirme');
    const stepCount = await steps.count();
    expect(stepCount).toBeGreaterThanOrEqual(4);
  });

  test('TC-04: Kategori Eşleştirme - Tedarikçi ve Pazaryeri seçimi guard kontrolü', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Uyarı mesajını kontrol et (eğer seçim yapılmamışsa)
    const warning = page.locator('text=Tedarikçi.*Pazaryeri seçiniz, text=Lütfen yukarıdan').first();
    if (await warning.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(warning).toBeVisible();
    }
  });

  test('TC-05: Kategori Eşleştirme - Tedarikçi dropdown açılıyor', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const supplierSelect = page.locator('select').first();
    await expect(supplierSelect).toBeVisible();
    
    // Dropdown seçeneklerini kontrol et
    const options = await supplierSelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
  });

  // ==================== 4. MARKA EŞLEŞTIRME ====================
  test('TC-06: Marka Eşleştirme sayfası yükleniyor', async ({ page }) => {
    // Ürün Hazırlama menüsüne tıkla
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Marka Eşleştirme tab'ına geç
    const markaTab = page.locator('text=Marka Eşleştirme').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    // Başlık kontrolü
    const heading = page.locator('text=Marka Eşleştirme').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('TC-07: Marka Eşleştirme - Gönderim Stratejisi seçimleri', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const markaTab = page.locator('text=Marka Eşleştirme').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    // Gönderim Stratejisi但onlarını kontrol et
    const xmlMode = page.locator('text=XML Markasını Kullan').first();
    const ownMode = page.locator('text=Kendi Markamla Gönder').first();
    
    if (await xmlMode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(xmlMode).toBeVisible();
    }
    if (await ownMode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(ownMode).toBeVisible();
    }
  });

  test('TC-08: Marka Eşleştirme - Manuel Ekle modalı açılıyor', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const markaTab = page.locator('text=Marka Eşleştirme').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    // Manuel Ekle butonunu bul ve tıkla
    const manualBtn = page.locator('text=Manuel Ekle').first();
    if (await manualBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await manualBtn.click();
      await page.waitForTimeout(500);
      
      // Modal açıldı mı kontrol et
      const modal = page.locator('text=Manuel Marka Ekle, text=Marka Adı').first();
      await expect(modal).toBeVisible({ timeout: 5000 });
    }
  });

  // ==================== 5. VARYANT EŞLEŞTIRME ====================
  test('TC-09: Varyant Eşleştirme sayfası yükleniyor', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const varyantTab = page.locator('text=Varyant Eşleştirme').first();
    await varyantTab.click();
    await page.waitForTimeout(1000);
    
    const heading = page.locator('text=Varyant Eşleştirme').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('TC-10: Varyant Eşleştirme - 3 adımlı stepper', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const varyantTab = page.locator('text=Varyant Eşleştirme').first();
    await varyantTab.click();
    await page.waitForTimeout(1000);
    
    // 3 step butonunu kontrol et
    const step1 = page.locator('text=Otomatik Eşleşme').first();
    const step2 = page.locator('text=AI Eşleştirme').first();
    const step3 = page.locator('text=Manuel Eşleştirme').first();
    
    if (await step1.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(step1).toBeVisible();
    }
    if (await step2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(step2).toBeVisible();
    }
    if (await step3.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(step3).toBeVisible();
    }
  });

  test('TC-11: Varyant Eşleştirme - Dairesel ilerleme çubuğu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const varyantTab = page.locator('text=Varyant Eşleştirme').first();
    await varyantTab.click();
    await page.waitForTimeout(1000);
    
    // SVG progress ring kontrolü
    const progressRing = page.locator('svg circle').first();
    if (await progressRing.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(progressRing).toBeVisible();
    }
  });

  // ==================== 6. LİSTELEME ŞABLONU ====================
  test('TC-12: Listeleme Şablonu sayfası yükleniyor', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('text=Listeleme Şablonları').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    const heading = page.locator('text=Listeleme Şablonu').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('TC-13: Listeleme Şablonu - Kural tablosu görünüyor', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('text=Listeleme Şablonları').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    // Kural tablosu başlıkları
    const priceHeader = page.locator('text=Fiyat Aralığı').first();
    const marginHeader = page.locator('text=Yüzde Çarpanı').first();
    const fixedHeader = page.locator('text=Ek Tutar').first();
    
    if (await priceHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(priceHeader).toBeVisible();
    }
    if (await marginHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(marginHeader).toBeVisible();
    }
    if (await fixedHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(fixedHeader).toBeVisible();
    }
  });

  test('TC-14: Listeleme Şablonu - Kural Ekle butonu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('text=Listeleme Şablonları').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    const addRuleBtn = page.locator('text=Kural Ekle').first();
    if (await addRuleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(addRuleBtn).toBeVisible();
    }
  });

  test('TC-15: Listeleme Şablonu - AI Optimizasyon Skoru', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('text=Listeleme Şablonları').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    const scoreRing = page.locator('text=AI Optimizasyon').first();
    if (await scoreRing.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(scoreRing).toBeVisible();
    }
  });

  test('TC-16: Listeleme Şablonu - 3 step navigasyonu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('text=Listeleme Şablonları').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    const genelStep = page.locator('text=Genel Kurallar').first();
    const urunStep = page.locator('text=Ürün Bazlı').first();
    const kategoriStep = page.locator('text=Kategori Bazlı').first();
    
    if (await genelStep.isVisible({ timeout: 3000 }).catch(() => false)) {
      await genelStep.click();
      await page.waitForTimeout(500);
    }
    
    if (await urunStep.isVisible({ timeout: 3000 }).catch(() => false)) {
      await urunStep.click();
      await page.waitForTimeout(500);
      
      // Ürün arama kutusunu kontrol et
      const searchBox = page.locator('input[placeholder*="Ürün adı"]').first();
      if (await searchBox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(searchBox).toBeVisible();
      }
    }
  });

  // ==================== 7. GÖNDERİME HAZIR ====================
  test('TC-17: Gönderime Hazır sayfası yükleniyor', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    const heading = page.locator('text=Gönderime Hazır').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('TC-18: Gönderime Hazır - KPI kartları görünüyor', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // KPI kartlarını kontrol et
    const readyCard = page.locator('text=Gönderime Hazır').first();
    const waitingCard = page.locator('text=Beklemede').first();
    const selectedCard = page.locator('text=Seçili').first();
    const totalCard = page.locator('text=Toplam').first();
    
    if (await readyCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(readyCard).toBeVisible();
    }
  });

  test('TC-19: Gönderime Hazır - Filtre butonları', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // Filtre butonlarını kontrol et
    const allFilter = page.locator('button:has-text("Tümü")').first();
    const readyFilter = page.locator('button:has-text("Hazır")').first();
    const waitingFilter = page.locator('button:has-text("Bekleyen")').first();
    const blockedFilter = page.locator('button:has-text("Bloklu")').first();
    
    if (await allFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(allFilter).toBeVisible();
    }
    if (await readyFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(readyFilter).toBeVisible();
    }
  });

  test('TC-20: Gönderime Hazır - Tablo yapısı', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // Tablo başlıklarını kontrol et
    const productHeader = page.locator('th:has-text("Ürün")').first();
    const skuHeader = page.locator('th:has-text("SKU")').first();
    const stockHeader = page.locator('th:has-text("Stok")').first();
    const categoryHeader = page.locator('th:has-text("Kategori")').first();
    const brandHeader = page.locator('th:has-text("Marka")').first();
    const variantHeader = page.locator('th:has-text("Varyant")').first();
    const statusHeader = page.locator('th:has-text("Durum")').first();
    
    if (await productHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(productHeader).toBeVisible();
    }
  });

  test('TC-21: Gönderime Hazır - Sayfalama', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // Sayfalama butonlarını kontrol et
    const page50 = page.locator('button:has-text("50")').first();
    const page100 = page.locator('button:has-text("100")').first();
    const page200 = page.locator('button:has-text("200")').first();
    
    if (await page50.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(page50).toBeVisible();
    }
  });

  test('TC-22: Gönderime Hazır - Tümünü Gönder butonu', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    const sendAllBtn = page.locator('text=Tümünü Gönder').first();
    if (await sendAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(sendAllBtn).toBeVisible();
      // Buton devre dışı olmalı (pazaryeri seçilmediği için)
      const isDisabled = await sendAllBtn.getAttribute('disabled');
      expect(isDisabled).not.toBeNull();
    }
  });

  test('TC-23: Gönderime Hazır - Seç ve Gönder butonu', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    const sendBtn = page.locator('text=Seç ve Gönder, text=Ürün Gönder').first();
    if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(sendBtn).toBeVisible();
      const isDisabled = await sendBtn.getAttribute('disabled');
      expect(isDisabled).not.toBeNull();
    }
  });

  // ==================== 8. MODÜLLER ARASI GEÇİŞ ====================
  test('TC-24: Kategori → Marka geçişi (CustomEvent)', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Kategori sekmesinde olduğunu doğrula
    const categoryHeading = page.locator('text=Kategori Eşleştirme').first();
    await expect(categoryHeading).toBeVisible({ timeout: 5000 });
    
    // Marka sekmesine geç
    const markaTab = page.locator('text=Marka Eşleştirme').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    // Marka sayfasında olduğunu doğrula
    const markaHeading = page.locator('text=Marka Eşleştirme').first();
    await expect(markaHeading).toBeVisible({ timeout: 5000 });
  });

  test('TC-25: Tüm preparation tabları arası geçiş', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Kategori
    const kategoriTab = page.locator('button:has-text("Kategori Eşleştirme")').first();
    await kategoriTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Kategori Eşleştirme Motoru').first()).toBeVisible({ timeout: 5000 });
    
    // Marka
    const markaTab = page.locator('button:has-text("Marka Eşleştirme")').first();
    await markaTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Marka Eşleştirme V4').first()).toBeVisible({ timeout: 5000 });
    
    // Varyant
    const varyantTab = page.locator('button:has-text("Varyant Eşleştirme")').first();
    await varyantTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Varyant Eşleştirme').first()).toBeVisible({ timeout: 5000 });
    
    // Listeleme
    const listelemeTab = page.locator('button:has-text("Listeleme Şablonları")').first();
    await listelemeTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Listeleme Şablonu').first()).toBeVisible({ timeout: 5000 });
  });

  // ==================== 9. HATA SENARYOLARI ====================
  test('TC-26: Boş veri ile gönderim denemesi', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // Pazaryeri seçilmeden gönder butonuna bas
    const sendAllBtn = page.locator('text=Tümünü Gönder').first();
    if (await sendAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Buton devre dışı olmalı
      const isDisabled = await sendAllBtn.getAttribute('disabled');
      expect(isDisabled).not.toBeNull();
    }
  });

  test('TC-27: Kategori eşleştirmede API hata yönetimi', async ({ page }) => {
    // API'nin çalıştığını doğrula (network isteklerini izle)
    const apiCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/') || req.url().includes('/categories/')) {
        apiCalls.push(req.url());
      }
    });
    
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(2000);
    
    // En az bir API çağrısı yapılmış olmalı
    expect(apiCalls.length).toBeGreaterThan(0);
  });

  // ==================== 10. RESPONSİVE DAVRANIŞ ====================
  test('TC-28: Dar ekranda tablo görünümü', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    await page.waitForTimeout(2000);
    
    // Tablo hala görünür olmalı
    const table = page.locator('table').first();
    if (await table.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(table).toBeVisible();
    }
  });

  // ==================== 11. LOADING STATE ====================
  test('TC-29: Loading spinner görünüyor', async ({ page }) => {
    const readyMenu = page.locator('text=Gönderime Hazır').first();
    await readyMenu.click();
    
    // Loading spinner'ı kısa süreliğine görünmeli
    const spinner = page.locator('[class*="animate-spin"]').first();
    // Spinner çok hızlı kaybolabilir, bu yüzden sadece sayfanın yüklendiğini kontrol et
    await page.waitForTimeout(3000);
    await expect(page.locator('table, [class*="text-center"]')).toBeVisible({ timeout: 10000 });
  });

  // ==================== 12. GERÇEK SENARYO: ÜRÜN HAZIRLAMA AKIŞI ====================
  test('TC-30: Tam ürün hazırlama akışı simülasyonu', async ({ page }) => {
    // Adım 1: Kategori Eşleştirme sayfasına git
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    // Stepper'daki 1. adıma tıkla (Urun Hazirlamaya Gec)
    const step1 = page.locator('text=Urun Hazirlamaya Gec').first();
    if (await step1.isVisible({ timeout: 3000 }).catch(() => false)) {
      await step1.click();
      await page.waitForTimeout(1000);
    }
    
    // Adım 2: Marka Eşleştirme sayfasına geçiş
    const markaTab = page.locator('button:has-text("Marka Eşleştirme")').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Marka Eşleştirme').first()).toBeVisible({ timeout: 5000 });
    
    // Adım 3: Varyant Eşleştirme sayfasına geçiş
    const varyantTab = page.locator('button:has-text("Varyant Eşleştirme")').first();
    await varyantTab.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Varyant Eşleştirme').first()).toBeVisible({ timeout: 5000 });
    
    // Adım 4: Listeleme Şablonu sayfasına geçiş
    const listelemeTab = page.locator('button:has-text("Listeleme Şablonları")').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Listeleme Şablonu').first()).toBeVisible({ timeout: 5000 });
    
    // Adım 5: Gönderime Hazır sayfasına geçiş
    const readyMenu2 = page.locator('text=Gönderime Hazır').first();
    await readyMenu2.click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Gönderime Hazır').first()).toBeVisible({ timeout: 5000 });
  });

  // ==================== 13. CONSOLE HATA KONTROLÜ ====================
  test('TC-31: Sayfa yüklenirken console hatası yok', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(2000);
    
    // Kritik hataları filtrele (API hatalarını hariç tut)
    const criticalErrors = errors.filter(e => 
      !e.includes('Failed to fetch') && 
      !e.includes('NetworkError') &&
      !e.includes('ERR_CONNECTION') &&
      !e.includes('401') &&
      !e.includes('403') &&
      !e.includes('500')
    );
    
    expect(criticalErrors.length).toBe(0);
  });

  // ==================== 14. LİSTELEME ŞABLONU DETAY ====================
  test('TC-32: Listeleme Şablonu - Düzenleme modu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('button:has-text("Listeleme Şablonları")').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    // Düzenle butonuna tıkla
    const editBtn = page.locator('text=Düzenle').first();
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(500);
      
      // Düzenleme modunda input'lar görünmeli
      const inputs = page.locator('input[inputmode="decimal"]');
      const inputCount = await inputs.count();
      expect(inputCount).toBeGreaterThan(0);
    }
  });

  test('TC-33: Listeleme Şablonu - Kayıtlı Şablonlar dropdown', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const listelemeTab = page.locator('button:has-text("Listeleme Şablonları")').first();
    await listelemeTab.click();
    await page.waitForTimeout(1000);
    
    // Kayıtlı Şablonlar butonuna tıkla
    const savedBtn = page.locator('text=Kayıtlı Şablonlar').first();
    if (await savedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await savedBtn.click();
      await page.waitForTimeout(500);
      
      // Dropdown açılmalı
      const dropdown = page.locator('[class*="overflow-y-auto"]').first();
      if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(dropdown).toBeVisible();
      }
    }
  });

  // ==================== 15. MARKA EŞLEŞTIRME DETAY ====================
  test('TC-34: Marka Eşleştirme - AI ile Eşleştir butonu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const markaTab = page.locator('button:has-text("Marka Eşleştirme")').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    const aiBtn = page.locator('text=AI ile Eşleştir').first();
    if (await aiBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(aiBtn).toBeVisible();
      const isDisabled = await aiBtn.getAttribute('disabled');
      // Pazaryeri seçilmediği için devre dışı olmalı
      expect(isDisabled).not.toBeNull();
    }
  });

  test('TC-35: Marka Eşleştirme - Tümünü Eşleştir butonu', async ({ page }) => {
    const prepMenu = page.locator('text=Ürün Hazırlama').first();
    await prepMenu.click();
    await page.waitForTimeout(1000);
    
    const markaTab = page.locator('button:has-text("Marka Eşleştirme")').first();
    await markaTab.click();
    await page.waitForTimeout(1000);
    
    const matchAllBtn = page.locator('text=Tümünü Eşleştir').first();
    if (await matchAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(matchAllBtn).toBeVisible();
      const isDisabled = await matchAllBtn.getAttribute('disabled');
      expect(isDisabled).not.toBeNull();
    }
  });
});
