# DG STOK — PRODUCT POOL STOCK AUTOMATION FINAL RED TEAM

## SONUÇ (kanıtlanmış, sahte başarı YOK)

```text
PRODUCT POOL UI              = PASS
NO MODAL                     = PASS

GLOBAL STOCK AUTOMATION      = PASS
CLOSE THRESHOLD              = PASS
OPEN THRESHOLD               = PASS
HYSTERESIS                   = PASS

PREP MIN STOCK               = PASS
PREP MAX STOCK               = PASS
PREP RANGE                   = PASS

PREP / SALES SEPARATION      = PASS

CONFIG PERSISTENCE           = PASS
API                          = PASS
DB                           = PASS
BROWSER                      = PASS
NETWORK                      = PASS
CONSOLE                      = PASS
TSC                          = PASS
BUILD                        = PASS
REGRESSION                   = PASS

LISTING PRICE RULE           = PASS
VARIANT                      = PASS
CATEGORY                     = PASS
BRAND                        = PASS
READY-TO-SHIP                = PASS

REAL MARKETPLACE API         = NOT VERIFIED
REAL SALE CLOSE              = NOT VERIFIED
REAL SALE OPEN               = NOT VERIFIED

FAIL COUNT                   = 0

FINAL                        = PASS
```

> `REAL MARKETPLACE API / SALE CLOSE / SALE OPEN = NOT VERIFIED` — bu çalışmada gerçek marketplace credential ile gerçek 2xx satış aç/kapat çağrısı yapılmadı. Yalnızca adapter istek üretimi, `UNSUPPORTED` ve fail-closed davranışı doğrulandı. Mock başarı gerçek başarı gibi raporlanmadı.

---

## YAPILAN DEĞİŞİKLİK (tek kaynak, motor değişmedi)

Yalnızca [`index.html`](index.html) değişti. Backend motor dosyaları, schema, migration, db push, seed, reset **YAPILMADI**.

- Ürün Havuzu'ndaki mevcut inline **STOK OTOMASYONU** paneli zaten mevcuttu; doğrulandı: [`index.html`](index.html:568).
- Aynı bölümdeki **ÜRÜN HAZIRLAMA STOK ARALIĞI** (ayrı kural) mevcuttu; doğrulandı: [`index.html`](index.html:594).
- Eksik olan cross-module görünürlük için Ayarlar sayfasına **Stok** sekmesi eklendi (aynı `GET/PUT /stock-automation` endpoint'ini kullanır — ikinci config kaynağı/state/endpoint YOK):
  - Sekme butonu: [`index.html`](index.html:1515)
  - Inline panel: [`index.html`](index.html:1547)
  - [`settingsTab()`](index.html:4682) listesine `stock` eklendi
  - [`showPage()`](index.html:2603) `settings` dalına `stockAutoSettingsLoad()` eklendi
  - [`stockAutoSettingsLoad()`](index.html:4724) ve [`stockAutoSettingsSave()`](index.html:4761) aynı endpoint'i kullanır

---

## KANITLAR

| Test | Sonuç |
|---|---|
| [`rt-stock-automation-test.ts`](server/rt-stock-automation-test.ts:50) (histerezis 19/19) | **19 PASS, 0 FAIL** |
| [`rt-stock-adapter-test.ts`](server/rt-stock-adapter-test.ts:42) (adapter + 2xx gate) | **7 PASS, 0 FAIL** |
| [`rt-stock-failure-test.ts`](server/rt-stock-failure-test.ts:93) (fail-closed, gerçek DB) | **14 PASS, 0 FAIL** |
| [`_stock-separation-test.cjs`](server/_stock-separation-test.cjs:44) (satış ↔ prep ayrımı) | **5/5 PASS** |
| [`_stock-redteam-api.cjs`](server/_stock-redteam-api.cjs) (validation + persistence) | **11/11 PASS** |
| [`_stock-prep-range-test.ts`](server/_stock-prep-range-test.ts) (gerçek DB prep 0/4/5/50/100/101) | **11 PASS, 0 FAIL** |
| [`_stock-pool-redteam.cjs`](_stock-pool-redteam.cjs) (Playwright gerçek click) | **10/10 PASS** |
| [`_stock-regression-api.cjs`](server/_stock-regression-api.cjs) (22 modül endpoint) | **22/22 PASS** |
| [`_stock-db-check.cjs`](server/_stock-db-check.cjs) (kalıntı + pricingRules=3) | **5/5 PASS** |

### Histerezis kanıtı (close=3, open=5)

```text
10 → HOLD (zaten AÇIK)     PASS
5  → HOLD (zaten AÇIK)     PASS
4  → HOLD (mevcut korunur) PASS
3  → CLOSE (AÇIK iken)     PASS
2/1/0 → HOLD (zaten KAPALI) PASS
4 (KAPALI) → HOLD (3↔4 çakır yok) PASS
5 (KAPALI) → OPEN          PASS
```

### Fail-closed kanıtı

```text
4xx/5xx/timeout/UNSUPPORTED/BLOCKED_IP → DB satış durumu DEĞİŞMEZ,
sahte başarı logu YAZILMAZ, 2xx olmadan DB güncellemesi YAPILMAZ.
```

### Prep min/max kanıtı (prepMin=5, prepMax=100)

```text
stok 0   → hazırlama DIŞI   PASS
stok 4   → hazırlama DIŞI   PASS
stok 5   → hazırlama DAHİL  PASS
stok 50  → hazırlama DAHİL  PASS
stok 100 → hazırlama DAHİL  PASS
stok 101 → hazırlama DIŞI   PASS
```

### Ayırım kanıtı

```text
prepMin/prepMax değiştir → closeAt/openAt DEĞİŞMEZ    PASS
closeAt/openAt değiştir  → prepMin/prepMax DEĞİŞMEZ   PASS
```

### Build / ortam kanıtı

```text
npx tsc -p tsconfig.json   = PASS (0 hata)
npm run build              = PASS (vite dist/index.html 568.92 kB)
GET http://localhost:4001/health = 200
NETWORK unexpected 4xx/5xx = 0
CONSOLE errors             = 0
```

### Göz testi ekran görüntüleri

- [`stock-automation-pool.png`](stock-automation-pool.png) — Ürün Havuzu içinde STOK OTOMASYONU paneli görünür.
- [`stock-automation-settings.png`](stock-automation-settings.png) — Ayarlar → Stok sekmesi (aynı config, tek kaynak).

---

## KORUNAN DOSYALAR (DEĞİŞTİRİLMEDİ)

- [`server/src/services/stockAutomation.ts`](server/src/services/stockAutomation.ts:50) — `decideSalesAction`, `runStockAutomation`, `isWithinPrepRange`
- [`server/src/services/marketplace/marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts) — `updateMarketplaceInventory`
- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts) — adapter sözleşmesi
- [`server/src/routes/stockAutomation.ts`](server/src/routes/stockAutomation.ts:23) — config + run + validation
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:114) — hazırlama gate'i
- `server/prisma/schema.prisma` — DEĞİŞMEDİ

## GERİ ALMA

`index.html` dışında hiçbir şey değişmedi. Geri alma: Ayarlar "Stok" sekmesi/paneli kaldırılıp `settingsTab()` ve `showPage()` eski haline döndürülür. Backend/DB etkilenmez.

## CANLI

Production build `http://localhost:4001` üzerinde çalışıyor; `GET /health = 200`.
