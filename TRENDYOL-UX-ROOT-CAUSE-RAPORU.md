# CATEGORY / BRAND / VARIANT EŞLEŞTİRME UX — ROOT CAUSE + RED TEAM RAPORU

**Tarih:** 15.08.2026 · **Mod:** ANALİZ (kod değiştirilmedi) · **Frontend:** [`index.html`](index.html:1) · **Backend route'ları:** KİLİTLİ

Bu rapor yalnızca mevcut kodun okunmasıyla üretilmiştir. Canlı UI manipülasyonu yapılmadı; her bulgu satır numarasıyla kanıtlanmıştır.

---

## 1. ROOT CAUSE

Kullanıcının gördüğü iki temel sorun tek kökten beslenir:

1. **Kategori listesi eşleşmemiş ürünlerle kısıtlanmıştır.**
   [`catFetchAll()`](index.html:4794) her zaman `status=XML` parametresiyle `/categories/products` çağırır.
   Backend [`prepCategories.ts`](server/src/routes/prepCategories.ts:598) bu değeri
   `categoryMatch=false AND categoryId=null` filtresine çevirir. Sonuç: **eşleşmiş kategoriler hiçbir zaman ekranda görünmez**;
   [`catComputeGroups()`](index.html:4824) içindeki `auto_matched` dalı ölü koddur çünkü `categoryMatch=true` olan ürün
   zaten sorguda elenmiştir.

2. **"Hedef pazaryeri kategori ağacı" verisi yoktur.**
   [`catFetchAll()`](index.html:4805) `/categories/tree?marketplaceId=...` çağırır. Backend
   [`prepCategories.ts`](server/src/routes/prepCategories.ts:107) tree'yi yalnızca `CategoryMapping`'i olan sistem
   kategorilerine daraltır. `CategoryMapping` tablosu **0 kayıt** olduğundan tree boş döner; Trendyol'un gerçek
   `getCategoryTree` ağacı hiç entegre değildir. Kullanıcı bu yüzden hedef ağacı göremez.

Bu iki kök neden, "kullanıcı hangi XML verisini hangi pazaryerine eşleştirdiğini göremiyor" şikayetinin tamamını açıklar.

---

## 2. CATEGORY SORUNLARI

| # | Sorun | Kanıt |
|---|-------|-------|
| C-1 | Eşleşen kategoriler hiç listelenmiyor | [`index.html:4803`](index.html:4803) `status='XML'` + [`prepCategories.ts:598`](server/src/routes/prepCategories.ts:598) |
| C-2 | Hedef pazaryeri kategori ağacı boş | [`prepCategories.ts:116`](server/src/routes/prepCategories.ts:116) mapping=0 → `where.id in []` |
| C-3 | XML kategori ağacı yok (düz `supplierCategory` string gruplaması) | [`catComputeGroups()`](index.html:4824) |
| C-4 | `limit=1000` — 13.404 ürünün ötesi/bağlamı eksik | [`index.html:4798`](index.html:4798) |
| C-5 | XML/pazaryeri değişince eski sonuç/poll temizlenmiyor | [`catOnXmlSourceChange()`](index.html:4773), [`catOnMarketplaceChange()`](index.html:4786) |
| C-6 | Auto match çift tıklama koruması yok (`autoMatchRunning` kontrol edilmiyor) | [`catAutoMatch()`](index.html:5161) |
| C-7 | `catRequireMarketplace` yalnızca görsel uyarı, buton devre dışı değil | [`catRequireMarketplace()`](index.html:5146) |

---

## 3. BRAND SORUNLARI

| # | Sorun | Kanıt |
|---|-------|-------|
| B-1 | "Hedef pazaryeri marka ağacı" yok — hedef, sistem içi `Brand` + serbest metin | [`prepBrandPreview()`](index.html:5621) `/brands?search=` |
| B-2 | Pazaryeri markası (`getBrands`) entegre değil; `Brand.externalId` doldurulmuyor | [`prepBrands.ts:167`](server/src/routes/prepBrands.ts:167) |
| B-3 | Marketplace seçimi yalnızca `marketplaceKey` olarak taşınıyor; marka eşleşmesi ürün bazında `brandId` (sistem) üzerinden | [`prepBrandSave()`](index.html:5655) |
| B-4 | Eşleşen/eşleşmeyen sayısı net değil (yalnızca ürün listesi) | [`prepBrandRenderProducts()`](index.html:5552) |

