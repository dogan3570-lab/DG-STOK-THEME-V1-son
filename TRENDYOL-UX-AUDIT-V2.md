# CATEGORY + BRAND + VARIANT + LISTING UX — ROOT CAUSE + RED TEAM + GAP ANALYSIS

**Tarih:** 15.08.2026 · **Mod:** READ-ONLY (kod/DB/migration/git/canlı API değişikliği YOK)
**Frontend:** [`index.html`](index.html:1) · **Kilitli backend:** prepCategories/prepBrands/prepVariants/prepListings/readiness

---

## 1. EXECUTIVE SUMMARY

Sistemde bir **global `contextState`** ve ekran üstünde **context indicator** mevcuttur
([`index.html:1750`](index.html:1750)). Ancak bu global bağlam ile alt modüllerin (Category/Brand/Variant/Listing)
kendi select/state'leri **senkron değildir**; kod bunu açıkça söyler:
[`syncLocalContextSelectors()`](index.html:1854) → *"Otomatik seçim YAPILMAZ — kullanıcı her alt modülün kendi select'inden seçer."*

Yani kullanıcı ekranın üstünde `XML A + Trendyol` görürken, Category modülünde alttaki select'te
farklı/boş bir seçim olabilir. "Tek çalışma bağlamı" kuralı mevcut mimaride **yarı uygulanmış** durumdadır.

Buna ek olarak üç veri katmanı sorunu vardır:
1. Category eşleşen sonuçları `status=XML` filtresiyle gizleniyor.
2. Hedef pazaryeri ağaçları (kategori/marka/attribute) gerçek veriyle beslenmiyor (`CategoryMapping` 0 kayıt; getBrands/getCategoryTree entegrasyonu yok).
3. Progress iki mod arasında geçiş yapıp geriye düşüyor; duplicate start ve polling context temizliği yok.

Sonuç: kullanıcı **"Hangi XML'i hangi pazaryerine hazırlıyorum?"** sorusuna 3 saniyede güvenilir cevap alamıyor.

---

## 2. ROOT CAUSE

| # | Kök neden | Kanıt |
|---|-----------|-------|
| R-1 | Global context ile alt modül context'i iki ayrı katman; senkronizasyon bilinçli olarak yapılmamış | [`index.html:1854`](index.html:1854) |
| R-2 | Category sonuç sorgusu eşleşmemiş ürünlerle kısıtlı (`status=XML`) → eşleşenler asla render edilmiyor | [`index.html:4803`](index.html:4803) + [`prepCategories.ts:598`](server/src/routes/prepCategories.ts:598) |
| R-3 | Hedef kategori ağacı yalnızca `CategoryMapping`'i olan sistem kategorilerine daraltılıyor; mapping 0 → tree boş | [`prepCategories.ts:116`](server/src/routes/prepCategories.ts:116) |
| R-4 | Progress `live` (backend sayaç) ile `percent` (local eşleşme oranı) arasında mod geçişi yapıyor | [`catRenderProgress()`](index.html:4935) |
| R-5 | Poll timer context değişiminde temizlenmiyor; `autoMatchRunning` guard yok | [`catAutoMatch()`](index.html:5161) |
| R-6 | Variant `stats` ve `auto-detect` global (xmlSourceId/context yok) | [`prepVariants.ts:63`](server/src/routes/prepVariants.ts:63), [`index.html:6028`](index.html:6028) |
| R-7 | Brand hedefi pazaryeri marka sistemi değil, sistem `Brand` + serbest metin; `Brand.externalId` boş | [`prepBrands.ts:167`](server/src/routes/prepBrands.ts:167) |
| R-8 | Listing modülü şablon CRUD'dur; XML context'i yalnızca `apply-all`'da kullanılır, ekranda gösterilmez | [`index.html:6194`](index.html:6194), [`prepListings.ts:436`](server/src/routes/prepListings.ts:436) |

---

## 3. CATEGORY AUDIT

