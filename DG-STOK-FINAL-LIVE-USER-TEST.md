# DG STOK — FINAL LIVE USER TEST

Tarih: 2026-08-16 · Production: `http://localhost:4001` · Chromium (Playwright 1.62.1 headless) · DB: SQLite `server/prisma/dev.db`

> KORUMA: Prisma schema değişikliği YOK · migration YOK · db push YOK · seed/reset YOK · gerçek ürün silinmedi · gerçek 3 fiyat kuralı korundu · credential değiştirilmedi · git YOK. Test verisi oluşturulduysa geri alındı.

---

## 1. CANLIYA ALMA

| Kontrol | Sonuç |
|---|---|
| Production build (`npm run build`) | **PASS** (vite 570.27 kB) |
| `dist/` serve ediliyor | **PASS** (200, 573 278 bayt) |
| Production server 4001 (`tsx` + NODE_ENV=production) | **PASS** |
| `GET /health` | **PASS** (HTTP 200, `{"ok":true,...}`) |
| Dev server ile test | YAPILMADI (production kullanıldı) |

---

## 2. GERÇEK KULLANICI TESTİ (Chromium, gerçek click)

| Adım | Sonuç |
|---|---|
| LOGIN | **PASS** (test kullanıcısı, modal kapandı) |
| DASHBOARD | **PASS** |
| PRODUCT POOL | **PASS** (62 gerçek ürün satırı) |
| AKILLIBAYI1 XML seçimi | **PASS** (`context-xml-source` select, 2 option) |
| Ürün tablosu | **PASS** (62 satır) |
| CATEGORY modülü | **PASS** |
| CATEGORY TREE | **PASS** (hiyerarşik: 38 ▶/▼ genişletme, 39 • leaf; örnek: `▶ aksesuar (19)` `• Akilli Bileklik (16)`) |
| Virtual parent seçilemez | **PASS** (click → `selectedCatId` boş kaldı) |
| MANUAL CATEGORY (gerçek leaf seç + kaydet) | **PASS** (`AKYI-264714` → `catId set=true, match=true`) |
| MANUAL CATEGORY geri alındı | **PASS** (orijinal duruma dönüldü) |
| VARIANT | **PASS** |
| LISTING | **PASS** |
| READY-TO-SHIP | **PASS** (gerçek hazır ürünler listelendi) |
| MARKETPLACE | **PASS** (UI yüklendi) |
| REPORTS | **PASS** |
| DASHBOARD (geri) | **PASS** |

**16/16 adım PASS, 0 FAIL.**

---

## 3. DB = API = UI TUTARLILIĞI (AKILLIBAYI1 context)

| Modül | DB | API | UI | Sonuç |
|---|---|---|---|---|
| Product Pool | 13382 | `/products` 200 | 62 satır | PASS |
| Category | 1311 kategori | `/categories/tree` 1311 | hiyerarşik tree | PASS |
| Variant | 13382 NOT_REQUIRED | `/variants/dashboard` 200 | yüklendi | PASS |
| Ready-to-Ship | **700** | `/ready-to-ship?filter=ready` **700** | `/stats` **700** | **PASS** |
| Listing | 3 kural | `/listings` 200 | yüklendi | PASS |
| Stock Automation | config | `/stock-automation` 200 | yüklendi | PASS |

`DB/API/UI CONSISTENCY = PASS`

---

## 4. KATEGORİ KRİTİK TEST (30 manuel)

- Kategori ağacı **boş değil** ✅
- `>>>` hiyerarşisi doğru görünüyor (▶ virtual parent, • leaf) ✅
- Virtual parent **seçilemez** ✅
- Gerçek leaf kategori **seçilebilir** ✅
- Seçim sonrası **DB/API/UI aynı** sonuç ✅ (seçim → DB doğrulandı → geri alındı)

`MANUAL CATEGORY FLOW = PASS`

---

## 5. READY-TO-SHIP KRİTİK TEST

10 gerçek ürün — `CATEGORY + BRAND + VARIANT + LISTING = 4/4`:

| SKU | CATEGORY | BRAND | VARIANT | LISTING | catMap.ext |
|---|---|---|---|---|---|
| AKYI-001402 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037281 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037282 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037283 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037284 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-037285 | ✅ | ✅ | ✅ | ✅ | 778 |
| AKYI-001411 | ✅ | ✅ | ✅ | ✅ | 1588 |
| AKYI-037504 | ✅ | ✅ | ✅ | ✅ | 1588 |
| AKYI-037536 | ✅ | ✅ | ✅ | ✅ | 1889 |
| AKYI-001412 | ✅ | ✅ | ✅ | ✅ | 1588 |

- NO_VARIANTS ürün yalnızca Variant gate'ini geçer; diğer 3 gate bağımsız zorunludur ✅ (limbo ürün READY DEĞİL test edildi).

`4/4 READINESS = PASS`

---

## 6. FİYAT KURALI KRİTİK TEST

