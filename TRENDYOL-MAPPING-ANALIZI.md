# TRENDYOL MAPPING STRATEJİSİ — READ-ONLY ANALİZ RAPORU

Bu rapor **kod yazılmadan**, **DB değiştirilmeden**, **migration yapılmadan** üretilmiştir.
Yalnızca mevcut şema, mevcut route/service kodu ve canlı DB'nin read-only sorgulanması ile hazırlanmıştır.
Resmi Trendyol sözleşmesi [`TRENDYOL-ADAPTER-PLAN.md`](TRENDYOL-ADAPTER-PLAN.md:1) içinde doğrulanmıştır.

---

## 1. ROOT CAUSE (mapping özelinde)

Trendyol V2 payload'u numeric `categoryId`, numeric `brandId` ve kategori-bazlı `attributes[]` zorunlu tutar.
Mevcut sistemde bu üç değeri provider'a güvenli şekilde taşıyacak **veri** hiç doldurulmamıştır:

- `CategoryMapping` (tüm marketplace'ler): **0 kayıt** → numeric `categoryId` çözümlenemez.
- `Category.externalId`: **0 / 1.288** dolu → kategori ID'si yok.
- `Brand.externalId`: **0 / 17** dolu → numeric `brandId` yok.
- Kategori-özellik (`attributeId`/`attributeValueId`) mapping altyapısı: **hiç yok**; `MarketplaceVariantRule` tablosu boş (0 kayıt).
- `Product.technicalSpecs`: **0** ürün dolu → teknik özellik (attribute) kaynağı kısıtlı; `Product.detail` 13.382 ürün dolu.
- READY 5.526 ürünün **0** tanesinde category mapping, **0** tanesinde brand externalId var → gönderilebilir ürün YOK.

Dolayısıyla sorun adapter şemasından önce **mapping verisinin yokluğudur**. SAHTE ID üretilmesi yasak olduğundan
mevcut durumda her gönderim `MAPPING_NOT_FOUND` ile engellenmelidir.

---

## 2. READ-ONLY DB BULGULARI (15.08.2026)

| Veri | Durum |
|------|-------|
| `Category` toplam | 1.288 (isim formatı: `"a >>> b >>> c"` düz string; `parentId` hiyerarşiyle dolu) |
| `Category.externalId` dolu | 0 |
| `CategoryMapping` toplam | 0 |
| `Brand` aktif | 17; `externalId` dolu: 0 |
| `BrandMapping` | 15 (xmlBrandName→dgBrandId iç eşleştirme; Trendyol brandId'si YOK) |
| `Product.technicalSpecs` dolu | 0 |
| `Product.detail` dolu | 13.382 |
| `Product.images` dolu | 13.400 |
| `Product.brandUsageType` | DG_BRAND: 13.401, XML_BRAND: 3 |
| `Variant` toplam | 30.251 |
| `Variant` gerçek attribute'lar | Beden 10.518, Renk 5.467, Numara 748, Kapasite 114 |
| `Variant` bozuk/yanlış kayıt | `name="AKYI"` 13.382 (SKU prefix'i attribute olarak kaydedilmiş) |
| `MarketplaceVariantRule` | 0 kayıt (tablo boş) |
| `VariantAnalysis` | 8 |
| READY ürün | 5.526; category mapping'li: 0; brand externalId'li: 0 |

**Variant değer örnekleri (mevcut, gerçek):**
- Beden: `S, XS, M`
- Renk: `Sari, Kahverengi, Beyaz, Mavi, Kirmizi, Siyah, Altin, Yesil, Krem, Mor`
- Numara: `41, 40, 36, 45, 48, 50, 35, 33, 43, 34`
- Kapasite: `64GB, 2GB, 1GB, 128GB, 256GB, 32GB`

---

## 3. MEVCUT MİMARİ — HANGİ ALAN NE İÇİN KULLANILABİLİR

| Trendyol ihtiyacı | Mevcut taşıyıcı alan | Schema değişikliği? | Doldurma yolu |
|-------------------|----------------------|---------------------|---------------|
| `categoryId` (integer) | [`CategoryMapping.externalId`](server/prisma/schema.prisma:302) (string) | YOK — tablo mevcut | getCategoryTree ile isim eşleştir → externalId'ye numeric ID yaz |
| `brandId` (integer) | [`Brand.externalId`](server/prisma/schema.prisma:245) (string) | YOK — alan mevcut | getBrands/by-name ile isim eşleştir → externalId'ye numeric ID yaz |
| `attributes[]` (kategori özellikleri) | runtime `getCategoryAttributes` + `getCategoryAttributeValues`; kalıcı önbellek için [`MarketplaceVariantRule`](server/prisma/schema.prisma:448) JSON alanları (`attributeRules`, `colorMapping`, `sizeMapping`) | YOK — tablo mevcut (0 kayıt) | Canlı çözümleme + JSON önbellek |
| attribute değer kaynağı | [`Variant`](server/prisma/schema.prisma:259) (name/value) + `Product.detail` | YOK | Renk/Beden/Numara/Kapasite → attribute adı/değeri eşleştir |
| `productMainId` | `Product.sku` / `VariantAnalysis.familyId` | YOK | sku (veya parent sku) → productMainId; varyant ailelerini gruplar |
| `dimensionalWeight` (desi) | **kaynak yok** (`Product`'te alan yok) | YOK (eklenemez) | `detail`/XML'den parse VEYA güvenli `0` + açık veri-eksikliği işareti |
| `quantity` | `Product.stock` | YOK | birebir map |
| `stockCode` | `Product.sku` | YOK | birebir map |
| `listPrice`/`salePrice` | `Product.salePrice` (+ purchasePrice) | YOK | salePrice→salePrice; listPrice için ayrı kaynak yoksa salePrice'a eşit veya `MAPPING_NOT_FOUND` |
| `description` | `Product.description` (HTML'e çevrilir) | YOK | listingEngine render |
| `images` | `Product.images` (CSV string) | YOK | `[{url}]`'ye dönüştür (max 8) |

**Önemli:** `attributes[]`'in `attributeId`/`attributeValueId` değerleri kategori bazında değişir ve Trendyol
haftalık güncelleme önerir. Bu yüzden kalıcı tek kaynak yeterli değildir; **canlı çözümleme** zorunludur.

---

## 4. MAPPING STRATEJİSİ (schema değişikliği olmadan)

### 4.1 Category → `categoryId`
1. Trendyol `GET /product/product-categories` (getCategoryTree) çekilir.
2. Mevcut kategori isimleri (`"aksesuar >>> canta >>> omuz cantasi"` gibi) Trendyol ağacının yaprak düğümleriyle normalize isim + AI ile eşleştirilir.
3. Eşleşen **en alt seviye** kategori ID'si `CategoryMapping.externalId`'ye (marketplaceId=tt) yazılır. Bu data-level doldurmadır; migration değildir.
4. Gönderimde: `categoryId = Number(externalId)`; boş/numeric-değilse → `MAPPING_NOT_FOUND`.

### 4.2 Brand → `brandId`
1. Trendyol `GET /product/brands` (sayfalı) ve/veya `GET /product/brands/by-name?name=...` ile marka adı aranır.
2. Eşleşen markanın numeric `id`'si `Brand.externalId`'ye yazılır. Data-level doldurma.
3. Gönderimde: `brandId = Number(product.brand.externalId)`; yoksa → `MAPPING_NOT_FOUND`.

### 4.3 Attributes (kategori özellikleri) — en kritik boşluk
Mevcut mimaride en güvenli yaklaşım **canlı çözümleme + sınırlı JSON önbellek** hibritidir:

```
Gönderim (READY ürün):
1. categoryId çözümlenir (4.1)
2. GET /product/categories/{categoryId}/attributes  → categoryAttributes[]
3. required=true olan attribute'lar alınır
4. Her required attribute için:
   - GET /product/categories/{categoryId}/attributes/{attributeId}/values → attributeValueId listesi
   - Ürünün Variant(name,value) + Product.detail metni ile eşleştirilir (normalize + AI)
   - allowCustom=true ise {attributeId, attributeValue: string}
   - değilse {attributeId, attributeValueIds: [attributeValueId]} (allowMultipleAttributeValues'a göre)
5. Eşleştirilemeyen required attribute varsa → MAPPING_NOT_FOUND (gönderim ENGELLENİR)
6. Opsiyonel kalıcı önbellek: çözümlenen eşleştirmeler MarketplaceVariantRule.attributeRules
   (JSON) içinde tutulabilir; ancak canlı doğrulama her zaman önceliklidir (kategori güncellenebilir).
```

**Kaynak tespit sorunu (RED TEAM'e giriş):** `Variant` tablosunda 13.382 adet `name="AKYI"`
kaydı SKU prefix'inden gelmiştir; bunlar attribute değildir. Canlı çözümleme yalnızca tanınan
attribute adlarını (Renk/Beden/Numara/Kapasite/Cinsiyet/Materyal/Model/Hacim/Ölçü) kabul etmeli,
diğerleri yok sayılmalıdır.

### 4.4 `productMainId` ve varyantlama
- Tek ürün gönderiminde `productMainId = Product.sku` (veya sku'nun parent kısmı) kullanılır.
- Çoklu varyant aynı `productMainId` ile gönderilir (resmi varyant kuralı). Mevcut sistem tek ürün
  gönderdiği için ilk aşamada tek item + `productMainId=sku` yeterlidir; gerçek varyant ailesi
  gönderimi ayrı bir fazdır.

### 4.5 Eksik alanlar — `dimensionalWeight`, `listPrice`
- `dimensionalWeight`: `Product`'te alan yok. Kaynak yoksa **uydurma**. İki güvenli seçenek:
  (a) `Product.detail`/XML'den parse, (b) parse edilemiyorsa gönderimi `DATA_MISSING` ile durdur
  veya resmi kurala uygun güvenli varsayılan yalnızca operatör onayıyla. `0` körü körüne gönderilmez.
- `listPrice`: mevcut sistemde tek fiyat var (`salePrice`). `listPrice ≥ salePrice` kuralı gereği
  güvenli yaklaşım `listPrice = salePrice` (aynı değer) olabilir; ancak bu bir iş kuralı kararıdır
  ve açıkça işaretlenmelidir.

---

## 5. AFFECTED FILES (uygulama aşamasında — şu an dokunulmadı)

- [`server/src/services/marketplace/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:123) — category/brand/attribute çözümleme gate'i
- [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts:104) — payload'a numeric ID + attributes + User-Agent
- [`server/src/services/marketplace/types.ts`](server/src/services/marketplace/types.ts:21) — payload tipi (items, brandId, categoryId, attributes, productMainId, quantity, stockCode, dimensionalWeight, listPrice/salePrice)
- [`server/src/services/marketplace/errors.ts`](server/src/services/marketplace/errors.ts:1) — `MAPPING_NOT_FOUND`, `DATA_MISSING`
- Yeni servis (kod): `trendyolCatalog.ts` — getBrands / getCategoryTree / getCategoryAttributes / getCategoryAttributeValues canlı istemcisi (SSRF + bounded retry korunur)
- [`server/src/routes/prepCategories.ts`](server/src/routes/prepCategories.ts:691) / [`server/src/routes/prepBrands.ts`](server/src/routes/prepBrands.ts:167) — mapping doldurma uçları (zaten mevcut; data girişi için kullanılır)

## 6. LOCKED FILES (değişmeyecek)

[`server/prisma/schema.prisma`](server/prisma/schema.prisma:1) — migration/seed/DB reset YOK.
[`server/src/routes/readyToShip.ts`](server/src/routes/readyToShip.ts:1), [`server/src/services/readiness.ts`](server/src/services/readiness.ts:1),
[`server/src/routes/products.ts`](server/src/routes/products.ts:1), [`server/src/routes/dashboard.ts`](server/src/routes/dashboard.ts:1),
[`server/src/routes/reports.ts`](server/src/routes/reports.ts:1), [`server/src/routes/listingV2.ts`](server/src/routes/listingV2.ts:1) — READY/readiness mantığı değişmez.

---

## 7. RED TEAM RİSKİ (mapping özelinde)

| Risk | Kontrol |
|------|---------|
| SAHTE `categoryId`/`brandId` | Sadece `externalId` numeric parse edilir; boş/non-numeric → `MAPPING_NOT_FOUND`. Elle uydurma değer yok. |
| Yanlış kategori ID (alt kategorisi olan) | getCategoryTree'de yaprak düğüm kontrolü; aksi → `MAPPING_NOT_FOUND`. |
| Attribute ID/value ID spoof | Yalnızca o kategori için getCategoryAttributes/getCategoryAttributeValues yanıtından alınır; kategori dışı ID reddedilir. |
| `name="AKYI"` benzeri çöp varyant | Tanınan attribute adları beyaz listesi; bilinmeyen adlar yok sayılır. |
| `dimensionalWeight` uydurma | Kaynak yoksa `DATA_MISSING`; sessiz `0` yok. |
| `listPrice < salePrice` | Doğrulama: listPrice ≥ salePrice; aksi → `VALIDATION_ERROR`. |
| Attribute value eşleşmesinde yanlış eşleşme | AI düşük güven eşiği altıysa zorunlu attribute doldurulmaz → `MAPPING_NOT_FOUND`. |
| Mapping data yazımında credential/log sızıntısı | getBrands/getCategoryTree istekleri Basic Auth içerir; Authorization/raw body loglanmaz (mevcut sözleşme). |
| Rate limit (Marka/Kategori 50 req/min) | Catalog istemcisi bounded; önbellek + backoff. |

---

## 8. KARAR (DUR)

Mapping altyapısı **şemada mevcut** (`CategoryMapping.externalId`, `Brand.externalId`,
`MarketplaceVariantRule` JSON) — schema değişikliğine gerek YOK. Ancak bu alanlarda **veri yok**;
ayrıca kategori-özellik (attributes) çözümlemesi için yeni bir **canlı catalog istemcisi** gerekir.

- Category mapping: **YOK** (data eksik)
- Brand mapping: **YOK** (data eksik)
- Attributes mapping: **altyapı + veri YOK**

Bu üçü tamamlanmadan payload zorunlu alanları güvenli doldurulamaz; **SAHTE ID ÜRETİLMEZ**,
**CANLI GÖNDERİM ENGELLENİR** (`MAPPING_NOT_FOUND` / `DATA_MISSING`).

**Sonraki adım (onay ile, uygulama fazı):**
1. [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:123) mapping gate'i: category/brand/attributes çözümle, eksikse `MAPPING_NOT_FOUND`
2. `trendyolCatalog.ts` canlı catalog istemcisi (brand/category/attribute servisleri)
3. Adapter payload'u resmi şemaya çevir (items wrapper, numeric ID, images obj, attributes)
4. Mapping verisi operatör/otomatik eşleştirme ile doldurulmadan canlı çağrı YAPMA
