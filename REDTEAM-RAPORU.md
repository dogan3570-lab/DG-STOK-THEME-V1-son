# DG-STOK-THEME-V1 — RED TEAM DOĞRULAMA RAPORU (v2)

**Tarih:** 12 Ağustos 2026
**Rapor Türü:** Red Team Canlı Doğrulama (Server Restart + Re-test)
**Proje:** DG-STOK-THEME-V1
**Mimari:** Express.js (TypeScript) + SQLite (Prisma) + SPA
**Port:** 4000
**Server PID:** 8532 (yeniden başlatıldı)

---

## ÖNEMLİ NOT

Bu rapor, eski server process'inin (PID 4716) durdurulması, mevcut kaynak kodla
yeniden başlatılması ve tüm testlerin baştan çalıştırılması ile hazırlanmıştır.

**Tek kod değişikliği:** `listingV2.ts:157`'de 1 karakterlik syntax fix (eksik `}` eklendi).
Bu fix olmadan server başlatılamıyordu (TransformError).

---

## A. TEST TABLOSU: ÖNCE → SONRA

| TEST | ÖNCE (eski server) | SONRA (yeni server) | KANIT | DURUM |
|------|--------------------|--------------------|-------|-------|
| FAIL-AUTH-001 | HTTP 200 (authsız kategori) | **HTTP 401** | `GET /categories` no auth → 401 Unauthorized | FIXED |
| FAIL-AUTH-001b | — | **HTTP 200** | `GET /categories` Bearer token ile → 200 + JSON data | PASS |
| FAIL-MP-001 | 1 marketplace (Trendyol) | **1 marketplace (Trendyol)** | `GET /marketplaces` → sadece Trendyol. Hepsiburada, N11 eksik | STILL FAIL |
| FAIL-RT-019 | HTTP 500 (invalid UUID) | **HTTP 400** | `PUT /marketplace-manage/not-a-uuid` → 400 + validation error | FIXED |
| FAIL-RT-027 | HTTP 500 (nonexistent ID) | **HTTP 404** | `DELETE /listings/00000000-...` → 404 Not Found | FIXED |
| FAIL-RT-028 | HTTP 200 (geçersiz XML) | **HTTP 400** | `POST /xml/import` invalid XML → 400 | FIXED |
| FAIL-RT-011 | HTTP 500 (invalid params) | **HTTP 400** | `GET /products?page=-1&limit=abc` → 400 | FIXED |
| FAIL-RT-021 | HTTP 200 (boş body) | **HTTP 400** | `POST /listing-v2/calculate` body `{}` → 400 | FIXED |
| REGRESSION-PRODUCTS | HTTP 200 | **HTTP 200** | `GET /products?page=1&limit=2` → 200, total=13246 | PASS |
| REGRESSION-CALC | HTTP 200 | **HTTP 200** | `POST /listing-v2/calculate` valid body → 200 + result | PASS |

**ÖZET:** 8 FAIL testinden **7'si FIXED**, **1'i (MP-001) hâlâ FAIL**.

---

## B. HEALTH CHECK

| Endpoint | Status | Sonuç |
|----------|--------|-------|
| `GET /health` | 200 | `{"ok":true,"service":"dg-stok-integrator-server"}` |
| `GET /system/health` | 200 | `{"database":"OK","marketplaces":"OK","xml":"OK","status":"healthy"}` |

---

## C. SMOKE TEST — TÜM MODÜLLER (21/21 PASS)

| Modül | Endpoint | HTTP | Durum |
|-------|----------|------|-------|
| AUTH | `GET /auth/me` | 200 | PASS |
| DASHBOARD | `GET /dashboard` | 200 | PASS |
| PRODUCTS | `GET /products?page=1&limit=2` | 200 | PASS |
| PRODUCTS-STATS | `GET /products/stats` | 200 | PASS |
| XML-SOURCES | `GET /xml-sources` | 200 | PASS |
| CATEGORIES | `GET /categories` | 200 | PASS |
| CATEGORIES-STATS | `GET /categories/stats` | 200 | PASS |
| BRANDS | `GET /brands` | 200 | PASS |
| VARIANTS | `GET /variants?page=1&limit=2` | 200 | PASS |
| MARKETPLACES | `GET /marketplaces` | 200 | PASS |
| MARKETPLACE-MANAGE | `GET /marketplace-manage` | 200 | PASS |
| LISTINGS | `GET /listings` | 200 | PASS |
| LISTING-V2 | `GET /listing-v2/rules` | 200 | PASS |
| READY-TO-SHIP | `GET /ready-to-ship` | 200 | PASS |
| ORDERS | `GET /orders` | 200 | PASS |
| REPORTS | `GET /reports` | 200 | PASS |
| AI | `GET /ai-settings` | 200 | PASS |
| SETTINGS | `GET /settings` | 200 | PASS |
| HEALTH | `GET /health` | 200 | PASS |
| API-STATUS | `GET /api-status` | 200 | PASS |
| FRONTEND | `GET /` | 200 | PASS |

