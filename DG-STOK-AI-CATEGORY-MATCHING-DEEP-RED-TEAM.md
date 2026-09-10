# DG STOK — AI CATEGORY MATCHING DEEP RED TEAM

Tarih: 2026-08-16 · Production: `http://localhost:4001` · Credential değerleri rapora YAZILMADI.

> KORUMA: schema/migration/db push/seed/reset/git YAPILMADI. Gerçek ürün topluca değiştirilmedi. Sahte AI response / mock PASS / sahte categoryMatch / sahte CategoryMapping / sahte READY ÜRETİLMEDİ. AI credential'ı değiştirilmedi.

---

## FAZ 1 — AI CONFIGURATION GERÇEĞİ (DB)

| Provider | active | model | keyConfigured | baseURL | req | ok | fail | lastStatus |
|---|---|---|---|---|---|---|---|---|
| nvidia | **false** | GLM-5.2 | true (enc+iv+tag dolu) | integrate.api.nvidia.com | 25 | 5 | 20 | connected |
| openrouter | **true** | **NULL** | true (decryptable) | openrouter.ai | 10 | 8 | 2 | connected |
| gemini | false | gemini-pro | false | — | 0 | 0 | 0 | unknown |
| deepseek | false | deepseek-chat | false | — | 0 | 0 | 0 | unknown |
| mistral | false | mistral-large-latest | false | — | 0 | 0 | 0 | unknown |
| openai | false | gpt-4 | false | — | 0 | 0 | 0 | unknown |
| **Kimi** | **YOK (kayıt yok)** | — | — | — | — | — | — | — |

```
AKTİF PROVIDER = openrouter (yalnızca o)
AKTİF MODEL    = YOK (openrouter model=NULL)
API KEY        = openrouter decryptable; nvidia key VAR AMA DECRYPT EDİLEMİYOR (aşağıda kanıt)
MODEL + KEY birlikte kullanılabilir mi? = HAYIR
```

---

## FAZ 2 — AI CONTROL CENTER DATA FLOW

`GET /ai-settings` → [`aiSettings.ts`](server/src/routes/aiSettings.ts:16) → `getAllProviders()` → [`aiGateway.ts`](server/src/services/aiGateway.ts:100) → DB `aIProviderConfig`. API key masked döner, `apiKeyConfigured` bayrağı `!!apiKeyEncrypted` ile hesaplanır.

**"UI'da model seçilmiş görünürken DB'de model NULL olabilir mi?"** — EVET. UI `lastStatus=connected` gösterir (test başarısından kalan), ama `model=NULL`. Bağlantı "connected" ile "model seçili" farklı alanlardır; UI'nın gösterdiği "connected" kullanıcıyı yanıltır. Kök neden: OpenRouter'a hiç model atanmamış.

---

## FAZ 3 — GERÇEK AI REQUEST KANITI (request sayaçlarıyla)

| Test | HTTP | Sonuç | Request sayacı (before→after) |
|---|---|---|---|
| `POST /ai-settings/openrouter/test` | 200 | `ok=false errorCode=NO_MODEL "Model seçilmemiş"` | 10 → **10** (istek ATILMADI) |
| `POST /ai-settings/nvidia/test` | 200 | `ok=false errorCode=NO_KEY "API key yapılandırılmamış"` | 25 → **25** (istek ATILMADI) |

```
REQUEST CREATED   = NO
PROVIDER SELECTED = openrouter (test) — ama model yok; nvidia — ama key decrypt edilemiyor
MODEL SELECTED    = NO
HTTP REQUEST SENT = NO
PROVIDER RESPONSE = NO
RESPONSE PARSED   = NO
```

