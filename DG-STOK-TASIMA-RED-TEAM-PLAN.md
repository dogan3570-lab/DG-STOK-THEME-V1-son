# DG STOK — STOK OTOMASYONU ÜRÜN HAVUZU TAŞIMA + RED TEAM — PLAN

## PLAN

1. **Mevcut durumu doğrula** (keşif tamamlandı):
   - Backend motor tam ve çalışır durumda: [`stockAutomation.ts`](server/src/services/stockAutomation.ts:50) içinde [`decideSalesAction()`](server/src/services/stockAutomation.ts:50), [`runStockAutomation()`](server/src/services/stockAutomation.ts:122), [`isWithinPrepRange()`](server/src/services/stockAutomation.ts:67).
   - Config route tek kaynak: [`stockAutomation.ts`](server/src/routes/stockAutomation.ts:23) → `GET/PUT /stock-automation`, `POST /stock-automation/run`.
   - Ürün Havuzu UI zaten inline panel olarak mevcut: [`index.html`](index.html:568) → STOK OTOMASYONU + ÜRÜN HAZIRLAMA STOK ARALIĞI (modal yok).
   - Hazırlama min/max gate'i send pipeline'a bağlı: [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:114).
2. **Eksik olan tek parça**: cross-module görünürlük/senkronizasyon. Ayarlar sayfasında Stok sekmesi yok. Red team talimatı gereği `Ayarlar ↔ Ürün Havuzu` aynı değeri göstermeli, bir yerde değişiklik diğerine yansımalı. Bunu **aynı `/stock-automation` endpoint'ini** kullanan ikinci bir okuma/yazma yüzeyi ekleyerek sağla (yeni endpoint/state/schema YOK).
3. Motor dosyalarına, schema'ya, migration'a, db push'a, seed'e, reset'e **dokunma**.
4. Red team testlerini çalıştır: `rt-stock-automation-test.ts`, `rt-stock-failure-test.ts`, `rt-stock-adapter-test.ts` + separation testi + Playwright browser testi.
5. TSC + BUILD + network/console + DB temizlik + göz testi (screenshot).
6. Final raporu üret.

## KÖK NEDEN

Kullanıcı, global stok otomasyonunu **Ayarlar** ekranında değil, ürünlerin bulunduğu **Ürün Havuzu** içinde görmek ve yönetmek istiyor. Motor (histerezis + fail-closed + marketplace inventory) zaten doğru çalışıyor; yapılacak iş motoru yeniden yazmak değil, yönetim arayüzünü Ürün Havuzu'na taşımak/görünür kılmak ve aynı modülde **Ürün Hazırlama MIN/MAX** kontrolünü (satış aç/kapattan ayrı) sunmaktır. Mevcut durumda Ürün Havuzu paneli tamamlanmış; eksik olan tek şey Ayarlar tarafında aynı config'in görünür/senkron olmamasıdır.

## ETKİLENECEK DOSYALAR

| Dosya | Değişiklik | Neden |
|---|---|---|
| [`index.html`](index.html:1514) | Ayarlar sayfasına "Stok" sekmesi + inline panel ekle | `Ayarlar ↔ Ürün Havuzu` aynı config'i göstermeli/senkron olmalı (red team TEST F) |
| [`index.html`](index.html:4682) | [`settingsTab()`](index.html:4682) tab listesine `stock` ekle | Yeni sekme gösterimi |
| [`index.html`](index.html:2603) | [`showPage()`](index.html:2559) `settings` dalına `stockAutoSettingsLoad()` ekle | Sekme açıldığında aynı endpoint'ten yükle |

## MEVCUT MOTORUN KORUNACAĞI DOSYALAR (DEĞİŞTİRİLMEZ)

- [`server/src/services/stockAutomation.ts`](server/src/services/stockAutomation.ts:50) — `decideSalesAction`, `runStockAutomation`, `isWithinPrepRange`, `getStockAutomationConfig`
- [`server/src/services/marketplace/marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts) — `updateMarketplaceInventory` (2xx gate)
- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts) — adapter inventory update sözleşmesi
- [`server/src/routes/stockAutomation.ts`](server/src/routes/stockAutomation.ts:23) — config + run route'ları + validation
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:114) — hazırlama min/max gate'i
- `server/prisma/schema.prisma` — DEĞİŞMEZ (schema lock)

## RED TEAM RİSKLERİ

| Risk | Önlem |
|---|---|
| İkinci config kaynağı/state oluşması | Ayarlar sekmesi aynı `GET/PUT /stock-automation` endpoint'ini kullanır; yeni state/schema/endpoint yok |
| Motor davranışının bozulması | Motor dosyalarına dokunulmaz; histerezis/fail-closed unit testleri yeniden koşulur |
| Native modal/prompt/alert/confirm | İnline panel; hiçbir yerde native dialog kullanılmaz; browser testi `dialog` event'i dinler |
| Config validasyon kaybı | Aynı PUT endpoint kullanılır; backend validation (close<open, negatif reddi, prepMin<=prepMax) aynen korunur |
| Satış/prep kuralının karışması | İki ayrı blok; separation testi prep değişimi close/open'u, close/open değişimi prep'i etkilemediğini kanıtlar |
| DB kalıntısı | Test ürün/state/audit kayıtları test sonunda silinir; `pricingRules=3` korunur |

## GERİ ALMA PLANI

`index.html` dışında hiçbir dosya değişmez. Geri alma: Ayarlar "Stok" sekmesi/paneli kaldırılıp `settingsTab()` ve `showPage()` eski haline döndürülür. Backend/DB etkilenmez.
