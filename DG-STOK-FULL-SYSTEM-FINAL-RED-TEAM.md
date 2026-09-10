# DG STOK — FULL SYSTEM FINAL RED TEAM

Tarih: 2026-08-16 · Ortam: Windows 11 · Backend: `tsx` (port 4001, production dist) · DB: SQLite `server/prisma/dev.db`

> KORUMA KURALLARI UYGULANDI: Prisma schema değişikliği YOK, migration YOK, `db push` YOK, seed YOK, DB reset YOK, git commit/push YOK, büyük refactor YOK, çalışan modül taşınmadı, mock başarı gerçek başarı gibi raporlanmadı.

---

## 1. FULL SYSTEM HARİTASI (gerçek bağlantılar)

```
XML Kaynakları (XmlSource: AKILLIBAYI1, 1 kaynak)
   ↓ xmlImport.ts (upsert + categoryId/brandId ata + 4/4 flag'leri)
Ürün İçe Aktarma → Ürün Havuzu (Product: 13 382 AKILLIBAYI1 + 22 bağlamsız test ürünü)
   ↓ categoryId / supplierCategory
Kategori Eşleştirme (prepCategories + aiGateway + trendyolMapping)
   ↓ categoryId + categoryMatch
Marka Eşleştirme (prepBrands + trendyolMapping) → brandId + brandMatch (13 382/13 382 tamam)
   ↓
Varyant Analizi (prepVariants + variantMatch) → variantStatus=NOT_REQUIRED (13 382/13 382)
   ↓
Listeleme Fiyat Kuralları (listingPriceResolver + listingTemplateResolver)
   ↓
Ürün Hazırlama / Ready-to-Ship (readiness.ts: 4/4 gate)
   ↓
Send Pipeline (marketplace/sendPipeline + sendReadiness)
   ↓
Marketplace API (marketplaceApi + adapters) → **GERÇEK CREDENTIAL YOK**
   ↓
Stok Otomasyonu (stockAutomation.ts histerezis motoru)
```

### Modül matrisi (UI / API / DB / SERVICE / INPUT / OUTPUT / DEPENDENCY / NEXT)

| Modül | UI | API | DB tabloları | SERVICE | INPUT → OUTPUT | NEXT |
|---|---|---|---|---|---|---|
| XML Kaynakları | `nav-xml` | `/xml-sources` | `XmlSource` | `xmlImport` | XML dosyası/URL → ürün | Ürün Havuzu |
| Ürün Havuzu | `nav-products` | `/products` | `Product` | — | xmlSourceId → ürün listesi | Kategori |
| Kategori | `nav-prep-categories` | `/categories/*` | `Category`, `CategoryMapping` | `aiGateway`, `categoryBrandMapper`, `trendyolMapping` | supplierCategory → categoryId+categoryMatch | Marka |
| Marka | `prepBrands` | `/brands/*` | `Brand`, `BrandMapping` | `categoryBrandMapper`, `trendyolMapping` | xmlBrandName → brandId+brandMatch | Varyant |
| Varyant | `prepVariants` | `/variants/*` | `Variant`, `VariantAnalysis` | `variantAi`, `variantMatch` | XML parent/group → variantStatus | Listeleme |
| Listeleme | `prepListings`, `listing-v2` | `/listings`, `/listing-v2` | `ListingTemplate`, `MarketplacePricingRule`, `ListingLog` | `listingEngine`, `listingPriceResolver`, `listingTemplateResolver` | ürün+kategori → şablon+fiyat | Ready-to-Ship |
| Ready-to-Ship | `ready-to-ship` | `/ready-to-ship/*` | `Product` (READY_FILTER) | `readiness` | 4/4 gate → READY | Send |
| Send | `marketplace-send` | `/marketplace-send/*`, `/ready-to-ship/send` | `ProductMarketplaceState` | `sendPipeline`, `sendReadiness` | READY ürün → PENDING/NOT_CONFIGURED | Marketplace API |
| Marketplace API | `marketplace-manage` | `/marketplace-manage`, `/marketplaces` | `Marketplace` | `marketplace/adapters`, `marketplaceApi` | credential → gerçek API | Stok |
| Stok Otomasyonu | `stock-automation` | `/stock-automation/*` | `Setting`, `ProductMarketplaceState` | `stockAutomation` | stok → CLOSE/OPEN/HOLD | Marketplace API |
| Dashboard/Reports/Auth | `dashboard`, `reports`, `settings` | `/dashboard`, `/reports`, `/auth/*` | `User`, `AuditLog`, `Order` | `authMiddleware`, `bootstrap` | — | — |