---

## 4. VARIANT SORUNLARI

| # | Sorun | Kanıt |
|---|-------|-------|
| V-1 | Progress ring `stats`'tan; `stats` **xmlSourceId filtresiz** (global) | [`prepVariantRender()`](index.html:5886) + [`prepVariants.ts:63`](server/src/routes/prepVariants.ts:63) |
| V-2 | `prepVariantAiMatch` → `/variants/auto-detect` `body:{}` (context/productIds yok) → tüm XML'leri işler | [`index.html:6028`](index.html:6028) + [`prepVariants.ts:164`](server/src/routes/prepVariants.ts:164) |
| V-3 | Pazaryeri attribute sistemi (`getCategoryAttributes`) entegre değil; hedef sabit liste | [`prepVariants.ts:329`](server/src/routes/prepVariants.ts:329) |
| V-4 | `unmatched-products?limit=500` sabit limit | [`index.html:5783`](index.html:5783) |

---

## 5. PROGRESS ROOT CAUSE (kesin mekanizma)

Progress çubuğu [`catRenderProgress()`](index.html:4935) içinde **iki mod** arasında geçiş yapar:

```text
MOD A (live):  catState.autoMatchLive varsa → processed/total  (backend ürün sayacı)
MOD B (percent): matchedProductCount / catState.products.length (status=XML ürünleri)
```

**"Yükselip düşme" zinciri adım adım:**

1. `catAutoMatch` start yanıtından `total = res.progress.totalProducts || 0` alır ([`index.html:5172`](index.html:5172)).
   Backend [`prepCategories.ts:297`](server/src/routes/prepCategories.ts:297) start anında `totalProducts` henüz
   `runAutoMatch` içinde set edilmediği için **0** döner → frontend MOD B'de kalır.
2. 3 sn sonra ilk poll [`index.html:5178`](index.html:5178) → `pr.totalProducts` artık dolu (ürün sayısı) → MOD A'ya geçer.
   Yüzde bir anda farklı bir değere **sıçrar**.
3. `status === 'completed'` olunca ([`index.html:5182`](index.html:5182)):
   - `catFetchAll()` çağrılır; `status=XML` filtresi nedeniyle eşleşen ürünler listeden düşer → `catState.products` küçülür/boşalır.
   - `setTimeout(5000)` ile `autoMatchLive = null` ([`index.html:5187`](index.html:5187)) → MOD B'ye döner.
   - MOD B'de `percent = matchedProductCount / products.length`; products artık eşleşmemiş ürünler olduğu için **percent 0'a düşer**.
4. Ayrıca:
   - **Çift tıklama:** `catAutoMatch` `autoMatchRunning` guard'ı YOK → stepper'a çift tıklamada iki `setInterval` yarışır; [`index.html:5175`](index.html:5175) yalnızca son timer'ı temizler.
   - **Context değişimi:** XML/pazaryeri değişince [`index.html:4777`](index.html:4777) `catFetchAll` çağırır ama `pollTimer` temizlenmez; eski poll yeni bağlamın progress'ini overwrite eder.

**Doğrulanan yanlış pattern:** `0% → 60% → 20% → 80% → 40% → 100%` benzeri geri gitme, MOD A↔B geçişi + `status=XML` filtreli yeniden yüklemeden kaynaklanır. Progress monoton değildir.

---

## 6. DATA FLOW

```text
CATEGORY:
  frontend catFetchAll()
    ├─ GET /categories/products?status=XML&xmlSourceId&marketplaceId&limit=1000
    │     → backend: categoryMatch=false AND categoryId=null  (EŞLEŞMİŞLER ELENİR)
    │     → catComputeGroups(): supplierCategory string gruplama
    └─ GET /categories/tree?marketplaceId
          → backend: CategoryMapping var olanlar (0 kayıt → BOŞ)
  auto match:
    POST /categories/auto-match-all/start → runAutoMatch (async, totalProducts geç set)
    poll /categories/auto-match-all/progress (3 sn) → autoMatchState (ürün sayacı)

BRAND:
  GET /xml-sources + /marketplaces
  GET /brands/xml-brands?xmlSourceId          → XML markaları
  GET /brands?search=... + POST /brands        → SİSTEM markası (Trendyol markası DEĞİL)
  POST /brands/preview → POST /brands/match    → ürün brandId güncelle

VARIANT:
  GET /variants/?limit=1000&xmlSourceId
  GET /variants/xml-variants?xmlSourceId       → detectVariantAttributes (pattern)
  GET /variants/stats                          → GLOBAL (xmlSourceId yok)
  GET /variants/unmatched-products?limit=500
  POST /variants/auto-detect (body {})         → GLOBAL (context yok)
  POST /variants/bulk-match / confirm-match / approve
```

