# TRENDYOL ADAPTER — RESMİ ŞEMA DÜZELTME PLANI (FAZ 3 — KOD ÖNCESİ)

Bu rapor FAZ 3 kapsamında, kod değiştirilmeden önce üretilmiştir. Tüm resmi sözleşme bilgileri
yalnızca Trendyol'un resmi dokümantasyonundan (`developers.trendyol.com`, ReadMe.io OpenAPI tanımları)
doğrulanmıştır. Üçüncü taraf kaynak kullanılmamıştır.

---

## 1. ROOT CAUSE

Mevcut adapter, Trendyol'un **eski (V1) ve/veya hiç var olmayan** bir sözleşmeye göre yazılmıştır.
Trendyol'un güncel resmi ürün entegrasyonu sözleşmesi (V2) üç temel eksende farklıdır:

1. **REQUEST:** Flat payload yerine `items[]` wrapper; string `categoryExternalId`/`brandName` yerine
   numeric `categoryId`/`brandId`; `images: string[]` yerine `images: [{url}]`; ayrıca zorunlu
   `productMainId`, `quantity`, `stockCode`, `dimensionalWeight`, `listPrice`/`salePrice` ayrımı ve
   **zorunlu `attributes[]`**.
2. **RESPONSE:** Senkron `POST /v2/products` başarısı yalnızca `{ "batchRequestId": "..." }` döner.
   Bu bir **listing/product ID değildir**; async kuyruk takip ID'sidir.
3. **EXTERNAL ID:** Gerçek external ürün ID'si (`contentId`, `variantId`, `productUrl`) yalnızca
   **onaylı ürün** filtre servisinden (`/products/approved`) alınabilir. Onaysız (draft/onay bekleyen)
   üründe yalnızca `barcode`/`productMainId` vardır; ID yoktur.

Mevcut `TrendyolAdapter.parseResponse` 2xx yanıtta `barcode` alanını arayıp onu "external listing id"
kabul etmektedir; ancak resmi yanıtta böyle bir alan olmadığından gerçekte `PARSE_ERROR` üretir ve
async akış hiç tasarlanmamıştır.

---

## 2. OFFICIAL API CONTRACT (resmi dokümandan doğrulandı)

