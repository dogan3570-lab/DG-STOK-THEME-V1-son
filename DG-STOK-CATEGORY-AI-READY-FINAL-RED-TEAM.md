# DG STOK — CATEGORY + AI + READY-TO-SHIP FINAL RED TEAM

Tarih: 2026-08-16 · Production: `http://localhost:4001` · DB: SQLite · Kapsam: AKILLIBAYI1 (`949855eb-d68c-4920-b378-c622a6a665e2`)

> KORUMA: schema/migration/db push/seed/reset/git YAPILMADI. Gerçek ürün topluca değiştirilmedi/silinmedi. Gerçek marketplace credential'ına ve AI credential'ına DOKUNULMADI. Mock başarı raporlanmadı. Test verisi (geçici test kullanıcıları) tamamen temizlendi.

---

## A) CATEGORY MATCHING — GERÇEK SAYILAR

```
TOTAL PRODUCTS          = 13382
AUTO MATCH              = 1252   (categoryMatch = true)
AI MATCH                = 0      (matchedBy = 'ai' = 0)
MANUAL MATCH            = 12130  (categoryMatch = false)
FAILED                  = 0      (status = ERROR)
CATEGORY MATCH TRUE     = 1252
CATEGORY MATCH FALSE    = 12130
categoryId NULL         = 30
categoryId NOT NULL     = 13352
supplierCategory NULL   = 31
supplierCategory NOT NULL = 13351
```

### Soruların kesin cevapları (DB kanıtlı)

1. **12.130 ürün neden MANUAL?** — Bu ürünlerin kategori kaydı **gerçek Trendyol mapping'ine sahip değil**. 30'unda `categoryId=null` + `supplierCategory=null` (kategori atanamaz); 12.100'ünde `categoryId` lokal bir `>>>` yollu kategoriye işaret ediyor ama o kategorinin `externalId=null` ve **0 CategoryMapping** kaydı var.
2. **1.252 AUTO nasıl oluşuyor?** — `categoryId`'si gerçek numeric `CategoryMapping.externalId` taşıyan (23 Trendyol kategorisi) ürünler. `matchedBy` dağılımı: 1.231 `manual` + 21 `null` (yani AI/rule değil; manuel eşleştirme + backfill ile doğrulandı).
3. **AI MATCH neden 0?** — Kanıt zinciri aşağıda.
4. **AI eşleştirme endpoint'i var mı?** — EVET: [`/categories/ai-match`](server/src/routes/prepCategories.ts:135) (aslında KURAL tabanlı) ve [`/categories/ai-match-ai/start`](server/src/routes/prepCategories.ts:497) (gerçek AI).
5. **AI çağrısı yapılıyor mu?** — HAYIR. Gerçek AI eşleştirmesi hiç çalışmamış: `AIDecisionLog=0`, `AIKnowledge=0`, `ai-match-ai/progress` durumu `idle`/0.
6. **AI'ya hangi veri gidiyor?** — [`buildCategoryMatchPrompt`](server/src/services/aiGateway.ts:452): ürünün `title` + `supplierCategory` + `brand` + `description` + lokal kategori listesi. (30 manuel üründe `supplierCategory` NULL olduğundan AI yalnızca title/brand görür.)
7. **AI response geliyor mu?** — HAYIR (çünkü çağrı hiç yapılmıyor).
8. **Parser doğru mu?** — [`parseAndValidateMatches`](server/src/services/aiGateway.ts:508) doğru; ama response olmadığından çalışmıyor.
9-10-11. **Sonuç categoryId/categoryMatch/CategoryMapping yazılıyor mu?** — HAYIR (0 AI sonucu). `runAiMatch` [`prepCategories.ts:405`](server/src/routes/prepCategories.ts:405) yalnızca `categoryId=null` ürünleri hedefliyor; 12.100 limbo (categoryId dolu, match false) AI'nın kapsamı DIŞINDA.
12. **Transaction commit?** — AI sonucu olmadığı için N/A.
13. **Reload persistence?** — AI config DB'de kalıcı (aşağıda), ama AI MATCH sonucu hiç oluşmadı.
14. **UI hangi alana bakıyor?** — [`catComputeGroups`](index.html:5224) `categoryMatch === true` (backend-authoritative, önceki turda hizalandı).

### 3 MANUEL ürün zinciri (gerçek)

| Ürün | supplierCategory | categoryId | categoryMatch | CategoryMapping |
|---|---|---|---|---|
| AKYI-266667 (Tabaklik) | NULL | NULL | false | YOK |
| AKYI-269529 (Cekpas) | NULL | NULL | false | YOK |
| AKYI-264798 (9V Pil) | NULL | NULL | false | YOK |

---

## B) AI CONTROL CENTER — GERÇEK DURUM (DB + API)

