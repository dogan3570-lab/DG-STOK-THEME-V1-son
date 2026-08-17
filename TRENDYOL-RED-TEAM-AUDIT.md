# TRENDYOL CANLI GÖNDERİM ÖNCESİ — FULL RED TEAM AUDIT (READ-ONLY)

**Tarih:** 15.08.2026 · **Mod:** READ-ONLY audit · **Canlı API çağrısı:** YOK · **DB write:** YOK · **Kod değişikliği:** YOK
Bu rapor yalnızca mevcut kod + DB (read-only) + resmi Trendyol dokümanı üzerinden üretilmiştir.
Doğrulanamayan her şey **NOT VERIFIED** işaretlenmiştir; sahte PASS üretilmemiştir.

Resmi sözleşme kaynakları: https://developers.trendyol.com/reference/createproducts · getbatchrequestresult · filterunapprovedproducts · filterapprovedproducts · docs/2-authorization · docs/1-servis-limitleri · docs/trendyol-marka-listesi-getbrands · docs/trendyol-kategori-listesi-getcategorytree · docs/kategori-özellik-listesi-v2 · docs/kategori-özellik-değerleri-listesi-v2

---

## FAZ 1 — DOSYA / MİMARİ ENVANTERİ

| # | Sistem | Durum | Trendyol'a etkisi |
|---|--------|-------|-------------------|
| 1 | [`adapters.ts`](server/src/services/marketplace/adapters.ts:104) | **ÇALIŞMIYOR (resmi sözleşmeyle uyumsuz)** — flat payload, eski URL, `listingIdField='barcode'`, User-Agent yok | CRITICAL: payload/endpoint/auth baştan yanlış |
| 2 | [`marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts:55) | Çalışır; sync POST → parseResponse; **async batch yok** | CRITICAL: async akış yok |
| 3 | [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:65) | Çalışır; READY gate + idempotency + sync ACTIVE; **mapping gate yok** | CRITICAL: mapping yokken provider'a istek gider |
| 4 | [`marketplaceSend.ts`](server/src/routes/marketplaceSend.ts:14) | Çalışır; ADMIN/OPERATOR; loop 100 ürün | OK |
| 5 | [`readyToShip.ts`](server/src/routes/readyToShip.ts:203) | Çalışır; `/send` NOT_CONFIGURED (sahte gönderim yok) ama **requireRole YOK** | HIGH: RBAC eksik |
| 6 | [`readiness.ts`](server/src/services/readiness.ts:108) | Çalışır; `isReady` = status READY + 4/4 (category/brand/template/variant); **barcode/fiyat/stok/görsel kontrolü YOK** | HIGH: veri bütünlüğü gate'te eksik |
| 7 | Category | Çalışır; 1.288 kayıt; `externalId` 0 dolu | CRITICAL: categoryId yok |
| 8 | CategoryMapping | Altyapı var; **0 kayıt** | CRITICAL |
| 9 | Brand | Çalışır; 17 aktif; `externalId` 0 dolu | CRITICAL: brandId yok |
| 10 | Variant | Çalışır; 30.251 kayıt; 13.382'si bozuk `name="AKYI"` | HIGH: attribute kaynağı kirli |
| 11 | Product | Çalışır; 13.404 ürün | OK |
| 12 | Product.detail | 13.382 dolu | OK (attribute kaynağı) |
| 13 | Product.technicalSpecs | **0 dolu** | HIGH: teknik özellik kaynağı yok |
| 14 | MarketplaceVariantRule | Tablo var; **0 kayıt** | HIGH: attribute kuralı yok |
| 15 | [`listingEngine.ts`](server/src/services/listingEngine.ts:560) | Çalışır; title/desc/price render | MEDIUM: listPrice üretmiyor |
| 16 | [`marketplaceManage.ts`](server/src/routes/marketplaceManage.ts:40) | Çalışır; credential sanitize iyi (rt-p0 doğrular) | OK |
| 17 | Frontend Gönderim Merkezi | Çalışır; `/marketplace-send/send` çağırır; **double-click koruması yok** | MEDIUM |
| 18 | [`crypto.ts`](server/src/services/crypto.ts:70) | AES-256-GCM, enc:v1, legacy fallback, malformed reddetme | OK |
| 19 | [`ssrfGuard.ts`](server/src/services/marketplace/ssrfGuard.ts:53) | Çalışır; scheme/IP/DNS kontrolü; **DNS rebinding TOCTOU var** (kodda kabul edilmiş) | LOW |
| 20 | [`httpClient.ts`](server/src/services/marketplace/httpClient.ts:85) | Bounded retry (3 deneme), 429/5xx retry, timeout 30sn | OK |
| 21 | Retry logic | 400/401/403/404/409 no-retry; 429/5xx/timeout/network bounded | OK |
| 22 | [`errors.ts`](server/src/services/marketplace/errors.ts:15) | HTTP sınıflandırma; **MAPPING_NOT_FOUND/DATA_MISSING/BATCH_FAILED yok** | HIGH |
| 23 | ProductMarketplaceState | 6.094 kayıt, **hepsi PENDING**; ACTIVE yok | MEDIUM: takılı PENDING |
| 24 | Idempotency | `unique(productId,marketplaceId)` + SENDING claim + P2002 | OK (rt-send doğrular) |
| 25 | Concurrency | `updateMany notIn SENDING/ACTIVE` claim | OK |
| 26 | Logging | `[send]` logları hash'li; raw body/credential yok | OK |
| 27 | Telemetry | Yok (sistemde telemetry katmanı bulunamadı) | INFO |
| 28 | RBAC | `requireAuth`/`requireRole` mevcut; `readyToShip/send` rol kontrolsüz | HIGH |
| 29 | Audit logs | `auditLog` + `brandLog` + `listingLog` mevcut | OK |

---

## FAZ 2 — TRENDYOL CATEGORY RED TEAM

| ID | Bulgu | Severity | Root Cause | Affected | Attack | Expected | Actual | Fix |
|----|-------|----------|-----------|----------|--------|----------|--------|-----|
| C-01 | CategoryMapping marketplace-bazlı mı? | INFO | `CategoryMapping.marketplaceId` nullable FK var; teorik olarak scoped | schema.prisma:302 | — | marketplace-scoped | Evet, ama 0 kayıt | — |
| C-02 | Trendyol categoryId başka mp ID olarak kullanılabilir mi? | HIGH | `externalId` tek alan, marketplace ayırt etmez; gönderimde mp filtresi `marketplaceId` ile yapılıyor ama mapping yoksa fallback yok | sendPipeline.ts:126 | başka mp ID'si tt'ye gider | mp bazlı sorgu | şu an 0 kayıt, sorgu marketplaceId'li | mapping'i mp bazlı doldur |
| C-03 | String→Number dönüşüm güvenliği | HIGH | Mevcut kod `externalId`'yi hiç Number'a çevirmiyor (payload'a string gider) | adapters.ts:98 | tip karışıklığı | numeric integer | string | `Number()` + integer doğrulama |
| C-04 | "0" kabul mü? | HIGH | Doğrulama yok | — | 0 categoryId gönderilir | reddedilmeli | kabul edilir | `>0` kontrol |
| C-05 | "-1" kabul mü? | HIGH | Doğrulama yok | — | -1 gönderilir | reddedilmeli | kabul edilir | `>0` kontrol |
| C-06 | NaN kabul mü? | HIGH | `Number('abc')=NaN` doğrulama yok | — | NaN JSON'a null olur | reddedilmeli | sessiz null | `Number.isInteger` kontrol |
| C-07 | Decimal ID kabul mü? | MEDIUM | integer kontrol yok | — | 123.45 gönderilir | reddedilmeli | kabul edilir | integer kontrol |
| C-08 | Boş string kabul mü? | HIGH | mapping yoksa `externalId=null` payload'a girer | sendPipeline.ts:131 | null categoryId gönderilir | MAPPING_NOT_FOUND | flat payload'a null | gate ekle |
| C-09 | Yanlış kategori ID başka ürüne? | HIGH | Mapping ürün→kategori→mapping zinciri ürünün categoryId'sinden; doğru ürün-kategori eşleşmesi `product.categoryId` üzerinden | sendPipeline.ts:126 | — | doğru | doğru zincir | ek doğrulama |
| C-10 | Mapping yokken payload üretilir mi? | **CRITICAL** | mapping yoksa `categoryExternalId=null` ile payload ÜRETİLİR ve istek atılır | sendPipeline.ts:131-144 | yanlış payload provider'a gider | BLOCK | provider'a istek | `MAPPING_NOT_FOUND` gate |
| C-11 | Eski mapping kullanımı | MEDIUM | `active:true` filtresi var ama kategori değişince mapping eskir; `updatedAt` kontrol yok | sendPipeline.ts:126 | stale ID | güncel kontrol | yok | stale guard |
| C-12 | Stale mapping engeli | MEDIUM | Yok | — | — | — | — | stale guard |
| C-13 | Mapping silinince engel mi? | MEDIUM | `active` filter var; silinen mapping (delete) yok sayılır ama hata yerine null düşer | sendPipeline.ts:126 | — | BLOCK | null payload | MAPPING_NOT_FOUND |
| C-14 | marketplaceId doğrulaması | OK | `findFirst({categoryId, marketplaceId, active})` | sendPipeline.ts:126 | — | OK | OK | — |
| C-15 | product/category ilişkisi | OK | `product.categoryId` kullanılır | sendPipeline.ts:124 | — | OK | OK | — |

---

## FAZ 3 — TRENDYOL BRAND RED TEAM

| ID | Bulgu | Severity | Root Cause | Actual | Fix |
|----|-------|----------|-----------|--------|-----|
| B-01 | Brand.externalId Trendyol brandId mi? | **CRITICAL** | `Brand.externalId` hiç dolu değil (0/17); kod `brandName` gönderiyor | numeric brandId YOK | mapping doldur |
| B-02 | Başka mp brand ID kullanımı | HIGH | Tek `externalId` alanı mp ayırt etmez | risk | mp bazlı tutarlı doldurma |
| B-03 | String→integer güvenli mi? | HIGH | Kod brandId'yi hiç kullanmıyor | N/A | Number+integer kontrol |
| B-04 | 0/-1/NaN kabul mü? | HIGH | Doğrulama yok | kabul edilir | `>0` + isInteger |
| B-05 | Brand mapping marketplace scoped mı? | MEDIUM | `BrandMapping.marketplaceKey` var ama kod onu kullanmıyor; `Brand.externalId` mp-agnostic | kısmi | mp bazlı doldurma |
| B-06 | Yanlış brand başka ürüne? | MEDIUM | `product.brandId` zinciri doğru | doğru zincir | ek doğrulama |
| B-07 | Mapping yokken default brand? | HIGH | `brandName = product.brand.name`; mapping yoksa string isim payload'a gider (resmi brandId değil) | yanlış | MAPPING_NOT_FOUND |
| B-08 | Fuzzy isim eşleşmesi riski | MEDIUM | Mevcut `prepBrands.ts` levenshtein fuzzy eşleştirme; yanlış brandId riski | orta risk | getBrands/by-name + AI onay eşiği |
| B-09 | Duplicate brand isimleri | MEDIUM | `Brand.name` unique; ama Trendyol tarafında isimler farklı olabilir | kısmi | by-name birebir |
| B-10 | Stale brand ID tespiti | MEDIUM | Yok | yok | getBrands doğrulama |

---

## FAZ 4 — ATTRIBUTE RED TEAM

**Resmi servisler:** `GET /product/categories/{categoryId}/attributes` → `categoryAttributes[]` (`attribute.id`, `attribute.name`, `required`, `allowCustom`, `slicer`, `varianter`, `allowMultipleAttributeValues`) · `GET /product/categories/{categoryId}/attributes/{attributeId}/values` → `content[]` (`attributeValueId`, `attributeValue`).

| # | Soru | Durum |
|---|------|-------|
| 1 | Zorunlu attribute belirleme | **YOK** — sistemde attribute servis entegrasyonu yok |
| 2 | attributeId kategoriye bağlı mı? | **YOK** — çözümleme yok |
| 3 | attributeValueId attribute'a bağlı mı? | **YOK** |
| 4 | Başka kategori attribute'ı kullanılabilir mi? | Potansiyel — kategori ID çözümlenmezse yanlış kategoriyle istek riski |
| 5 | Başka mp attribute ID'si kullanılabilir mi? | **YOK** (altyapı yok; yanlış kullanım engellenemez) |
| 6 | Variant.name güvenilir mi? | **HAYIR** — `AKYI` gibi 13.382 bozuk kayıt |
| 7 | Variant.value güvenilir mi? | Kısmen — Renk/Beden/Numara/Kapasite gerçek; geri kalanı çöp |
| 8 | Product.detail parse güvenilir mi? | Doğrulanmadı; HTML/metin yapısı belirsiz |
| 9 | AKYI filtreleniyor mu? | **HAYIR** — hiç filtre yok |
| 10 | Attribute whitelist var mı? | Kısmen — [`variantAi.ts`](server/src/services/variantAi.ts:10) `MARKETPLACE_ATTRIBUTES` var ama sendPipeline'da kullanılmıyor |
| 11 | Bilinmeyen attribute davranışı | Yok sayılmıyor; tanımsız |
| 12 | Duplicate attribute davranışı | Tanımsız |
| 13 | Aynı attribute çoklu value | Tanımsız (allowMultipleAttributeValues işlenmiyor) |
| 14 | Zorunlu attribute yoksa BLOCK? | **HAYIR** — BLOCK yok |
| 15 | Required/optional ayrımı | **YOK** |
| 16 | Attribute value bulunamazsa | **YOK** — sessiz geçer |
| 17 | Value ID tahmini? | Şu an ID hiç üretilmiyor (tahmin de yok) — ancak bu boşluk ileride tahmin riski doğurur |
| 18 | Numeric ID validation | **YOK** |
| 19 | Kategori değişince cache invalid | **YOK** (cache yok) |
| 20 | Stale attribute cache | **YOK** (cache yok) |

**ÖNEMLİ SORU — `AKYI` yanlışlıkla attribute olarak gönderilebilir mi?**
Şu an **attribute gönderimi hiç yapılmıyor** (payload'da `attributes` yok), bu yüzden bugün doğrudan sızıntı YOK.
Ancak uygulama yapılırsa ve whitelist eklenmezse `Variant.name="AKYI"` kayıtları `attributeId` eşleşmesine
dahil edilebilir. **CEVAP: Bugün mümkün değil; ileride whitelist olmadan MÜMKÜN — BLOCK gerekir.**

---

## FAZ 5 — PRODUCT DATA RED TEAM (DB doğrulamalı)

READY ürünlerde (5.526):

| Alan | NULL/boş/0/negatif | DB durumu |
|------|--------------------|-----------|
| barcode | barcodeNull 0, barcodeEmpty 0, duplicate 0 | OK |
| title | kontrol edilmedi | NOT VERIFIED (send'de title `?? ''`) |
| productMainId | **kaynak yok** (sku'dan üretilebilir) | DATA_MISSING |
| quantity | stock 0 kayıt yok (stockZeroOrLess 0) | OK şu an |
| stockCode | skuNull 0 | OK |
| dimensionalWeight | **kaynak yok** | DATA_MISSING |
| description | descriptionNull 1 | MEDIUM |
| listPrice | **kaynak yok** | DATA_MISSING |
| salePrice | salePriceNull 0, salePriceZeroOrLess 0 | OK |
| vatRate | kontrol edilmedi | NOT VERIFIED |
| images | imagesNull 1; http:// olanlar olabilir (Trendyol https zorunlu) | MEDIUM |
| brandId | **0 dolu** | MAPPING_NOT_FOUND |
| categoryId | **0 dolu** | MAPPING_NOT_FOUND |
| attributes | **yok** | MAPPING_NOT_FOUND |

HTML injection (description): Trendyol description HTML kabul eder; mevcut `renderDescription` HTML üretir, sanitization yok — provider red riski, güvenlik kritik değil (çıktı Trendyol'a gider). **INFO**.

---

## FAZ 6 — DIMENSIONAL WEIGHT

- Kaynak: **YOK** (`Product`'te alan yok; `technicalSpecs` 0 dolu).
- 0 üretilebilir mi? Şu an hiç üretilmiyor. **Üretilmemeli.**
- Default/tahmin: **YASAK.**
- null gönderilebilir mi? Resmi required'da var; null → 400.
- Yanlışlıkla gönderim: mapping gate olmadan mümkün.
- **Beklenen:** `DATA_MISSING → SEND BLOCK`. **Gerçek:** BLOCK YOK.

---

## FAZ 7 — PRICE RED TEAM

- `listPrice < salePrice`: doğrulama YOK (listPrice üretilmiyor).
- `listPrice = salePrice`: iş kuralı yok.
- `listPrice = 0` / `salePrice = 0`: salePrice DB'de 0 kayıt; ama kodda `salePrice ?? purchasePrice ?? 0` fallback var → 0 üretilebilir (VALIDATION yok).
- Negatif/NaN/Infinity: doğrulama YOK.
- VAT dahil/hariç: `listingEngine.calculatePrice` karmaşık; sendPipeline `salePrice`'ı ham kullanıyor — VAT mode gönderimde uygulanmıyor.
- Currency: Trendyol'da `currencyType` yok (TRY varsayılan); mevcut payload'da currency yok.
- Rounding: `listingV2` rounding'i sendPipeline'a bağlı değil.
- **Yanlış fiyatla canlı gönderim mümkün mü?** Evet — price validasyonu yok. **HIGH.**

---

## FAZ 8 — PAYLOAD RED TEAM (resmi V2 vs mevcut)

| Alan | Resmi V2 | Mevcut adapter | Mismatch |
|------|----------|----------------|----------|
| wrapper | `{items:[...]}` | flat `{...}` | **CRITICAL** |
| brandId | integer | `brandName` string | **CRITICAL** |
| categoryId | integer | `categoryExternalId` string | **CRITICAL** |
| attributes[] | required | **yok** | **CRITICAL** |
| images | `[{url}]` max 8 | `string[]` | **CRITICAL** |
| productMainId | required | yok (sku var) | HIGH |
| quantity | required | `stock` var (isim farklı) | MEDIUM |
| stockCode | required | `sku` var (isim farklı) | MEDIUM |
| dimensionalWeight | required | **yok** | CRITICAL |
| description | required HTML | var | OK |
| listPrice | required | yok (tek price) | CRITICAL |
| salePrice | required | `price` var | MEDIUM |
| vatRate | required int | var | OK |
| User-Agent | zorunlu | **yok** | HIGH (403 riski) |
| endpoint | `/product/sellers/{sellerId}/v2/products` | `/suppliers/{sellerId}/products` | **CRITICAL** |
| auth | Basic | Basic | OK |

---

## FAZ 9 — BATCH LIFECYCLE RED TEAM

Mevcut durum: **async akış hiç yok.** `parseResponse` yalnızca `listingIdField` arar; resmi yanıt `{batchRequestId}` olduğundan **PARSE_ERROR** üretir → `ACTIVE` üretmez. Bu "kazara güvenli" ama doğru değil.

| # | Senaryo | ACTIVE üretilebilir mi? (mevcut) | Beklenen |
|---|---------|----------------------------------|----------|
| 1 | 200 + batchRequestId → direkt ACTIVE | **HAYIR** (PARSE_ERROR'a düşer) | HAYIR (SENDING/polling) |
| 2 | batch FAILED → ACTIVE | HAYIR (akış yok) | HAYIR (ERROR) |
| 3 | batch IN_PROGRESS → ACTIVE | HAYIR (akış yok) | HAYIR (SENDING) |
| 4 | timeout → ACTIVE | HAYIR | HAYIR (TIMEOUT) |
| 5 | polling timeout → ACTIVE | HAYIR (polling yok) | HAYIR (TIMEOUT) |
| 6 | approved query başarısız → ACTIVE | HAYIR (query yok) | HAYIR |
| 7 | contentId yok → ACTIVE | HAYIR | HAYIR (EXTERNAL_ID_NOT_RESOLVED) |
| 8 | variantId yok → ACTIVE | HAYIR | HAYIR |
| 9 | productUrl yok → ACTIVE | HAYIR | HAYIR |
| 10 | Sahte response ile ACTIVE | **EVET mümkün** — 2xx + `barcode` içeren sahte yanıt `ok=true` üretir (rt-p0-test bunu PASS sayar) | HAYIR (approved servis doğrulaması şart) |
| 11 | Duplicate batch | Kısmen — idempotency slot SENDING/ACTIVE korur | OK |
| 12 | Aynı barcode iki kez | ACTIVE sonrası DUPLICATE (rt-send doğrular) | OK |

---

## FAZ 10 — CREDENTIAL / SECURITY RED TEAM

| Öğe | Durum |
|-----|-------|
| apiKey / apiSecret | DB encrypted (`enc:v1:`), decrypt istek anında — OK |
| sellerId | settings içinde plaintext (ID, gizli değil) — INFO |
| Authorization | Basic header yalnızca istek anında; log yok — OK |
| User-Agent | **eksik** (403 riski) — HIGH |
| refreshToken | encrypted (refreshTokenEnc) — OK |
| DB ciphertext | plaintext credential yok (rt-p0-01) — OK |
| Logs | `[send]` hash'li; raw body/credential yok — OK |
| Telemetry | yok — INFO |
| Frontend DOM | credential yok — OK |
| API responses | GET/POST/PUT sanitize (rt-p0-04/05/06) — OK |
| Error messages | credential içermiyor (rt-p0-18/19) — OK |

**NOT:** Gerçek credential değerleri bu rapora yazılmamıştır; yalnızca configured=true/false.

---

## FAZ 11 — SSRF RED TEAM

Kod: [`ssrfGuard.ts`](server/src/services/marketplace/ssrfGuard.ts:53)

| Kontrol | Durum |
|---------|-------|
| localhost/127.0.0.1/::1/10.x/172.16.x/192.168.x/169.254.169.254/metadata | ENGELLENİR (kod + rt-p0 testi) |
| scheme http/https dışı (ftp vb.) | ENGELLENİR |
| Redirect | `redirect:'error'` → takip edilmez (httpClient.ts:66) |
| DNS rebinding | **TOCTOU açık** — guard tek lookup yapar, fetch yeniden resolve eder (kod yorumunda kabul edilmiş) — LOW |
| apiUrl kaynağı | DB'den; ADMIN kontrollü — INFO |

**Canlı SSRF saldırısı yapılmadı.**

---

## FAZ 12 — RETRY / FAILURE RED TEAM

- 401/403/404/409 → no-retry, permanent — **OK** (classifyHttpStatus + rt-p0)
- 429 → bounded retry + Retry-After cooldown — **OK**
- 5xx → bounded retry (3 deneme, backoff 500→2000ms) — **OK**
- timeout/network → bounded retry — **OK**
- Permanent failure quarantine: yok; `ERROR` state var — MEDIUM
- Transient cooldown: 429 cooldown var — OK
- "Aynı request lifecycle aynı model/provider tekrar denenmemeli" — marketplace ile ilgisi yok; AI gateway kapsamında — NOT VERIFIED (bu audit kapsamı dışı)

---

## FAZ 13 — IDEMPOTENCY / CONCURRENCY

- Aynı ürün iki kez: ACTIVE sonrası DUPLICATE — **OK** (rt-send S28)
- Eş zamanlı iki send: ACTIVE + DUPLICATE — **OK** (rt-send S26-29)
- Duplicate batch: slot SENDING korur — OK
- PENDING/SENDING/ACTIVE/ERROR/DUPLICATE: sendPipeline'da uygulanmış — OK
- **1 ürün için iki gerçek listing oluşabilir mi?** Mevcut sync tasarımda unique + claim sayesinde **hayır**. Ancak **async batch'e geçilirse** batchRequestId'nin ayrıca idempotent saklanması gerekir (mevcut tasarım yok) — HIGH.

---

## FAZ 14 — READY GATE BYPASS

| Kapı | Durum |
|------|-------|
| category/brand/variant/template 4/4 | OK (backend authoritative, frontend'e güvenilmez) |
| barcode / fiyat / stok / görsel | **GATE'TE YOK** — `isReady` bunları içermiyor (DB'de şu an 0 occurrence ama kod seviyesinde açık) |
| XML context | OK (WRONG_XML_CONTEXT) |
| marketplace | OK (MARKETPLACE_NOT_FOUND) |
| READY olmayan → BLOCK | OK (NOT_READY) |

---

## FAZ 15 — RBAC

| Yol | Durum |
|-----|-------|
| unauthenticated → 401 | OK |
| VIEWER → 403 | `marketplace-manage` ADMIN-only OK; **`readyToShip/send` requireRole YOK** → authed her rol erişir — HIGH |
| OPERATOR | `marketplace-send/send` ADMIN+OPERATOR — OK |
| ADMIN | OK |
| SUPER ADMIN | Sistemde rol tanımı yok — INFO |

---

## FAZ 16 — FRONTEND RED TEAM

- Endpoint: doğru (`/marketplace-send/send`) — OK
- Credential leak: frontend'de credential yok — OK
- Raw provider error: summary label'ları kullanıyor, raw body göstermiyor — OK
- listingId sahteciliği: frontend backend response kullanır — OK
- ACTIVE sahteciliği: frontend `r.status === 'ACTIVE'` backend'den — OK
- Duplicate click: **koruma yok** (confirm sonrası disable/loading state yok) — MEDIUM (backend idempotent)
- Loading/error/success state: toast ile — OK

---

## FAZ 17 — DATABASE INTEGRITY (READ-ONLY)

- ProductMarketplaceState: 6.094 kayıt, **hepsi PENDING** (kaynağı NOT VERIFIED; takılı kayıtlar)
- ACTIVE without external ID: 0 — OK
- ACTIVE without externalRef: 0 — OK
- PENDING with listingId (impossible): 0 — OK
- Duplicate listingId: 0 — OK
- Duplicate barcode: 0 — OK
- Duplicate SKU: 0 — OK
- Orphan mapping: CategoryMapping 0 (yok) — N/A
- Image private IP: örneklemde 0 — OK

---

## FAZ 18 — TEST GAP ANALYSIS

Mevcut testler: [`rt-p0-test.ts`](server/rt-p0-test.ts:1) (crypto/env/SSRF/retry/error/RBAC/leak), [`rt-send-test.ts`](server/rt-send-test.ts:1) (pipeline/idempotency/concurrency/retry/leak), browser testleri (mp-redteam, ready-to-ship, mp-crud, mp-opera, prep-context-e2e, full-e2e).

**EKSİK TESTLER (yazılmadı, sadece raporlandı):**
- Category mapping numeric dönüşüm + MAPPING_NOT_FOUND
- Brand mapping + brandId
- Attributes (attributeId/attributeValueId) çözümleme + whitelist + AKYI filtresi
- dimensionalWeight DATA_MISSING
- Batch polling (IN_PROGRESS/COMPLETED/FAILED/TIMEOUT)
- Approved product query (contentId/variantId/productUrl)
- Stale mapping / wrong sellerId / duplicate batch
- listPrice ≥ salePrice + fiyat doğrulama
- Trendyol V2 payload şeması (items wrapper, images obj, User-Agent)

**YANLIŞ TEST:** [`rt-p0-test.ts:183`](server/rt-p0-test.ts:183) ve [`rt-p0-test.ts:184`](server/rt-p0-test.ts:184) `parseResponse(200, {barcode})` → `ok=true` bekler; bu, resmi V2'de yanlış olan davranışı PASS sayar. **Testler resmi sözleşmeye göre güncellenmeli.**

---

## FAZ 19 — RESMİ DOKÜMAN KONTROLÜ

- Endpoint/payload/response/auth/rate-limit: **VERIFIED** (resmi OpenAPI).
- `currencyType`: resmi şemada YOK → eklenmeyecek. **VERIFIED.**
- Gerçek external ID (contentId/variantId/productUrl) yalnızca onaylı üründe. **VERIFIED.**
- Onay süreci: POST sonrası ürün onaya girer; onaysızda ID yok. **VERIFIED.**
- Attribute servisleri (attributes + values). **VERIFIED.**
- Marka/kategori servisleri. **VERIFIED.**
- Doğrulanamayan davranış: canlı ortamda onay süresi, retry davranışının birebir provider yanıtı — **NOT VERIFIED** (canlı çağrı yapılmadı).

---

## FAZ 20 — FINAL GAP MATRIX

| ID | Alan | Severity | Root Cause | Current | Expected | Risk | Fix Required | Block Live? |
|----|------|----------|-----------|---------|----------|------|---------------|-------------|
| G-01 | Adapter payload şeması | CRITICAL | flat + eski URL + barcode→ID | uyumsuz | items wrapper + V2 alanları | yanlış ürün/red | adapter rewrite | **EVET** |
| G-02 | Category mapping | CRITICAL | 0 kayıt | yok | numeric categoryId | red/yanlış kategori | mapping doldur + gate | **EVET** |
| G-03 | Brand mapping | CRITICAL | 0 kayıt | yok | numeric brandId | red | mapping doldur + gate | **EVET** |
| G-04 | Attributes | CRITICAL | altyapı+veri yok | yok | attributeId/valueId | red | canlı çözümleme + whitelist | **EVET** |
| G-05 | dimensionalWeight | CRITICAL | kaynak yok | yok | desi | DATA_MISSING | veri kaynağı | **EVET** |
| G-06 | Async batch lifecycle | CRITICAL | tasarlanmamış | sync+PARSE_ERROR | POST→poll→query→ID | yanlış durum | async pipeline | **EVET** |
| G-07 | listPrice | CRITICAL | tek fiyat | yok | listPrice≥salePrice | red | fiyat kaynağı/kural | **EVET** |
| G-08 | User-Agent | HIGH | header yok | 403 riski | `{sellerId} - SelfIntegration` | 403 | header ekle | **EVET** |
| G-09 | READY gate veri bütünlüğü | HIGH | isReady stock/barcode/fiyat/görsel içermiyor | 0 occurrence | tam gate | eksik veri gönderimi | gate genişlet | **EVET** |
| G-10 | readyToShip/send RBAC | HIGH | requireRole yok | authed her rol | ADMIN/OPERATOR | yetkisiz send | role ekle | EVET |
| G-11 | Variant AKYI kirliliği | HIGH | SKU prefix'i attribute | 13.382 bozuk | temiz | yanlış attribute | whitelist | EVET |
| G-12 | Price validation | HIGH | yok | 0/negatif/NaN geçer | doğrulanmış | yanlış fiyat | validasyon | EVET |
| G-13 | Testler V2'ye göre eski | HIGH | rt-p0 barcode→ID PASS | yanlış PASS | V2 testleri | gizli regresyon | test güncelle | EVET |
| G-14 | Stale mapping | MEDIUM | guard yok | — | güncel doğrulama | yanlış ID | stale guard | EVET |
| G-15 | Frontend double-click | MEDIUM | disable yok | — | loading state | çift istek | disable | HAYIR (backend korur) |
| G-16 | Takılı PENDING (6094) | MEDIUM | kaynak bilinmiyor | takılı | temiz lifecycle | karışıklık | NOT VERIFIED | HAYIR |
| G-17 | http:// image URL | MEDIUM | veri | örneklemde var | https | red | veri düzeltme | EVET |
| G-18 | DNS rebinding TOCTOU | LOW | tek lookup | kabul edilmiş | çift kontrol | SSRF | pin/çift lookup | HAYIR |
| G-19 | Cookie secure:false | LOW | prod HTTP | — | secure | token çalınma | prod ayar | HAYIR |

---

## FAZ 21 — CANLI GÖNDERİM GATE

- [x] Official API schema verified (resmi OpenAPI)
- [ ] Endpoint verified — **FAIL** (kod eski endpoint kullanıyor)
- [x] Auth verified (Basic)
- [ ] User-Agent verified — **FAIL** (eksik)
- [ ] Category mapping verified — **FAIL** (0 kayıt)
- [ ] Brand mapping verified — **FAIL** (0 kayıt)
- [ ] Required attributes verified — **FAIL**
- [ ] Attribute values verified — **FAIL**
- [ ] dimensionalWeight verified — **FAIL** (kaynak yok)
- [ ] Price rules verified — **FAIL**
- [ ] Product data verified — **PARTIAL** (barcode/fiyat/stok OK; image http riski)
- [ ] Payload verified — **FAIL**
- [ ] Batch lifecycle verified — **FAIL**
- [ ] Approved product verification verified — **FAIL**
- [ ] External ID verified — **FAIL**
- [x] Idempotency verified (mevcut sync; async için eksik)
- [x] Concurrency verified (mevcut sync)
- [x] Retry verified
- [x] SSRF verified (temel; rebinding LOW)
- [x] Credential security verified
- [ ] RBAC verified — **FAIL** (readyToShip rol eksik)
- [x] READY gate verified (4/4; veri bütünlüğü eksik)
- [ ] Frontend wiring verified — **PARTIAL** (double-click)
- [x] DB state integrity verified (ACTIVE/impossible state yok)
- [ ] Test coverage sufficient — **FAIL**
- [ ] Red Team PASS — **FAIL**

**SONUÇ: 100% PASS sağlanmadı → LIVE SEND = BLOCKED**

---

## FAZ 22 — SONUÇ

### 1. BULUNAN HATALAR (özet)
- CRITICAL: adapter şeması/endpoint/external-ID yaklaşımı tamamen resmi V2 dışı (G-01, G-06)
- CRITICAL: category/brand/attributes mapping verisi yok (G-02, G-03, G-04)
- CRITICAL: dimensionalWeight + listPrice kaynağı yok (G-05, G-07)
- HIGH: User-Agent, READY gate veri bütünlüğü, RBAC, price validasyonu, testlerin eski davranışı PASS sayması (G-08..G-13)
- MEDIUM/LOW: AKYI kirliliği, http image, double-click, DNS rebinding, secure cookie

### 2. EKSİKLER
Mapping verisi, canlı catalog istemcisi, async batch pipeline, attribute çözümleme, fiyat/desi kaynağı.

### 3. FALSE POSITIVE'LER
- `apiStatus='connected'` yanıltıcı — gerçek doğrulama yok (NOT VERIFIED).
- `rt-p0-test` "barcode → external ID" davranışını PASS sayıyor — bu resmi V2'ye göre yanlış pozitif.

### 4. GERÇEK RİSKLER
Canlı gönderim yapılırsa: 403 (User-Agent yok), 404 (yanlış endpoint), 400 (yanlış şema), yanlış category/brand/attribute ile ürün reddi. Gerçek listing ID'si çözümlenemeden ACTIVE üretilmez (mevcut kod bunu kazara engelliyor) — ama doğru akış da yok.

### 5. KÖK NEDENLER
Adapter eski bir sözleşmeye göre yazılmış; mapping verisi hiç doldurulmamış; async batch lifecycle tasarlanmamış; testler güncel sözleşmeyle senkron değil.

### 6. ETKİLENEN DOSYALAR
[`adapters.ts`](server/src/services/marketplace/adapters.ts:104) · [`types.ts`](server/src/services/marketplace/types.ts:21) · [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:65) · [`marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts:55) · [`errors.ts`](server/src/services/marketplace/errors.ts:15) · [`httpClient.ts`](server/src/services/marketplace/httpClient.ts:85) · [`readyToShip.ts`](server/src/routes/readyToShip.ts:203) · yeni `trendyolCatalog.ts`.