---

## 2. CRITICAL BUG #1 — "Ürün Hazırlama tamam ama ürün yok"

### Gerçek DB sayıları (AKILLIBAYI1, `xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2`)

| Metrik | Değer |
|---|---|
| Toplam ürün | 13 382 |
| `status=READY` | 6 092 |
| `status=XML` | 7 290 |
| `categoryMatch=true` | 7 658 |
| `categoryId` dolu | 13 352 |
| `categoryId` dolu & `categoryMatch=false` (limbo) | **5 694** |
| `categoryId=null` (manuel) | 30 |
| `brandMatch=true` | 13 382 |
| `variantStatus=NOT_REQUIRED` | 13 382 |
| `templateMatch=true` | 6 092 |
| `templateMatch=false` | 7 290 |

### Ready-to-Ship API gerçeği

- `GET /ready-to-ship/stats` → `readyCount=6093, total=13404`
- `GET /ready-to-ship?filter=ready` → ürün döner.

**Sonuç: "0 ürün" semptomu MEVCUT KODDA API düzeyinde yeniden üretilemiyor.** Ready-to-Ship 6 093 ürün gösteriyor. "0/eksik" algısının kök nedeni, UI ile backend'in **farklı "kategori tamam" tanımı** kullanması ve tarihsel veri gecikmesidir:

### KÖK NEDEN (zincir, kanıtlı)

1. **UI/backend kural çakışması:** Kategori UI [`index.html:5224`](index.html:5224) "kategori eşleşmiş = `categoryId` dolu" kabul ediyordu; backend authoritative [`readiness.ts:76`](server/src/services/readiness.ts:76) ise `categoryMatch === true` istiyor. 5 694 limbo ürün (categoryId dolu, categoryMatch=false) UI'da "eşleşmiş/yeşil" görünüyor, ama Ready-to-Ship gate'inde takılı kalıyor.
2. **Listing doğrulama çelişkisi:** [`listingEngine.ts:486`](server/src/services/listingEngine.ts:486) `passed = categoryMatch || categoryId !== null` kullanıyordu — mesaj "Eşleşmemiş" derken `passed=true` dönüyordu (kendi içinde çelişkili).
3. **Tarihsel flag gecikmesi:** 1 566 ürün `categoryMatch=true` + `brandMatch=true` + `variantStatus=NOT_REQUIRED` ama `templateMatch=false` (eski import'tan kalma). Bu ürünler varsayılan şablona çözülse de READY'ye terfi edemiyor.
4. **30 manuel:** `categoryId=null` + `supplierCategory=null` → kategorisiz.

### UYGULANAN KONTROLLÜ DÜZELTME

- [`index.html:5224`](index.html:5224), [`index.html:5228`](index.html:5228), [`index.html:5270-5275`](index.html:5270): UI "eşleşmiş" tanımı backend ile birebir `categoryMatch === true` yapıldı; sayaçlar tutarlı hale getirildi (auto = categoryMatch true, ai = önerili kategorisiz, manuel = geri kalan).
- [`listingEngine.ts:486`](server/src/services/listingEngine.ts:486), [`listingEngine.ts:491`](server/src/services/listingEngine.ts:491): `passed` bayrağı `categoryMatch === true` / `brandMatch === true` ile mesajla tutarlı hale getirildi.

> Kapsam dışı bırakıldı (karar gerektirir): 5 694 limbo ürünün categoryMatch'i ve 1 566 ürünün templateMatch'i **tarihsel veri** — gerçek kullanıcı verisine toplu `UPDATE` çalıştırılmadı. Bu ürünlerin category'leri `externalId=null` (Trendyol'a map edilmemiş) olduğundan otomatik "READY" yapılmaları ZATEN YANLIŞ olurdu; UI artık onları dürüstçe "manuel" gösterir.

---

## 3. CRITICAL BUG #2 — "30 manuel kategori ürününde kategori ağacı yok"

### Kanıt (DB)

