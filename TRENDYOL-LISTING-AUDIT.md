# WORKSPACE CONTEXT + LISTING — READ-ONLY AUDIT + LOCK CONFLICT RAPORU

**Tarih:** 15.08.2026 · **Canlı API:** YOK · **Ürün gönderimi:** YOK · **Schema/migration/seed/git:** YOK

---

## ROOT CAUSE

1. **Listing "hazır" durumu sahte.** [`xmlImport.ts:572`](server/src/services/xmlImport.ts:572) ve [`xmlImport.ts:599`](server/src/services/xmlImport.ts:599) import sırasında her ürüne `templateMatch: true` yazıyor. Yani 4/4 gate'in "LISTING" ayağı, gerçek bir şablon eşleşmesi olmadan otomatik `READY` sayılıyor.
2. **ListingTemplate önceliği (Ürün > Kategori > Genel) YOK.** [`listingTemplate.findMany`](server/src/routes/prepListings.ts:69) yalnızca listeleme için kullanılıyor; gönderim/hazırlık anında ürün→kategori→genel şablon seçimi yapan kod yok.
3. Fiyat önceliği **yalnızca `MarketplacePricingRule`** için var: [`listingV2.ts:81`](server/src/routes/listingV2.ts:81) `findBestRule` (PRODUCT→CATEGORY→GENERAL). `ListingTemplate.priceRangeRules` için öncelik zinciri uygulanmıyor.
4. İki ayrı fiyat motoru mevcut: [`listingEngine.ts:121`](server/src/services/listingEngine.ts:121) `calculatePrice` (şablon tabanlı) ve [`listingV2.ts:27`](server/src/routes/listingV2.ts:27) `calculatePriceV5` (kural tabanlı). Bu ayrım kullanıcıya "hangi fiyat kaynağı geçerli" belirsizliği yaratır.
5. [`listingEngine.ts:146`](server/src/services/listingEngine.ts:146) `if (basePrice <= 0) basePrice = 1;` → fiyat verisi yokken **sahte 1 TL** üretir (DATA_MISSING/FAIL-CLOSED değil).

## CONTEXT MODEL

- Global `contextState` + `syncLocalContextSelectors()` (önceki turda düzeltildi): global seçim dört modülün select/state'ine yazılıyor.
- Category global fallback + progress/duplicate/polling düzeltmeleri önceki turda uygulandı.
- Variant `stats`/`auto-detect` artık `xmlSourceId` alıyor (frontend + backend minimal).
- **Listing context banner hâlâ yok:** `prepListState.xmlSourceId`/`marketplaceId` taşınıyor ama ekranda görünmüyor.

## CATEGORY

Durum: `status=XML` kaldırıldı → eşleşenler görünüyor; progress monoton; duplicate/polling korumalı. **Hedef MP ağacı hâlâ boş** (`CategoryMapping` 0).

## BRAND