### 7. LOCKED DOSYALAR
[`schema.prisma`](server/prisma/schema.prisma:1) · [`readyToShip.ts`](server/src/routes/readyToShip.ts:1) · [`readiness.ts`](server/src/services/readiness.ts:1) · [`products.ts`](server/src/routes/products.ts:1) · [`dashboard.ts`](server/src/routes/dashboard.ts:1) · [`reports.ts`](server/src/routes/reports.ts:1) · [`listingV2.ts`](server/src/routes/listingV2.ts:1) — migration/seed/DB reset YOK.

### 8. UYGULAMA ÖNCESİ PLAN
1. Adapter rewrite (resmi V2 şema + endpoint + User-Agent + `{batchRequestId}` parse)
2. `MAPPING_NOT_FOUND`/`DATA_MISSING`/`BATCH_FAILED`/`EXTERNAL_ID_NOT_RESOLVED` hata sözleşmesi
3. Mapping verisi doldurma (CategoryMapping.externalId, Brand.externalId — data-level, migration değil)
4. `trendyolCatalog.ts` canlı catalog/attribute istemcisi + whitelist (AKYI filtresi)
5. Async batch pipeline (bounded polling + approved query + gerçek ID)
6. listPrice/desi kaynağı + fiyat/veri validasyonu
7. Testlerin V2 sözleşmesine göre güncellenmesi
8. READY gate'e veri bütünlüğü + RBAC düzeltmesi

### 9. LIVE SEND GATE
**BLOCKED** — 27 kontrolün çoğu FAIL.

### 10. FINAL VERDICT

```
FAIL — LIVE SEND BLOCKED
```

Canlı API çağrısı yapılmadı, gerçek ürün gönderilmedi, sahte ID/başarı üretilmedi, DB değiştirilmedi, kod değiştirilmedi.