**Mock/static data tespiti:**
- [`prepVariants.ts:329`](server/src/routes/prepVariants.ts:329) `universal-attributes` ve
  [`prepVariants.ts:345`](server/src/routes/prepVariants.ts:345) `marketplace-attributes` **statik sabit liste** döner —
  gerçek pazaryeri attribute verisi değildir.

---

## 7. AFFECTED FILES

| Dosya | Etki |
|-------|------|
| [`index.html`](index.html:4726) | Category/Brand/Variant frontend state + render + progress |
| [`server/src/routes/prepCategories.ts`](server/src/routes/prepCategories.ts:581) | `/categories/products` status filtresi, tree, auto-match state |
| [`server/src/routes/prepBrands.ts`](server/src/routes/prepBrands.ts:109) | marka listesi/ürün/match |
| [`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:63) | stats global, auto-detect, universal-attributes |
| [`server/src/services/readiness.ts`](server/src/services/readiness.ts:46) | `detectVariantAttributes` (XML varyant tespiti) |

---

## 8. LOCKED FILES (bu görevde değiştirilemez)

[`server/src/routes/prepCategories.ts`](server/src/routes/prepCategories.ts:1) ·
[`server/src/routes/prepBrands.ts`](server/src/routes/prepBrands.ts:1) ·
[`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:1) ·
[`server/src/services/readiness.ts`](server/src/services/readiness.ts:1) ·
[`server/prisma/schema.prisma`](server/prisma/schema.prisma:1) — migration/seed/DB reset YOK.

**LOCK CONFLICT:** Progress ve veri görünürlüğü düzeltmelerinin çoğu kilitli backend route'larını
(`/categories/products` status filtresi, `/categories/tree`, `/variants/stats`, `/variants/auto-detect`) gerektirir.
Frontend ([`index.html`](index.html:1)) kilit dışıdır; ancak tek başına yetersizdir.

---

## 9. RED TEAM RESULTS (kod seviyesi)