Durum: XML filtresi var; hedef MP marka sistemi yok; `Brand.externalId` boş (önceki audit'lerle tutarlı). Bağlam senkronizasyonu önceki turda eklendi.

## VARIANT

Durum: `stats`/`auto-detect` context'li yapıldı; `AKYI` whitelist'i hâlâ yok (kilitli `readiness.ts`/`prepVariants.ts` kapsamı).

## LISTING

| Kontrol | Durum |
|---------|-------|
| XML context ekranda | **YOK** (state var, UI yok) |
| MP context ekranda | Kısmen (şablon satırında MP adı) |
| Şablon listesi context filtresi | **YOK** (tüm şablonlar) |
| XML A şablonları vs XML B | **YOK** (filtre yok) |

## LISTING PRECEDENCE

- İstenen: Ürün > Kategori > Genel (`ListingTemplate`). **MEVCUT DEĞİL.**
- Mevcut olan: yalnızca `MarketplacePricingRule` (fiyat kuralı) için PRODUCT→CATEGORY→GENERAL.
- `templateMatch` import'ta otomatik `true` → "şablon yoksa WAITING" kuralı hiç çalışmıyor.

## 4/4 SEND GATE

- `isReady` 4/4 (category/brand/variant/template) mevcut; ama `templateMatch` sahte `true` olduğu için LISTING ayağı anlamlı değil.
- "3/4 hazır — Varyant eksik" görsel durum şeridi **YOK**.

## 3 SECOND UX TEST

- XML/MP göstergesi: global indicator var; Listing'e yansımıyor.
- "Hangi XML'i hangi MP'ye hazırlıyorum" → Category/Brand/Variant'te iyileşti; **Listing'de hâlâ FAIL**.

## RED TEAM

| Test | Sonuç |
|------|-------|
| XML A→B sızma (context) | PARTIAL (frontend senkron; Listing filtresiz) |
| MP değişimi sızma | PARTIAL |
| Duplicate auto-match | KAPATILDI (guard) |
| Stale polling | KAPATILDI (timer temizleme) |
| Progress geriye gitme | KAPATILDI (%100 sabit) |
| Variant global stats/auto-detect | KAPATILDI (xmlSourceId) |
| Şablon önceliği yanlış seçim | **AÇIK** (precedence yok) |
| Şablon yokken gönderim | **AÇIK** (templateMatch sahte true) |
| Sahte 1 TL fiyat | **AÇIK** (listingEngine basePrice<=0→1) |
| Negatif/0 fiyat fail-closed | **AÇIK** (guard yok) |

## TEST RESULTS / TSC / BUILD / REGRESSION

- `npx tsc -p server/tsconfig.json --noEmit` → **PASS** (önceki tur; bu tur backend değişmedi)
- `npm run build` → **PASS**
- [`rt-p0-test.ts`](server/rt-p0-test.ts:1) → **44 PASS, 0 FAIL**
- [`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1) → **28 PASS, 0 FAIL**

## AFFECTED FILES (önceki gap closure, bu tur tekrar doğrulandı)

[`index.html`](index.html:1854) · [`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:63)

## LOCKED FILES (bu turun bulguları için değişiklik gerektiren ama dokunulmayan)

[`xmlImport.ts`](server/src/services/xmlImport.ts:571) (templateMatch sahte true) ·
[`listingEngine.ts`](server/src/services/listingEngine.ts:121) (şablon önceliği + sahte 1 TL) ·
[`prepListings.ts`](server/src/routes/prepListings.ts:67) (şablon listesi context filtresi) ·
[`readiness.ts`](server/src/services/readiness.ts:108) (4/4 gate görsel) ·
[`schema.prisma`](server/prisma/schema.prisma:1)

## REMAINING RISKS

1. Listing şablon önceliği (Ürün>Kategori>Genel) uygulanmadı — LOCK CONFLICT.
2. `templateMatch` import'ta otomatik `true` — 4/4 gate'in LISTING ayağı anlamlı değil — LOCK CONFLICT.
3. Listing context banner + şablon listesi xmlSourceId/marketplaceId filtresi yok.
4. Sahte `1 TL` fiyat fallback ve fiyat fail-closed guard yok.
5. Hedef MP ağaçları boş (mapping verisi + getBrands/getCategoryTree/getCategoryAttributes entegrasyonu yok).
6. `AKYI` varyant whitelist'i yok.

## FINAL VERDICT

```
FAIL — LIVE SEND BLOCKED
```

Canlı API çağrısı yapılmadı. Workspace context/progress/Variant düzeltmeleri tamamlandı; ancak Listing şablon önceliği,
`templateMatch` sahte true, fiyat fail-closed ve hedef MP ağaçları kilitli dosyalar + veri eksikliği nedeniyle tamamlanmadı.
Bu eksikler giderilmeden canlı gönderime geçilemez. Sahte PASS/ID üretilmedi.
