# DG STOK — 12.100 ÜRÜN GERÇEK TRENDYOL KATEGORİ EŞLEŞTİRME PLANI + RED TEAM RİSK ANALİZİ

Tarih: 2026-08-16 · Durum: **PLAN — HENÜZ KOD DEĞİŞTİRİLMEDİ** · Yalnızca read-only ölçüm yapıldı.

> KORUMA DURUMU: schema / migration / db push / seed / DB reset / git YAPILMADI. Gerçek veri silinmedi. Kör toplu UPDATE, sahte CategoryMapping, sahte Trendyol ID, sahte AI sonucu, mock PASS ÜRETİLMEDİ. Bu dokümanda yalnızca ÖLÇÜM ve TASARIM vardır.

---

## 0. ÖZET KARAR

| Soru | Cevap |
|---|---|
| 12.100 ürün neden eşleşmemiş? | `categoryId` yalnızca lokal XML `>>>` kategorisine işaret ediyor; bu kategorilerin `externalId=null` ve hiç `CategoryMapping` yok. Gerçek Trendyol hedefine hiç bağlanmadılar. |
| Gerçek Trendyol ağacı DB'de var mı? | **EVET** — 3867 kategori (3361 leaf) parentId hiyerarşisiyle DB'de; 3867 CategoryMapping (tt) mevcut. |
| Kaç ürün exact/kural ile otomatik eşleşebilir? | **2448** ürün (tam/path eşleşmesi). |
| Kaç ürün AI/fuzzy/manual gerektirir? | **9653** ürün. |
| AI limbo ürünleri işliyor mu? | **HAYIR** — [`/ai-match`](server/src/routes/prepCategories.ts:216) ve [`runAiMatch`](server/src/routes/prepCategories.ts:416) yalnızca `categoryId: null` işliyor (31 ürün). |
| AI aktif mi? | **HAYIR (fiilen)** — aktif tek provider `openrouter` ama `model` boş; istek gönderemez. `deepseek` anahtarlı ve 2/2 başarılı ama `active=false`. |
| templateMatch sorunu var mı? | **VAR** — 571 ürün `categoryMatch=true` ama `templateMatch=false`; 6740 ürün ikisi de false. Bayrak gerçek şablon çözümüyle yeniden hesaplanmalı. |

---

## 1. ÖLÇÜM SONUÇLARI (BEFORE — READ-ONLY)

Ölçüm aracı: [`_cat-plan-probe.ts`](server/_cat-plan-probe.ts:1) ve [`_cat-plan-probe2.ts`](server/_cat-plan-probe2.ts:1) — ikisi de yalnızca okur.

```text
Product total                 = 13404
categoryMatch=true            = 1272
categoryMatch=false           = 12132
categoryId=null               = 31
categoryId dolu               = 13373
supplierCategory=null         = 33
supplierCategory dolu         = 13371

Category total                = 5155
Trendyol Category total       = 3867  (externalId dolu)
local XML Category            = 1288  (externalId null, ">>>" isimli)
parentId dolu                 = 3851

CategoryMapping total         = 3867
Trendyol CategoryMapping      = 3867  (tamamı tt)

READY total                   = 701

Brand match (true/false)      = 13383 / 21
Variant pass (true VEYA NOT_REQUIRED) = 13399
Variant fail                  = 5
Listing template match (true/false)   = 6093 / 7311
4/4 readiness                 = 701
```

### 1.1 Gerçek Trendyol Ağacı Doğrulaması

```text
REAL TRENDYOL TREE = 3867
LEAF               = 3361
DUPLICATE          = 0
ORPHAN             = 0
CYCLE              = 0
```

Beklenenle **birebir aynı**. Ağaç tutarlı; `externalId` numeric, `parentId` uuid-hiyerarşisi doğru, 16 kök + 3851 çocuk.

### 1.2 AI Provider Durumu (maskelenmiş)

```text
active=true  → openrouter (model BOŞ  → fiilen çalışamaz, 8/10 başarılı)
active=false → nvidia  (GLM-5.2, anahtar var, 5/25)
active=false → deepseek (deepseek-chat, anahtar var, 2/2 başarılı)
```

### 1.3 Marketplace Credential (maskelenmiş)

```text
Trendyol (tt): apiKey VAR, apiSecret VAR, sellerId VAR, apiStatus=connected
```

### 1.4 Listing Template

```text
toplam 3 şablon; hepsi GENERAL (marketplace başına 1, tt dahil); product/category scoped şablon YOK.
templateMatch=false = 7311  → 6740 (categoryMatch=false) + 571 (categoryMatch=true)
```