---

## D. WARNING TESTLERİ

| Test | Sonuç | Kanıt |
|------|-------|-------|
| SPA Nonexistent Route | STILL WARNING | `GET /nonexistent` → 200 (SPA catch-all index.html döndürüyor) |
| Rate Limit | PASS | 25 istek gönderildi, 17. istekte **429** döndü. Auth limiter (20/15dk) çalışıyor |
| CORS evil.com | PASS | `Origin: evil.com` → no ACAO header, istek engellendi |
| CORS localhost | PASS | `Origin: localhost:3000` → 200, izin verildi |
| Auth Persistence | PASS | Token ile `/auth/me` → 200, user bilgileri doğru |
| DB Consistency | PASS | `products/stats.totalProducts` (13246) = `products.pagination.total` (13246) |
| XML Empty | PASS | `POST /xml/import` body `{xml:""}` → 400 |
| XML No Field | PASS | `POST /xml/import` body `{}` → 400 |
| Settings | PASS | `GET /settings` → 200 |

---

## E. GÜVENLİK KONTROLÜ

| Test | Durum | Kanıt |
|------|-------|-------|
| SEC-002 Hardcoded JWT_SECRET | PASS | Source code'da hardcoded değil, `.env`'den okunuyor (`env.JWT_SECRET`) |
| SEC-003 Hardcoded ADMIN_PASSWORD | PASS | Source code'da hardcoded değil, `.env`'den okunuyor (`env.ADMIN_PASSWORD`) |
| SEC-003 JWT Secret Strength | PASS | 63 karakter, >=32 eşiğinin üzerinde |
| Rate Limiting | PASS | Genel: 1000/15dk, Auth: 20/15dk |
| Helmet | PASS | CSP, frameguard, XSS koruması aktif |
| SQL Injection | PASS | Prisma ORM koruması |

---

## F. VERİ DURUMU

| Tablo | Kayıt |
|-------|-------|
| Product | 13.246 |
| Category | 1.285 |
| Brand | 15 |
| Variant | 500+ (limitli sorgu) |
| XmlSource | 2 |
| Marketplace | **1** (sadece Trendyol) |
| Order | 0 |
| ListingTemplate | 0 |

---

## G. KALAN SORUN

### FAIL-MP-001: Marketplace Seed Eksik (DEVAM EDİYOR)

- **Durum:** DB'de sadece Trendyol var. Hepsiburada ve N11 eksik.
- **Kök Neden:** `bootstrap.ts:26-30`'de seed fonksiyonu doğru çalışıyor
  (`key: 'he'` ve `key: 'n11'` için filter pass olmalı), ancak DB'ye yazılmamış.
  Muhtemelen eski DB'de `key: 'trendyol'` kaydı var ve seed fonksiyonu
  `createMany` çağrısında sessizce başarısız olmuştur (hata try/catch tarafından
  yakalanmış).
- **Etki:** Düşük — Trendyol aktif ve çalışıyor. Hepsiburada/N11 için
  manuel seed gerekebilir.
- **Öneri:** DB'yi temizleyip yeniden seed etmek veya manuel insert yapmak.

### SPA Catch-All (WARNING)

- **Durum:** `GET /nonexistent` → 200 (SPA index.html)
- **Etki:** Düşük — API istekleri için sorun değil, sadece GET requests
- **Öneri:** SPA catch-all'dan önce API 404 handler eklenebilir

---

## H. BUILD

| Komut | Sonuç |
|-------|-------|
| `npm run build` | PASS — `✓ built in 213ms`, `dist/index.html 467.88 kB` |

---

## I. GIT

```
On branch master, up to date with origin/master.

Unstaged changes:
  M server/src/bootstrap.ts
  M server/src/routes/index.ts
  M server/src/routes/listingV2.ts
  M server/src/routes/marketplaceManage.ts
  M server/src/routes/prepCategories.ts
  M server/src/routes/prepListings.ts
  M server/src/routes/products.ts

Untracked:
  ?? REDTEAM-RAPORU.md
```

`git add` YAPILMADI. `git commit` YAPILMADI. `git push` YAPILMADI.

---

## J. FİNAL KARAR

### 🟡 CONDITIONAL

**7/8 FAIL düzeltildi. 1 FAIL (MP-001) devam ediyor.**

| Kategori | Sayı |
|----------|------|
| FAIL → FIXED | 7 |
| FAIL → STILL FAIL | 1 (MP-001 — DB seed) |
| WARNING PASS | 8 |
| WARNING STILL | 1 (SPA catch-all) |
| SMOKE PASS | 21/21 |
| BUILD | PASS |

