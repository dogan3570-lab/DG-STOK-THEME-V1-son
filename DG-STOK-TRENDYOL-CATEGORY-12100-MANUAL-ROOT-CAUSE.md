# DG STOK — TRENDYOL CATEGORY + 12.100 MANUAL ROOT CAUSE RED TEAM

Tarih: 2026-08-16 · READ-ONLY inceleme · Hiçbir veri/fix uygulanmadı.

> KORUMA: schema/migration/db push/seed/reset/git YAPILMADI. Toplu ürün güncellemesi / sahte mapping / sahte categoryMatch / sahte READY ÜRETİLMEDİ. Sadece okuma yapıldı.

---

## DB GERÇEKLİK DENETİMİ

### Category (1311)

```
toplam Category          = 1311
externalId != null       = 23   (GERÇEK Trendyol ID taşıyanlar)
externalId == null       = 1288
parentId != null         = 0
parentId == null         = 1311 (tamamı düz liste)
isimde ">>>" olan        = 1272 (local XML kategorileri)
```

### CategoryMapping (23)

```
toplam mapping           = 23
marketplace dağılımı     = tamamı Trendyol (tt)
Trendyol mapping         = 23
gerçek numeric externalId= 23
```

### Product (AKILLIBAYI1)

```
toplam ürün              = 13382
categoryId null          = 30
categoryId dolu          = 13352
categoryMatch=true       = 1252
categoryMatch=false      = 12130
categoryId dolu + match false (LIMBO) = 12100
categoryId dolu + gerçek CategoryMapping var = 0
categoryId dolu + gerçek CategoryMapping yok = 12100
```

---

## 12.100 ÜRÜNÜN KÖK NEDENİ (20 gerçek örnekle kanıtlı)

20 örneğin TAMAMI aynı desende:

```
SKU: AKYI-000001 … AKYI-000522 …
supplierCategory   = "Bahce > Yapi Market / Bahce / Oto > ..." (XML'den)
categoryId         = lokal kategori (ör. "yapi market / bahce / oto >>> bahce >>> ...")
Category.name      = ">>>" yollu LOKAL isim
Category.externalId= null
CategoryMapping    = YOK
categoryMatch      = false
templateMatch      = karışık (bazıları true, bazıları false)
brandMatch         = true
variantMatch       = false (variantStatus=NOT_REQUIRED)
status             = XML
```

**Cevap:** Bu ürünler gerçek Trendyol kategorisine **HİÇ eşleşmemişti**. `categoryId` yalnızca XML'den üretilen LOKAL kategoriye işaret ediyor; o kategorinin `externalId=null` ve hiç `CategoryMapping` kaydı yok.

---

## TRENDYOL KATEGORİ AĞACI NEREDEN GELDİ?

```
DB'de gerçek Trendyol kategori ağacı  = YOK
DB'deki kategori kayıtları            = 1311 (23 gerçek Trendyol leaf + 1288 lokal XML ">>>" kategori)
parentId hiyerarşisi                  = YOK (parentId hepsi null)
662 virtual node                      = RUNTIME'da ">>>" isimlerden üretilen sanal ağaç (benim /categories/tree fix'im)
```

[`/categories/tree`](server/src/routes/prepCategories.ts:124) artık `parentId` yerine `>>>` ayraçlı isimleri runtime'da parçalayarak hiyerarşi üretir. Bu **DB'deki gerçek Trendyol ağacı DEĞİLDİR**; local XML kategorilerinin görselleştirilmesidir.

---

## İNTERNET YOKKEN NE OLDU?

[`fetchTrendyolCategoryTree`](server/src/services/trendyolCatalog.ts:1) internet yokken başarısız → [`mapTrendyolCategories`](server/src/services/trendyolMapping.ts:46) `CATALOG_UNAVAILABLE` döner → **CategoryMapping OLUŞMAZ**.

Eski [`xmlImport.ts`](server/src/services/xmlImport.ts:582) ise internetten bağımsız olarak XML'in kategori alanından **lokal kategori** oluşturup `categoryId`'yi buna bağlıyordu ve **`categoryMatch=true + status=READY`** yazıyordu — gerçek mapping olmadan. Sahte "tamamlanmış" görünümün kaynağı buydu.

---

## TARİHSEL DEĞİŞİKLİK ANALİZİ

Audit loglarında `RULE_CATEGORY_MATCH` (kural tabanlı, yalnız 30 ürün) ve `AI_CATEGORY_MATCH_V2` kayıtları var. Toplu bir "categoryMatch=false" backfill audit logu YOKTUR çünkü o düzeltme doğrudan `product.update` ile yapıldı (backup: `server/_backup-category-match-1786915857404.json`, 6406 kayıt).

**İlişki zinciri:**
1. Eski import: `categoryMatch=true + READY` (sahte) → ürünler "tamamlanmış" görünüyordu.
2. Benim backfill'im: `categoryMatch = (gerçek numeric CategoryMapping var mı)` → 6406 ürün düzeltildi, 12.100 ürün `categoryMatch=false` oldu.
3. Sonuç: 12.100 ürün dürüstçe MANUAL görünmeye başladı.

---

## EN KRİTİK KONTROL — A / B / C

> **12.100 ürün daha önce gerçekten Trendyol'a eşleşmiş miydi?**

**Cevap: B + C.**

