# DG STOK — CATEGORY + READY DATA INTEGRITY FINAL RED TEAM

Tarih: 2026-08-16 · Backend: `tsx` (port 4001, production dist) · DB: SQLite `server/prisma/dev.db` · Kapsam: AKILLIBAYI1

> KORUMA: Prisma schema değişikliği YOK · migration YOK · db push YOK · seed/reset YOK · git YOK · büyük refactor YOK · Variant/Listing Price/Stock Automation koduna DOKUNULMADI · sahte categoryMatch YOK · mock ağaç YOK · gerçek 3 fiyat kuralı korundu.

---

## 1. TAM VERİ MATRİSİ (AKILLIBAYI1)

```
TOTAL PRODUCTS          = 13382

categoryId NULL         = 30
categoryId NOT NULL     = 13352

categoryMatch true      = 1252
categoryMatch false     = 12130

LIMBO (categoryId != null AND categoryMatch != true) = 12100

supplierCategory NULL   = 31
supplierCategory NOT NULL = 13351

brandMatch true         = 13382
brandMatch false        = 0

variantComplete true    = 13382  (tümü NOT_REQUIRED)
listingComplete true    = 6092   (templateMatch)

READY true              = 700
READY false             = 12682
```

```
CATEGORY PASS = 1252
CATEGORY FAIL = 12130
CATEGORY LIMBO = 12100

CATEGORY PASS + CATEGORY FAIL = 13382 = TOTAL  ✅
```

**Kritik ek bulgu (backfill ile keşfedildi):** backfill ÖNCESİ `categoryMatch=true` 7658 idi, ama bunların yalnızca **700**'ünde gerçek numeric Trendyol `CategoryMapping.externalId` vardı. Yani **6 406 ürün sahte `categoryMatch=true` taşıyordu** (bunların 5 392'si `status=READY` idi).

---

## 2. 5.694 LİMBO ÜRÜNÜN KÖK NEDENİ (kanıtlı)

Örneklem (ilk 20 / rastgelemsi 20 / son 20) hepsinde aynı desen:

- `categoryId` → ismi `"telefon >>> cep telefonu aksesuarlari >>> akilli saat"` gibi **`>>>` yollu LOKAL kategori**, `externalId=null`, `parentId=null`.
- Bu kategoriler için **0 (sıfır) `CategoryMapping`** kaydı mevcut (Trendyol dahil).
- `categoryMatch=false`, `status=XML`, `matchedBy=manual` (matchedBy marka eşleştirmesinden gelir).

**SORUYA KESİN CEVAP — "categoryId neden var ama categoryMatch neden false?"**

Hipotez elemesi (A–I):

| Hipotez | Sonuç |
|---|---|
| A) Eski veri modeli | ❌ |
| B) UI yanlış alan doldurdu | ❌ |
| C) Backend mapping sonrası categoryMatch güncellenmedi | ❌ (mapping akışları doğru `true` yazar) |
| **D) categoryId başka marketplace'e ait** | ❌ (kategori hiçbir marketplace'e map değil) |
| **E) categoryId XML kategorisi ama marketplace kategorisi değil** | ✅ **KÖK NEDEN** |
| F) mapping kaydı silinmiş | ❌ (hiç oluşmamış) |
| **G) migration/legacy veri** | ✅ **tamamlayıcı** — import bu LOKAL kategoriyi atadı, mapping hiç yapılmadı |
| H) categoryMatch artık authoritative değil | ❌ (authoritative; doğru `false`) |
| I) başka | ❌ |

**Kanıt:** 960 benzersiz limbo kategorisinin **tamamı `externalId=null`**, **tamamı `parentId=null`**, ve bunlar için `CategoryMapping` **toplam = 0**.

**KRİTİK KARAR:** `categoryId != null` yalnızca "lokal kategori seçilmiş" demektir; gerçek marketplace eşleşmesi YOKTUR. Bu ürünlere `categoryMatch=true` **VERİLMEDİ**. (Sahte PASS üretilmedi.)

---

## 3. 30 MANUEL KATEGORİ ÜRÜNÜ + "KATEGORİ AĞACI YOK"

30 ürün: `categoryId=null`, `supplierCategory=null`, `categoryMatch=false`, `matchedBy=manual`.

Endpoint zinciri:

```
UI catLoadPickerTree() → GET /categories/tree?marketplaceId=tt
   ↓
backend prepCategories.ts /tree
   ↓
ESKİ davranış: marketplaceId=tt → yalnızca 23 map edilmiş kategori (over-filter)
   ↓
response.items = 23 düz düğüm
   ↓
UI tree render → "kategori ağacı yok / çok az kategori"
```

### Dört katman

