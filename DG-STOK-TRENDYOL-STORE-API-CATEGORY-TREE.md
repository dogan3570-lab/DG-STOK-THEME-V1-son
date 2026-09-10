# DG STOK — TRENDYOL MAĞAZA API BAĞLANTISI + GERÇEK KATEGORİ AĞACI

Tarih: 2026-08-16 · READ-ONLY + gerçek API testi · DB'ye YAZMA YOK · Credential değerleri rapora YAZILMADI.

> KORUMA: schema/migration/db push/seed/reset/git YAPILMADI. Ürün/categoryMatch/READY DEĞİŞTİRİLMEDİ. Sahte CategoryMapping / sahte Trendyol ID / sahte READY ÜRETİLMEDİ. Mock kullanılmadı.

---

## 2. MEVCUT TRENDYOL MAĞAZA BAĞLANTISI (READ-ONLY)

```
marketplaceId       = 757a071c-98c5-4c96-bb8c-2dceac1568dd
marketplaceKey      = tt
name                = Trendyol
apiUrl              = https://api.trendyol.com/sapigw/selling/
apiStatus           = connected
SELLER ID           = PRESENT (numeric)
API KEY             = PRESENT (decryptable = true)
API SECRET          = PRESENT (decryptable = true)
adapter             = TrendyolAdapter (adapters.ts, key='tt')
```

Credential değerleri yalnızca istek anında [`crypto.ts`](server/src/services/crypto.ts:100) `decryptCredential` ile açıldı; değerler rapora/loga yazılmadı.

---

## 3. GERÇEK PROD API BAĞLANTISI (mock yok)

```
GET https://apigw.trendyol.com/integration/product/product-categories
HTTP STATUS = 200 (ok=true)
```

[`trendyolCatalog.ts`](server/src/services/trendyolCatalog.ts:78) `fetchTrendyolCategoryTree()` ile aynı endpoint ve Basic Auth kullanıldı.

---

## 4. KATEGORİ AĞACI DOĞRULAMA

```
CATEGORY COUNT   = 3867
ROOT COUNT       = 16
LEAF COUNT       = 3361
DUPLICATE ID     = 0
ORPHAN (parentId yok) = 0
CYCLE            = 0
PARENT/CHILD INTEGRITY = PASS
```

20 gerçek örnek (id | name | parentId | subCount):

```
368  | Aksesuar            | ROOT      | 15
387  | Saat                | 368       | 0   (leaf)
394  | Şapka               | 368       | 0   (leaf)
396  | Takı & Mücevher     | 368       | 17
397  | Bileklik            | 396       | 10
1238 | Altın Bileklik      | 397       | 0   (leaf)
...
```

**Kanıt:** Gerçek parent-child hiyerarşisi ve gerçek numeric Trendyol category ID'leri geldi. `subCategories.length === 0` olan **3361 leaf** kategori, ürün aktarımında kullanılacak hedef katalogdur.

---

## 5. LEAF KRİTİK KONTROL