| Senaryo | Sonuç | Kanıt |
|---------|-------|-------|
| XML seçilmeden Auto Match | BLOCK (guard) — ama buton disable değil, yalnızca uyarı | [`catRequireMarketplace()`](index.html:5146) |
| MP seçilmeden Auto Match | BLOCK (guard) | aynı |
| XML + MP seçili | Çalışır (yalnızca eşleşmemiş veri) | [`catFetchAll()`](index.html:4794) |
| XML değiştirildikten sonra | Eski poll devam eder; sonuçlar karışır | [`catOnXmlSourceChange()`](index.html:4773) |
| MP değiştirildikten sonra | Eski poll devam eder | [`catOnMarketplaceChange()`](index.html:4786) |
| Auto Match çift hızlı tıklama | İki start + timer yarışı (guard yok) | [`catAutoMatch()`](index.html:5161) |
| Auto Match sırasında XML/MP değiştirme | Poll yeni bağlamı bozar | poll closure [`index.html:5176`](index.html:5176) |
| API yavaş/timeout | Poll 3sn; timeout yakalanmaz, sonsuz sessiz poll | [`index.html:5190`](index.html:5190) |
| API 401/403/429/500 | `catch (e) {}` sessiz — kullanıcıya hata iletilmez | [`index.html:5190`](index.html:5190) |
| Boş kategori ağacı | Tree boş (mapping 0) — boş hedef gösterilir | [`prepCategories.ts:116`](server/src/routes/prepCategories.ts:116) |
| Eşleşen kategori | **GÖRÜNMEZ** (status=XML filtresi) | [`index.html:4803`](index.html:4803) |
| Eşleşmeyen kategori | Görünür (manual_required) | [`catRenderTable()`](index.html:5056) |
| Sayfa refresh / remount | State kaybolur; `catState` memory-only | [`index.html:4705`](index.html:4705) |
| Variant: farklı XML seçimi | `stats` global → yanlış yüzde | [`prepVariants.ts:63`](server/src/routes/prepVariants.ts:63) |
| Variant: AI match | Global `auto-detect` (context'siz) → yanlış XML işlenir | [`index.html:6028`](index.html:6028) |

---

## 10. GAPS (UX gereksinimlerine karşı)

| Gereksinim | Durum |
|-----------|-------|
| KAYNAK XML + HEDEF MP bağlamı ekranda görünür | **KISMİ** (select var; başlık/etiket yok) |
| XML kategori ağacı | **YOK** (düz liste gruplaması) |
| Hedef MP kategori ağacı | **YOK** (veri yok) |
| İki seçim olmadan OTOMATİK EŞLEŞTİR disabled | **YOK** (guard var ama buton disable edilmiyor) |
| Eşleşen/eşleşmeyen/manual sayıları | **KISMİ** (eşleşen hiç görünmez) |
| XML Varyant → MP Attribute eşleme görünümü | **KISMİ** (hedef sabit statik liste) |
| XML Marka → MP Marka eşleme görünümü | **YOK** (sistem markası + serbest metin) |
| Monoton progress | **YOK** (MOD A/B geçişi) |
| Gerçek işlem sayısı (`X / Y kategori işleniyor`) | **YOK** (backend ürün sayar, UI "kategori" der) |

---

## 11. MINIMAL FIX PLAN (uygulama öncesi onay gerekir)

**Kilit dışı (frontend [`index.html`](index.html:1)):**
1. `catAutoMatch`'e `if (catState.autoMatchRunning) return;` guard ekle.
2. `catOnXmlSourceChange` / `catOnMarketplaceChange` içinde `pollTimer` temizle + `autoMatchLive=null`.
3. `catRenderProgress`'i tek moda indir: `autoMatchLive` yokken sahte percent yerine `"X / Y kategori işleniyor"` gerçek sayaç göster; monoton artış sağla.
4. `prepVariantAiMatch`'e xmlSourceId/productIds ilet (context).
5. Butonları gerçekten `disabled` yap (guard'dan bağımsız).

**Kilitli (backend — kullanıcı onayı olmadan DOKUNULMAZ):**
6. [`prepCategories.ts`](server/src/routes/prepCategories.ts:581) `/categories/products`: `status=XML` filtresini kaldır/iki taraflı listele; eşleşenleri de döndür.
7. [`prepCategories.ts`](server/src/routes/prepCategories.ts:107) `/categories/tree`: marketplace gerçek ağacını (Trendyol `getCategoryTree`) besleyecek veri/entegrasyon.
8. [`prepVariants.ts`](server/src/routes/prepVariants.ts:63) `/variants/stats`: `xmlSourceId` filtresi.
9. [`prepVariants.ts`](server/src/routes/prepVariants.ts:164) `/variants/auto-detect`: context (xmlSourceId/productIds) zorunlu.

**Veri (migration DEĞİL, data-level):** `CategoryMapping` ve `Brand.externalId` doldurulması (önceki audit'lerle tutarlı).

---

## 12. REGRESSION RISK

- Frontend guard/monoton progress değişiklikleri: **DÜŞÜK** (yalnızca görsel/state; API imzası değişmez).
- Backend filtre değişiklikleri: **ORTA-YÜKSEK** — `status=XML` kaldırılırsa tablo 13.404 ürün/1288 kategori yüklenir; pagination/performans gözden geçirilmeli; kilitli dosyalar olduğu için riskli.
- Rollback: frontend için eski [`index.html`](index.html:1) içeriğine dönüş; backend için değişiklik yapılmadı (kilitli).

---

## 13. FINAL VERDICT

```
FAIL — LIVE SEND BLOCKED (UX katmanında: bağlam görünürlüğü ve eşleşme sonucu eksik)
```

Kullanıcının sorusu — **"Ben hangi XML'deki veriyi, hangi pazaryerine eşleştiriyorum?"** — mevcut ekranda
açıkça cevaplanmamaktadır: eşleşen kategoriler gösterilmiyor, hedef pazaryeri kategori/marka/attribute ağacı yok,
progress monoton değil. Bu nedenle Category/Brand/Variant modülleri tamamlanmış kabul edilemez. Kod değiştirilmedi;
kilitli backend dosyalarına dokunulmadı. Uygulama için yukarıdaki MINIMAL FIX PLAN onay beklemektedir.