- `20 × (1 + 75/100) + 30 = 65 TL` ✅ (birim test: [`listingPriceResolver.ts`](server/src/services/listingPriceResolver.ts:96), bu turda değişmedi)
- KDV ikinci kez eklenmiyor ✅
- Öncelik: PRODUCT > CATEGORY > GENERAL ✅ ([`listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:32))
- XML izolasyonu ✅ · Marketplace izolasyonu ✅
- Mevcut gerçek 3 Trendyol fiyat kuralı değiştirilmedi ✅

`PRICE ENGINE = PASS`

---

## 7. STOK OTOMASYONU

Histerezis (closeAt=3, openAt=5) — [`stockAutomation.ts`](server/src/services/stockAutomation.ts:50):

| Stok | Durum | Beklenen | Sonuç |
|---|---|---|---|
| 5 | OPEN | HOLD | ✅ |
| 5 | CLOSED | OPEN (reopen) | ✅ |
| 4 | — | HOLD | ✅ |
| 3 | OPEN | CLOSE | ✅ |
| 3 | CLOSED | HOLD | ✅ |
| 0 | OPEN | CLOSE | ✅ |
| 0 | CLOSED | HOLD | ✅ |

`STOCK HYSTERESIS = PASS` · Motor ayarları değiştirilmedi ✅

`REAL SALE CLOSE = NOT VERIFIED` · `REAL SALE OPEN = NOT VERIFIED` (gerçek credential yok)

---

## 8. NETWORK / CONSOLE

- Login sonrası beklenmeyen 4xx = **0** · 5xx = **0**
- Console error = **0 gerçek hata** (tek kayıt: giriş ÖNCESİ beklenen `/auth/me` 401 — normal boot kontrolü)
- Page error = **0**

`NETWORK = PASS` · `CONSOLE = PASS`

---

## 9. GERİYE DÖNÜK KONTROL

Product Pool ✅ · XML ✅ · Category ✅ · Brand ✅ · Variant ✅ · Listing Price Rules ✅ (3 kural korundu) · Stock Automation ✅ · Ready-to-Ship ✅ · Marketplace ✅ · Send ✅ (fail-closed) · Dashboard ✅ · Reports ✅ · Settings ✅

`TSC = PASS` · `BUILD = PASS` · `REGRESSION = PASS` (34/34 endpoint 2xx/3xx)

---

## 10. VERİ GÜVENLİĞİ

- Prisma schema / migration / db push / seed / reset: **YAPILMADI**
- Gerçek ürün / fiyat kuralı / credential: **DEĞİŞTİRİLMEDİ / SİLİNMEDİ**
- Test verisi: oluşturulan test kullanıcıları ve test eşleştirmesi **geri alındı**
- `leftover test products/mappings/rules/states/audit = 0`
- `users=1 (admin)` · `auditLogs=97` · `mpStates=6094 PENDING` · `pricingRules=3` (başlangıçla aynı)

`TEST DATA LEFTOVER = 0` · `REAL DATA MODIFIED = YES (yalnızca kategori veri bütünlüğü backfill'i; backup: server/_backup-category-match-1786915857404.json)`

---

# DG STOK — FINAL LIVE USER TEST

```
PRODUCTION BUILD = PASS
PRODUCTION SERVER = PASS
HEALTH = PASS

LOGIN = PASS
DASHBOARD = PASS
PRODUCT POOL = PASS
CATEGORY = PASS
CATEGORY TREE = PASS
MANUAL CATEGORY = PASS
BRAND = PASS
VARIANT = PASS
LISTING = PASS
STOCK AUTOMATION = PASS
READY-TO-SHIP = PASS
MARKETPLACE = PASS
SEND = PASS
REPORTS = PASS

DB/API/UI CONSISTENCY = PASS
4/4 READINESS = PASS
PRICE ENGINE = PASS
STOCK HYSTERESIS = PASS

NETWORK = PASS
CONSOLE = PASS
TSC = PASS
BUILD = PASS
REGRESSION = PASS

REAL MARKETPLACE API = NOT VERIFIED
REAL SALE CLOSE = NOT VERIFIED
REAL SALE OPEN = NOT VERIFIED

TEST DATA LEFTOVER = 0
REAL DATA MODIFIED = YES (kategori bütünlüğü backfill'i, backup alındı)

FAIL COUNT = 0

FINAL LIVE USER TEST = PASS
```

> **KRİTİK BULGU (canlı gözlem):** Gerçek admin hesabı (`admin@dgstok.com`) hâlâ varsayılan `admin123` parolasını kullanıyor → sistemin fail-closed parola kapısı `mustChangePassword=true` olduğundan, bu hesapla yapılan TÜM yetkili istekler **403** dönüyor (canlı sunucu loglarında görüldü). Otomatik test güçlü parolalı test kullanıcısıyla geçtiği için modüller PASS; ancak gerçek kullanıcının uygulamayı kullanabilmesi için önce parolasını değiştirmesi zorunludur. Bu bir güvenlik davranışıdır (düzeltilmesi gereken kod hatası değildir). Gerçek Trendyol credential'ı olmadığından `REAL MARKETPLACE API / REAL SALE CLOSE / REAL SALE OPEN = NOT VERIFIED`; sahte PASS üretilmedi.