Trendyol ürün aktarımı **leaf (alt kategorisi olmayan) category ID** ister. Doğrulandı: 3361 leaf (subCategories.length=0). Kategori seçiminde ROOT→PARENT→CHILD→LEAF mantığı kullanılmalı; virtual parent seçilemez olmalı (mevcut UI'da zaten böyle).

---

## 6. MEVCUT DG STOK KATEGORİLERİYLE KARŞILAŞTIRMA

```
DB Category            = 1311
externalId dolu        = 23 (gerçek numeric Trendyol ID)
externalId null        = 1288 (local XML ">>>" kategori)
mevcut Trendyol mapping= 23

GERÇEK TRENDYOL AĞACI  = 3867 kategori (16 root, 3361 leaf)
```

DB'deki 23 mapping, gerçek 3867'lik ağacın küçük bir alt kümesidir. 1288 local XML kategorisi gerçek Trendyol kategorisi DEĞİLDİR.

---

## 7. DB'YE KAYDETME PLANI (UYGULANMADI — onay bekliyor)

Mevcut schema ([`Category`](server/prisma/schema.prisma:231) + [`CategoryMapping`](server/prisma/schema.prisma:302)) gerçek ağacı saklamaya YETERLİ:

```
SCHEMA CHANGE = NO
MIGRATION     = NO
DB PUSH       = NO
```

Önerilen plan (onay sonrası):
1. 3867 gerçek Trendyol kategorisi `Category.externalId` (numeric string) + gerçek `parentId` ile upsert.
2. 3361 leaf kategori için `CategoryMapping` (marketplaceId=tt, numeric externalId) oluştur.
3. Duplicate kontrolü: mevcut 23 mapping ile kesişim; upsert/atla.
4. Ürünler bu aşamada DEĞİŞMEZ.

```
eklenecek Category ≈ 3867
eklenecek CategoryMapping ≈ 3361
duplicate (mevcut 23 ile kesişim) ≈ 23'e kadar
mevcut ürünlere etki = YOK (bu turda)
```

---

## 8. İNTERNET KESİLİRSE

```
Önceden senkronize edilmiş Trendyol katalog → DB'den kullanılabilir
Yeni senkronizasyon → SYNC FAIL → mevcut katalog KORUNUR
local XML kategorisi → Trendyol kategorisi KABUL EDİLMEZ
fake externalId / categoryMatch=true / READY → ÜRETİLMEZ (fail-closed)
```

---

## 10. BROWSER GÖZ TESTİ (Chromium)

LOGIN ✅ · MARKETPLACE (Trendyol görünüyor) ✅ · CATEGORY TREE (hiyerarşik, ▶/▼) ✅

Console error = 0 gerçek hata (yalnız giriş öncesi beklenen `/auth/me` 401) · Page error = 0 · Login sonrası 4xx/5xx = 0.

---

# TRENDYOL STORE CONNECTION FINAL RED TEAM

```
TRENDYOL STORE CONNECTION        = PASS (credential present + decryptable + sellerId numeric)
REAL PROD API                    = PASS (HTTP 200)
REAL CATEGORY TREE               = PASS (3867 kategori)
CATEGORY COUNT                   = 3867
LEAF COUNT                       = 3361
PARENT/CHILD INTEGRITY           = PASS (0 orphan / 0 cycle)
DUPLICATE CHECK                  = PASS (0 duplicate)
DB COMPATIBILITY                 = PASS (mevcut schema yeterli, değişiklik yok)
BROWSER                          = PASS
NETWORK                          = PASS
CONSOLE                          = PASS

12.100 PRODUCTS MODIFIED         = NO
CATEGORY MATCH MODIFIED          = NO
READY MODIFIED                   = NO
FAKE DATA                        = NO
MOCK API                         = NO
SCHEMA                           = NO CHANGE
MIGRATION                        = NO
DB RESET                         = NO
SEED                             = NO
GIT                              = NO

REAL TRENDYOL API = VERIFIED

NEXT STEP = Kullanıcı onayıyla: 3867 gerçek kategori + 3361 leaf CategoryMapping'i
            güvenli şekilde DB'ye al (duplicate kontrolü ile), ardından 12.100 ürünü
            XML kategori → AI → gerçek Trendyol leaf → candidate → onay → CategoryMapping
            → categoryMatch=true akışıyla eşleştir.

FAIL COUNT = 0
FINAL = PASS
```

> **SONUÇ:** Gerçek Trendyol mağaza credential'ı ÇALIŞIYOR; PROD kategori endpoint'i HTTP 200 döndü ve **3867 gerçek Trendyol kategorisi** (16 root, 3361 leaf) doğrulandı (0 duplicate, 0 orphan, 0 cycle). Mevcut DG STOK schema'sı bu ağacı güvenle saklamaya yeterli; bu turda hiçbir ürün/categoryMatch/READY değiştirilmedi, toplu import yapılmadı. Bir sonraki adım onaylı güvenli import + 12.100 ürünün gerçek Trendyol leaf hedeflerine eşleştirilmesidir.