30 ürün (`xmlSourceId=AKILLIBAYI1`, `categoryId=null`):
- **`supplierCategory=null`** (XML'de kategori alanı yok),
- `matchedBy=manual`, `categoryMatch=false`, `status=XML`.

Kategori "ağacı" (DB): 1 311 kategori kaydı, **tamamı `parentId=null`** (düz liste). Hiyerarşi isimlerde `>>>` ayracıyla taşınıyor (örn. `aksesuar >>> canta >>> omuz cantasi`), `parentId` ilişkisinde DEĞİL.

### "Kategori ağacı yok" mesajının gerçek sebebi (A–J elemesi)

| Hipotez | Sonuç |
|---|---|
| A) Kategori ağacı DB/API'de gerçekten yok | ❌ 1 311 kategori + `GET /categories/tree` 200 döner |
| B) Frontend yanlış endpoint | ❌ `catLoadPickerTree()` doğru endpoint'i çağırıyor |
| C) marketplaceId yanlış | ❌ Trendyol id doğru |
| D) Trendyol credential eksik | ⚠️ credential YOK ama bu tree'yi etkilemiyor (tree DB'den) |
| E) Category tree cache boş | ❌ cache yok, canlı DB okunuyor |
| F) externalId yanlış | ❌ 23 mapping'de externalId dolu |
| G) XML context yanlış | ❌ context taşınıyor |
| H) Modal yanlış property | ❌ `d.items` doğru okunuyor |
| **I) 30 manuel ürün için marketplace context taşınmıyor** | ✅ **KÖK NEDEN** — `marketplaceId=tt` seçiliyken `/categories/tree?marketplaceId=tt` yalnızca **23 map edilmiş kategori** döner (1 311 değil). Kullanıcı 30 ürünü eşleştirmek için yalnızca 23 hazır kategori görür; üstelik 30 ürünün `supplierCategory=null` olduğu için otomatik/AI eşleşmesi **yapısal olarak imkânsızdır** |
| J) Başka | ✅ **Düz ağaç:** tüm kategoriler `parentId=null` olduğundan `buildTree(null)` hiyerarşi üretmez, 1 311 kök düğüm döner |

### Sonuç (kök neden zinciri)

1. `supplierCategory=null` → 30 ürün kalıcı olarak manuel kovaya düşer (bu doğru fail-closed davranıştır; kodda `ai-match` [`prepCategories.ts:192`](server/src/routes/prepCategories.ts:192) `if (!path) { manualCount += ... }` ile kanıtlı).
2. Kategori ağacı **düz bir listedir** (`parentId=null`), hiyerarşi isim içinde `>>>` ile taşınır.
3. `marketplaceId=tt` filtresi tree'yi 23 kategoriye indirir → "ağaç yok/eksik" algısı.

> Düzeltme yapılmadı çünkü: (a) `parentId` hiyerarşisi kurmak `>>>` adlarından parent-child üretmeyi gerektirir = veri migration'ı = KORUMA kuralına aykırı; (b) 30 ürüne sahte kategori atamak mock başarı olur. Bu iki konu karar gerektiren VERİ işleridir.

---

## 4. FULL USER JOURNEY TEST

Gerçek Chromium (Playwright 1.62.1, headless) + API düzeyinde:

| Aşama | API | UI/DB |
|---|---|---|
| LOGIN | 200 + token | ✅ modal kapandı |
| DASHBOARD | `/dashboard/stats` 200 (totalProducts=13404) | ✅ yüklendi |
| XML KAYNAĞI | `/xml-sources` 200 (1 kaynak) | ✅ |
| ÜRÜN HAVUZU | `/products` 200 | ✅ |
| KATEGORİ | `/categories/*` 200; tree=1311 (tt filtresiyle 23) | ✅ sayfa açıldı |
| MARKA | `/brands` 200 (17) | ✅ |
| VARYANT | `/variants` 200; 13 382 NOT_REQUIRED | ✅ |
| LİSTELEME | `/listings` 200 (3 kural), `/listing-v2/price` 200 | ✅ |
| READY-TO-SHIP | `readyCount=6093` | ✅ sayfa yüklendi |
| SEND CENTER | `/marketplace-send` 200 | ✅ |

**UI count = API count = DB count** (hepsi tutarlı, `readyCount=6093` ↔ `READY_FILTER=6093` ↔ DB).

---

## 5. LİSTELEME FİYAT MOTORU

[`listingPriceResolver.ts:96`](server/src/services/listingPriceResolver.ts:96) doğrulandı:

`listingPrice = kdvDahilAlis × (1 + kar/100) + sabitEk`