**İsteğin durduğu tam kod satırları:**
- OpenRouter test: [`aiGateway.ts:705`](server/src/services/aiGateway.ts:705) `if (!configuredModel) return { ok:false, errorCode:'NO_MODEL' }` → provider API'sine istek YOK.
- NVIDIA test: [`aiGateway.ts:679`](server/src/services/aiGateway.ts:679) `getDecryptedApiKey` → `decryptApiKey` **throw ediyor** → `return null` → [`aiGateway.ts:681`](server/src/services/aiGateway.ts:681) `NO_KEY`. (NVIDIA'nın enc/iv/tag alanları dolu ama şifreli anahtar mevcut `CREDENTIAL_ENCRYPTION_KEY` ile açılamıyor — legacy encryption migration kalıntısı.)

---

## FAZ 4 — KATEGORİ EŞLEŞTİRME PIPELINE'ı AI CONFIG KULLANIYOR MU?

**YES** — kategori motoru AI Control Center'daki aynı `aIProviderConfig` tablosunu kullanır:

[`matchCategoriesWithAI`](server/src/services/aiGateway.ts:555) → [`getActiveProvidersByPriority`](server/src/services/aiGateway.ts:87) (`where: { active: true }`) → key decrypt → model → gerçek API.

AMA `testProvider` [`aiGateway.ts:673`](server/src/services/aiGateway.ts:673) **`active` bayrağını yok sayar**, kategori motoru ise **sayar**. Bu asimetri, "test başarılı görünüyor ama kategori eşleştirme çalışmıyor" algısının kaynağıdır.

---

## FAZ 5 + FAZ 8 — GERÇEK 5 ÜRÜN / 12.100 LIMBO KAPSAMI

`POST /categories/ai-match-ai/start` (AKILLIBAYI1):

```
start: ok=true (başlatıldı)
progress: status=completed, processedProducts=30, matchedCount=0, manualCount=30,
          provider="", model="", lastError="OpenRouter: Model seçilmemiş", percent=100
```

**Kanıt:**
- AI motoru yalnızca **30 ürünü** işledi (`categoryId=null` olanlar). 12.100 limbo (categoryId dolu, match false) İŞLENMEDİ.
- Kapsam koşulu: [`runAiMatch`](server/src/routes/prepCategories.ts:355) `const where: any = { categoryId: null };` (rule-based `/ai-match` da [`prepCategories.ts:139`](server/src/routes/prepCategories.ts:139) aynı).
- 30 üründe `supplierCategory=NULL` olduğundan AI yalnızca title/brand görebilir; üstelik AI hiç çağrılmadı (model NULL).

**5 gerçek ürün testi sonucu:** AI pipeline'ı 5 üründe de **0 eşleşme** üretti; hiçbir üründe `AI REQUEST / PROVIDER / MODEL / RESPONSE / PARSED CATEGORY / CATEGORY MAPPING / DB PERSISTED / categoryMatch` değişmedi.

```
AI REAL REQUEST = FAIL
```

---

## FAZ 6 — AI RESPONSE PERSISTENCE

AI response hiç üretilmediği için parser→CategoryMapping→Product→commit zinciri çalışmadı. Kanıt: `AIDecisionLog=0`, `AIKnowledge=0`, `matchedBy='ai'=0`, provider request sayaçları sabit (openrouter=10, nvidia=25).

Ayrıca tasarım notu: AI, ürünü **lokal kategori tablosuna** (1311 kategori, çoğu `externalId=null`) eşleştirir; gerçek Trendyol `CategoryMapping` üretmez. Yani AI çalışsa bile gerçek marketplace mapping'i garanti etmez.

---

## FAZ 9 — HATA SINIFLANDIRMASI

**I = Birden fazla kök neden** (önem sırasıyla):

1. **A+B (Provider + Model config):** aktif provider'da (model+decryptable key) ikilisi yok.
   - openrouter: active=true, key OK, **model=NULL**.
   - nvidia: **active=false**, model OK, **key decrypt edilemiyor (NO_KEY)**.
2. **H (AI kapsam/selection):** AI yalnızca `categoryId=null` (30 ürün) hedefliyor; 12.100 limbo kapsam dışı.
3. **G (CategoryMapping persistence):** AI lokal kategoriye eşleştirir, gerçek marketplace mapping üretmez.

---

## FAZ 10 — MİNİMUM FIX KARARI

- **Config problemi:** Kod değişikliği GEREKMEZ. Kullanıcı aksiyonu: (a) OpenRouter'a model seç, VEYA (b) NVIDIA'yı `active=true` yap + key'i yeniden gir (mevcut key decrypt edilemiyor).
- **Kapsam (H) ve mapping (G):** gerçek Trendyol kategori ağacı/credential olmadan GÜVENLİ kod düzeltmesi YOK. Kapsamı genişletmek (limbo'yu dahil etmek) lokal kategoriye sahte `categoryMatch=true` yazardı → YASAK.

**FIX REQUIRED = YES · FIX APPLIED = NO** (config kullanıcı yönetiminde; credential'a müdahale yasak).

---

## REGRESSION

Category ✅ Brand ✅ Variant ✅ Listing ✅ Price Rules ✅ Product Pool ✅ Ready-to-Ship ✅ Marketplace ✅ Stock Automation ✅ Dashboard ✅ Reports ✅ AI Control Center ✅

`TSC = PASS` · `BUILD = PASS` · `HEALTH = 200` · `API = PASS` (34/34) · `BROWSER = PASS` · `NETWORK = PASS` (login sonrası 4xx/5xx=0) · `CONSOLE = PASS` (yalnız giriş öncesi beklenen /auth/me 401)

`TEST DATA LEFTOVER = 0` · geçici test kullanıcıları silindi · gerçek ürün/credential/kural değişmedi.

---

# DG STOK — AI CATEGORY MATCHING DEEP RED TEAM

```
AI PROVIDER CONFIG          = FAIL  (aktif provider'da model yok)
AI MODEL CONFIG             = FAIL  (openrouter model=NULL)
AI CONTROL CENTER TEST      = FAIL  (openrouter NO_MODEL, nvidia NO_KEY — istek atılmıyor)
REAL AI REQUEST             = FAIL  (request sayaçları sabit: 10→10, 25→25)
REAL AI RESPONSE            = FAIL  (yok)

CATEGORY AI PIPELINE        = FAIL  (yalnız 30 ürün işlendi, 0 eşleşme)
AI RESPONSE PARSER          = N/A   (response hiç üretilmedi; parser kodu doğru)
CATEGORY PERSISTENCE        = FAIL  (0 yazım)
AIDecisionLog PERSISTENCE   = FAIL  (AIDecisionLog=0)
AIKnowledge PERSISTENCE     = FAIL  (AIKnowledge=0)

5 REAL PRODUCT TEST         = FAIL  (5/5 üründe 0 eşleşme)
5/5 RESULT PERSISTENCE      = FAIL

12.100 LIMBO AI COVERAGE    = FAIL  (AI yalnız categoryId=null kapsar)

ROOT CAUSE #1               = A+B: aktif provider'da model+decryptable key yok
                              (openrouter model NULL; nvidia active=false + key decrypt edilemiyor)
ROOT CAUSE #2               = H: AI yalnızca categoryId=null (30 ürün) hedefliyor
ROOT CAUSE #3               = G: AI lokal kategoriye eşleştirir, gerçek Trendyol mapping üretmez

FIX REQUIRED                = YES
FIX APPLIED                 = NO  (config kullanıcı yönetiminde; credential'a dokunulmadı)

DB/API/UI CONSISTENCY       = PASS (READY 700=700=700)
RELOAD PERSISTENCE          = N/A (AI sonucu hiç oluşmadı)

CATEGORY REGRESSION         = PASS
BRAND REGRESSION            = PASS
VARIANT REGRESSION          = PASS
LISTING REGRESSION          = PASS
READY REGRESSION            = PASS
STOCK REGRESSION            = PASS

TSC                         = PASS
BUILD                       = PASS
BROWSER                     = PASS
NETWORK                     = PASS
CONSOLE                     = PASS

REAL DATA MODIFIED          = NO
TEST DATA LEFTOVER          = 0

REAL MARKETPLACE API        = NOT VERIFIED

FAIL COUNT                  = 10

FINAL                       = FAIL
```

> **SON KURAL CEVABI:** "AI bağlı" ile "AI kategori eşleştirme motorunda çalışıyor" AYNI DEĞİL. Gerçek bir ürün kategori eşleştirmeye girdiğinde sistem **seçili provider+model'e HTTP isteği GÖNDERMİYOR** ve sonucu DB'ye KAYDETMİYOR — bu, provider request sayaçlarının sabit kalması (openrouter 10→10, nvidia 25→25), `AIDecisionLog=0`, `AIKnowledge=0`, `matchedBy='ai'=0` ve `lastError="OpenRouter: Model seçilmemiş"` ile KANITLANDI. Gerçek AI request yapılamadığı için **FINAL=FAIL**; neden açıkça raporlandı, sahte/mock başarı üretilmedi.
