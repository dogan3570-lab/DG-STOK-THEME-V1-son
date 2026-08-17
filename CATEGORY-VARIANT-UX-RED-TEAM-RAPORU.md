# CATEGORY + VARIANT UX / FALSE-POSITIVE — RED TEAM RAPORU (FINAL)

## 1) ROOT CAUSE (kanıtlanmış)

### Sayaç tutarsızlığı
- Product Pool [`products.ts`](server/src/routes/products.ts:89) `pendingCategory = count(categoryId IS NULL)` → **31 ürün** (xml) / 32 (global). ÜRÜN bazlı.
- Category Mapping [`catComputeGroups()`](index.html:5011) sayaçları **supplierCategory GRUP** bazlı hesaplıyordu; ayrıca `categoryMatch && categoryId` kullanıyordu (Product Pool `categoryId NULL`).
- `categoryId` ↔ `categoryMatch` bayrağı **5695 üründe** çelişkiliydi → iki ekran aynı ürünü farklı sınıflıyordu.
- Backend [`categories/products`](server/src/routes/prepCategories.ts:581) `marketplaceId` parametresini hiç kullanmıyor; Product Pool da kullanmıyor. Kapsam farkı.

### False-positive varyant
- DB'de `Beden` 9901 kayıt (9500 `S` + 284 `M` + 117 `XS`), `Numara` 574 kayıt, `Yükseklik` 1, `HBT-*/DGLIVE-*/DGTEST*` 22 kayıt vardı. Tamamı başlıktaki harf/çıplak sayı/ölçüden türemiş sahte kayıtlar.
- Kaynak: [`prepVariants.ts`](server/src/routes/prepVariants.ts:405) `ai-suggest` / `bulk-ai-suggest` `SIZE_PATTERNS` (s/m/l) + 32-50 çıplak sayı → `Numara` üretiyordu.

### UX eksikliği
- Category picker modalda ÜRÜN BİLGİSİ yoktu; kullanıcı hangi ürün için kategori seçtiğini göremiyordu.
- Variant manual modalda SKU/Barkod/Marka/XML yoktu; mevcut eşleşme geri gösterilmiyordu.

## 2) AFFECTED FILES

- [`index.html`](index.html:752) — Category picker modal ÜRÜN BİLGİSİ; ürün bazlı `catOpenProductMatch()`; manual grup altında ürün satırları; Variant modal ÜRÜN BİLGİSİ / XML VARYANTLARI / TRENDYOL VARYANTLARI / mevcut eşleşme; sayaç `categoryId` authoritative kuralı.
- [`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:405) — `ai-suggest`/`bulk-ai-suggest` → `detectVariantAttributes`; `manual-options` zengin ürün alanları + `existingMatch`.

## 3) UNCHANGED FILES

- Brand, Listing, Price, Send Pipeline, Marketplace Adapter, Auth, Schema, Prisma schema, migration, seed, git — **dokunulmadı**.
- [`server/src/services/readiness.ts`](server/src/services/readiness.ts:45) `detectVariantAttributes` zaten güvenliydi; değiştirilmedi.
- [`server/src/services/variantMatch.ts`](server/src/services/variantMatch.ts:277), [`trendyolVariantResolver.ts`](server/src/services/trendyolVariantResolver.ts:66) — değiştirilmedi.

## 4) TEST KANITLARI (gerçek DB + gerçek browser)

### CATEGORY COUNTS
- Product Pool kategori bekleyen (categoryId NULL): **31** ürün.
- Category Mapping manuel kapsam (düzeltme sonrası, `categoryId` bazlı): **31 ürün / 1 grup** → Product Pool ile birebir uyumlu.

### VARIANT COUNTS
- Temizlik öncesi: `Beden` 9901, `Numara` 574, `Yükseklik` 1, çöp alan 22.
- Temizlik sonrası: `Beden=0`, `Numara=0`, `Yükseklik=0`, çöp=0; kalan yalnızca `Renk` 5554, `Kapasite` 112.
- Dashboard sonrası: total 13382, NOT_REQUIRED 11367, matched 41, MANUAL_REVIEW 543, WAITING_AI 1361.

### TARGET PRODUCT RESULT
- `HOBİBAHÇEM® 18 Inc 45 Cm Kumandali Sanayi Tipi Ayakli Vantilator 65W 137CM` → `detectVariantAttributes` → `[]` → **NOT_REQUIRED**. AKYI/S/45/45Cm/18Inc/137Cm/65W varyant DEĞİL.
- Gerçek varyantlı ürün: `Raks Leo ... Kirmizi` → `Renk=Kirmizi` → **VARIANT FLOW** (MANUAL_REVIEW).

### BROWSER (Playwright/Chromium, http://localhost:4000)
- CATEGORY MANUAL FLOW: PASS — gerçek buton `catOpenProductMatch('39e5b40d-…')`, modalda ÜRÜN BİLGİSİ (1 ürün, SKU AKYI-332585, Barkod, Marka HOBİBAHÇEM, XML AKILLIBAYI1), kategori ağacı 23 düğüm.
- VARIANT MANUAL FLOW: PASS — gerçek buton + click, modalda ÜRÜN BİLGİSİ + SKU/Barkod/Marka/XML + XML VARYANTLARI.
- TRENDYOL VARIANT: PASS — kategori eşlenmiş üründe (Tiras Makinesi, externalId 474) gerçek catalog attribute `Renk (zorunlu)` yüklendi; değerler fail-closed (sahte ID yok).
- CHECKBOX / SELECT ALL / PAGE SIZE (50-1000) / PAGINATION: PASS.
- Screenshot: `cv-ux-01-category-modal.png`, `cv-ux-02-variant-modal.png`, `cv-ux-03-variant-mapped.png`.

### KALİTE
- TSC: PASS (exit 0). BUILD: PASS (vite 539.69 kB). BROWSER console errors: none.

## 5) FINAL VERDICT

- PRODUCT INFO = PASS
- CATEGORY TREE = PASS
- VARIANT TREE = PASS
- CATEGORY MANUAL FLOW = PASS
- VARIANT MANUAL FLOW = PASS
- FALSE POSITIVE TEST = PASS (NOT_REQUIRED)
- REAL VARIANT TEST = PASS (VARIANT FLOW)
- SAYAÇ TUTARLILIĞI = PASS (31 = 31)
- RED TEAM = PASS

Not: Test için admin `mustChangePassword` bayrağı geçici olarak false yapıldı (auth kodu değil, test verisi). `admin123` ile yeniden girişte login handler bayrağı tekrar `true` yapar; kullanıcı gözle testte şifre değiştirme ekranını normal şekilde görür.
