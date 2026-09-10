# TRENDYOL GAP CLOSURE RAPORU — RED TEAM SONRASI

**Tarih:** 15.08.2026 · **Canlı API çağrısı:** YOK · **Gerçek ürün gönderimi:** YOK · **DB schema/migration/seed:** YOK
**Kilitli dosya değişikliği:** YOK · **Git işlemi:** YOK (yalnızca read-only `git status/diff`)

---

## ROOT CAUSE

Trendyol resmi V2 sözleşmesi (`developers.trendyol.com`) ile mevcut [`TrendyolAdapter`](server/src/services/marketplace/adapters.ts) arasındaki uyumsuzluk iki katmanlıdır:

1. **Adapter katmanı:** flat JSON payload, eski endpoint `.../suppliers/{sellerId}/products`, `barcode`→external ID kabulü, `User-Agent` eksikliği.
2. **Veri/mapping katmanı:** numeric `categoryId` (CategoryMapping: 0 kayıt), numeric `brandId` (Brand.externalId: 0/17), kategori `attributes[]` mapping altyapısı (yok), `dimensionalWeight` ve `listPrice` kaynağı (yok) — bu yüzden payload'un zorunlu alanları güvenli doldurulamaz.

---

## CRITICAL FINDINGS

| ID | Bulgu | Durum |
|----|-------|-------|
| C-1 | Adapter resmi V2 şema/endpoint/User-Agent dışında | **FIXED** |
| C-2 | `barcode` → external ID kabulü (batchRequestId ≠ listingId) | **FIXED** |
| C-3 | Mapping yokken provider'a istek gitmesi | **FIXED** (gate eklendi) |
| C-4 | Category mapping verisi yok (0 kayıt) | **UNFIXED** (veri eksikliği; canlı engellenir) |
| C-5 | Brand numeric ID yok (0/17) | **UNFIXED** |
| C-6 | Attributes mapping altyapısı + verisi yok | **UNFIXED** |
| C-7 | `dimensionalWeight` kaynağı yok | **UNFIXED** |
| C-8 | `listPrice` kaynağı yok | **UNFIXED** |

---

## HIGH FINDINGS