---

## 2. KÖK NEDEN — 12.132 `categoryMatch=false` ÜRÜNÜN GRUPLARA AYRILMASI

Ölçüm ([`_cat-plan-probe.ts`](server/_cat-plan-probe.ts:1)) ile `categoryMatch=false` (12.132) ürün:

| Grup | Tanım | Ürün sayısı | Kanıt |
|---|---|---|---|
| **A** | `supplierCategory=null` | **31** | kategorisiz; AI/manual |
| **B** | `supplierCategory` dolu fakat gerçek Trendyol mapping yok | **12.101** | `categoryId` lokal XML kategorisinde |
| **C** | `categoryId` dolu fakat lokal XML kategori (`externalId=null`) | **12.101** | B ile örtüşür |
| **D** | Trendyol adayı bulunabiliyor (exact/path unique) | **2.448** | matcher `MATCHED` |
| **E** | Birden fazla aday / belirsiz | **0** | matcher `AMBIGUOUS` |
| **F** | Hiçbir güvenilir aday yok | **9.653** | matcher `NOT_FOUND` |

Ek anormallik kontrolleri:

```text
categoryId GERÇEK Trendyol kategorisi ama categoryMatch=false  = 0
categoryMatch=false ama mevcut doğrulanmış mapping var           = 0
```

Yani kör şekilde `categoryMatch=true` yapılabilecek hazır mapping yok; her eşleşme gerçekten üretilmeli.

> **TEK CÜMLELİK KÖK NEDEN:** 12.101 ürün, XML import'unun ürettiği lokal `>>>` kategorisine bağlı (`externalId=null`, mapping yok); gerçek Trendyol leaf hedefine hiç eşleştirilmedi. Eşleştirme motoru gerçek Trendyol ağacını kullanmıyor, AI da `categoryId:null` kapsamına sıkışmış durumda.

---

## 3. ETKİLENECEK DOSYALAR

### 3.1 YENİ dosyalar (mevcut modüllere dokunmaz)