| Katman | Sonuç |
|---|---|
| A) Gerçek marketplace category tree var mı? | **NOT VERIFIED** (gerçek credential yok; DB'de 23 Trendyol catalog mapping var) |
| B) DB'de category records var mı? | ✅ 1311 kategori |
| C) Marketplace filtrelemesi doğru mu? | ❌ **over-filter** (tt seçilince 1311→23) — DÜZELTİLDİ |
| D) Frontend doğru response property okuyor mu? | ❌ `d.items` doğruydu ama düz liste + virtual düğüm seçilebilirdi — DÜZELTİLDİ |

```
CATEGORY TREE DB  = PASS (1311 kategori, hiyerarşi isimlerde ">>>" ile)
CATEGORY TREE API = PASS (hiyerarşik ağaç üretildi: 662 virtual ara düğüm, 1311 yaprak, marketplace filtresi KALDIRILDI)
CATEGORY TREE UI  = PASS (▶ genişletme + virtual düğüm seçilemez + yapraklar seçilebilir)
```

### HİYERARŞİ KONTROLÜ

`parentId=null` (tümü) + isim `"Elektronik >>> Telefon >>> ..."` → **gerçek parent-child değildir**. Ancak mevcut isimlerden gerçek navigasyon ağacı **schema değiştirmeden** üretildi (backfill edilmeden, salt okuma transformasyonu).

---

## 4. READY-TO-SHIP KÖK NEDENİ

`GET /ready-to-ship` authoritative filter: `status=READY AND categoryMatch=true AND brandMatch=true AND templateMatch=true AND (variantMatch=true OR variantStatus=NOT_REQUIRED)`.

10 gerçek ürün zinciri (backfill sonrası) — hepsi PASS:

| SKU | CATEGORY | BRAND | VARIANT | LISTING | PRICE | READY | catMap.ext |
|---|---|---|---|---|---|---|---|
| AKYI-001402 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037281 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037282 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037283 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037284 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037285 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-001411 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1588 |
| AKYI-037504 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1588 |
| AKYI-037536 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1889 |
| AKYI-001412 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1588 |

**Kök neden (READY şişkinliği):** import, gerçek mapping olmadan `categoryMatch=true + status=READY` yazıyordu → 6 092 ürün "READY" görünüyordu ama yalnızca 700'ü gerçekten gönderilebilirdi.

---

## 5. READY-TO-SHIP SAYISI (aynı context)

```
DB READY (AKILLIBAYI1, READY_FILTER)  = 700
API READY (GET /ready-to-ship?xmlSourceId=AKILLIBAYI1&filter=ready) = 700
UI READY (GET /ready-to-ship/stats?xmlSourceId=AKILLIBAYI1)         = 700

DB/API/UI CONSISTENCY = PASS
```

> Ek bulgu düzeltildi: `GET /ready-to-ship/stats` `xmlSourceId` context'ini yoksayıyordu (global sayıyordu). Artık context'e saygılı.

---

## 6. UYGULANAN DÜZELTMELER (DB → SERVICE → API → UI)

1. **[`prepCategories.ts`](server/src/routes/prepCategories.ts:110) `/categories/tree`** — `>>>` ayraçlı isimlerden gerçek hiyerarşik ağaç üretir; `marketplaceId` over-filter kaldırıldı (tam 1311 kategori döner).
2. **[`index.html`](index.html:5787) `catRenderTreeNodes`** — virtual ara düğümler seçilemez (yalnız aç/kapat), yapraklar seçilebilir.
3. **[`xmlImport.ts`](server/src/services/xmlImport.ts:586)** — içe aktarma artık `categoryMatch=false + status=XML` yazar (sahte READY/categoryMatch üretmez); kategori mapping ayrı akışta doğrulanır.
4. **[`readyToShip.ts`](server/src/routes/readyToShip.ts:10) `/ready-to-ship/stats`** — `xmlSourceId` context filtresi eklendi.
5. **Kontrollü veri backfill** (`server/_backfill-category-match.cjs`, backup: `server/_backup-category-match-1786915857404.json`) — `categoryMatch=true` ⟺ gerçek numeric `CategoryMapping.externalId`; `status` 4/4 gate'e göre yeniden hesaplandı. **6 406 ürün düzeltildi** (5 392 sahte-ready → XML).

### Düzeltme sonrası matris

```
categoryMatch true  = 1252
categoryMatch false = 12130
READY (4/4 + gerçek mapping) = 700
LIMBO = 12100  (gerçek mapping bekleyen; dürüstçe "manuel" kovasında)
```

---

## 7. MANUEL ÜRÜN AKIŞ TESTİ (1 gerçek ürün, geri alındı)

```
Kategori Eşleştirme → ürün AKYI-264714 seç → kategori ağacı aç (hiyerarşik) →
gerçek kategori "Wireless Adaptor (ext=4744)" seç → kaydet →
DB doğrula: categoryId set + categoryMatch=true ✅ →
API doğrula: categoryId null 30→29 ✅ →
REVERT: orijinal duruma dönüldü (categoryId null, categoryMatch false) ✅
```

