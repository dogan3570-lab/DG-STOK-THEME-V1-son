# CORE LISTING + 4/4 GERÇEK GATE — KONTROLLÜ UYGULAMA RAPORU

**Tarih:** 15.08.2026 · **Canlı API:** YOK · **Ürün gönderimi:** YOK · **Schema/migration/DB write/git:** YOK

---

## 1. BASELINE (ölçülen)

- READY ürün: **5.526** (sahte `categoryMatch/brandMatch/templateMatch=true` kaynaklı)
- ListingTemplate: **2** (ikisi de GENEL, `productId/categoryId/brandId=null`, marketplaceId=tt)
- CategoryMapping: **0** · Brand.externalId dolu: **0**
- ProductMarketplaceState: **6.094 PENDING**
- `git status`: çalışma kopyası önceki turlardan değişik (raporlar + marketplace/ + frontend + prepVariants)

## 2. ROOT CAUSE

1. [`xmlImport.ts:568`](server/src/services/xmlImport.ts:568) import'ta `categoryMatch/brandMatch/templateMatch=true + status=READY` → gerçek eşleşme/şablon olmadan 4/4 READY üretiliyor (kilitli, bu turda değiştirilmedi).
2. ListingTemplate öncelik zinciri (Ürün>Kategori>Genel) yoktu.
3. [`listingEngine.ts:146`](server/src/services/listingEngine.ts:146) `basePrice<=0→1` (kilitli, preview/simulate yolu).

## 3. IMPLEMENTED CHANGES (bu tur)

1. **Yeni [`listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:1)** (kilit dışı, izole):
   - `resolveListingTemplate({productId, categoryId, marketplaceId})` → PRODUCT → CATEGORY → GENERAL → NO_TEMPLATE.
   - Marketplace context zorunlu; rastgele seçim yok.
2. **Gerçek listing gate** [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:123):
   - `isReady` sonrası `resolveListingTemplate` çağrılır; `NO_TEMPLATE` ise `TEMPLATE_NOT_FOUND` → **provider'a istek GİTMEZ** (import'tan gelen sahte `templateMatch` bypass edilir).
3. **Yeni test** [`rt-listing-template-test.ts`](server/rt-listing-template-test.ts:1): precedence + context izolasyonu (9 senaryo).
4. [`rt-send-test.ts`](server/rt-send-test.ts:124): sentetik GENEL şablon eklendi (gerçek gate ile uyumlu) + cleanup'a şablon silme.

## 4. TEMPLATE RESOLVER

`resolveListingTemplate`: 1) `productId` eşleşen aktif şablon; 2) yoksa `categoryId` (+ productId/brandId null) şablon; 3) yoksa genel (productId/categoryId/brandId null) şablon; 4) yoksa `NO_TEMPLATE`. Tüm sorgular `marketplaceId` ile scoped.

## 5. PRODUCT > CATEGORY > GENERAL

| Senaryo | Test sonucu |
|---------|-------------|
| Üçü varken | **PRODUCT** (PASS) |
| Product yok | **CATEGORY** (PASS) |
| Product+Category yok | **GENERAL** (PASS) |
| Hiçbiri yok | **NO_TEMPLATE** (PASS) |
| Yanlış marketplace şablonu | **sızmaz** (PASS) |

## 6. XML + MARKETPLACE CONTEXT

Resolver marketplaceId ile scoped; XML context ürünün kendisinden gelir. Frontend global `contextState` senkronizasyonu önceki turda uygulanmıştı.

## 7. CATEGORY / BRAND / VARIANT

Önceki turlar: Category `status=XML` kaldırıldı, progress monoton + duplicate/stale polling koruması, Variant `stats`/`auto-detect` `xmlSourceId`. Bu turda değiştirilmedi.

## 8. REAL 4/4 GATE

`isReady` (readiness, kilitli) hâlâ sahte `templateMatch`'i okuyor; ancak **gönderim anında** sendPipeline artık gerçek `resolveListingTemplate` sonucunu şart koşuyor → şablon yoksa gönderim engellenir. Eski 5.526 READY kaydı topluca güncellenmedi (kullanıcı yasağı); runtime gate onları gönderimde korur.

## 9. PRICE ENGINE

Bu turda fiyat motoru değiştirilmedi (kilitli). 4 ayrı yol mevcut; `basePrice<=0→1` yalnızca preview/simulate'de; gönderim fiyatı `salePrice ?? purchasePrice ?? 0`.

## 10. FAIL-CLOSED

- Listing: NO_TEMPLATE → `TEMPLATE_NOT_FOUND` (provider'a gitmez) — **UYGULANDI**.
- Fiyat: `basePrice<=0→1` fail-closed'a çevrilmedi — **LOCK CONFLICT** (kilitli [`listingEngine.ts`](server/src/services/listingEngine.ts:146)).

## 11. 3-SECOND UX

Önceki turlar: XML/MP göstergesi global; Category/Brand/Variant bağlandı. **Listing ekranında context banner hâlâ yok** (kilitli [`prepListings.ts`](server/src/routes/prepListings.ts:1)) — UX FAIL (Listing özelinde).

## 12. RED TEAM

- Product>Category>General: **PASS** (9/9)
- Yanlış marketplace şablon sızması: **PASS**
- NO_TEMPLATE → gönderim engeli: **PASS** (sendPipeline)
- Sahte templateMatch bypass: **KAPATILDI** (sendPipeline gate)
- Sahte 1 TL: **AÇIK** (kilitli)
- Import sahte categoryMatch/brandMatch: **AÇIK** (kilitli)

## 13. TEST RESULTS

| Test | Sonuç |
|------|-------|
| [`rt-listing-template-test.ts`](server/rt-listing-template-test.ts:1) (yeni) | **9 PASS, 0 FAIL** |
| [`rt-p0-test.ts`](server/rt-p0-test.ts:1) | **44 PASS, 0 FAIL** |
| [`rt-send-test.ts`](server/rt-send-test.ts:1) | **21 PASS, 0 FAIL** |
| [`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1) | **28 PASS, 0 FAIL** |