| Dosya | Amaç |
|---|---|
| [`server/src/services/categoryMatchEngine.ts`](server/src/services/categoryMatchEngine.ts:1) | Merkezi DB Trendyol ağacını yükleyen + leaf-only + verified eşleştirme motoru (yazma dahil, audit'li). |
| [`server/src/routes/categoryMatchEngine.ts`](server/src/routes/categoryMatchEngine.ts:1) | `POST /category-engine/preview` (dry-run) ve `POST /category-engine/run` (kontrollü batch) + `GET /category-engine/progress`. |
| [`server/_cat-engine-probe.ts`](server/_cat-engine-probe.ts:1) | 10 ürün + batch doğrulama aracı (read-only preview). |

### 3.2 MİNİMUM düzeltme yapılacak mevcut dosyalar

| Dosya | Değişiklik | Gerekçe |
|---|---|---|
| [`server/src/routes/prepCategories.ts`](server/src/routes/prepCategories.ts:416) | `runAiMatch` içindeki AI aday listesini **yalnızca gerçek Trendyol leaf** kategorilerine indir; sonuç `Category.externalId` ile doğrulansın. | Sahte lokal kategoriye AI ile `categoryMatch=true` yazılmasını engellemek (YASAK'ın önlenmesi). |
| [`server/src/routes/index.ts`](server/src/routes/index.ts:1) | Yeni engine rotasını mount et. | Erişim. |
| [`server/src/services/trendyolMapping.ts`](server/src/services/trendyolMapping.ts:46) | **DOKUNULMAYACAK** (mevcut pipeline çalışıyor). Limbo kurtarma yeni engine ile yapılır. | Çalışanı koruma. |

### 3.3 KESİNLİKLE DOKUNULMAYACAKLAR

```text
XML Engine (xmlImport) · Brand sistemi · Variant sistemi · Listing Price Rules
Stock Automation (closeAt/openAt/hysteresis) · Marketplace credential · XML Engine davranışı
Prisma schema · migration · db push · seed · DB reset
```

---

## 4. EŞLEŞTİRME MOTORU TASARIMI (leaf-only + verified)

Akış:

```text
XML supplierCategory
  ↓
CENTRAL DB TRENDYOL TREE (3867, parentId hiyerarşisi)
  ↓
1. exact / normalized full-path leaf eşleşmesi          → HIGH  (auto)
2. mevcut doğrulanmış CategoryMapping (aynı kategori)    → HIGH  (auto, verify)
3. parent-child hiyerarşi + leaf name unique             → HIGH  (auto)
4. kural tabanlı benzerlik (token/contains)              → MEDIUM/LOW (aday)
5. ürün başlığı + marka + öznitelik + AI (yalnız gerçek leaf) → HIGH/MEDIUM/LOW
6. manual review                                         → MANUAL
```

### 4.1 Kesin kurallar

1. **Hedef her zaman `leaf category`** olur. `children` olan (parent) kategori ürün hedefi olarak **kabul edilmez**.
2. **Hedef kategori mutlaka** `Category.externalId` numeric + DB'de gerçek Trendyol kategorisi + aktif `CategoryMapping (marketplaceId=tt)` ile doğrulanır.
3. **Yeni Category satırı oluşturulmaz.** Hedef, DB'deki mevcut gerçek Trendyol kategorisine `externalId` ile eşlenir (duplicate externalId engeli).
4. **AI'ya yalnızca gerçek Trendyol leaf kategorileri aday verilir.** AI çıktısı `Category.externalId` ile doğrulanır; AI kendi ID uyduramaz.
5. **`categoryMatch=true` yalnızca** (gerçek Trendyol leaf hedef + numeric externalId + geçerli CategoryMapping) doğrulanınca yazılır. `categoryId != null` tek başına asla `categoryMatch` sayılmaz.
6. Her yazma işleminde `productId + source category + target Trendyol category + externalId + matching method + confidence` [`AuditLog`](server/prisma/schema.prisma:213) ve AI kararları [`AIDecisionLog`](server/prisma/schema.prisma:490) ile izlenir.

### 4.2 Güven skoru ve manual gate (mevcut eşikler korunur)

| Skor | Karar |
|---|---|
| `confidence >= 0.95` | **HIGH** → otomatik eşleştirme (yalnızca leaf+externalId+Mapping doğrulaması sonrası) |
| `0.85 <= confidence < 0.95` | **MEDIUM** → aday göster (aiSuggestedCategoryId), **categoryMatch YAZILMAZ** |
| `confidence < 0.85` | **LOW** → MANUAL (yazma yok) |

Gerekçe: Mevcut [`aiGateway.ts`](server/src/services/aiGateway.ts:507) prompt eşikleri (0.95 / 0.85) ve [`runAiMatch`](server/src/routes/prepCategories.ts:488) davranışıyla birebir uyumludur; sistemde zaten var olan eşikleri bozmadan kullanılır.

---

## 5. AI KAPSAMI FIX + AI ZİNCİRİ DOĞRULAMA

Tespit: [`runAiMatch`](server/src/routes/prepCategories.ts:436) `where: { categoryId: null }` kullanıyor → 12.101 limbo ürün AI dışı. Ayrıca [`runAiMatch`](server/src/routes/prepCategories.ts:422) aday listesi olarak **tüm 5155 kategoriyi** (lokal `>>>` dahil) veriyor.

Çözüm:
1. Yeni engine, limbo ürünleri (`categoryMatch=false`) AI'ya **yalnızca gerçek Trendyol leaf** adaylarıyla gönderir.
2. Mevcut `runAiMatch` aday listesi minimal şekilde gerçek leaf listesine indirilir (geriye dönük `categoryId:null` akışı güvenli kalır).
3. AI zinciri gerçek API ile doğrulanır:

```text
PRODUCT → AI REQUEST → AI RESPONSE → CATEGORY CANDIDATE (yalnız gerçek leaf)
→ REAL TRENDYOL externalId doğrulama → CategoryMapping → DB
```

4. AI persistence: [`AIDecisionLog`](server/prisma/schema.prisma:490) ve `AIProviderConfig.lastStatus/lastError` doğrulanır; mock kullanılmaz.

**Ön koşul:** AI provider çalışmalı. Mevcut durumda `openrouter` modeli boş. Plan: [`aiSettings.ts`](server/src/routes/aiSettings.ts:1) üzerinden **var olan yapılandırma rotasıyla** `openrouter` model seçimi veya `deepseek` aktifleştirme (kod değişikliği değil, config). Gerçek API testi yapılır.

---

## 6. CATEGORYMAPPING KURALI

```text
categoryMatch=true
  ⟺ ürünün hedef Category'si gerçek Trendyol
    + numeric externalId doğrulanmış
    + geçerli CategoryMapping (marketplaceId=tt, active, externalId numeric)
```

Kör toplu UPDATE:

```sql
UPDATE Product SET categoryMatch=true WHERE categoryMatch=false
```

**UYGULANMAYACAK.** Her ürün bireysel doğrulanmış sonuçla güncellenir.

---

## 7. READY-TO-SHIP KAPISI

Kategori eşleşmesi tek başına READY yapmaz. Mevcut [`readiness.ts`](server/src/services/readiness.ts:84) kapısı:

```text
CATEGORY → BRAND → VARIANT → LISTING TEMPLATE → 4/4 → READY
```

```text
MEVCUT: READY=701 · CATEGORY PASS=1272 · BRAND PASS=13383 · VARIANT PASS=13399 · TEMPLATE PASS=6093 · 4/4=701
FIRST BROKEN GATE = CATEGORY (12.132 takılı)
SECOND BROKEN GATE = LISTING TEMPLATE (7311 takılı; bunun 571'i kategori geçmiş ama bayrak eski)
```

### 7.1 Listing template kontrolü (kör backfill YASAK)

`templateMatch=false` kök neden ayrıştırması:

```text
templateMatch=false toplam = 7311
  ├─ categoryMatch=false  = 6740  (kategori çözülmeden template anlamı yok)
  └─ categoryMatch=true   = 571   (kategori çözülmüş ama bayrak eski/yanlış)
```

- 571 ürün için gerçek şablon ilişkisi [`resolveListingTemplate`](server/src/services/listingTemplateResolver.ts:32) ile doğrulanır (tt genel şablonu mevcut). Doğrulanmışsa `templateMatch=true`; değilse false kalır.
- Kör backfill yapılmaz; 6740 ürün kategori çözülene kadar bekler.
- READY yalnızca 4/4 tamamlanınca; eksik gate açıkça raporlanır.

---

## 8. UYGULAMA FAZLARI

### Faz 0 — Plan onayı (şu an)
Kullanıcı onayı olmadan koda dokunulmaz.

### Faz 1 — AI provider gerçek API doğrulama + model config
- `testProvider` gerçek API ile test edilir.
- `openrouter` model seçimi veya `deepseek` aktifleştirme (config, kod değil).
- AI request/response/DB persistence zinciri kanıtlanır.

### Faz 2 — Yeni eşleştirme motoru (yeni dosyalar + 2 minimal düzeltme)
- [`categoryMatchEngine.ts`](server/src/services/categoryMatchEngine.ts:1) + rota + index mount.
- `runAiMatch` aday listesi minimal fix (yalnız gerçek leaf).

### Faz 3 — 10 gerçek ürün doğrulama
- Gruplardan 10 gerçek ürün seçilir.
- Her ürün için: `XML category, title, brand, attributes, AI/rule candidate, Trendyol target, externalId, confidence, CategoryMapping, categoryMatch` raporlanır.
- **10/10 doğru olmadan batch'e geçilmez.** Yanlış sonuçta durulur, kök neden raporlanır.

### Faz 4 — Batch
```text
50 → 100 → 500 → kalan
```
Her batch sonunda `matched / manual / failed / ambiguous / invalid` sayıları çıkar. Anormal hata oranında durulur.

### Faz 5 — READY + templateMatch yeniden hesap
- Eşleşen ürünler için readiness kapısı yeniden değerlendirilir.
- 571 kategori-geçmiş templateMatch=false ürün gerçek resolver ile doğrulanır.
- `DB READY = API READY = UI READY` eşitliği kanıtlanır.

### Faz 6 — Red team + regression
Aşağıdaki test planı uygulanır.

### Faz 7 — Final rapor (bölüm 11 şablonu)

---

## 9. RED TEAM RİSK ANALİZİ

| # | Risk | Olasılık | Etki | Önlem |
|---|---|---|---|---|
| R1 | Kör toplu `categoryMatch=true` | Yüksek (yanlış yapılırsa) | Kritik | Per-product doğrulanmış yazma; toplu kör UPDATE yok |
| R2 | Sahte CategoryMapping / sahte ID | Orta | Kritik | Yalnızca DB'deki gerçek `externalId` kullanılır; AI ID uyduramaz |
| R3 | AI lokal kategoriye eşleşme | Yüksek (mevcut kodda) | Kritik | Aday listesi yalnız gerçek leaf; sonuç `externalId` ile doğrulanır |
| R4 | Duplicate Category satırı (externalId çakışması) | Orta (mevcut `mapTrendyolCategories`'te) | Yüksek | Yeni engine externalId ile reuse; yeni satır oluşturmaz |
| R5 | Non-leaf hedef | Orta | Yüksek | Leaf-only kontrol (`children=0`) |
| R6 | AI provider çalışmıyor (model boş) | Kesin (şu an) | Yüksek | Faz 1'de provider config + gerçek API test |
| R7 | API başarısız olunca veri bozulması | Orta | Kritik | Fail-closed: API başarısızsa `categoryMatch/READY` değişmez, mapping yazılmaz |
| R8 | templateMatch kör backfill | Orta | Yüksek | Gerçek resolver doğrulaması; kör yok |
| R9 | Yanlış READY (gate eksik) | Orta | Yüksek | 4/4 kapısı; eksik gate raporlanır |
| R10 | Çalışan modülleri bozma | Orta | Kritik | Yeni dosyalar + 2 minimal düzeltme; Brand/Variant/Price/Stock/Auth/XML dokunulmaz |
| R11 | DB/migration/seed/git | Düşük | Kritik | Yasak; yapılmayacak |
| R12 | Veri kaybı | Düşük | Kritik | Öncesi snapshot/backup; yalnız değişen kayıtlar geri alınabilir |

---

## 10. RED TEAM TEST PLANI

### CATEGORY
exact match · normalized match · parent-child match · ambiguous category · unknown category · missing supplierCategory · fake externalId · invalid externalId · non-leaf category · duplicate category

### AI
valid provider · invalid provider · missing model · invalid API key · timeout · 429 · 5xx · malformed AI response · AI invented category ID · AI valid category ID · persistence

### READY
category fail · brand fail · variant fail · template fail · price fail · stock fail · all gates pass

### SAFETY
API başarısızsa → `categoryMatch` değişmez, `READY` değişmez, sahte mapping yazılmaz.

### REGRESSION
Login/Auth · Dashboard · XML Import · Product Pool · Category · Brand · Variant · Listing · Listing Price Rules · AI Control Center · Ready-to-Ship · Marketplace · Sending Center · Reports · **Stock Automation (closeAt/openAt/hysteresis — dokunulmaz)**.

### CANLI API
Gerçek Trendyol credential ile kategori ağacı `HTTP 200 + 3867` doğrulanır. Satış aç/kapat tetiklenmez.

---

## 11. FINAL RAPOR ŞABLONU

```text
DG STOK — CATEGORY + AI + READY FINAL RED TEAM

TRENDYOL TREE
TOTAL = 3867
LEAF = 3361
DUPLICATE = 0
ORPHAN = 0
CYCLE = 0

BEFORE
CATEGORY AUTO = ...
AI = ...
MANUAL = ...
READY = 701

AFTER
CATEGORY AUTO = ...
AI = ...
MANUAL = ...
READY = ...

AI REAL REQUEST = ...
AI REAL RESPONSE = ...
AI DB PERSISTENCE = ...

10 PRODUCT VALIDATION = ...

50 BATCH = ...
100 BATCH = ...
500 BATCH = ...
FINAL BATCH = ...

CATEGORY GATE = ...
BRAND GATE = ...
VARIANT GATE = ...
LISTING TEMPLATE GATE = ...
PRICE GATE = ...
STOCK GATE = ...

READY DB = ...
READY API = ...
READY UI = ...

REGRESSION = ...
TSC = ...
BUILD = ...
BROWSER = ...
NETWORK = ...
CONSOLE = ...

REAL TRENDYOL API = ...

FAKE DATA = NO
MOCK PASS = NO
SCHEMA CHANGE = NO
MIGRATION = NO
DB RESET = NO
SEED = NO
GIT = NO

TEST DATA LEFTOVER = 0

FAIL COUNT = ?

FINAL = PASS / FAIL
```

---

## 12. KABUL KRİTERLERİ (SAHTE PASS YASAK)

1. Her eşleşme gerçek Trendyol **leaf** `externalId` ile doğrulanmış olacak.
2. Doğrulanmamış ürün **MANUAL** kalacak; yanlış kategori + READY üretilmeyecek.
3. `DB READY = API READY = UI READY`.
4. 10/10 ürün doğrulaması geçmeden batch başlamayacak.
5. Regression'da çalışan modül bozulmayacak.
6. `%100 doğruluk sağlanamayan hiçbir şey FINAL PASS ile işaretlenmeyecek.`

---

> **DURUM:** Plan hazır. Kod değişikliği yapılmadı (yalnızca 3 read-only ölçüm script'i oluşturuldu: [`_cat-plan-probe.ts`](server/_cat-plan-probe.ts:1), [`_cat-plan-probe2.ts`](server/_cat-plan-probe2.ts:1), [`_cat-plan-probe3.ts`](server/_cat-plan-probe3.ts:1)). Onay bekleniyor.
