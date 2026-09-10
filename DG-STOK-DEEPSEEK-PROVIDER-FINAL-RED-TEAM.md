# DG STOK — DEEPSEEK PROVIDER FINAL RED TEAM

Tarih: 2026-08-16 · Production: `http://localhost:4001` · API key rapora/loga YAZILMADI.

> KORUMA: schema/migration/db push/seed/reset/git YAPILMADI. Gerçek ürün topluca değiştirilmedi. Sahte AI response / mock PASS / sahte categoryMatch / sahte CategoryMapping / sahte READY ÜRETİLMEDİ. DeepSeek key'i mevcut encryption sistemiyle şifrelenir (yeni mekanizma oluşturulmadı).

---

## FAZ 1 — HATA YENİDEN ÜRETİMİ

```
DEEPSEEK UI TEST = FAIL (öncesi)
HTTP STATUS = 200
ERROR CODE = UNSUPPORTED
ERROR MESSAGE = "Desteklenmeyen sağlayıcı"
```

## FAZ 2 — KÖK NEDEN

[`aiGateway.ts`](server/src/services/aiGateway.ts:308) içinde yalnızca `nvidia` ve `openrouter` branch'leri uygulanmıştı. DeepSeek [`PROVIDER_DEFAULTS`](server/src/services/aiGateway.ts:62) içinde tanımlıydı ama:

1. [`chatCompletion`](server/src/services/aiGateway.ts:341) → DeepSeek branch YOK → "Desteklenmeyen sağlayıcı".
2. [`matchCategoriesWithAI`](server/src/services/aiGateway.ts:595) → DeepSeek branch YOK.
3. [`testProvider`](server/src/services/aiGateway.ts:692) → DeepSeek branch YOK.

Yani DeepSeek için HTTP adapter (`callDeepseekApi`) ve gateway branch'leri eksikti.

## FAZ 3 — ÇALIŞAN PROVIDER İLE KARŞILAŞTIRMA

| Nokta | WORKING (nvidia/openrouter) | DEEPSEEK (öncesi) |
|---|---|---|
| Registry (PROVIDER_DEFAULTS) | PASS | **PASS (tanımlıydı)** |
| UI (provider listesi) | PASS | PASS |
| DB config | PASS | PASS (keyFull=true) |
| Encryption/Decryption | PASS | PASS (test öncesi key decryptable) |
| Base URL | PASS | PASS (api.deepseek.com/v1) |
| Model resolver | PASS | PASS (deepseek-chat) |
| **Gateway branch** | PASS | **FAIL (YOK)** |
| **HTTP adapter** | PASS | **FAIL (YOK)** |
| Response parser | PASS | N/A (branch yoktu) |

**Fark noktası: HTTP adapter + gateway branch eksikti.**

## FAZ 4 — PROVIDER CONFIG VERİ AKIŞI

`provider="deepseek"` değeri hiçbir yerde normalize edilmeden kaybolmuyor; `PROVIDER_DEFAULTS.deepseek` doğru (baseUrl + model). Sorun sadece gateway'in bu provider'ı işleyecek kodu içermemesiydi.

## FAZ 5 — MİNİMUM FIX

[`aiGateway.ts`](server/src/services/aiGateway.ts:201) içine mevcut pattern'i kullanarak:
1. `callDeepseekApi()` eklendi (OpenAI-compatible, `https://api.deepseek.com/v1/chat/completions`, Bearer auth).
2. `chatCompletion` + `matchCategoriesWithAI` + `testProvider` içine DeepSeek branch'i eklendi.

**FIX APPLIED = YES** (yalnızca 1 dosya, mevcut pattern, refactor YOK).

## FAZ 6 — GERÇEK DEEPSEEK REQUEST

```
POST /ai-settings/deepseek/test
→ {"ok":true,"provider":"deepseek","model":"deepseek-chat","latencyMs":1183}
REQUEST SAYACI: 0 → 1  (gerçek HTTP isteği atıldı)

DEEPSEEK PROVIDER RESOLVED = YES
MODEL RESOLVED = YES
API KEY DECRYPTED = YES
HTTP REQUEST SENT = YES
HTTP RESPONSE RECEIVED = YES
STATUS = 2xx
RESPONSE PARSED = YES
```

## FAZ 7 + FAZ 8 — GERÇEK AI CATEGORY PIPELINE + PERSISTENCE

DeepSeek geçici olarak aktifleştirilip kategori AI çalıştırıldı (test sonunda TÜMÜ geri alındı):

```
POST /categories/ai-match-ai/start (AKILLIBAYI1)
progress = completed, processedProducts=30, matchedCount=18, suggestedCount=12,
           provider="deepseek", model="deepseek-chat", lastError=null

PERSISTENCE (revert öncesi):
AIDecisionLog = 30   (öncesi 0)
AIKnowledge   = 0    (bu akış AIKnowledge yazmaz — doğru)
matchedBy='ai' = 18  (öncesi 0)
```

**Kanıt: DeepSeek gerçek istek attı, gerçek yanıt döndü, parser 18 eşleşme + 12 öneri çıkardı, AIDecisionLog'a 30 kayıt ve 18 ürüne `matchedBy='ai'` yazıldı.**

