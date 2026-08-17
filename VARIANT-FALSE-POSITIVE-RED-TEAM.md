# VARIANT FALSE POSITIVE RED TEAM

Tarih: 2026-08-15 · Ortam: Chromium/Playwright · URL: `http://localhost:4001` · XML: AKILLIBAYI1

---

## TARGET PRODUCT

```text
HOBİBAHÇEM® 18 Inc 45 Cm Kumandali Sanayi Tipi Ayakli Vantilator
5-METAL Pervane 3-KADEME Hiz 65W Y:137CM

PRODUCT ID  = 9239cef5-0766-4090-93a0-8e1c7ca985c7
SKU         = AKYI-053937
XML RAW     = <sku>AKYI-053937</sku> (flat XML, varyant/combination alanı YOK)
```

## SONUÇ

```text
VARIANT FALSE POSITIVE RED TEAM

TARGET PRODUCT
HOBİBAHÇEM® 18 Inc 45 Cm ... (AKYI-053937)

OLD RESULT
VARIANT = YES (MANUAL_REVIEW; AKYI=053937, Beden=S, Numara=45)

NEW RESULT
VARIANT = NO (NOT_REQUIRED)

AKYI
NOT VARIANT (stok/SKU kodu)

BEDEN=S
FALSE POSITIVE (başlıktaki 's' harfi — "Sanayi" kelimesindeki s)

NUMARA=45
FALSE POSITIVE (başlıktaki "45 Cm" teknik ölçüsü)

TITLE NUMBER DETECTION
PASS (kaldırıldı)

TECHNICAL UNIT DETECTION
PASS (cm/W/L/inc vb. varyant sayılmaz)

REAL XML VARIANT DETECTION
PASS (flat XML'de varyant yapısı yok; yalnızca açık sinyal kabul)

FALSE POSITIVE SCAN
13.382 AKYI satırı + 10.277 Beden=S ürünü + 761 Numara ürünü

REAL VARIANT PRODUCTS
2.196 (toplam varyantlı)

REAL NON-VARIANT PRODUCTS
11.186 (NOT_REQUIRED)

AUTO MATCH
PASS (1.138 korundu)

AI MATCH
PASS (akış korundu)

MANUAL MATCH
PASS (akış korundu)

UI
PASS

BROWSER
PASS

TSC
PASS

BUILD
PASS

REGRESSION
PASS

FINAL
PASS
```

---

## 1. ROOT CAUSE — HER FALSE VARIANTIN KAYNAĞI

### AKYI = 053937