| # | Konu | Resmi Değer |
|---|------|-------------|
| 1 | Ürün yaratma endpoint | `POST https://apigw.trendyol.com/integration/product/sellers/{sellerId}/v2/products` |
| 2 | HTTP method | `POST` |
| 3 | Authentication | HTTP Basic Auth (`apiKey:apiSecret`) + zorunlu `User-Agent` header: `"{sellerId} - SelfIntegration"` (yoksa **403**) |
| 4 | Supplier ID | path param `sellerId` (`integer int64`) |
| 5 | Request body | `{ "items": [ ... ] }` — max **1.000** item |
| 6 | `items` yapısı | `CreateProductItem[]` (required: barcode, title, productMainId, brandId, categoryId, quantity, stockCode, dimensionalWeight, description, listPrice, salePrice, images, vatRate, attributes) |
| 7 | barcode | `string`, max 40 |
| 8 | productMainId | `string`, max 40 (satıcı ana ürün kodu / model kodu; varyant gruplama anahtarı) |
| 9 | brandId | `integer` (getBrands servisinden alınır) |
| 10 | categoryId | `integer` (getCategoryTree servisinden, **en alt seviye** kategori) |
| 11 | quantity | `integer` |
| 12 | stockCode | `string`, max 100 |
| 13 | dimensionalWeight | `number` (desi) |
| 14 | description | `string` (HTML), max 30.000 |
| 15 | currencyType | **YOK** (resmi OpenAPI'de bu alan yoktur — uydurma alan eklenmeyecek) |
| 16 | listPrice | `number` (PSF; `salePrice`tan küçük olamaz) |
| 17 | salePrice | `number` (TSF) |
| 18 | vatRate | `integer` (0,1,10,20 gibi) |
| 19 | images | `array` max **8**, eleman: `{ "url": "https://..." }` |
| 20 | attributes | `array`, eleman: `{ attributeId (required), attributeValueIds: integer[] \| attributeValue: string }` |
| 21 | batchRequestId | POST 200 yanıtı: `{ "batchRequestId": "string" }` |
| 22 | Batch/status endpoint | `GET /product/sellers/{sellerId}/products/batch-requests/{batchRequestId}` |
| 23 | Batch status response | `{ batchRequestId, items:[{requestItem, status: SUCCESS\|FAILED, failureReasons[]}], status: COMPLETED\|IN_PROGRESS, creationDate, lastModification, sourceType, itemCount, failedItemCount, batchRequestType }` — sonuçlar **4 saat** görüntülenebilir |
| 24 | Ürün sorgulama | Onaysız: `GET /product/sellers/{sellerId}/products/unapproved?barcode=...` · Onaylı: `GET /product/sellers/{sellerId}/products/approved?barcode=...` |
| 25 | Gerçek external ID | Yalnızca **onaylı** üründe: `contentId` (integer), `variantId` (integer), `productUrl`. Onaysız üründe **ID yoktur**. |
| 26 | Hata formatı | 400 → `{ "errors": [ { key, message, errorCode } ] }` · 401 → `{ "exception": "ClientApiAuthenticationException" }` |
| 27 | Rate-limit | Aynı endpoint'e 10 sn'de 50 → 429. Mevcut (14.09.2026'ya kadar): Ürün Aktarma 1000 req/min, Batch Kontrol 1000 req/min, Ürün Filtreleme 2000 req/min, Marka/Kategori 50 req/min |

**Yardımcı mapping servisleri (resmi):**
- Marka: `GET https://apigw.trendyol.com/integration/product/brands` (yanıt: `brands[{id, name, luxe}]`) · `GET /product/brands/by-name?name=...`
- Kategori: `GET https://apigw.trendyol.com/integration/product/product-categories` (yanıt: ağaç `{id, name, parentId, subCategories[]}`)

**Resmi kaynaklar:**
- Ürün yaratma: https://developers.trendyol.com/docs/ürün-yaratma-v2 · https://developers.trendyol.com/reference/createproducts
- Batch kontrol: https://developers.trendyol.com/reference/getbatchrequestresult
- Onaysız filtre: https://developers.trendyol.com/reference/filterunapprovedproducts
- Onaylı filtre: https://developers.trendyol.com/reference/filterapprovedproducts
- Auth: https://developers.trendyol.com/docs/2-authorization
- Limitler: https://developers.trendyol.com/docs/1-servis-limitleri
- Hata kodları: https://developers.trendyol.com/docs/hata-kodları
- Marka listesi: https://developers.trendyol.com/docs/trendyol-marka-listesi-getbrands
- Kategori listesi: https://developers.trendyol.com/docs/trendyol-kategori-listesi-getcategorytree

---

## 3. CURRENT ADAPTER (mevcut durum)

| Dosya | Mevcut davranış |
|-------|-----------------|
| [`adapters.ts`](server/src/services/marketplace/adapters.ts) | `TrendyolAdapter` → `listingIdField='barcode'`; `jsonBody()` **flat** payload üretir (`barcode, sku, title, description, price, stock, vatRate, categoryExternalId, brandName, images[]`); URL `{apiUrl}/suppliers/{sellerId}/products`; `User-Agent` header yok |
| [`types.ts`](server/src/services/marketplace/types.ts) | `MarketplaceListingPayload`: `categoryExternalId: string`, `brandName: string`, `images: string[]`, tek `price`; `quantity/stockCode/dimensionalWeight/listPrice/attributes/productMainId` alanları yok |
| [`marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts) | Credential decrypt + `requestWithBoundedRetry` + `parseResponse`; async akış yok |
| [`httpClient.ts`](server/src/services/marketplace/httpClient.ts) | Bounded retry (MAX_RETRIES=2; 429/5xx) + SSRF guard + 30 sn timeout; polling desteği yok |
| [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts) | `categoryExternalId` ← `categoryMapping.externalId`; `brandName` ← `product.brand.name`; senkron ok ise **doğrudan ACTIVE** (async yok) |
| [`errors.ts`](server/src/services/marketplace/errors.ts) | HTTP sınıflandırma var; `MAPPING_NOT_FOUND` yok |

---

## 4. REQUEST MISMATCHES

| # | Mevcut | Resmi olması gereken |
|---|--------|----------------------|
| 1 | Flat `{...}` | `{ "items": [ {...} ] }` |
| 2 | `categoryExternalId: string` | `categoryId: integer` |
| 3 | `brandName: string` | `brandId: integer` |
| 4 | `images: string[]` | `images: [{url}]` (max 8) |
| 5 | tek `price` | `listPrice` + `salePrice` (listPrice ≥ salePrice) |
| 6 | `stock` | `quantity` |
| 7 | `sku` | `stockCode` |
| 8 | yok | `productMainId` (zorunlu) |
| 9 | yok | `dimensionalWeight` (zorunlu; desi) |
| 10 | yok | `attributes[]` (zorunlu; kategori özellikleri) |
| 11 | yok | `User-Agent` header (403 koruması) |
| 12 | URL `.../suppliers/{sellerId}/products` | `https://apigw.trendyol.com/integration/product/sellers/{sellerId}/v2/products` |
| 13 | `currencyType` beklentisi | resmi sözleşmede **yok** → eklenmeyecek |

---

## 5. RESPONSE MISMATCHES

| # | Mevcut | Resmi |
|---|--------|-------|
| 1 | `parseResponse` 2xx'te `barcode` arar | POST 200 yanıtı `{batchRequestId}`; `barcode` yok |
| 2 | `listingId = barcode` | `listingId ≠ batchRequestId`; gerçek ID yalnızca onaylı filtre servisinde |
| 3 | Senkron başarı → ACTIVE | POST başarısı yalnızca "kuyruğa alındı"; ACTIVE için onaylı ürün ID doğrulaması şart |
| 4 | Batch hata/status yapısı hiç yok | `status: COMPLETED\|IN_PROGRESS`, `items[].status: SUCCESS\|FAILED`, `failureReasons[]` |

---

## 6. ASYNC FLOW (resmi sözleşmeye göre doğru akış)

```
READY (4/4)
  → SENDING
  → POST /v2/products
  → 200 { batchRequestId }            (externalRef olarak saklanır; listingId DEĞİL)
  → GET /products/batch-requests/{batchRequestId}   (bounded polling)
       ├─ IN_PROGRESS → bekle (bounded; timeout → TIMEOUT)
       ├─ COMPLETED + item FAILED   → ERROR (failureReasons güvenli hata)
       └─ COMPLETED + item SUCCESS  → ürün ONAY SÜRECİNDE (onaysız/draft)
            → GET /products/unapproved?barcode=...   (varlık doğrulama; ID yok)
            → (onay sonrası) GET /products/approved?barcode=...
                 → contentId + variantId + productUrl + onSale=true doğrulanır
                 → ACTIVE (listingId = variantId, listingUrl = productUrl)
```

**KRİTİK KURAL:** `POST 2xx` + `batchRequestId` mevcut olsa bile **ACTIVE YASAK**.
ACTIVE ancak provider tarafından onaylanmış ürünün gerçek external ID'si (variantId/contentId)
doğrulanırsa mümkündür. Onay süreci günler sürebilir; bu sürede durum `SENDING`/onay-bekleme
olarak kalmalı, asla `ACTIVE` üretilmemelidir.

---

## 7. MAPPING GAPS (canlı DB doğrulandı — 15.08.2026)

| Mapping | Durum | Sonuç |
|---------|-------|-------|
| Category → Trendyol `categoryId` | `CategoryMapping` (tt): **0 kayıt**; `Category.externalId` null | **YOK** |
| Brand → Trendyol `brandId` | `Brand.externalId` dolu: **0 / 17**; `BrandMapping` (tt): 2 kayıt ama yalnızca iç eşleştirme, Trendyol brandId'si yok | **YOK** |
| Attributes (kategori özellikleri) | Sisteme ait hiçbir tablo/servis yok | **YOK** |
| Test ürünü | 5.526 READY ürün var; hiçbirinde category/brand external ID yok | Hazır değil |

**KARAR:** SAHTE ID ÜRETİLMEZ. Mapping olmayan her alan için `MAPPING_NOT_FOUND` üretilir ve
gönderim provider'a ulaşmadan engellenir.

---

## 8. AFFECTED FILES (düzeltme kapsamı)

- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts) — TrendyolAdapter payload + URL + User-Agent + parseResponse
- [`server/src/services/marketplace/types.ts`](server/src/services/marketplace/types.ts) — payload tipleri (items, brandId, categoryId, images obj, attributes)
- [`server/src/services/marketplace/marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts) — async batch çağrıları (POST + status + filtre)
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts) — lifecycle + mapping gate + bounded polling
- [`server/src/services/marketplace/errors.ts`](server/src/services/marketplace/errors.ts) — `MAPPING_NOT_FOUND`, `BATCH_FAILED`, `EXTERNAL_ID_NOT_RESOLVED`, `APPROVAL_PENDING`
- [`server/src/services/marketplace/httpClient.ts`](server/src/services/marketplace/httpClient.ts) — polling/batch istekleri (mevcut bounded retry korunur)
- Yeni: category/brand/attribute mapping çözümleme servisi (numeric ID'leri güvenli üretir; sahte ID yok)

## 9. LOCKED FILES (dokunulmayacak)

- [`server/src/routes/readyToShip.ts`](server/src/routes/readyToShip.ts) (kilitli)
- [`server/src/routes/products.ts`](server/src/routes/products.ts) · [`server/src/routes/dashboard.ts`](server/src/routes/dashboard.ts) · [`server/src/routes/reports.ts`](server/src/routes/reports.ts) · [`server/src/routes/listingV2.ts`](server/src/routes/listingV2.ts)
- [`server/src/services/readiness.ts`](server/src/services/readiness.ts) — READY/readiness mantığı değiştirilmez
- [`server/prisma/schema.prisma`](server/prisma/schema.prisma) — schema/migration/seed/DB reset YOK

## 10. DB IMPACT

- **Schema değişikliği yok.** Async durum mevcut alanlara yazılır: `batchRequestId → externalRef`
  (geçici), gerçek `variantId → listingId`, `productUrl → listingUrl`, `errorMessage` batch hata detayı.
- Mevcut 6.094 `PENDING` + 5.526 `READY` kaydına dokunulmaz; yalnızca açıkça seçilen 1 ürün işlenir.
- `ACTIVE` yalnızca onaylı ürün ID'si doğrulanınca yazılır.

## 11. SECURITY IMPACT

- Credential decrypt yalnızca istek anında kalır; GET/POST/PUT yanıtlarında, log/telemetry/DOM'da yok.
- `Authorization` (Basic) loglanmaz; `User-Agent` yalnızca `sellerId` (ID, gizli değil) + `SelfIntegration` içerir.
- Raw provider body yalnızca truncate edilmiş kopya olarak parse edilir; log/dönüş yok.
- [`server/rt-p0-test.ts`](server/rt-p0-test.ts) 43/43 PASS hedefi korunur.

## 12. RED TEAM RISK (öngörülen kontrol listesi)

- `batchRequestId` spoof → format/uzunluk doğrulaması; yalnızca kendi POST'umuzun döndürdüğü değer kullanılır
- fake `COMPLETED` status → provider yanıtında `items[].status` + `itemCount/failedItemCount` çapraz doğrulama
- fake external ID → yalnızca `approved?barcode` yanıtından, `barcode` eşleşmesi + `onSale=true` ile doğrulanır
- wrong `categoryId`/`brandId`/`sellerId` → mapping yoksa `MAPPING_NOT_FOUND`; sellerId credential validate
- duplicate batch → idempotency slot (`unique(productId, marketplaceId)` + `SENDING` claim) korunur
- polling abuse → bounded (max deneme + toplam süre) + sleep; timeout → `TIMEOUT`
- raw provider response leak → log yok
- credential leak → mevcut P0 kontrolleri aynen çalışır

## 13. ROLLBACK PLAN

Tüm değişiklikler yalnızca adapter/pipeline katmanındadır; schema değişikliği yoktur.
Geri alma: ilgili 6 dosyanın eski içeriğine dönülmesi yeterlidir. Mock/test seviyesi doğrulama
canlı çağrıdan önce tamamlanır; canlı çağrı yalnızca 1 ürün ve açık gate onayı ile yapılır.

## 14. KARAR (DUR)

Resmi doküman **belirgin ve doğrulanmıştır**; endpoint/payload/async akış nettir. Ancak:

- Category mapping **yok**
- Brand mapping (numeric Trendyol brandId) **yok**
- Attributes mapping **yok**

Bu üç mapping eksik olduğu sürece payload'un zorunlu `brandId`, `categoryId`, `attributes` alanları
güvenli şekilde doldurulamaz. Kullanıcı talimatı gereği **SAHTE ID ÜRETİLMEZ** ve
**CANLI GÖNDERİM ENGELLENİR** (`MAPPING_NOT_FOUND`).

**Sonraki adım (kullanıcı onayı ile):**
1. Adapter'ı resmi şemaya göre düzelt (Faz 4)
2. Mapping gate'i `MAPPING_NOT_FOUND` üretecek şekilde kur (Faz 5)
3. Async batch flow'u bounded polling ile kur (Faz 6)
4. Mock/test'leri geç; mapping olmadan canlı çağrı YAPMA
