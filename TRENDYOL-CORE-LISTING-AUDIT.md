# CORE LISTING + 4/4 GATE — LOCKED GAP CLOSURE (READ-ONLY + PLAN)

**Tarih:** 15.08.2026 · **Canlı API:** YOK · **Ürün gönderimi:** YOK · **Schema/migration/seed/DB write/git:** YOK
Bu tur kod değişikliği YAPILMADI; yalnızca çekirdek analiz ve plan üretildi (kilitli dosyalar + geniş etki).

---

## 1. PLAN

1. `templateMatch` ve `categoryMatch`/`brandMatch` sahte üretimini kanıtla.
2. `calculatePrice` (`basePrice<=0→1`) çağrı zincirini ve etkisini belirle.
3. ListingTemplate öncelik kuralının (Ürün>Kategori>Genel) mevcut durumunu doğrula.
4. Fiyat motorlarını (4 ayrı yol) haritala.
5. Kilit dışı güvenli düzeltme varsa öner; yoksa LOCK CONFLICT raporla.

## 2. ROOT CAUSE

- [`xmlImport.ts:568-573`](server/src/services/xmlImport.ts:568) import sırasında **`categoryMatch: true`, `brandMatch: true`, `templateMatch: true`, `status: 'READY'`** yazıyor. Yani 4/4 READY, gerçek eşleşme/şablon çözümlemesi olmadan import anında üretiliyor.
- `categoryId: categoryId || defaultCategory.id` ve `brandId: brandId || defaultBrand.id` → kategori/marka eşleşmesi de "default" kayda bağlanarak sahte true oluyor.
- ListingTemplate öncelik zinciri (Ürün>Kategori>Genel) **yok**; `templateMatch` hiçbir şablona bağlı değil.
- [`listingEngine.ts:146`](server/src/services/listingEngine.ts:146) `basePrice <= 0 → 1` → fiyat yokken sahte 1 TL (yalnızca preview/simulate yolunda).

## 3. DATA IMPACT

