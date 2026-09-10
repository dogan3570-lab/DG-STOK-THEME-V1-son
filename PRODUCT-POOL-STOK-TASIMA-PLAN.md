# ÜRÜN HAVUZU'NA STOK OTOMASYONU TAŞIMA — PLAN

## PLAN
Mevcut çalışan GLOBAL STOCK AUTOMATION motorunu (backend) DEĞİŞTİRMEDEN, kullanıcının yönetim arayüzünü **Ayarlar → Stok** yerine **Ürün Havuzu** içine taşımak. Aynı `/stock-automation` config endpoint'i tek kaynak olarak kalır; yeni API/state/schema eklenmez. Ürün Hazırlama MIN/MAX aynı bölümde ama açıkça AYRI bir alt blok olarak sunulur.

## KÖK NEDEN
Stok otomasyonu config UI'ı ilk implementasyonda Ayarlar sayfasına kondu. Kullanıcı bu ayarı ürünlerin bulunduğu Ürün Havuzu'nda yönetmek istiyor. Motor (histerezis + fail-closed + marketplace inventory) zaten doğru çalışıyor; değişiklik yalnızca UI konumu ve tek kaynak düzenidir.

## ETKİLENECEK DOSYALAR
- [`index.html`](index.html:519) — Ürün Havuzu sayfasına STOK OTOMASYONU + ÜRÜN HAZIRLAMA STOK ARALIĞI inline paneli eklenir.
- [`index.html`](index.html:1457) — Ayarlar sayfasındaki "Stok" tab/panel kaldırılır (düzenlenebilir ikinci kopya olmaması için).

## MEVCUT MOTORUN KORUNACAĞI DOSYALAR (DEĞİŞTİRİLMEZ)
- [`server/src/services/stockAutomation.ts`](server/src/services/stockAutomation.ts:39) — `decideSalesAction`, `runStockAutomation`, `isWithinPrepRange`
- [`server/src/services/marketplace/marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts:68) — `updateMarketplaceInventory`
- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts:175) — Trendyol envanter güncelleme
- [`server/src/routes/stockAutomation.ts`](server/src/routes/stockAutomation.ts:1) — config + run route'ları

## RED TEAM RİSKLERİ
| Risk | Önlem |
|---|---|
| Çift düzenlenebilir kopya (Ayarlar + Havuz) | Ayarlar Stok paneli kaldırılır; yalnızca Ürün Havuzu düzenler |
| Native modal/prompt | Inline panel; hiçbir yerde prompt/alert/confirm kullanılmaz |
| Motor davranışı değişmesi | Backend dosyalarına dokunulmaz |
| Config validasyonu kaybı | Aynı PUT endpoint kullanılır (validasyon backend'de) |
| Hazırlama/satış karışması | İki ayrı alt blok; aynı endpoint ama farklı alanlar |

## GERİ ALMA PLANI
`index.html` dışında hiçbir dosya değişmez. Geri alma: Ürün Havuzu panelini kaldırıp Ayarlar Stok panelini geri eklemek. Backend/DB etkilenmez.
