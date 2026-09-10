# CORE LISTING PRICE + GERÇEK 4/4 GATE — UYGULAMA + RED TEAM RAPORU

**Tarih:** 15.08.2026 · **Canlı API:** YOK · **Ürün gönderimi:** YOK · **Schema/migration/DB write/git:** YOK

## ROOT CAUSE
- `templateMatch` import'ta sahte `true`; gerçek şablon çözümlemesi yoktu.
- ListingTemplate önceliği (Ürün>Kategori>Genel) yoktu.
- Fiyat kuralı fail-closed yoktu; `basePrice<=0→1` sahte fiyat riski (kilitli `listingEngine.ts`).
- 4/4 gate, sahte flag'lere dayanıyordu.

## CHANGED FILES (bu tur)
- [`server/src/services/listingPriceResolver.ts`](server/src/services/listingPriceResolver.ts:1) — YENİ: KDV dahil alış → `× (1+pct/100) + fixedAmount`; fail-closed (DATA_MISSING / RULE_NOT_FOUND / RULE_AMBIGUOUS); negatif/0/NaN/Infinity red.
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:135) — gerçek listing gate (TEMPLATE_NOT_FOUND) + fiyat gate (fail-closed), tt mapping gate'inden sonra doğru sırada.
- [`server/src/services/listingTemplateResolver.ts`](server/src/services/listingTemplateResolver.ts:1) — önceki tur; bu turda sıra düzeltmesiyle korundu.
- [`server/rt-listing-price-test.ts`](server/rt-listing-price-test.ts:1) — YENİ (27 senaryo).
- [`server/rt-send-test.ts`](server/rt-send-test.ts:124) — sentetik şablona fiyat kuralı + purchasePrice.

## LOCKED FILES (dokunulmadı)
[`xmlImport.ts`](server/src/services/xmlImport.ts:568) · [`listingEngine.ts`](server/src/services/listingEngine.ts:146) · [`readiness.ts`](server/src/services/readiness.ts:108) · [`prepListings.ts`](server/src/routes/prepListings.ts:1) · [`schema.prisma`](server/prisma/schema.prisma:1)

## LISTING TEMPLATE RESULT
PRODUCT → CATEGORY → GENERAL → NO_TEMPLATE; marketplace context scoped. **9 PASS** (yeni test dahil).

## PRICE ENGINE RESULT
- Formül: `vatIncludedPurchasePrice × (1+profitMargin/100) + fixedAmount` (KDV ikinci kez eklenmez).
- **500 → 630** doğrulandı; boundary (0, 0.01, 100, 499.99, 500, 500.01, 1000, 1000.01) geçti.
- Çakışan bant → `PRICE_RULE_AMBIGUOUS`; kural yok → `PRICE_RULE_NOT_FOUND`; geçersiz fiyat → `PRICE_DATA_MISSING`. **27 PASS.**

## 4/4 GATE RESULT
Gönderim anında gerçek zincir: READY 4/4 → (tt: mapping gate) → listing template → fiyat kuralı → fiyat>0. Şablon/kural/geçerli fiyat yoksa **provider'a istek GİTMEZ**.

## CATEGORY RESULT
Mapping verisi yok (0 kayıt) → tt gönderimi `MAPPING_NOT_FOUND` (sahte ID yok). Frontend `status=XML` kaldırıldı (eşleşenler görünür). Hedef MP ağacı hâlâ boş.

## BRAND RESULT
`Brand.externalId` 0 dolu → tt `MAPPING_NOT_FOUND`. MP marka sistemi yok (kilitli `prepBrands.ts` + veri).

## VARIANT RESULT
`stats`/`auto-detect` artık `xmlSourceId`'li (önceki tur). `AKYI` whitelist'i hâlâ yok.

## CONTEXT ISOLATION RESULT
Frontend global context sync + progress monoton + duplicate/stale polling koruması (önceki tur). Resolver marketplaceId scoped; yanlış MP şablonu sızmaz (test PASS).

## RED TEAM RESULT
- Product>Category>General: PASS · yanlış MP şablon sızması: PASS · NO_TEMPLATE→engel: PASS · sahte templateMatch bypass: KAPATILDI · sahte 1 TL: izole fiyat resolver'da YOK (fail-closed) · duplicate/concurrency: PASS (rt-send).
- AÇIK: import sahte `categoryMatch/brandMatch/templateMatch` (kilitli); `basePrice<=0→1` preview'de (kilitli).

## REGRESSION RESULT
`rt-p0-test` 44 PASS · `rt-send-test` 21 PASS · `rt-trendyol-v2-test` 28 PASS · `rt-listing-template-test` 9 PASS · `rt-listing-price-test` 27 PASS.

## TSC
`npx tsc -p server/tsconfig.json --noEmit` → **PASS**

## BUILD
`npm run build` → **PASS**

## LIVE API STATUS
`REAL MARKETPLACE SEND = DISABLED` — canlı API çağrısı YAPILMADI.

## REMAINING RISKS
1. Import sahte `categoryMatch/brandMatch/templateMatch` (kilitli `xmlImport.ts`).
2. `basePrice<=0→1` preview/simulate'de (kilitli `listingEngine.ts`).
3. Listing UI context banner + şablon listesi filtresi yok (kilitli `prepListings.ts`).
4. Mapping verisi (CategoryMapping 0, Brand.externalId 0) + hedef MP ağaçları yok → canlı gönderim `MAPPING_NOT_FOUND`.
5. Eski 5.526 READY kaydı topluca güncellenmedi (kullanıcı yasağı); runtime gate koruyor.

## FINAL VERDICT
```
FAIL — LIVE SEND BLOCKED
```
Canlı API çağrısı yapılmadı. Listing şablon önceliği, KDV dahil fiyat motoru (fail-closed) ve gönderim anındaki gerçek listing+fiyat gate'i tamamlandı ve test edildi. Ancak import sahte match flag'leri (kilitli), fiyat preview fallback'i (kilitli) ve mapping verisi eksikliği nedeniyle canlı gönderim engellidir. Sahte PASS/READY/ACTIVE/ID üretilmedi.