## 14. TSC

`npx tsc -p server/tsconfig.json --noEmit` → **PASS**

## 15. BUILD

`npm run build` → **PASS** (489.50 kB)

## 16. REGRESSION

Mevcut tüm backend testleri geçti (44 + 21 + 28 + 9). Frontend/backend kilitli alanlar değişmedi.

## 17. CHANGED FILES

- [`server/src/services/listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:1) (yeni)
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:123) (listing gate)
- [`server/rt-send-test.ts`](server/rt-send-test.ts:124) (sentetik şablon + cleanup)
- [`server/rt-listing-template-test.ts`](server/rt-listing-template-test.ts:1) (yeni)

## 18. LOCKED FILES (dokunulmadı)

[`xmlImport.ts`](server/src/services/xmlImport.ts:568) · [`listingEngine.ts`](server/src/services/listingEngine.ts:146) · [`readiness.ts`](server/src/services/readiness.ts:108) · [`prepListings.ts`](server/src/routes/prepListings.ts:1) · [`prepCategories.ts`](server/src/routes/prepCategories.ts:1) · [`prepBrands.ts`](server/src/routes/prepBrands.ts:1) · [`schema.prisma`](server/prisma/schema.prisma:1)

## 19. SCHEMA / MIGRATION STATUS

**SCHEMA DEĞİŞİKLİĞİ YAPILMADI ve GEREKMEDİ.** `ListingTemplate.productId/categoryId/brandId/marketplaceId` mevcut alanlarla resolver çalışıyor.

## 20. REMAINING RISKS

1. Import sahte `categoryMatch/brandMatch/templateMatch` hâlâ var (kilitli `xmlImport.ts`); gönderim runtime gate ile korunuyor.
2. `basePrice<=0→1` preview/simulate'de sahte fiyat (kilitli `listingEngine.ts`).
3. Listing UI context banner + şablon listesi context filtresi yok (kilitli `prepListings.ts`).
4. 4/4 görsel durum şeridi yok (kilitli `readiness.ts` + UX).
5. Hedef MP ağaçları boş; mapping verisi yok → canlı gönderim `MAPPING_NOT_FOUND` bloke.
6. Eski 5.526 READY kaydı (toplu DB update yapılmadı).

## 21. FINAL VERDICT

```
FAIL — LIVE SEND BLOCKED
```

Canlı marketplace API çağrısı YAPILMADI. Bu turda **ListingTemplate resolver (Product>Category>General>NO_TEMPLATE)** ve
**gerçek listing gate** (şablon yoksa provider'a gitmez) uygulandı ve test edildi. Ancak import'taki sahte
`categoryMatch/brandMatch/templateMatch`, fiyat fail-closed ve hedef MP ağaçları kilitli dosyalar + veri eksikliği
nedeniyle tamamlanmadı; canlı gönderim ayrıca mapping eksikliğiyle engellidir. Sahte PASS/READY/ACTIVE/ID üretilmedi.