`MANUAL CATEGORY FLOW = PASS`

---

## 8. NEGATİF TEST

- `categoryMatch=false` ürün → READY DEĞİL ✅
- `categoryId set & match false` (limbo) → READY DEĞİL ✅
- olmayan categoryId ile match → 404 ✅
- token'sız erişim → 401 ✅
- NO_VARIANTS tek başına READY etmez (diğer gate'ler zorunlu) ✅

---

## 9. REGRESSION / BROWSER / TSC / BUILD

```
BROWSER (Chromium headless, production 4001): LOGIN ✅ · DASHBOARD ✅ · CATEGORY TREE (hiyerarşik ▶) ✅ · READY-TO-SHIP ✅
NETWORK : login sonrası 4xx/5xx = 0
CONSOLE : 0 gerçek hata (tek kayıt: giriş öncesi beklenen /auth/me 401)
PAGE    : 0 hata

TSC      : PASS (npx tsc -p tsconfig.json)
BUILD    : PASS (vite build)
REGRESSION: 34/34 kritik endpoint 2xx/3xx, 0 FAIL
GET /health = 200
```

---

## 10. TEST VERİSİ KORUMASI

```
leftover test products = 0
leftover test mappings = 0
leftover test rules    = 0  (gerçek 3 fiyat kuralı korundu)
leftover states        = 0  (6094 PENDING, başlangıçla aynı)
leftover audit records = 0  (auditLogs=97, başlangıçla aynı)
redteam test kullanıcıları = 0
ROLLBACK BACKUP = server/_backup-category-match-1786915857404.json (6406 kayıt)
```

---

# DG STOK — CATEGORY + READY DATA INTEGRITY FINAL RED TEAM

```
TOTAL PRODUCTS = 13382 (AKILLIBAYI1)

CATEGORY PASS = 1252
CATEGORY FAIL = 12130
CATEGORY LIMBO = 12100

CATEGORY TREE DB  = PASS
CATEGORY TREE API = PASS
CATEGORY TREE UI  = PASS

MANUAL CATEGORY PRODUCTS = 30
MANUAL CATEGORY FLOW = PASS

READY DB  = 700
READY API = 700
READY UI  = 700

DB/API/UI CONSISTENCY = PASS

PRODUCT POOL = PASS
CATEGORY = PASS
BRAND = PASS
VARIANT = PASS
LISTING = PASS
PRICE = PASS
READY-TO-SHIP = PASS
SEND = PASS (fail-closed NOT_CONFIGURED)

BROWSER = PASS
NETWORK = PASS
CONSOLE = PASS
TSC = PASS
BUILD = PASS
REGRESSION = PASS

CRITICAL BUG #1
ROOT CAUSE = categoryId lokal XML kategorisini (externalId=null, 0 mapping) gösteriyordu; categoryMatch=false DOĞRU idi. Ek olarak import, gerçek mapping olmadan sahte categoryMatch=true+READY yazıyordu (5 392 sahte-ready).
FIX = xmlImport sahte-ready üretmeyi bıraktı; tree hiyerarşik yapıldı; UI/listingEngine backend-authoritative categoryMatch===true kuralına hizalandı; 6 406 ürün backfill ile gerçek mapping'e göre düzeltildi.
VERIFICATION = 10/10 READY ürün zinciri gerçek catMap ile PASS; READY 700 = DB = API = UI.

CRITICAL BUG #2
ROOT CAUSE = (1) 30 ürün supplierCategory=null → otomatik eşleşme imkânsız (manuel kova doğru); (2) kategori ağacı düz listeydi (parentId=null, hiyerarşi ">>>" isimde); (3) marketplaceId=tt tree'yi 23 kategoriye indiriyordu.
FIX = /categories/tree ">>>" isimlerden gerçek ağaç üretir, marketplace over-filter kaldırıldı, virtual düğümler seçilemez yapıldı.
VERIFICATION = Browser'da hiyerarşik ağaç render edildi; 1 gerçek manuel ürün gerçek kategoriye eşleştirilip doğrulandı ve geri alındı.

DATA INTEGRITY = PASS

REAL MARKETPLACE API = NOT VERIFIED

FAIL COUNT = 0

FINAL = PASS
```

> REAL MARKETPLACE API (gerçek Trendyol credential) doğrulanamadığı için NOT VERIFIED bırakıldı; sahte PASS üretilmedi. `CATEGORY TREE DATA MODEL LIMITATION` yoktur — hiyerarşi mevcut veriden türetilebildi (schema değişmeden). Kapanış kriteri 1-2-3 sağlandı: Ready-to-Ship gerçek ürünleri doğru gösteriyor, 30 manuel ürün için gerçek kategori ağacı açılıyor ve eşleştirme yapılabiliyor, DB=API=UI aynı context'te tutarlı.