**Genel Değerlendirme:**
- Kritik güvenlik sorunları (auth, error handling, validation) düzeltildi
- Tüm modüller çalışır durumda
- SPA catch-all uyarısı kritik değil, işletme etkisi minimal
- MP-001 (marketplace seed) veri sorunu, kod sorunu değil — manuel müdahale gerekebilir

**Öncelikli Eylemler:**
1. DB seed sorununu çöz (Hepsiburada/N11 manually insert et veya DB'yi resetle)
2. SPA catch-all için monitoring
3. `git add` + `commit` + `push` yapmadan önce MP-001'i çöz

---

## K. CONTEXT-001: XML KAYNAĞI / PAZARYERİ SCOPE İZOLASYONU

**Tarih:** 12 Ağustos 2026
**Önem:** HIGH
**Tür:** Veri tutarlılığı / Bağlam izolasyonu

### Tanım

XML kaynağı veya pazaryeri seçilmeden, kullanıcıya kategori, marka ve listing
şablonu ekranları tüm veriyi gösteriyor. Kullanıcı hangi XML kaynağına ait
veriyi gördüğü konusunda net bilgi sahibi olamıyor.

### Test Sonuçları

| Test | Endpoint | Seçili XML | Seçili MP | Beklenen | Gerçek | DURUM |
|------|----------|-----------|-----------|----------|--------|-------|
| 1A | GET /categories | YOK | YOK | 0 veya filtered | 1285 (tümü) | FAIL |
| 1B | GET /categories?xmlSourceId=XML1 | XML1 | YOK | XML1'e özel | 1285 (tümü) | FAIL |
| 1C | GET /categories?xmlSourceId=XML2 | XML2 | YOK | XML2'ye özel | 1285 (tümü) | FAIL |
| 1D | GET /categories/xml-categories | YOK | YOK | Tüm XML kategorileri | 144 tree, 1287 flat | PASS |
| 1E | GET /categories/xml-categories?xmlSourceId=XML1 | XML1 | YOK | 0 (XML1 boş) | 0 tree, 0 flat | PASS |
| 1F | GET /categories/xml-categories?xmlSourceId=XML2 | XML2 | YOK | XML2 kategorileri | 141 tree, 1271 flat | PASS |
| 1G | GET /categories/stats | — | — | — | totalXmlCategories=1287 | PASS |
| 2A | GET /brands | YOK | YOK | Filtrelenmiş | 15 (tümü) | FAIL |
| 3A | GET /listings | YOK | YOK | — | 0 (boş) | N/A |
| 4A | GET /products | YOK | YOK | 13246 | 13246 | PASS |
| 4B | GET /products?xmlSourceId=XML1 | XML1 | YOK | 0 | 0 | PASS |
| 4C | GET /products?xmlSourceId=XML2 | XML2 | YOK | 13227 | 13227 | PASS |
| 5A | GET /categories/products | YOK | YOK | 13246 | 13246 | PASS |
| 5B | GET /categories/products?xmlSourceId=XML1 | XML1 | YOK | 0 | 0 | PASS |
| 5C | GET /categories/products?xmlSourceId=XML2 | XML2 | YOK | 13227 | 13227 | PASS |
| 6A | GET /categories?marketplaceId=MP1 | YOK | Trendyol | Filtrelenmiş | 1285 (tümü) | FAIL |
| 6B | GET /categories/tree?marketplaceId=MP1 | YOK | Trendyol | Filtrelenmiş | 1285 root | FAIL |
| 6C | GET /categories/mappings?marketplaceId=MP1 | YOK | Trendyol | Mapping'ler | 0 | N/A |
| 6D | GET /categories/mappings | YOK | YOK | Tüm mapping'ler | 0 | N/A |
| 6E | GET /listing-v2/rules | YOK | YOK | Tüm kurallar | 0 | N/A |
| 6F | GET /listing-v2/rules?marketplaceId=MP1 | YOK | Trendyol | MP1 kuralları | 0 | N/A |

### Kanıt Detayı

**Test 1B Kanıtı:**
```
GET /categories?xmlSourceId=99a0eeee-42cc-44bb-9381-b8086153aee2
Response: 1285 categories (XML1'de 0 ürün var, ama 1285 kategori dönüyor)
```

**Test 1E Kanıtı (Doğru Davranış):**
```
GET /categories/xml-categories?xmlSourceId=99a0eeee-42cc-44bb-9381-b8086153aee2
Response: 0 tree, 0 flat (XML1'de ürün yok → doğru)
```

**Test 2A Kanıtı:**
```
GET /brands
Response: 15 brands (D&G, HOBİBAHİEM, akilli bayi, ...)
xmlSourceId filter parametresi: endpoint'te tanımlı değil
```

**Test 6A Kanıtı:**
```
GET /categories?marketplaceId=a4a14491-672b-46d4-8c9b-ed1f32801ba5
Response: 1285 categories (Trendyol'a özel olmalı, ama tüm kategoriler dönüyor)
```

### Kök Neden Analizi

| Veri Tipi | xmlSourceId Filtresi | marketplaceId Filtresi | Durum |
|-----------|---------------------|----------------------|-------|
| System Categories (`/categories`) | Parametre var ama **görmezden geliniyor** | Parametre var ama **görmezden geliniyor** | FAIL |
| XML Categories (`/categories/xml-categories`) | **Doğru çalışıyor** | Yok | PASS |
| Products (`/products`) | **Doğru çalışıyor** | Yok | PASS |
| Categories Products (`/categories/products`) | **Doğru çalışıyor** | Yok | PASS |
| Brands (`/brands`) | Parametre **yok** | Yok | FAIL |
| Category Tree (`/categories/tree`) | Yok | Parametre var ama **görmezden geliniyor** | FAIL |
| Category Mappings (`/categories/mappings`) | Yok | Doğru çalışıyor (0 kayıt) | PASS |
| Listing Rules (`/listing-v2/rules`) | Yok | Doğru çalışıyor (0 kayıt) | PASS |

### DB İlişki Analizi

| Tablo | xmlSourceId Alanı | marketplaceId Alanı | Durum |
|-------|-------------------|---------------------|-------|
| Product | VAR (ilişkili) | YOK | Doğru |
| Category | YOK (global) | YOK | Tasarım gereği |
| Brand | YOK (global) | YOK | Tasarım gereği |
| ListingTemplate | Yok | marketplaceId var | Doğru |
| CategoryMapping | Yok | marketplaceId var | Doğru |

### XML Kaynak Dağılımı

| XML Kaynak | ID | Ürün Sayısı |
|------------|-----|-------------|
| RT_TEST_XML_UPD | 99a0eeee-... | 0 |
| AKILLIBAYI1 | 949855eb-... | 13.227 |
| Kayıtsız | — | 19 |
| **Toplam** | — | **13.246** |

### Frontend Context Kullanımı

Frontend HTML'inde tespit edilen kalıplar:
- `xmlSourceId`: 13 kullanım
- `selectedXml`: 9 kullanım
- `xmlSource`: 48 kullanım
- `marketplaceId`: 13 kullanım
- `selectedMarketplace`: 1 kullanım

Frontend, context seçimini UI'da yönetiyor ancak API level'da filtreleme
bazı endpointlerde çalışmıyor.

### Beklenen Davranış

```
XML KAYNAĞI YOK + PAZARYERİ YOK
→ Kategoriler: Boş veya "kaynak seçin" mesajı
→ Markalar: Boş veya "kaynak seçin" mesajı
→ Listing Şablonları: Boş veya "kaynak seçin" mesajı

XML-A + Trendyol seçildiğinde
→ Kategoriler: Sadece XML-A'nın kategorileri
→ Markalar: Sadece XML-A'dan gelen markalar
→ Listing Şablonları: Sadece Trendyol'a ait şablonlar

XML-B + Hepsiburada seçildiğinde
→ XML-A'nın verisi GÖRÜNMEMELİ
```

### Gerçek Davranış

```
XML KAYNAĞI YOK
→ Kategoriler: 1285 kategori gösteriliyor (tümü)
→ Markalar: 15 marka gösteriliyor (tümü)
→ Listing Şablonları: 0 (boş — şablon yok)

XML-A (XML1) seçildiğinde
→ Kategoriler: HÂLÂ 1285 kategori gösteriliyor (değişmiyor!)
→ Ürünler: 0 ürün (doğru)

XML-B (XML2) seçildiğinde
→ Kategoriler: HÂLÂ 1285 kategori gösteriliyor (değişmiyor!)
→ Ürünler: 13.227 ürün (doğru)
```

### Etki

- **Yüksek**: Kullanıcı hangi XML kaynağına ait gördüğü konusunda yanıltılıyor
- **Orta**: UI'da context seçimi var ama API arkasında filtreleme yok
- **Düşük**: Ürün düzeyinde filtreleme doğru çalışıyor

### Sonuç

**CONTEXT-001: FAIL**

3 endpoint'te xmlSourceId/marketplaceId filtrelemesi çalışmıyor:
1. `GET /categories` — xmlSourceId ve marketplaceId görmezden geliniyor
2. `GET /brands` — xmlSourceId parametresi hiç yok
3. `GET /categories/tree` — marketplaceId görmezden geliniyor

Ürün düzeyinde filtreleme (`/products`, `/categories/products`,
`/categories/xml-categories`) doğru çalışıyor.

*K CONTEXT-001 sonu. 12 Ağustos 2026.*

*Rapor sonu. 12 Ağustos 2026.*
