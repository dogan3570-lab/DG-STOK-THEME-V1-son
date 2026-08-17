# TRENDYOL CORE MAPPING — SON SKOR KARTI

Tarih: 2026-08-15 (UTC+3)
Kapsam: Yalnızca `C:\PROJE 1\DG-STOK-THEME-V1`

## SKOR KARTI

| Alan | Sonuç |
| --- | --- |
| CATEGORY MAPPING | **PASS** |
| BRAND MAPPING | **PASS** (fail-closed; bu XML'de gerçek marka yok → NOT_FOUND, sahte ID üretilmedi) |
| VARIANT MAPPING | **PASS** |
| LISTING | **PASS** |
| PRICE | **PASS** |
| 4/4 GATE | **PASS** |
| TRENDYOL PAYLOAD | **PASS** |
| RED TEAM | **52 PASS / 0 FAIL** |
| TSC | **PASS** |
| BUILD | **PASS** |
| REGRESSION | **PASS** |
| LIVE SEND | **BLOCKED** |

## CANLI CATALOG (AŞAMA 1 — READ-ONLY GET)

- Category Tree = PASS (16 kök)
- Brands = PASS (1000)
- Category Attributes = PASS (34)
- Attribute Values = PASS (32)

## KONTROLLÜ DB YAZIMI (AŞAMA 3 — 10/10/10)

- Kategori: 4 AUTO_MATCH (gerçek ID: 4744, 3275, 626, 3074), 6 NOT_FOUND
- Marka: 2 NOT_FOUND ("Akilli Bayi" tedarikçi adı, gerçek Trendyol markası değil → sahte ID YOK)
- Varyant: 10 MANUAL_REVIEW/NOT_FOUND (AKYI/bozuk/numerik değerler whitelist dışı → auto kabul edilmedi)

## REGRESYON SONUÇLARI

- `tsc --noEmit` / `npm run build`: PASS
- `rt-p0-test.ts`: 44 PASS / 0 FAIL
- `rt-send-test.ts`: 21 PASS / 0 FAIL
- `rt-trendyol-v2-test.ts`: 28 PASS / 0 FAIL
- `rt-listing-template-test.ts`: 9 PASS / 0 FAIL
- `rt-listing-price-test.ts`: 27 PASS / 0 FAIL
- `rt-trendyol-mapping-test.ts`: 11 PASS / 0 FAIL
- `rt-trendyol-mapping-v2-test.ts` (YENİ): 38 PASS / 0 FAIL
- `rt-send-gate-test.ts` (YENİ): 14 PASS / 0 FAIL
- `rt-trendyol-catalog-probe.ts` (YENİ): ALL_PASS

## YENİ DOSYALAR

- [`trendyolVariantResolver.ts`](server/src/services/trendyolVariantResolver.ts) — saf XML varyant → Trendyol attribute/value eşleyici (whitelist, AKYI engeli)
- [`sendReadiness.ts`](server/src/services/sendReadiness.ts) — runtime 4/4 gate (eski flag'lere güvenmez, kısa devreli)
- [`trendyolMapping.ts`](server/src/services/trendyolMapping.ts) — gerçek catalog ile kontrollü mapping + 3 saniye UX durumu
- [`trendyolMapping.ts`](server/src/routes/trendyolMapping.ts) — `/trendyol-mapping` route'ları (status, run, mock-send-test)

## DEĞİŞEN DOSYALAR

- [`categoryBrandMapper.ts`](server/src/services/categoryBrandMapper.ts) — path-aware kategori eşleştirme + AUTO_MATCH/MANUAL_REVIEW/NOT_FOUND
- [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts) — Trendyol gönderiminde gerçek gate + `listingPrice`
- [`index.ts`](server/src/routes/index.ts) — `/trendyol-mapping` mount
- [`rt-trendyol-v2-test.ts`](server/rt-trendyol-v2-test.ts) — spesifik hata kodlarına güncellendi

## KURALLARA UYUM

- Schema değişmedi, migration yok, DB reset yok, seed yok
- Sahte Trendyol ID / sahte mapping / sahte READY üretilmedi
- Canlı ürün gönderimi yapılmadı (LIVE SEND = BLOCKED)
- Git işlemi yapılmadı
- KDV ikinci kez eklenmedi; `500 × 1.20 + 30 = 630` doğrulandı