| Kontrol | Durum |
|---------|-------|
| XML context nereden | `catGetXmlSourceId()` → kendi select'inden (global contextState değil) |
| MP context nereden | `catGetMarketplaceId()` → kendi select'inden |
| Context request'e gidiyor mu | Evet (`xmlSourceId`+`marketplaceId` → `/categories/products` ve `/tree`) |
| Backend context kullanıyor mu | products: evet; tree: marketplaceId→mapping (0→boş) |
| Eşleşen sonuç görünüyor mu | **HAYIR** (`status=XML`) |
| Hedef MP tree görünüyor mu | **HAYIR** (boş) |
| Progress kaynağı | live/percent çift mod |
| Progress sıçrar mı | **EVET** (R-4) |
| Duplicate start | **MÜMKÜN** (guard yok) |
| Eski poll yeni context'i bozar mı | **EVET** (timer temizlenmiyor) |

---

## 4. BRAND AUDIT

| Kontrol | Durum |
|---------|-------|
| XML'e göre filtreleniyor mu | Evet (`/brands/xml-brands?xmlSourceId=`) |
| MP'e göre filtreleniyor mu | Kısmen (yalnızca `marketplaceKey` taşınır) |
| Hedef MP marka sistemi var mı | **YOK** (sistem `Brand` + serbest metin) |
| `Brand.externalId` kullanılıyor mu | **HAYIR** (boş) |
| Global Brand verisi | Evet (`/brands` tümü) |
| Başka XML'in markası görünür mü | xml-brands xmlSourceId'li → HAYIR |
| Auto-match context üzerinde mi | Kısmen (manuel marka + preview/match) |
| Sonuç anlamlı mı | Kısmen (ürün listesi + önizleme) |

---

## 5. VARIANT AUDIT

