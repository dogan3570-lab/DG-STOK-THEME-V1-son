# DG STOK CORE — NİHAİ DURUM RAPORU (UX + 4/4 GATE)

**Tarih:** 15.08.2026 · **Canlı API:** YOK · **Ürün gönderimi:** YOK · **Schema/migration/DB write/git:** YOK

## ROOT CAUSE
- Import'ta sahte `categoryMatch/brandMatch/templateMatch=true + READY` üretiliyordu; 4/4 gate anlamlı değildi.
- ListingTemplate önceliği ve fiyat kuralı fail-closed yoktu.
- Global `contextState` alt modüllere bağlı değildi; progress çift mod + stale polling + duplicate start vardı.

## IMPLEMENTED (önceki turların toplamı)
1. [`listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:1) — Ürün > Kategori > Genel > NO_TEMPLATE.
2. [`listingPriceResolver.ts`](server/src/services/listingPriceResolver.ts:1) — KDV dahil formül + fail-closed.
3. [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:135) — gerçek listing + fiyat gate; provider'a erken request YOK.
4. [`adapters.ts`](server/src/services/marketplace/adapters.ts:104) — Trendyol V2 payload/endpoint/User-Agent + `batchRequestId ≠ listingId`.
5. [`index.html`](index.html:1854) — context sync + progress monoton + duplicate guard + stale polling temizliği + `status=XML` kaldırma.
6. [`prepVariants.ts`](server/src/routes/prepVariants.ts:63) — `stats`/`auto-detect` `xmlSourceId` context.

## CHANGED FILES
[`listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:1) · [`listingPriceResolver.ts`](server/src/services/listingPriceResolver.ts:1) · [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:135) · [`adapters.ts`](server/src/services/marketplace/adapters.ts:104) · [`types.ts`](server/src/services/marketplace/types.ts:21) · [`errors.ts`](server/src/services/marketplace/errors.ts:60) · [`index.html`](index.html:1854) · [`prepVariants.ts`](server/src/routes/prepVariants.ts:63) · testler (rt-p0, rt-send, rt-trendyol-v2, rt-listing-template, rt-listing-price)

## LOCKED FILES (dokunulmadı)
[`schema.prisma`](server/prisma/schema.prisma:1) · [`xmlImport.ts`](server/src/services/xmlImport.ts:568) · [`listingEngine.ts`](server/src/services/listingEngine.ts:146) · [`readiness.ts`](server/src/services/readiness.ts:108) · [`prepListings.ts`](server/src/routes/prepListings.ts:1) · [`prepCategories.ts`](server/src/routes/prepCategories.ts:1) · [`prepBrands.ts`](server/src/routes/prepBrands.ts:1) · [`readyToShip.ts`](server/src/routes/readyToShip.ts:1) · [`products.ts`](server/src/routes/products.ts:1) · [`reports.ts`](server/src/routes/reports.ts:1) · [`dashboard.ts`](server/src/routes/dashboard.ts:1) · [`listingV2.ts`](server/src/routes/listingV2.ts:1)

## 4/4 STATUS
Gönderim anında gerçek zincir: READY 4/4 → (tt: mapping gate) → listing template resolver → fiyat kuralı → fiyat>0. Şablon/kural/geçerli fiyat yoksa provider'a gitmez. **Runtime gate: PASS.** Ancak görsel "4/4 durum şeridi" eklenmedi (kilitli `readiness.ts` + frontend).

## CATEGORY STATUS
`status=XML` kaldırıldı (eşleşenler görünür); progress monoton; duplicate/stale polling korumalı. **Hedef MP ağacı boş** (CategoryMapping 0).

## BRAND STATUS
XML filtresi var; MP marka sistemi ve `Brand.externalId` yok (veri eksik).

## VARIANT STATUS
`stats`/`auto-detect` context'li; `AKYI` whitelist'i hâlâ yok.

## LISTING STATUS
Resolver + fiyat gate tamam; **UI context banner ve şablon listesi context filtresi yok** (kilitli `prepListings.ts`).

## PRICE ENGINE
`vatIncludedPurchasePrice × (1+pct/100) + fixedAmount`; 500→630 doğrulandı; AMBIGUOUS/NOT_FOUND/DATA_MISSING fail-closed; sahte 1 TL yok (izole resolver). Kilitli `listingEngine.ts` içindeki eski `basePrice<=0→1` preview'de duruyor.

## CONTEXT ISOLATION
Frontend global `contextState` senkronizasyonu + poll/timer temizliği + resolver marketplace scoped. Yanlış MP şablonu sızmaz (test PASS). **Refresh sonrası kalıcılık yok** (memory-only).

## 3-SECOND UX TEST
- XML/MP göstergesi: global `context-label` "XML + MP" gösterir (PASS kısmi).
- Dört işlem durumu (Category/Brand/Variant/Listing ✅/⚠) + "Neden geçemiyorum" özeti: **YOK**.
- **3 SECOND UX: FAIL (kısmi)** — Listing banner'ı ve 4'lü durum şeridi eksik.

## RED TEAM
- Product>Category>General: PASS · yanlış MP şablon: PASS · NO_TEMPLATE→engel: PASS · sahte templateMatch bypass: KAPATILDI · fiyat fail-closed: PASS · duplicate/concurrency: PASS · batchRequestId≠listingId: PASS · 401/429/5xx/timeout: PASS · credential leak: PASS.
- AÇIK: import sahte match flag'leri (kilitli), `basePrice<=0→1` preview (kilitli), `AKYI` whitelist, Listing UI context.

## TSC
`npx tsc -p server/tsconfig.json --noEmit` → **PASS**

## BUILD
`npm run build` → **PASS**

## REGRESSION
rt-p0 **44** · rt-send **21** · rt-trendyol-v2 **28** · rt-listing-template **9** · rt-listing-price **27** — **tümü PASS, 0 FAIL**.

## REMAINING RISKS
1. Import sahte `categoryMatch/brandMatch/templateMatch` (kilitli `xmlImport.ts`).
2. `basePrice<=0→1` preview/simulate (kilitli `listingEngine.ts`).
3. Listing UI context banner + 4'lü durum şeridi + refresh kalıcılığı yok.
4. Mapping verisi (CategoryMapping 0, Brand.externalId 0) + hedef MP ağaçları yok → canlı gönderim `MAPPING_NOT_FOUND`.
5. `AKYI` varyant whitelist'i yok.

## FINAL VERDICT
```
FAIL — LIVE SEND BLOCKED
```
**3 SECOND UX: FAIL** · **4/4 GATE: PASS (runtime)** · **LIVE SEND: BLOCKED**

Canlı marketplace API çağrısı YAPILMADI. Backend çekirdeği (şablon önceliği, KDV dahil fail-closed fiyat, gerçek listing+fiyat gate, Trendyol V2 adapter, context izolasyonu) tamamlandı ve test edildi. Kalan eksikler kilitli dosyalar (import flag'leri, fiyat preview fallback, Listing/readiness UX) ve mapping verisi nedeniyledir. Sahte PASS/READY/ACTIVE/ID üretilmedi.