| ID | Bulgu | Durum |
|----|-------|-------|
| H-1 | `isReady` barcode/fiyat/stok/görsel kontrolü yapmıyor | **UNFIXED** (kilitli [`readiness.ts`](server/src/services/readiness.ts:108); DB'de şu an 0 occurrence) |
| H-2 | [`readyToShip.ts`](server/src/routes/readyToShip.ts:203) `/send` requireRole yok | **UNFIXED** (kilitli dosya) |
| H-3 | Testler V2'ye göre eskiydi | **FIXED** ([`rt-p0-test.ts`](server/rt-p0-test.ts:181) güncellendi) |
| H-4 | `Variant.name="AKYI"` 13.382 bozuk kayıt | **UNFIXED** (veri; attribute whitelist uygulama aşamasında gerekli) |
| H-5 | `apiUrl` eski + `apiStatus='connected'` yanıltıcı | **PARTIAL FIXED** (adapter DB apiUrl'yi bypass eder; DB değeri değişmedi) |

---

## MEDIUM FINDINGS

| ID | Bulgu | Durum |
|----|-------|-------|
| M-1 | Frontend double-click koruması yok | **UNFIXED** (backend idempotent) |
| M-2 | Stale mapping guard yok | **UNFIXED** |
| M-3 | http:// image URL (Trendyol https zorunlu) | **UNFIXED** (veri) |
| M-4 | 6.094 takılı `PENDING` state (kaynağı NOT VERIFIED) | **UNFIXED** (read-only; DB değiştirilmedi) |
| M-5 | `npm test` scripti yok | **NOT VERIFIED** (testler `npx tsx rt-*.ts` ile çalışır) |

---

## LOW FINDINGS

| ID | Bulgu | Durum |
|----|-------|-------|
| L-1 | DNS rebinding TOCTOU (kodda kabul edilmiş) | **UNFIXED** |
| L-2 | Cookie `secure:false` (localhost; prod riski) | **UNFIXED** |

---

## FALSE POSITIVES

- `apiStatus='connected'` → gerçek doğrulama yok (NOT VERIFIED).
- Eski test `parseResponse(200,{barcode}) → ok=true` → resmi V2'ye göre yanlış pozitifti; **kaldırıldı**.

---

## FIXED FINDINGS (bu tur uygulanan, kilit dışı)

1. **Adapter resmi V2** ([`adapters.ts`](server/src/services/marketplace/adapters.ts:104)):
   - Endpoint: `https://apigw.trendyol.com/integration/product/sellers/{sellerId}/v2/products` (DB'deki eski `apiUrl` bypass edilir; `stage` işaretiyle STAGE base seçilir)
   - `User-Agent: {sellerId} - SelfIntegration`
   - Payload: `{ items: [ { barcode, title, productMainId, brandId, categoryId, quantity, stockCode, dimensionalWeight, description, listPrice, salePrice, vatRate, images:[{url}], attributes } ] }`
   - `currencyType` üretilmez (resmi şemada yok)
   - `parseResponse`: 2xx + `batchRequestId` → `ok=true, externalListingId=null, batchRequestId`; `batchRequestId` yoksa `PARSE_ERROR`; `barcode` asla listingId kabul edilmez.
2. **Mapping gate** ([`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:134)): `tt` için numeric `categoryId` → numeric `brandId` → `attributes` zinciri çözümlenemezse `MAPPING_NOT_FOUND`; provider'a istek GİTMEZ (SAHTE ID üretilmez).
3. **Async güvenli davranış** ([`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:182)): `batchRequestId` alınınca `ACTIVE` üretilmez; state `SENDING` + `externalRef=batchRequestId`, sonuç `APPROVAL_PENDING`.
4. **Hata sözleşmesi** ([`errors.ts`](server/src/services/marketplace/errors.ts:60)): `MAPPING_NOT_FOUND`, `DATA_MISSING`, `APPROVAL_PENDING`.
5. **Tipler** ([`types.ts`](server/src/services/marketplace/types.ts:21)): Trendyol V2 alanları + `batchRequestId`.
6. **Test güncelleme** ([`rt-p0-test.ts`](server/rt-p0-test.ts:181)): `barcode→ID` yanlış beklentisi kaldırıldı; `batchRequestId` davranışı eklendi.
7. **Yeni mock red team testi** ([`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1)): payload şeması + parseResponse + 3 katmanlı mapping gate + "provider'a istek gitmedi" doğrulaması.

---

## UNFIXED FINDINGS (canlı gönderimi bloke eden, veri/altyapı kaynaklı)

- Category mapping verisi (0 kayıt) → numeric `categoryId` üretilemiyor.
- Brand `externalId` (0/17) → numeric `brandId` üretilemiyor.
- Kategori-özellik (attributes) çözümleme servisi yok → `attributeId`/`attributeValueId` üretilemiyor.
- `dimensionalWeight` + `listPrice` veri kaynağı yok.
- Tam async zincir: batch polling + approved query (`contentId`/`variantId`/`productUrl`) henüz uygulanmadı.

**Bunlar tamamlanmadan canlı gönderim güvenli değildir; sistem `MAPPING_NOT_FOUND`/`DATA_MISSING` ile provider'a ulaşmadan durur (istenen güvenli davranış).**

---

## LOCKED FILE CONFLICTS

**YOK.** Şu dosyalara dokunulmadı: [`schema.prisma`](server/prisma/schema.prisma:1), [`readyToShip.ts`](server/src/routes/readyToShip.ts:1), [`readiness.ts`](server/src/services/readiness.ts:1), [`products.ts`](server/src/routes/products.ts:1), [`dashboard.ts`](server/src/routes/dashboard.ts:1), [`reports.ts`](server/src/routes/reports.ts:1), [`listingV2.ts`](server/src/routes/listingV2.ts:1), [`prepCategories.ts`](server/src/routes/prepCategories.ts:1), [`prepBrands.ts`](server/src/routes/prepBrands.ts:1), [`prepVariants.ts`](server/src/routes/prepVariants.ts:1), [`prepListings.ts`](server/src/routes/prepListings.ts:1), [`aiGateway.ts`](server/src/services/aiGateway.ts:1), [`aiSettings.ts`](server/src/routes/aiSettings.ts:1), [`xmlImport.ts`](server/src/services/xmlImport.ts:1), [`listingEngine.ts`](server/src/services/listingEngine.ts:1).

---

## CHANGED FILES (kilit dışı)

- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts:104) — TrendyolAdapter resmi V2
- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:134) — mapping gate + batchRequestId→SENDING
- [`server/src/services/marketplace/types.ts`](server/src/services/marketplace/types.ts:21) — V2 alanları + batchRequestId
- [`server/src/services/marketplace/errors.ts`](server/src/services/marketplace/errors.ts:60) — yeni hata kodları
- [`server/rt-p0-test.ts`](server/rt-p0-test.ts:181) — test düzeltmesi
- [`server/rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1) — yeni mock red team testi

---

## DATABASE STATE

**DB değiştirilmedi.** Testler yalnızca cleanup'lı sentetik kayıtlar kullandı (son durumda temizlendi). Mevcut durum: `ProductMarketplaceState` 6.094 PENDING (değişmedi); ACTIVE/impossible state/duplicate external ID: 0.

---

## SECURITY RESULTS

| Kontrol | Sonuç |
|---------|-------|
| Credential leak (GET/POST/PUT/error/log/DOM) | **PASS** (rt-p0 44/44) |
| SSRF private/internal block | **PASS** |
| Retry policy (400/401/403/404/409 no-retry; 429/5xx bounded) | **PASS** |
| Idempotency + concurrency (1 gönderim + DUPLICATE) | **PASS** |
| User-Agent + Basic Auth (resmi V2) | **PASS** (adapter) |
| Mapping gate (SAHTE ID yok; provider'a gitmez) | **PASS** (mock) |

---

## TEST RESULTS

| Test | Sonuç |
|------|-------|
| [`rt-p0-test.ts`](server/rt-p0-test.ts:1) | **44 PASS, 0 FAIL** |
| [`rt-send-test.ts`](server/rt-send-test.ts:1) | **21 PASS, 0 FAIL** |
| [`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1) | **28 PASS, 0 FAIL** |
| `npm test` | **NOT VERIFIED** (script tanımlı değil) |

---

## TSC

`npx tsc -p server/tsconfig.json --noEmit` → **PASS**

## BUILD

`npm run build` (vite) → **PASS**

---

## LIVE SEND GATE

- [x] Official endpoint verified (`/product/sellers/{sellerId}/v2/products`)
- [x] Official payload verified (`{items:[...]}` + resmi alanlar)
- [x] Authentication verified (Basic Auth)
- [x] User-Agent verified
- [ ] Category mapping verified — **FAIL** (0 kayıt)
- [ ] Brand mapping verified — **FAIL** (0/17)
- [ ] Attribute mapping verified — **FAIL** (altyapı yok)
- [ ] dimensionalWeight verified — **FAIL** (kaynak yok)
- [ ] listPrice verified — **FAIL** (kaynak yok)
- [x] salePrice verified (DB dolu; validasyon eksik → PARTIAL)
- [ ] Batch lifecycle verified — **PARTIAL** (POST→batchRequestId→SENDING var; polling yok)
- [ ] Batch polling verified — **FAIL**
- [ ] Approved product lookup verified — **FAIL**
- [ ] contentId verified — **FAIL**
- [ ] variantId verified — **FAIL**
- [ ] productUrl verified — **FAIL**
- [x] ACTIVE only after real external verification (batchRequestId ACTIVE üretmez; approved çözümleme yok)
- [x] Retry policy verified
- [x] Idempotency verified
- [x] Concurrency verified
- [x] SSRF verified
- [x] Credential security verified
- [ ] RBAC verified — **FAIL** (readyToShip rol eksik; kilitli)
- [x] Frontend wiring verified (doğru endpoint `/marketplace-send/send`; double-click MEDIUM)
- [x] Error sanitization verified
- [ ] Telemetry sanitization verified — **NOT VERIFIED** (telemetry yok)
- [x] DB state verified
- [x] No fake IDs
- [x] No fake PASS
- [x] No synthetic records (testler cleanup'lı)
- [x] TSC PASS
- [x] Build PASS
- [ ] Red Team PASS — **PARTIAL** (mock geçti; canlı doğrulama yok)

**SONUÇ: 100% PASS sağlanmadı → LIVE SEND = BLOCKED**

---

## SON KARAR

```
FAIL — LIVE SEND BLOCKED
```

Canlı gönderimi engelleyen kritik kontroller (category/brand/attributes mapping verisi, dimensionalWeight, listPrice, async approved-query çözümlemesi) henüz tamamlanmadı. Adapter ve güvenlik katmanı resmi V2 sözleşmesine hizalandı; sistem artık eksik mapping'de provider'a ulaşmadan `MAPPING_NOT_FOUND` üretiyor. Gerçek ürün gönderilmedi, sahte ID/PASS üretilmedi, DB değiştirilmedi, kilitli dosyalara dokunulmadı.