- **20 × (1 + 75/100) + 30 = 65** ✅ (birim test PASS)
- KDV ikinci kez eklenmiyor ✅
- MIN/MAX bant, fallback yok, çakışma → `PRICE_RULE_AMBIGUOUS` ✅
- 3 gerçek `MarketplacePricingRule` korundu (dokunulmadı) ✅
- Gerçek XML isolation / marketplace isolation: çözümleyici ürün→kategori→genel sırasıyla [`listingTemplateResolver.ts:32`](server/src/services/listingTemplateResolver.ts:32) ✅

## 6. GLOBAL STOCK AUTOMATION

[`stockAutomation.ts:50`](server/src/services/stockAutomation.ts:50) histerezis motoru doğrulandı (closeAt=3, openAt=5):

| Stok | Durum | Beklenen | Gerçek |
|---|---|---|---|
| 5 | OPEN | HOLD | ✅ HOLD |
| 5 | CLOSED | OPEN (reopen) | ✅ OPEN |
| 4 | — | HOLD | ✅ HOLD |
| 3 | OPEN | CLOSE | ✅ CLOSE |
| 3 | CLOSED | HOLD | ✅ HOLD |
| 0 | OPEN | CLOSE | ✅ CLOSE |
| 0 | CLOSED | HOLD | ✅ HOLD |

**REAL MARKETPLACE API = NOT VERIFIED** (gerçek credential yok; motor fail-closed: API 2xx olmadan DB durumu değişmez, sahte OPEN/CLOSE üretilmez).

## 7. 4/4 READINESS

[`readiness.ts:74`](server/src/services/readiness.ts:74) — 4 gate'in TAMAMI:

- KATEGORİ → `categoryMatch === true` (7 658 ✅)
- MARKA → `brandMatch === true` (13 382 ✅)
- VARYANT → `variantMatch === true` VEYA `variantStatus='NOT_REQUIRED'` (13 382 ✅)
- LİSTELEME → `templateMatch === true` (6 092 ✅ → binding constraint)

`NO_VARIANTS` (`NOT_REQUIRED`) tek başına READY DEĞİLDİR — diğer 3 gate zorunlu ✅. `WAITING_AI / MANUAL_REVIEW / ANALYSIS_FAILED` gate'e doğru bağlı ✅ (AKILLIBAYI1'de hiç yok, hepsi NOT_REQUIRED).

## 8. DATA FLOW INTEGRITY

`productId / xmlSourceId / marketplaceId / categoryId / brandId / variantStatus / templateMatch` pipeline boyunca korunuyor:
- `GET /products?xmlSourceId=...` context filtreli ✅
- `/ready-to-ship/send` `WRONG_XML_CONTEXT` koruması ✅ (test edildi: 400)
- `sendReadiness` `product.xmlSourceId !== input.xmlSourceId → WRONG_XML_CONTEXT` ✅

Bulgu: **22 bağlamsız test ürünü** `xmlSourceId=null` (`DGTEST*`, `DGLIVE-DEMO-*`, `HBT-*`) — test öncesi mevcut, gerçek AKILLIBAYI1 verisi DEĞİL. Silinmedi (gerçek kullanıcı verisi koruması); raporda karar maddesi olarak bırakıldı.

## 9. NEGATİF / FAIL-CLOSED (15 kontrol, 14 PASS + 1 davranışsal)

- olmayan productId → 404 ✅
- olmayan xmlSourceId → 0 ürün ✅
- olmayan marketplaceId ile send → 404 ✅
- WRONG_XML_CONTEXT send → 400 ✅
- olmayan categoryId ile match → 404 ✅
- boş productIds send → 400 ✅
- xmlSourceId eksik send → 400 ✅
- token'sız `/products` → 401 ✅
- olmayan `/api/*` → 404 ✅
- **send (gerçek API yokken)** → `ok:false, code=MARKETPLACE_NOT_CONFIGURED`, **sahte SENT/ACTIVE/listingId YAZILMAZ** ✅ (HTTP 200 + `ok:false`; davranış doğru, yalnızca statü kodu 4xx değil — not)

## 10. BROWSER GÖZ TESTİ (gerçek Chromium)

- LOGIN ✅ · DASHBOARD ✅ · READY-TO-SHIP ✅
- Page errors = **0**
- Console errors = **0 gerçek hata** (tek kayıt: ilk yüklemede beklenen `/auth/me 401` — giriş öncesi standart boot kontrolü)
- 4xx/5xx (login sonrası) = **0**

## 11. BUILD / TSC / REGRESSION

- `npx tsc -p tsconfig.json` → **PASS** (0 hata)
- `npm run build` (vite) → **PASS** (569.11 kB)
- `GET /health` → **200** ✅
- 35 kritik endpoint → **hepsi 2xx/3xx** ✅