| Kontrol | Durum |
|---------|-------|
| `/variants/stats` XML context kullanıyor mu | **HAYIR** (global) |
| `auto-detect` context gönderiyor mu | **HAYIR** (`body:{}`) |
| Global işlem yapılıyor mu | **EVET** (auto-detect tüm XML'ler) |
| Variant.name/value yorumu | `detectVariantAttributes` pattern; `AKYI` filtresi YOK |
| AKYI attribute olarak algılanabilir mi | Potansiyel (whitelist yok) |
| Hedef MP varyant/attribute sistemi | **YOK** (statik `universal-attributes`) |
| Eşleşme sonucu gösteriliyor mu | Kısmen (matched/ai/required/manual satırlar) |
| Hangi varyant → hangi hedef attribute | Kısmen (değer bazlı; hedef sabit liste) |
| Progress doğru mu | **HAYIR** (global stats) |
| Polling/context sorunu | Polling yok; context senkron değil |

---

## 6. LISTING AUDIT

| Kontrol | Durum |
|---------|-------|
| XML context var mı | `prepListState.xmlSourceId` var (yalnızca `apply-all`) |
| MP context var mı | `prepListState.marketplaceId` var (şablon oluşturma/apply-all) |
| Ürün hangi XML'den | Şablon CRUD ürün listelemez; `apply-all` xmlSourceId ile |
| Hedef MP ekranda mı | Şablon satırında `t.marketplace.name` gösterilir |
| Category/brand/variant mapping yansıyor mu | **HAYIR** (şablon/fiyat kuralı odaklı) |
| Hazır/sorunlu ayrımı | **YOK** (o, readyToShip modülünde) |
| Neden gönderilemedi | **YOK** (listing şablon ekranı) |
| Eksikler (category/brand/variant/barcode/fiyat/stok/görsel) | **YOK** |
| Global READY count yanlış bağlamda | Potansiyel (stats global) |
| **"Bu XML'deki ürünleri şu MP'ye hazırlıyorum"** | **HAYIR** — ROOT CAUSE |

---

## 7. SHARED CONTEXT AUDIT

- **Var olan:** global `contextState` + `getContextParams()` + `apiWithContext()` + `updateContextUI()` + `clearContext()` + `isContextValid()`.
- **Eksik olan:** `syncLocalContextSelectors()` alt modül select'lerini **bağlamıyor** (yalnızca guard tetikliyor); her modül kendi select'ini okur.
- `contextRequiredPages = ['ready-to-ship','orders']` — Category/Brand/Variant/Listing context'i zorunlu kılınmamış.
- Context değişince `clearAllPageData()` + `refreshCurrentPage()` çalışır (iyi), ama **poll timer'lar temizlenmez**.

**Tek bağlam modeli mevcut mimaride KISMEN var; tam uygulanmamış.**

---

## 8. PROGRESS RED TEAM

| Senaryo | Sonuç | Kanıt |
|---------|-------|-------|
| 0→50→100 monoton | **FAIL** (mod geçişi) | [`catRenderProgress()`](index.html:4935) |
| Backend start'ta total=0 | **FAIL** (total=0 → percent modu) | [`prepCategories.ts:297`](server/src/routes/prepCategories.ts:297) |
| Sonradan total gelmesi | Sıçrama | poll total doldurur |
| Polling sırasında XML değiştirme | **FAIL** (timer temizlenmez) | [`catOnXmlSourceChange()`](index.html:4773) |
| Polling sırasında MP değiştirme | **FAIL** | [`catOnMarketplaceChange()`](index.html:4786) |
| İşlem sürerken tekrar başlatma | **FAIL** (guard yok) | [`catAutoMatch()`](index.html:5161) |
| Tamamlandıktan sonra tekrar poll | `clearInterval` var; OK |
| Eski timer yeni context'i bozması | **MÜMKÜN** |
| Completed sonrası %0'a düşme | **EVET** (`status=XML` → products boşalır + `autoMatchLive=null`) |
| Aynı anda iki işlem | **MÜMKÜN** |
| Backend error | `catch(e){}` sessiz — kullanıcıya iletilmez |
| Timeout | Sonsuz sessiz poll |
| Network disconnect | Sessiz |

**`80% → 20% → 0% → 100%` pattern'i gerçektir ve FAIL kabul edilir.**

---

## 9. CONTEXT ISOLATION RED TEAM

| Test | Sonuç |
|------|-------|
| CTX-01 XML-A→B geçince eski işlem B ekranını bozar mı | **MÜMKÜN** (poll timer temizlenmez; `catState` ayrı) |
| CTX-02 Trendyol→Hepsiburada sonuç sızması | Kısmi (veri yeniden yüklenir ama poll eski kalabilir) |
| CTX-03 Variant sonra MP değişimi | Kısmi (fetch yeniden; stats global) |
| CTX-04 Listing'e geçince başka context verisi | Listing kendi state'i; global context'le bağlı değil |
| CTX-05 Sayfa refresh | `contextState` memory-only → **context KAYBOLUR** (yeniden seçim gerekir; açık uyarı yok) |
| CTX-06 Aynı anda iki auto-match | **MÜMKÜN** (guard yok) |

---

## 10. 3-SECOND USER TEST

| Test | Sonuç |
|------|-------|
| TEST-01 Hangi XML? | PARTIAL (global indicator var; alt modül select'i ayrı) |
| TEST-02 Hangi MP? | PARTIAL |
| TEST-03 Şu an hangi işlem? | PARTIAL (stepper var; bağlam net değil) |
| TEST-04 Kaç kayıt işlendi? | PARTIAL (progress ürün sayar, "kategori" der) |
| TEST-05 Kaç eşleşti? | **FAIL** (eşleşenler gizli) |
| TEST-06 Kaç sorun var? | PARTIAL (manual_required görünür) |
| TEST-07 Ne yapmalıyım? | PARTIAL (guard/stepper) |
| TEST-08 Kategori hangi XML+MP için? | **FAIL** |
| TEST-09 Marka hangi XML+MP için? | **FAIL** |
| TEST-10 Varyant hangi XML+MP için? | **FAIL** |
| TEST-11 Listing hangi XML+MP için? | **FAIL** |

---

## 11. ARTILAR / EKSİLER

| Modül | Artı | Eksi | Kullanıcı Riski | Minimal Çözüm |
|-------|------|------|-----------------|---------------|
| Category | guard + stepper + poll + context params | `status=XML` eşleşenleri gizler; hedef tree boş; progress çift mod; duplicate start | eşleşme sonucu görünmez | backend filtre düzelt + frontend tek mod/guard/timer |
| Brand | xml-brands xmlSourceId'li; preview/match akışı | hedef MP marka sistemi yok; `externalId` boş | yanlış marka | getBrands entegrasyonu + externalId |
| Variant | tespit + satır bazlı onay/manual | stats global; auto-detect context'siz; hedef statik liste; AKYI filtresiz | yanlış XML işlenir | stats/auto-detect'e context; whitelist |
| Listing | şablon CRUD + apply-all context'li | XML context görünmez; global şablon listesi; eksik bilgisi yok | hangi XML? | context banner + xmlSourceId filtresi |

---

## 12. GAP MATRIX

| Gereksinim | Durum |
|-----------|-------|
| XML seçili | PARTIAL (çift katman) |
| MP seçili | PARTIAL |
| Bağlam ekran üstünde | **VAR** (global indicator) |
| Category context ile çalışır | PARTIAL (eşleşenler gizli) |
| Brand context ile çalışır | PARTIAL |
| Variant context ile çalışır | **FAIL** (global stats/auto-detect) |
| Listing context ile çalışır | PARTIAL |
| Hedef MP tree görünür | **FAIL** |
| Eşleşen sonuç görünür | **FAIL** |
| Progress geriye düşmez | **FAIL** |
| Duplicate engellenir | **FAIL** |
| Eski poll yeni context'i bozamaz | **FAIL** |
| XML değişince sızma yok | PARTIAL |
| MP değişince sızma yok | PARTIAL |
| Refresh sonrası context | **FAIL** (kaybolur, açık yönlendirme yok) |
| 3 saniyede anlaşılır | **FAIL** |
| Hata anlaşılır gösterilir | PARTIAL (sessiz catch) |
| Sorunlu kayıt görünür | PARTIAL |
| 4 modül aynı UX | **FAIL** |
| Backend bozulmaz | — (değişiklik yapılmadı) |
| Security regression yok | — |
| Existing tests korunur | — |

---

## 13. LOCK CONFLICTS

Aşağıdaki düzeltmeler **kilitli backend** dosyalarını gerektirir; onay olmadan dokunulmadı:

| Gerekli değişiklik | Kilitli dosya |
|--------------------|---------------|
| `/categories/products` `status=XML` filtresini düzelt (eşleşenleri de döndür) | [`prepCategories.ts`](server/src/routes/prepCategories.ts:581) |
| `/categories/tree` gerçek MP ağacını besle | [`prepCategories.ts`](server/src/routes/prepCategories.ts:107) |
| `/variants/stats` xmlSourceId filtresi | [`prepVariants.ts`](server/src/routes/prepVariants.ts:63) |
| `/variants/auto-detect` context zorunlu | [`prepVariants.ts`](server/src/routes/prepVariants.ts:164) |
| Brand MP marka sistemi + `externalId` doldurma | [`prepBrands.ts`](server/src/routes/prepBrands.ts:109) |
| Listing xmlSourceId filtre/context yansıtma | [`prepListings.ts`](server/src/routes/prepListings.ts:67) |

Kilit dışı: [`index.html`](index.html:1) (frontend).

---

## 14. MINIMAL FIX PLAN (sıralı, kilit dışı önce)

**A. Frontend (kilit dışı, güvenli):**
1. `syncLocalContextSelectors()`'ı gerçek senkronizasyona çevir: global `contextState` değişince Category/Brand/Variant/Listing select'lerine yaz ve `isValid` yansıt.
2. `catAutoMatch()`'e `if (catState.autoMatchRunning) return;` ekle.
3. `catOnXmlSourceChange`/`catOnMarketplaceChange` içinde `pollTimer` temizle + `autoMatchLive=null`.
4. `catRenderProgress` tek mod: `autoMatchLive` yokken sahte yüzde yerine `"X / Y kategori işleniyor"` gerçek sayaç; monoton.
5. `prepVariantAiMatch` request'ine `xmlSourceId`/`marketplaceId` ekle.
6. Listing'e context banner ("Bu XML → Bu MP") + xmlSourceId filtresi.

**B. Backend (kilitli — onay sonrası):** 13 numaralı listedeki 6 değişiklik.

---

## 15. OPTION A vs OPTION B

### OPTION A — En az değişiklik
- **Değişen:** yalnızca [`index.html`](index.html:1) (frontend senkronizasyon + progress + guard) + kilitli backend'te yalnızca 2 zorunlu satır (status filtresi, stats xmlSourceId).
- **Değişmeyen:** schema, readiness, send pipeline, credential, XML import.
- **Risk:** DÜŞÜK-ORTA · **Regresyon:** DÜŞÜK · **Test:** mevcut browser testleri + elle 3 saniye testi.
- **UX:** bağlam senkron + monoton progress; hedef tree yine boş (veri yok).
- **Avantaj:** hızlı, güvenli · **Dezavantaj:** hedef MP ağaçları hâlâ eksik.

### OPTION B — Sağlam Workspace Context
- **Değişen:** `contextState` tek authoritative kaynak yapılır; dört modül yalnızca onu okur; backend context zorunlu hale getirilir; hedef MP ağaçları (getCategoryTree/getBrands/getCategoryAttributes) entegre edilir.
- **Değişmeyen:** schema, send pipeline, credential, readiness, XML import.
- **Risk:** ORTA-YÜKSEK · **Regresyon:** ORTA (dört modül yeniden bağlanır) · **Test:** tam E2E + context isolation suite.
- **UX:** istenen 3 saniye deneyimi tam.
- **Avantaj:** kalıcı doğru mimari · **Dezavantaj:** kapsam büyük, kilitli backend + veri doldurma gerekir.

---

## 16. REGRESSION RISKS

- Frontend senkronizasyon/progress: DÜŞÜK (API imzası değişmez).
- Backend `status` filtresi kaldırılırsa: tablo 13.404 ürün / 1.288 kategori yüklenir → pagination/performans ORTA.
- Variant stats/auto-detect context eklenirse: mevcut global davranış değişir → ORTA (test gerekir).
- Kilitli dosyalar değişirse: READY/readiness/send pipeline etkilenmez ama Category/Brand/Variant akışı etkilenir → ORTA.

---

## 17. TEST PLAN

1. `npx tsc -p server/tsconfig.json --noEmit` + `npm run build`.
2. Mevcut browser testleri (`ready-to-ship-test.cjs`, `mp-crud-test.cjs`, `prep-context-e2e.cjs`, `variant-e2e.cjs`).
3. Yeni context isolation testleri: CTX-01..CTX-06.
4. Progress monotonluk testi: 0→50→100 geriye düşme yok.
5. Duplicate start: çift tıklamada tek start.
6. Eşleşen sonuç görünürlüğü: auto-matched satırlar render.
7. 3-saniye kullanıcı testi (TEST-01..TEST-11).

---

## 18. ACCEPTANCE CRITERIA (mevcut durum)

- [ ] XML seçili — PARTIAL
- [ ] Marketplace seçili — PARTIAL
- [ ] Bağlam ekran üstünde — VAR
- [ ] Category context ile çalışır — PARTIAL
- [ ] Brand context ile çalışır — PARTIAL
- [ ] Variant context ile çalışır — FAIL
- [ ] Listing context ile çalışır — PARTIAL
- [ ] Hedef MP tree görünür — FAIL
- [ ] Eşleşen sonuç görünür — FAIL
- [ ] Progress geriye düşmez — FAIL
- [ ] Duplicate engellenir — FAIL
- [ ] Eski poll yeni context'i bozamaz — FAIL
- [ ] XML değişince sızma yok — PARTIAL
- [ ] MP değişince sızma yok — PARTIAL
- [ ] Refresh sonrası context güvenli — FAIL
- [ ] 3 saniyede anlaşılır — FAIL
- [ ] Hata anlaşılır — PARTIAL
- [ ] Sorunlu kayıt görünür — PARTIAL
- [ ] 4 modül aynı UX — FAIL
- [ ] Backend bozulmaz — SAĞLANDI (değişiklik yok)
- [ ] Security regression yok — SAĞLANDI
- [ ] Existing tests korunur — SAĞLANDI

---

## 19. FINAL VERDICT

```
FAIL — LOCK CONFLICT
```

Kritik düzeltmelerin çoğu kilitli backend dosyalarını ([`prepCategories.ts`](server/src/routes/prepCategories.ts:1),
[`prepBrands.ts`](server/src/routes/prepBrands.ts:1), [`prepVariants.ts`](server/src/routes/prepVariants.ts:1),
[`prepListings.ts`](server/src/routes/prepListings.ts:1)) gerektirir. Kullanıcı onayı olmadan bu dosyalara dokunulmadı.
Frontend-only kısmi iyileştirme mümkündür (OPTION A), ancak "hangi XML → hangi pazaryeri" sorusunun tam ve
güvenilir cevabı için backend context ve hedef MP ağacı entegrasyonu şarttır. Kod/DB/migration/git değiştirilmedi.
