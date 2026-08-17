# GLOBAL STOK OTOMASYONU + ÜRÜN HAVUZU STOK HAZIRLAMA MIN/MAX — UYGULAMA PLANI

## 1) KÖK NEDEN

- Ürün stokları [`Product.stock`](server/prisma/schema.prisma:90) alanında tutuluyor; ancak stok seviyesine göre pazaryerinde **satışı otomatik açıp kapatan** bir motor mevcut değil.
- Mevcut marketplace adapter'ları ([`adapters.ts`](server/src/services/marketplace/adapters.ts:139)) yalnızca **listeleme oluştur/güncelle** (send) yapabiliyor; **stok/envanter güncelleme (satış aç/kapat)** yeteneği yok.
- Ürün Havuzu'nda stok aralığına göre "hazırlama pipeline'ına girme" filtresi yok (satış aç/kapat kuralından bağımsız, ayrı bir kural olarak).
- Sonuç: stok değiştiğinde satış durumu manuel kalıyor; düşük stokta ürün pazaryerinde satılmaya devam edebiliyor.

## 2) ETKİLENEN DOSYALAR

| Dosya | Değişiklik | Neden |
|---|---|---|
| [`server/src/services/stockAutomation.ts`](server/src/services/stockAutomation.ts) | **YENİ** | Histerezis motoru + orchestrator (config okuma, karar, API çağrısı, state/log güncelleme) |
| [`server/src/services/marketplace/types.ts`](server/src/services/marketplace/types.ts:35) | Genişlet | `MarketplaceInventoryUpdatePayload` + `buildInventoryUpdateRequest` adapter sözleşmesi |
| [`server/src/services/marketplace/adapters.ts`](server/src/services/marketplace/adapters.ts:139) | Genişlet | Her adapter'a stok/envanter güncelleme isteği üretme yeteneği (Trendyol price-and-inventory, Hepsiburada stock-uploads, diğerleri best-effort) |
| [`server/src/services/marketplace/marketplaceApi.ts`](server/src/services/marketplace/marketplaceApi.ts:55) | Genişlet | `updateMarketplaceInventory()` — gerçek API çağrısı + 2xx doğrulama (sahte başarı yok) |
| [`server/src/routes/stockAutomation.ts`](server/src/routes/stockAutomation.ts) | **YENİ** | GET/PUT config, POST `/run`, GET `/status` |
| [`server/src/routes/index.ts`](server/src/routes/index.ts:53) | Genişlet | `/stock-automation` route grubunu bağla |
| [`server/src/services/sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:68) | Genişlet | Hazırlama stok aralığı gate'i (ayrı kural — satış aç/kapat'ı etkilemez) |
| [`index.html`](index.html:1457) | Genişlet | Ayarlar'a "Stok Otomasyonu" paneli + Ürün Havuzu'na min/max stok filtresi + çalıştır butonu |

## 3) TASARIM (SCHEMA DEĞİŞİKLİĞİ YOK)

Kural 4 gereği **Prisma schema değişikliği ve migration YAPILMAZ.** Mevcut yapılar kullanılır:

- **Global config** → [`Setting`](server/prisma/schema.prisma:430) key-value:
  - `stockAuto.enabled` = `"true"|"false"`
  - `stockAuto.closeAt` = `"3"` (SATIŞI KAPATMA STOĞU)
  - `stockAuto.openAt` = `"5"` (SATIŞI AÇMA STOĞU)
  - `stockAuto.prepMin` = `"1"` (Hazırlama min stok)
  - `stockAuto.prepMax` = `"999999"` (Hazırlama max stok)
- **Satış durumu takibi** → [`ProductMarketplaceState.status`](server/prisma/schema.prisma:163) alanına **yeni değer** `CLOSED` eklenir (String alan; schema değişikliği değildir):
  - `ACTIVE`/`SENDING` = satış AÇIK
  - `CLOSED` = satış KAPALI
  - Motor yalnızca `ProductMarketplaceState` kaydı olan (yani pazaryerine gönderilmiş) ürünleri değerlendirir.
- **Log** → [`AuditLog`](server/prisma/schema.prisma:213) (`entity='StockAutomation'`, `action='STOCK_AUTO_CLOSE|STOCK_AUTO_OPEN'`, `meta` JSON).

### Histerezis motoru (saf fonksiyon, unit-testable)

```
stock <= closeAt  → CLOSE (durum zaten CLOSED ise HOLD)
stock >= openAt   → OPEN  (durum zaten açık ise HOLD)
closeAt < stock < openAt → HOLD (mevcut durum korunur)
```

Örnek (close=3, open=5): 10→AÇIK, 5→AÇIK, 4→HOLD, 3→KAPAT, 2→KAPALI, 1→KAPALI, 0→KAPALI, 4→HOLD(KAPALI), 5→AÇ.

### Gerçek marketplace API akışı (kullanıcı şartı)

```
XML stok → ürün → motor → eşik → değişim? → Marketplace API → 2xx doğrulandı mı? → DB state/log güncelle
```

- API **başarısızsa** DB'de satış durumu değiştirilmez (fail-closed, "sadece isActive=false" yapılmaz).
- Credential eksik/ayarsızsa (`configured=false`) motor o ürünü atlar ve hata loglar; sahte KAPALI/AÇIK üretilmez.

### A) Global Satış Otomasyonu ile B) Hazırlama Stok Aralığı AYRIMI

- **A)** `stockAutomation.ts` — pazaryeri satış aç/kapat (yukarıdaki histerezis).
- **B)** `isWithinPrepRange(stock, prepMin, prepMax)` — hazırlama/listing pipeline gate'i. [`sendPipeline.ts`](server/src/services/marketplace/sendPipeline.ts:68)'ye ayrı bir kontrol olarak eklenir; satış otomasyonunu ETKİLEMEZ.

## 4) RED TEAM RİSK ANALİZİ

| Risk | Şiddet | Önlem |
|---|---|---|
| Mevcut send lifecycle bozulması (`ACTIVE`/`SENDING` idempotency) | HIGH | `CLOSED` yalnızca otomasyon tarafından, API başarısı sonrası yazılır; send pipeline'daki status kontrolleri değişmez |
| Yanlış zamanda aç/kapat (histerezis ihlali) | HIGH | Saf `decideSalesAction` fonksiyonu unit test ile 3-4 bandı dahil tüm sınırlar test edilir |
| Gerçek kullanıcı kuralı/listeleme etkilenmesi | HIGH | Motor varsayılan `enabled=false`; ayar açılmadan hiçbir API çağrısı yapılmaz |
| Sahte başarı (API doğrulanmadan state güncelleme) | HIGH | `updateMarketplaceInventory` yalnızca gerçek 2xx + doğrulanmış yanıt ile ok döner |
| Credential decrypt sızıntısı | HIGH | Mevcut [`crypto.ts`](server/src/services/crypto.ts) decrypt yalnızca istek anında, log yok |
| SSRF | HIGH | Mevcut [`ssrfGuard.ts`](server/src/services/marketplace/ssrfGuard.ts) + httpClient korunur |
| Trendyol async (batchRequestId) karışıklığı | MED | Trendyol satış aç/kapat stok güncelleme ucu (`price-and-inventory`) senkron yanıt verir; send pipeline'daki APPROVAL_PENDING akışı değişmez |
| Konfig validasyonu (close < open şartı) | MED | Config endpoint'i `closeAt <= openAt` ve pozitif tam sayı zorunlu kılar; aksi 400 |
| Mevcut modüllerde regresyon | MED | TSC + BUILD + mevcut red team testleri + regression script tekrar koşulur |

## 5) UYGULAMA SIRASI

1. `stockAutomation.ts` (histerezis + orchestrator) + unit test.
2. Adapter inventory update + `marketplaceApi.updateMarketplaceInventory`.
3. `stockAutomation.ts` route + route register.
4. `sendPipeline` hazırlık stok aralığı gate.
5. `index.html` UI (Ayarlar paneli + Havuz filtresi + çalıştır butonu).
6. TSC + BUILD + DB + API + Browser doğrulama + regresyon + histerezis testi.