| Provider | active | key | model | lastStatus | req | ok | fail |
|---|---|---|---|---|---|---|---|
| nvidia | **false** | var | GLM-5.2 | connected | 25 | 5 | 20 |
| openrouter | **true** | var | **NULL** | connected | 10 | 8 | 2 |
| gemini/deepseek/mistral/openai | false | yok | — | unknown | 0 | 0 | 0 |

```
AI Assistant configured?  = KISMEN (key var ama model/aktiflik eksik)
Provider configured?     = EVET (2 provider'da key var)
Model configured?        = HAYIR (openrouter model=NULL; nvidia model var ama inactive)
API key present?         = EVET (openrouter + nvidia)
Connection persisted?    = EVET (DB'de kalıcı)
Test endpoint?           = EVET (/ai-settings/:provider/test)
Real request?            = KATEGORİ EŞLEŞTİRME İÇİN HAYIR
Real response?           = HAYIR
Response parsing?        = N/A
DB persistence?          = HAYIR (AIDecisionLog=0)
Reload persistence?      = config evet; AI sonucu yok
```

**DURUM A + D birlikte:**
- UI `lastStatus=connected` gösteriyor (test başarısından), fakat **gerçek AI eşleştirmesi çalışamaz**: tek aktif provider OpenRouter'ın `model=NULL`; [`chatCompletion`](server/src/services/aiGateway.ts:344) ve [`matchCategoriesWithAI`](server/src/services/aiGateway.ts:603) openrouter dalında `if (!provider.model) { "Model seçilmemiş"; continue; }` ile isteği YAPMADAN atlıyor. NVIDIA model dolu ama `active=false` olduğundan [`getActiveProvidersByPriority`](server/src/services/aiGateway.ts:87) onu seçmiyor.

**AI MATCH = 0 kök neden zinciri:** aktif provider'da (model+key) ikilisi yok → AI isteği hiç atılmıyor → response yok → persistence yok (AIDecisionLog=0) → UI'da "AI Eşleştirme=0".

---

## C) READY-TO-SHIP — GERÇEK SAYILAR (AKILLIBAYI1)

```
DB READY  = 700
API READY = 700  (GET /ready-to-ship?xmlSourceId=AKILLIBAYI1&filter=ready)
UI READY  = 700  (GET /ready-to-ship/stats?xmlSourceId=AKILLIBAYI1)
```

### GATE ANALİZİ

```
CATEGORY PASS = 1252        CATEGORY FAIL = 12130
BRAND PASS    = 13382       BRAND FAIL    = 0
VARIANT PASS  = 13382       VARIANT FAIL  = 0
LISTING TEMPLATE PASS = 6092   LISTING TEMPLATE FAIL = 7290
4/4 PASS = 700              4/4 FAIL = 12682
```