- **A (mapping vardı, kayboldu):** YOK. Mapping silindiğine dair hiçbir log/kanıt yok; 23 mapping hep vardı, hep Trendyol.
- **B (hiç gerçek mapping yoktu, yanlışlıkla tamam görünüyordu):** EVET. Ürünlerin `externalId=null` lokal kategorisi var; import sahte `categoryMatch=true+READY` yazdı.
- **C (kategori sistemi değişti, eski local category artık mapping sayılmıyor):** KISMEN. Benim backfill'im `categoryMatch` anlamını "gerçek mapping var" olarak netleştirdi.

---

## AI KAPSAMI

[`runAiMatch`](server/src/routes/prepCategories.ts:355) ve kural tabanlı [`/ai-match`](server/src/routes/prepCategories.ts:139) yalnızca `where: { categoryId: null }` işler → **12.100 limbo AI'ya GÖNDERİLMİYOR**. Neden: AI "kategorisiz ürüne kategori ata" için tasarlandı; limbo ürünler zaten lokal kategori taşıyor. Kapsam genişletilirse risk: AI lokal kategoriye sahte `categoryMatch=true` yazar (gerçek Trendyol mapping olmadan) — YASAK.

---

## READY-TO-SHIP KANITI

```
READY = 700
CATEGORY PASS = 1252   CATEGORY FAIL = 12130
BRAND PASS = 13382     BRAND FAIL = 0
VARIANT PASS = 13382   VARIANT FAIL = 0
LISTING TEMPLATE PASS = 6092  LISTING TEMPLATE FAIL = 7290
4/4 = 700
```

**FIRST BROKEN GATE = CATEGORY** (12.130 ürün burada takılı; 552 ürün kategori geçiyor ama listing template bayrağı eski).

---

## ÇÖZÜM TASARIMI (BU AŞAMADA UYGULANMADI)

```
XML kategori
  ↓
AI / eşleştirme motoru  → GERÇEK TRENDYOL KATEGORİ AĞACI (internet gerekli)
  ↓
GERÇEK Trendyol externalId
  ↓
CategoryMapping (duplicate kontrolü)
  ↓
categoryMatch=true (yalnızca gerçek mapping doğrulanınca)
  ↓
Brand → Variant → Listing Template → 4/4 → READY
```

**İnternet/API erişimi olmadan GERÇEK Trendyol externalId üretilemez.** Bu yüzden:

```
TRENDYOL CATEGORY SOURCE = NOT VERIFIED
REAL MARKETPLACE API = NOT VERIFIED
```

İnternet gelince (kullanıcı onayıyla): Trendyol category tree çek → doğrula → DB'ye güvenli yaz → duplicate kontrolü → local kategorilerle ilişkilendir → CategoryMapping oluştur → 5-10 ürünle uçtan uca test. **Şimdi uygulanmadı.**

---

# DG STOK — TRENDYOL CATEGORY + 12.100 MANUAL ROOT CAUSE RED TEAM

```
ROOT CAUSE = 12.100 ürünün gerçek Trendyol CategoryMapping'i HİÇ oluşmadı;
             lokal XML ">>>" kategorisine bağlılar (externalId=null).
             Eski XML import'u sahte categoryMatch=true + READY yazdığı için
             "tamamlanmış" görünüyorlardı; bu sahte durum düzeltilince MANUAL'a düştüler.

12.100 PRODUCTS = categoryId dolu + categoryMatch=false + CategoryMapping YOK
TRENDYOL CATEGORY TREE IN DB = NO (yalnız 23 gerçek leaf mapping var, hiyerarşi yok)
REAL TRENDYOL CATEGORY IDS = 23
CATEGORY MAPPING = 23 (tamamı Trendyol, numeric)
LOCAL XML CATEGORY = 1288 (">>>" isimli, externalId null)
CATEGORY MATCH = 1252 true / 12130 false
AI COVERAGE = yalnızca categoryId=null (30 ürün); 12.100 kapsam dışı
READY GATE = 700 (FIRST BROKEN GATE = CATEGORY)

HISTORICAL CHANGE = XML import sahte categoryMatch=true+READY → backfill düzeltti → 12.100 MANUAL

FIX REQUIRED = YES (gerçek Trendyol kategori ağacı çekilip mapping oluşturulmalı)

PROPOSED FIX = internet/credential ile gerçek Trendyol category tree çek → duplicate kontrolü →
               CategoryMapping → yalnızca doğrulanmış ürünlerde categoryMatch=true → 4/4 → READY

RISK = kapsamı genişletip lokal kategoriye sahte categoryMatch=true yazmak (YASAK);
       gerçek credential olmadan mapping üretilemez

SCHEMA CHANGE = NO
MIGRATION = NO
SEED = NO
DB RESET = NO
REAL DATA MODIFIED = NO

REAL MARKETPLACE API = NOT VERIFIED

FAIL COUNT = 3 (CATEGORY GATE / AI COVERAGE / TRENDYOL CATEGORY SOURCE)

FINAL = FAIL (gerçek Trendyol category tree DB'de yok; 12.100 ürün mapping'siz)
```

---

## TEK CÜMLELİK KESİN CEVAP

> **12.100 ürün MANUAL oldu çünkü gerçek Trendyol `CategoryMapping`'leri hiç oluşmadı (ürünler yalnızca `externalId=null` lokal XML kategorisine bağlı); daha önce "tamamlanmış" görünmelerinin tek nedeni eski XML import'unun gerçek mapping olmadan sahte `categoryMatch=true + status=READY` yazmasıydı ve bu sahte durum benim yaptığım categoryMatch backfill'i ile düzeltilince ürünler dürüstçe MANUAL olarak görünmeye başladı.**