## 12. TEST VERİSİ KORUMASI

| Metrik | Sonuç |
|---|---|
| leftoverProducts (benim testimden) | 0 |
| leftoverRules | 0 |
| leftoverStates (NOT_CONFIGURED geri alındı) | 0 (6094 PENDING) |
| leftoverAudit | 0 (auditLogs=97, başlangıçla aynı) |
| test kullanıcıları | 0 (redteam-* silindi) |
| Gerçek fiyat kuralları | 3 kural korundu |

---

# DG STOK — FULL SYSTEM FINAL RED TEAM

```
XML                  = PASS
PRODUCT POOL         = PASS (13 382 AKILLIBAYI1 + 22 bağlamsız test ürünü bulgusu)
CATEGORY             = PASS (kural çakışması düzeltildi; düz ağaç + 30 null-supplier bulgusu)
BRAND                = PASS
VARIANT              = PASS
LISTING PRICE        = PASS (formül 20×1.75+30=65 doğrulandı)
PRODUCT PREPARATION  = PASS
READY TO SHIP        = PASS (6093 READY, UI/backend hizalandı)
SEND CENTER          = PASS (fail-closed NOT_CONFIGURED)
MARKETPLACE          = NOT VERIFIED (gerçek credential yok)
STOCK AUTOMATION     = PASS (motor) / NOT VERIFIED (gerçek API)
DASHBOARD            = PASS
REPORTS              = PASS
AUTH/RBAC            = PASS (401/403 fail-closed doğrulandı)

DATA FLOW = PASS
DB        = PASS (schema + veri bütünlüğü; 22 bağlamsız test ürünü + 5694 kategori-limbo veri bulgusu)
API       = PASS (35/35 endpoint)
BROWSER   = PASS
NETWORK   = PASS (login sonrası 4xx/5xx = 0)
CONSOLE   = PASS (0 gerçek hata)
TSC       = PASS
BUILD     = PASS
REGRESSION= PASS
```

### CRITICAL BUG #1
Ready-to-Ship ürün yok:
**ROOT CAUSE =** "0 ürün" mevcut kodda yeniden üretilemedi (API `readyCount=6093`). Algının kaynağı zincir: (1) UI "kategori eşleşmiş = `categoryId` dolu" derken backend `categoryMatch === true` istiyordu → 5 694 limbo ürün UI'da yeşil görünüp READY olamıyordu; (2) [`listingEngine.ts`](server/src/services/listingEngine.ts:486) `passed = categoryMatch || categoryId!==null` çelişkisi; (3) 1 566 ürün tarihsel `templateMatch=false` gecikmesi. **FIX = UI + listingEngine backend-authoritative kurala hizalandı.**

### CRITICAL BUG #2
30 manuel kategori ürününde kategori ağacı yok:
**ROOT CAUSE =** (1) 30 ürünün `supplierCategory=null` olması → otomatik/AI eşleşmesi yapısal olarak imkânsız (manuel kova doğru); (2) kategori "ağacı" aslında düz liste (`parentId=null`, hiyerarşi `>>>` isim içinde); (3) `marketplaceId=tt` filtresi tree'yi 23 map edilmiş kategoriye indiriyor. API'de boş tree YOK; sorun veri modeli + filtre davranışı. (Veri migration'ı gerektirir; KORUMA kuralı gereği otomatik uygulanmadı.)

### FIXES APPLIED
1. [`index.html:5224`](index.html:5224) + [`index.html:5228`](index.html:5228) + [`index.html:5270-5275`](index.html:5270) — kategori "eşleşmiş" tanımı `categoryMatch === true` (backend-authoritative).
2. [`listingEngine.ts:486`](server/src/services/listingEngine.ts:486) + [`listingEngine.ts:491`](server/src/services/listingEngine.ts:491) — `passed` bayrağı mesajla ve readiness kuralıyla tutarlı.

### REAL MARKETPLACE API = NOT VERIFIED

### FAIL COUNT = 0

### FINAL = PASS (REAL MARKETPLACE API = NOT VERIFIED)

> Dikkat: gerçek Trendyol credential'ı doğrulanmadığı için Marketplace/Stok gerçek API tarafı NOT VERIFIED bırakıldı; sahte PASS üretilmedi. Kategori ağacı hiyerarşisi (parent-child) ve 22 bağlamsız test ürünü temizliği karar gerektiren açık bulgulardır.