- **FIRST BROKEN GATE = CATEGORY** (12.130 ürün kategori gate'inde takılı).
- **İKİNCİ KIRIK GATE = LISTING TEMPLATE** (552 ürün kategori geçiyor ama `templateMatch=false`; toplam 7.290 templateMatch=false — eski import'lardan kalma bayrak gecikmesi).

**READY ROOT CAUSE:** READY=700 = (categoryMatch true ∩ templateMatch true ∩ brand/variant pass). 12.130 ürün kategori mapping'siz; 552 ürün kategori geçer ama template bayrağı eski.

---

## D) CATEGORY → READY VERİ AKIŞI (sınır analizi)

| Sınır | Değer | Kaybolma noktası |
|---|---|---|
| XML IMPORT → PRODUCT | 13.382 ürün | — |
| PRODUCT → SUPPLIER CATEGORY | 31 NULL / 13.351 dolu | 30 ürün XML'de kategori alanı yok |
| SUPPLIER CATEGORY → CATEGORY MATCH | 1.252 true / 12.130 false | **KÖK NEDEN: gerçek Trendyol mapping yok** |
| CATEGORY MATCH → CATEGORY MAPPING | 23 gerçek mapping | 12.100 ürünün lokal kategorisi map DEĞİL |
| CATEGORY MAPPING → BRAND MATCH | 13.382 PASS | — |
| BRAND → VARIANT | 13.382 NOT_REQUIRED | — |
| VARIANT → LISTING TEMPLATE | 6.092 PASS / 7.290 FAIL | **2. KÖK NEDEN: templateMatch bayrağı eski** |
| LISTING TEMPLATE → 4/4 READINESS → RTS | 700 | category ∩ template |

---

## E) FAZ 5 — GERÇEK BROWSER (Chromium)

LOGIN ✅ · DASHBOARD ✅ · PRODUCT POOL ✅ · AKILLIBAYI1 XML ✅ · CATEGORY ✅ (hiyerarşik tree) · MANUAL seçim+ kaydet ✅ (DB doğrulandı, geri alındı) · VARIANT ✅ · LISTING ✅ · READY-TO-SHIP ✅ · MARKETPLACE ✅ · REPORTS ✅ · AI CONTROL CENTER ✅ (OpenRouter + NVIDIA görünüyor).

- Page error = **0** · Login sonrası 4xx/5xx = **0** · Console'da yalnızca giriş öncesi beklenen `/auth/me` 401.

---

## F) FAZ 6 — DÜZELTME KARARI

Kod bug'ı BULUNMADI. Kök nedenler iki başlıkta:

1. **AI KONFİGÜRASYONU (kullanıcı aksiyonu gerektirir):** OpenRouter'a model seçilmeli VEYA NVIDIA `active=true` yapılmalı. Bu, gerçek AI credential/config değişikliğidir — görev kuralları gereği DOKUNULMADI. (Rapor: yapılacak işlem.)
2. **VERİ MAPPING GAP (gerçek Trendyol credential gerektirir):** 12.100 ürünün kategori mapping'i yok. `REAL MARKETPLACE API = NOT VERIFIED`; sahte mapping üretilmedi.

**Toplu veri onarım önerileri (UYGULANMADI, karar gerektirir):**
- `templateMatch` backfill: etkilenen = **7.290 kayıt** (default şablon mevcut; `resolveListingTemplate` → GENERAL). Güvenli transform: `templateMatch=true`. Beklenen: READY 700 → 1.252 (kategori geçen 552 ürün daha READY olur). Backup + rollback şart.
- Kategori mapping: etkilenen = **12.100 kayıt**. Gerçek Trendyol kategori ağacı (credential) olmadan GÜVENLİ transform YOKTUR → DUR ve onay iste.

---

# DG STOK — CATEGORY + AI + READY-TO-SHIP FINAL RED TEAM

```
CATEGORY TOTAL              = 13382
AUTO MATCH                  = 1252
AI MATCH                    = 0
MANUAL MATCH                = 12130
FAILED                      = 0

CATEGORY ROOT CAUSE         = 12.130 ürünün gerçek Trendyol CategoryMapping'i yok
                              (30 categoryId null + 12.100 lokal '>>>' kategori, externalId null)

AI ASSISTANT CONFIG         = FAIL   (aktif provider'da model+key ikilisi yok)
AI REAL REQUEST             = FAIL   (model=null → istek atılmıyor)
AI REAL RESPONSE            = FAIL   (yok)
AI RESULT PERSISTENCE       = FAIL   (AIDecisionLog=0)
AI RELOAD PERSISTENCE       = PASS   (config DB'de kalıcı; sonuç hiç oluşmadı)

READY DB                    = 700
READY API                   = 700
READY UI                    = 700

CATEGORY GATE               = FAIL   (12.130 fail)
BRAND GATE                  = PASS
VARIANT GATE                = PASS
LISTING TEMPLATE GATE       = FAIL   (7.290 fail)
4/4 READINESS               = PASS   (700 ürün doğru; sahte READY yok)

FIRST BROKEN GATE           = CATEGORY
READY ROOT CAUSE            = category mapping eksikliği (12.130) + templateMatch bayrak gecikmesi (552)

BROWSER                     = PASS
NETWORK                     = PASS
CONSOLE                     = PASS
API                         = PASS
TSC                         = PASS
BUILD                       = PASS
REGRESSION                  = PASS

REAL DATA MODIFIED          = NO
REAL DATA BACKED UP         = NO (onarım uygulanmadı)
SCHEMA CHANGED              = NO
MIGRATION                   = NO
SEED                        = NO
DB RESET                    = NO
GIT                         = NO

TEST DATA LEFTOVER          = 0

REAL MARKETPLACE API        = NOT VERIFIED

FAIL COUNT                  = 6 (AI CONFIG / AI REQUEST / AI RESPONSE / AI PERSISTENCE / CATEGORY GATE / LISTING TEMPLATE GATE)

FINAL                       = FAIL
```

> **HONEST SONUÇ:** "AI çalışıyor / kategori eşleşti / READY oldu" iddiaları için browser→HTTP→backend→DB→API→browser zinciri kanıtlandı ve AI'nın **hiç** gerçek eşleştirme yapmadığı (AIDecisionLog=0, aktif provider model NULL) kesinleşti. 12.130 ürün gerçek Trendyol mapping'inden yoksun. Bunlar kod bug'ı DEĞİL; (1) AI model/aktiflik konfigürasyonu ve (2) gerçek Trendyol kategori mapping verisi eksikliğidir. KORUMA kuralları gereği gerçek AI credential'ına ve ürün verisine toplu müdahale YAPILMADI. FINAL=FAIL, kök neden kanıtlı olarak bırakılmıştır; düzeltme için gerekli aksiyonlar raporda belirtilmiştir.