| Alan | Değer |
|---|---|
| KAYNAK TABLO | `Product` |
| KAYNAK ALAN | `sku` |
| XML'DEN Mİ | EVET |
| XML FIELD NAME | `<sku>` |
| XML RAW VALUE | `AKYI-053937` |
| VARYANT OLARAK KİM SINIFLANDIRDI | Tarihsel/aktif olmayan eski kod (güncel kod üretmiyor) |
| DOSYA | [`server/src/routes/prepVariants.ts:8`](server/src/routes/prepVariants.ts:8) (REAL_VARIANT_NAMES filtresi AKYI'yı dışlar) |
| SONUÇ | **VARYANT DEĞİL — stok/SKU kodu.** |

Kanıt: AKILLIBAYI1'de her üründe tam 1 adet `AKYI` varyant satırı var (13.382 ürün → 13.382 AKYI satırı). Bu, AKYI'nin ürün başına tek kimlik (SKU) olduğunu, varyant kombinasyonu olmadığını kanıtlar. XML import [`server/src/services/xmlImport.ts:246`](server/src/services/xmlImport.ts:246) yalnızca `<sku>` okur; varyant alanı parse etmez.

### BEDEN = S

| Alan | Değer |
|---|---|
| KAYNAK | Eski `detectVariantsFromText` (substring `t.includes('s')`) |
| DOSYA | [`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:42) (eski satır ~49) |
| MEKANİZMA | `SIZE_PATTERNS` içinde `'s'`; başlıktaki **"Sanayi"** kelimesindeki `s` harfi → Beden=S |
| SONUÇ | **FALSE POSITIVE.** |

Kanıt: 10.716 Beden satırının 10.277'si `S`; bunların büyük çoğunluğu beden bağlamı olmayan ürünlerde (vantilatör, set, aksesuar).

### NUMARA = 45

| Alan | Değer |
|---|---|
| KAYNAK | `detectVariantAttributes` (eski) çıplak sayı regex'i |
| DOSYA | [`server/src/services/readiness.ts:64`](server/src/services/readiness.ts:64) (eski satır) |
| MEKANİZMA | `/^(3[2-9]|4[0-9]|50)$/` → başlıktaki **"45 Cm"** token'ı `45` → Numara=45 |
| SONUÇ | **FALSE POSITIVE — "45 Cm" teknik ölçüdür, ayakkabı numarası değildir.** |

Kanıt: 761 ürünün tümü başlıkta çıplak sayıdan türetilmiş Numara satırı taşıyor; XML'de hiçbir üründe gerçek `<numara>` varyant alanı yok.

---

## 2. GERÇEK XML YAPISI

`parseXmlImportPayload` ([`server/src/services/xmlImport.ts:225`](server/src/services/xmlImport.ts:225)) yalnızca düz alanlar okur:

```text
xmlKey, name/title, sku, barcode, stock, price, brand, category,
description, detail, images, link, unit, active
```

**Varyant/option/combination alanı YOK.** Bu nedenle varyant tespiti için tek güvenilir sinyal, başlıkta AÇIK varyant sinyalidir (standalone renk kelimesi, `beden:`, `numara:`, `kapasite:`, GB/TB). Çıplak sayı ve teknik birim asla varyant değildir.

---

## 3. DÜZELTME

### [`server/src/services/readiness.ts`](server/src/services/readiness.ts:45) — `detectVariantAttributes`

Yeni güvenli kural:

- **Renk**: yalnızca standalone renk token'ı.
- **Beden**: yalnızca `beden:` etiketi VEYA net çok harfli beden (XS/XL/XXL...). Tek harf `s/m/l` bağlamsız → varyant DEĞİL.
- **Numara**: yalnızca `numara:` etiketi. Çıplak sayı YASAK.
- **Kapasite**: yalnızca `kapasite:` etiketi VEYA net depolama (GB/TB/MB). `40L`, `1 L` gibi hacim şüpheli → yok sayılır.

### [`server/src/routes/prepVariants.ts`](server/src/routes/prepVariants.ts:42) — `detectVariantsFromText`

Eski substring/number mantığı kaldırıldı; artık tek authoritative `detectVariantAttributes`'a devrediyor. (`/scan`, `/reanalyze`, `/xml-variants`, `/ai-suggest` de bu güvenli kuralı kullanır.)

### Manuel modal

[`server/src/routes/prepVariants.ts:969`](server/src/routes/prepVariants.ts:969) — `xmlVariants` yalnızca `REAL_VARIANT_NAMES` ile filtrelenir; AKYI manuel modalda varyant olarak gösterilmez.

### Tek seferlik veri temizliği — [`server/_variant-falsepositive-fix.ts`](server/_variant-falsepositive-fix.ts)

Gerçek DB üzerinde çalıştırıldı:

```text
[1] AKYI varyant satırı silindi          : 13.382
[2] Yeniden sınıflandırılan ürün         : 1.318
[3] NOT_REQUIRED yapılan                 : 260
[4] Gerçek varyantlı kalan               : 1.058
[5] Silinen sahte varyant satırı         : 1.179
[6] HEDEF ÜRÜN → NOT_REQUIRED, variants=[]
```

---

## 4. YENİ SAYAÇLAR (gerçek DB)

```text
TOTAL            13.382
NOT_REQUIRED     11.186   (önceki 10.926)
VARIANT PRODUCTS  2.196   (önceki 2.457 — false positive'ler temizlendi)
AUTO_MATCH        1.138   (korundu)
AI_MATCH          0
MANUAL_REVIEW     229     (önceki 298)
WAITING_AI        835     (gerçekten bekleyen, variantMatch=false)
```

Eski `2.457` sayısı hatalıydı; AKYI/Beden=S/Numara=45 false positive'lerini içeriyordu. Doğru varyantlı ürün sayısı **2.196**.

---

## 5. GERÇEK VARYANTLI ÜRÜN KARŞILAŞTIRMA

| | FALSE POSITIVE (hedef) | GERÇEK VARYANTLI |
|---|---|---|
| Ürün | 18 Inc 45 Cm Vantilatör | Apple Watch 42mm Kordon - Koyu Yesil |
| SKU | AKYI-053937 | AKYI-168971 |
| Sinyal | başlıkta `45 Cm` (teknik ölçü) | başlıkta standalone `Yesil` (renk) |
| Yeni sonuç | NOT_REQUIRED (varyantsız) | WAITING_AI → Renk=Yesil (varyant ekranında) |

Motor, teknik ölçüyü varyant saymazken gerçek renk varyantını doğru yakalıyor.

---

## 6. GERÇEK BROWSER KANITI (4001)

```text
COUNTERS: total=13.382 has=2.196 none=11.186 auto=1.138 ai=0 manual=229 waiting=835
LIST: 1-50 / 2.196 ürün
HEDEF ÜRÜN VARYANT LİSTESİNDE DEĞİL      = PASS (AKYI-053937 listede YOK)
AKYI VARYANT OLARAK GÖSTERİLMİYOR        = PASS
GERÇEK VARYANTLI ÜRÜN LİSTEDE            = PASS (Renk satırları görünüyor)
MANUEL EŞLEŞTİRME KORUNDU                = PASS (49 buton ilk sayfada)
SELECT ALL                               = PASS
1901                                      = ABSENT
```

Screenshot: `variant-fp-01-dashboard.png`.

---

## 7. REGRESYON

- `npx tsc -p tsconfig.json --noEmit` → **PASS** (hata yok)
- `npm run build` (Vite) → **PASS**
- Konsol hatası yok (Playwright temiz)
- Manuel eşleştirme akışı (`Manuel Eşleştir → Attribute → Value → Kaydet → DB`) önceki turda kanıtlandı ve bu turda korundu.
- Variant motoru (`variantMatch.ts`, `trendyolVariantResolver.ts`, `trendyolCatalog.ts`) yeniden yazılmadı; yalnızca tespit kuralı sıkılaştırıldı.
- Brand / Listing / Price-send / Category mapping motoruna dokunulmadı.