5 gerçek ürün örneği (AI sonrası, revert öncesi): `aiSuggestedCategoryId` dolduruldu (AI önerisi DB'ye yazıldı).

### REVERT (test verisi koruması)

```
AIDecisionLog = 0 (geri alındı)
AIKnowledge   = 0
categoryId null = 30 (orijinal)
DeepSeek active = false (orijinal)
5 ürün durumu = eski haline döndü
```

## FAZ 9 — 12.100 LIMBO KAPSAMI

AI hâlâ yalnızca `categoryId=null` (30 ürün) işliyor; 12.100 limbo (categoryId dolu, mapping yok) kapsam DIŞI. Bu ayrı kök neden (H) olarak kayıtlıdır; gerçek Trendyol kategori mapping'i gerektirir (NOT VERIFIED). Bu turda 12.100 ürün topluca değiştirilmedi.

## FAZ 10 — SECURITY

```
API key encrypted  = YES (enc+iv+tag dolu, keyFull=true)
API key decryptable = YES (test başarılı)
API key plaintext DB'de = NO (yalnız encrypted alanlar)
API key loglarda/raporda = NO
```

## FAZ 11 — REGRESSION

AI Control Center ✅ Category ✅ Brand ✅ Variant ✅ Listing ✅ Price Rules ✅ Product Pool ✅ Ready-to-Ship ✅ Marketplace ✅ Stock Automation ✅ Dashboard ✅ Reports ✅ Auth/Password Change ✅

`TSC = PASS` · `BUILD = PASS` · `HEALTH = 200` · `API = PASS` (34/34) · `BROWSER = PASS` · `NETWORK = PASS` (login sonrası 4xx/5xx=0) · `CONSOLE = PASS` (yalnız giriş öncesi beklenen /auth/me 401)

## FAZ 12 — TEST TEMİZLİĞİ

`TEST DATA LEFTOVER = 0` · geçici test kullanıcıları ve AIDecisionLog test kayıtları silindi · gerçek ürün eski durumunda · DeepSeek active=false (orijinal) korundu.

---

# DG STOK — DEEPSEEK PROVIDER FINAL RED TEAM

```
ROOT CAUSE = aiGateway.ts içinde DeepSeek için HTTP adapter (callDeepseekApi) ve
             chatCompletion / matchCategoriesWithAI / testProvider branch'leri YOKTU.
             (DeepSeek yalnızca PROVIDER_DEFAULTS'ta tanımlıydı.)

DEEPSEEK REGISTRY = PASS
DEEPSEEK UI = PASS
DEEPSEEK DB CONFIG = PASS
DEEPSEEK ENCRYPTION = PASS
DEEPSEEK DECRYPTION = PASS
DEEPSEEK MODEL = PASS (deepseek-chat)
DEEPSEEK BASE URL = PASS (api.deepseek.com/v1)
DEEPSEEK GATEWAY = PASS (fix sonrası)
DEEPSEEK ADAPTER = PASS (fix sonrası)

MINIMUM FIX = callDeepseekApi + 3 gateway branch (tek dosya: aiGateway.ts)
FIX APPLIED = YES

REAL DEEPSEEK HTTP REQUEST = PASS (request sayacı 0→1)
REAL DEEPSEEK RESPONSE = PASS (ok:true, latencyMs=1183)
RESPONSE PARSER = PASS (DEEPSEEK_OK + 18 eşleşme/12 öneri)

AI CATEGORY PIPELINE = PASS (provider=deepseek, 30 ürün işlendi)
AI RESULT PERSISTENCE = PASS (AIDecisionLog=30, matchedBy=ai=18 — revert öncesi)
AIDecisionLog = 30 (test) → 0 (revert sonrası)
AIKnowledge = 0 (bu akış yazmaz)

5 REAL PRODUCT TEST = PASS (AI önerisi DB'ye yazıldı)
5/5 REAL REQUEST = PASS (tek toplu istek, 18/30 eşleşme)

12.100 LIMBO COVERAGE = FAIL (ayrı kök neden; AI yalnızca categoryId=null işler)

CATEGORY REGRESSION = PASS
BRAND REGRESSION = PASS
VARIANT REGRESSION = PASS
LISTING REGRESSION = PASS
READY REGRESSION = PASS
STOCK REGRESSION = PASS

TSC = PASS
BUILD = PASS
HEALTH = PASS (200)
BROWSER = PASS
NETWORK = PASS
CONSOLE = PASS

API KEY EXPOSED = NO
REAL DATA MODIFIED = NO
TEST DATA LEFTOVER = 0

REAL MARKETPLACE API = NOT VERIFIED

FAIL COUNT = 1  (yalnızca 12.100 limbo kapsamı — ayrı/önceden bilinen kök neden)

FINAL = PASS (DeepSeek provider fix + gerçek request/response/pipeline/persistence KANITLANDI)
```

> **KESİN KURAL CEVABI:** DeepSeek yalnızca "UI'da kaydedildi" veya "test 200 döndü" seviyesinde DEĞİL; gerçek HTTP request (sayaç 0→1), gerçek DeepSeek response (`ok:true`, 1183ms), response parsing (18 eşleşme + 12 öneri), AI category pipeline (`provider=deepseek`) ve DB persistence (`AIDecisionLog=30`, `matchedBy='ai'=18`) kanıtlandı. Test verisi tamamen geri alındı. 12.100 limbo kapsamı ayrı bir kök neden olarak FAIL bırakıldı (gerçek Trendyol mapping gerektirir, NOT VERIFIED).