- 13.404 ürün import'ta `READY` işaretleniyor; 5.526'sı `READY_FILTER` ile "gönderime hazır" görünüyor. Bu sayı, gerçek listing şablonu çözümlemesiyle değil, import varsayılanlarıyla oluşuyor.
- `ProductMarketplaceState` 6.094 `PENDING` (import sırasında `createMany` ile her aktif MP'ye bağlanıyor — [`xmlImport.ts:605-618`](server/src/services/xmlImport.ts:605)).
- Bu turda hiçbir veri değiştirilmedi.

## 4. CONTEXT MODEL

- Global `contextState` + `syncLocalContextSelectors` (önceki tur) dört modülü bağlıyor.
- Listing şablonları **context filtresiz** listeleniyor ([`prepListings.ts:69`](server/src/routes/prepListings.ts:69)); `apply-all` xmlSourceId alıyor ama tablo global.

## 5. LISTING TEMPLATE MODEL (hedef)

```text
resolveListingTemplate(productId, categoryId, brandId, marketplaceId):
  1. ListingTemplate where { marketplaceId, productId }      → PRODUCT
  2. yoksa { marketplaceId, categoryId }                      → CATEGORY
  3. yoksa { marketplaceId, productId:null, categoryId:null }→ GENERAL
  4. yoksa → TEMPLATE_NOT_FOUND / WAITING
```
Not: `ListingTemplate.productId/categoryId/brandId` alanları şemada mevcut; **schema değişikliği gerekmez**. `Product.templateId` kalıcı alanı yok; çözümleme runtime'da yapılmalıdır.

## 6. TEMPLATE PRIORITY

| Senaryo | Beklenen | Mevcut |
|---------|----------|--------|
| Ürün=A, Kategori=B, Genel=C | A | **yok** (seçim mekanizması yok) |
| Ürün kaldırılır | B | yok |
| Kategori kaldırılır | C | yok |
| Hiçbiri yok | WAITING | **FAIL** (templateMatch hâlâ true) |

## 7. PRICE ENGINE (4 ayrı yol)

| Yol | Dosya | Kaynak fiyat | Kullanım |
|-----|-------|--------------|----------|
| 1 | [`listingEngine.ts:121`](server/src/services/listingEngine.ts:121) `calculatePrice` | `priceSource` (XML_PURCHASE vs) + `priceRangeRules` | preview/simulate |
| 2 | [`prepListings.ts:13`](server/src/routes/prepListings.ts:13) local `calculatePrice` | purchasePrice>0 ? purchasePrice : salePrice | price-preview/apply-all |
| 3 | [`listingV2.ts:27`](server/src/routes/listingV2.ts:27) `calculatePriceV5` | purchasePrice + profitMargin/rounding | listing-v2 |
| 4 | [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:139) | `salePrice ?? purchasePrice ?? 0` | gerçek gönderim |

- `basePrice<=0→1` yalnızca Yol 1'de (preview/simulate); **gönderim fiyatı Yol 4'ten** gelir.
- `apply-all` (Yol 2) `purchasePrice { not:null, gt:0 }` filtresiyle 0/negatif alış fiyatını zaten dışlar (kısmi fail-closed var).
- İkili motor kullanıcıda "hangi fiyat geçerli" belirsizliği yaratır; bu raporda NOT VERIFIED.

## 8. 4/4 GATE

- `isReady` = status READY + categoryMatch + brandMatch + templateMatch + variant. Ama categoryMatch/brandMatch/templateMatch import'ta sahte `true` → gate şu an **anlamlı değil**.
- Gerçek gate için: `templateMatch` yerine runtime `resolveListingTemplate` sonucu + mapping numeric ID doğrulaması gerekir.

## 9. CATEGORY / BRAND / VARIANT REGRESSION

Önceki turlarda uygulananlar (doğrulandı): context sync, `status=XML` kaldırma, progress monoton + duplicate guard + stale polling temizliği, Variant stats/auto-detect `xmlSourceId`. Bu turda değiştirilmedi.

## 10. 3 SECOND UX TEST

- XML/MP göstergesi: global var; Listing'de yansımıyor → **Listing FAIL**.
- "Hangi XML → hangi MP" → Category/Brand/Variant iyileşti; Listing hâlâ FAIL.

## 11. RED TEAM (bu tur bulguları)

| Test | Sonuç |
|------|-------|
| Sahte templateMatch | **AÇIK** (import'ta true) |
| Şablon önceliği yanlış seçim | **AÇIK** (mekanizma yok) |
| Şablon yokken gönderim | **AÇIK** (templateMatch sahte true) |
| Sahte 1 TL fiyat | **AÇIK** (Yol 1 preview) |
| Negatif/0/NaN fiyat fail-closed | **KISMEN** (apply-all gt:0 var; preview/send yok) |
| Context leak (XML/MP) | Kısmen kapatıldı (önceki tur); Listing filtresiz |
| Duplicate/stale polling/progress geriye gitme | KAPATILDI (önceki tur) |

## 12. TEST RESULTS

- [`rt-p0-test.ts`](server/rt-p0-test.ts:1): **44 PASS, 0 FAIL**
- [`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts:1): **28 PASS, 0 FAIL**
- Listing precedence/templateMatch/fiyat fail-closed için **test YOK** (gerekli — kilitli dosyalar değişmeden eklenemez).

## 13. TSC

`npx tsc -p server/tsconfig.json --noEmit` → **PASS**

## 14. BUILD

`npm run build` → **PASS**

## 15. REGRESSION

Bu tur kod değişmedi → önceki regression sonuçları geçerli (44 + 28 PASS).

## 16. CHANGED FILES

Bu tur: **YOK** (READ-ONLY).

## 17. LOCKED FILES (düzeltme gerektiren, dokunulmadı)

[`xmlImport.ts`](server/src/services/xmlImport.ts:568) (sahte categoryMatch/brandMatch/templateMatch) ·
[`listingEngine.ts`](server/src/services/listingEngine.ts:146) (sahte 1 TL) ·
[`readiness.ts`](server/src/services/readiness.ts:108) (4/4 gate) ·
[`prepListings.ts`](server/src/routes/prepListings.ts:67) (şablon context filtresi + öncelik)

## 18. SCHEMA / MIGRATION STATUS

**SCHEMA DEĞİŞİKLİĞİ GEREKMEDİ.** `ListingTemplate.productId/categoryId/brandId` alanları mevcut; `resolveListingTemplate` runtime servisi ile öncelik uygulanabilir. `Product.templateId` kalıcı alanı istenirse ayrıca SCHEMA GAP olarak onay gerektirir (bu turda önerilmiyor).

## 19. REMAINING RISKS

1. `templateMatch`/`categoryMatch`/`brandMatch` import'ta sahte true — 4/4 gate anlamlı değil (LOCK CONFLICT).
2. ListingTemplate öncelik zinciri yok (LOCK CONFLICT).
3. Listing şablon listesi context filtresiz (LOCK CONFLICT).
4. `basePrice<=0→1` preview/simulate'de sahte fiyat (LOCK CONFLICT).
5. Hedef MP ağaçları boş; mapping verisi yok → canlı gönderim `MAPPING_NOT_FOUND` bloke.
6. Fiyat motoru ikiliği (4 yol) — dokümante edilmeli.

## 20. FINAL VERDICT

```
FAIL — FIX REQUIRED
```

Canlı marketplace API çağrısı YAPILMADI. Çekirdek 4/4 gate şu an gerçek şablon/eşleşme çözümlemesine dayanmıyor;
`templateMatch`/`categoryMatch`/`brandMatch` import varsayılanlarıyla sahte `true` üretiliyor ve ListingTemplate
öncelik zinciri yok. Düzeltme kilitli dosyaları ([`xmlImport.ts`](server/src/services/xmlImport.ts:1),
[`listingEngine.ts`](server/src/services/listingEngine.ts:1), [`readiness.ts`](server/src/services/readiness.ts:1),
[`prepListings.ts`](server/src/routes/prepListings.ts:1)) gerektirir; etki geniş olduğu için değişiklik yapılmadı.
Canlı gönderim ayrıca mapping/veri eksikliğiyle de engellidir. Sahte PASS/READY/ACTIVE/ID üretilmedi.
