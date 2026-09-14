# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: not-going-redteam.spec.ts >> RED TEAM — Pazaryerine Gitmeyen Modülü >> RT-03: Ürün listesi render + satır verisi API ile eşleşiyor
- Location: tests\not-going-redteam.spec.ts:134:3

# Error details

```
Error: getUiXmlSourceId: 30000ms içinde ID alınamadı. Denemeler: [status=0 ct= id=empty | status=0 ct= id=empty | status=0 ct= id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=0 ct= id=empty | status=0 ct= id=empty | status=0 ct= id=empty]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - generic [ref=e6]: 
          - generic [ref=e8]:
            - heading "DG STOK" [level=1] [ref=e9]
            - text: V5.0 Enterprise
        - navigation [ref=e10]:
          - link " Kontrol Paneli" [ref=e11] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e12]: 
            - text: Kontrol Paneli
          - link " XML Kaynakları" [ref=e13] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e14]: 
            - text: XML Kaynakları
          - link " Ürün Havuzu" [ref=e15] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e16]: 
            - text: Ürün Havuzu
          - generic [ref=e17]:
            - link " Ürün Hazırlama " [ref=e18] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e19]: 
              - text: Ürün Hazırlama
              - generic [ref=e20]: 
            - text:    
          - generic [ref=e21]:
            - link " Gönderime Hazır " [ref=e22] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e23]: 
              - text: Gönderime Hazır
              - generic [ref=e24]: 
            - text: 
          - link " AI Görsel Merkezi" [ref=e25] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e26]: 
            - text: AI Görsel Merkezi
          - link " AI Satış Asistanı" [ref=e27] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e28]: 
            - text: AI Satış Asistanı
          - link " AI Copilot" [ref=e29] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e30]: 
            - text: AI Copilot
          - link " AI Kontrol Merkezi" [ref=e31] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e32]: 
            - text: AI Kontrol Merkezi
          - link " Pazaryeri Yönetimi" [ref=e34] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e35]: 
            - text: Pazaryeri Yönetimi
          - link " Siparişler" [ref=e36] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e37]: 
            - text: Siparişler
          - link " Raporlar" [ref=e38] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e39]: 
            - text: Raporlar
          - link " Ayarlar" [ref=e40] [cursor=pointer]:
            - /url: "#"
            - generic [ref=e41]: 
            - text: Ayarlar
          - generic [ref=e42]:
            - link " Hesabım " [ref=e43] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e44]: 
              - text: Hesabım
              - generic [ref=e45]: 
            - text:      
            - link " Çıkış Yap" [ref=e46] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e47]: 
              - text: Çıkış Yap
          - generic [ref=e48]:
            - link " Yönetim " [ref=e49] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e50]: 
              - text: Yönetim
              - generic [ref=e51]: 
            - text:           
      - generic [ref=e52]:
        - generic [ref=e53]: API Gateway
        - generic [ref=e56]: Stabil
    - generic [ref=e57]:
      - banner [ref=e58]:
        - generic: 
        - generic [ref=e59]:
          - button "" [ref=e60] [cursor=pointer]
          - button "" [ref=e62] [cursor=pointer]
          - button "" [ref=e64] [cursor=pointer]
          - button "" [ref=e66] [cursor=pointer]
          - button "" [ref=e68] [cursor=pointer]
          - generic [ref=e70]:
            - generic [ref=e71]: DG
            - generic [ref=e72]:
              - generic [ref=e73]: Doğan Gılavuz
              - generic [ref=e74]: Sistem Yöneticisi
      - main [ref=e75]:
        - generic [ref=e76]:
          - generic [ref=e78]:
            - generic [ref=e79]:
              - heading "KONTROL PANELİ" [level=2] [ref=e82]
              - paragraph [ref=e83]: D&G STOK v5.0 Kontrol Paneli
              - paragraph [ref=e84]: Gerçek veriler yükleniyor...
            - generic [ref=e85]:
              - generic [ref=e86]: "Son güncelleme:"
              - generic [ref=e87]: 18:02:58
          - generic [ref=e88]:
            - generic [ref=e89]:
              - heading "PAZARYERİ API BAĞLANTILARI" [level=3] [ref=e90]
              - generic [ref=e91]: "-"
            - paragraph [ref=e93]: Yükleniyor...
          - generic [ref=e94]:
            - generic [ref=e95]:
              - generic [ref=e96]:
                - generic [ref=e97]: TOPLAM ÜRÜN
                - generic [ref=e98]: 
              - generic [ref=e100]:
                - generic [ref=e101]: "0"
                - generic [ref=e102]: Havuzdaki toplam ürün
            - generic [ref=e103]:
              - generic [ref=e104]:
                - generic [ref=e105]: STOKTA YOK
                - generic [ref=e106]: 
              - generic [ref=e108]:
                - generic [ref=e109]: "0"
                - generic [ref=e110]: Miktarı sıfır olanlar
            - generic [ref=e111]:
              - generic [ref=e112]:
                - generic [ref=e113]: HATALI ÜRÜNLER
                - generic [ref=e114]: 
              - generic [ref=e116]:
                - generic [ref=e117]: "0"
                - generic [ref=e118]: Kritik hata
            - generic [ref=e119]:
              - generic [ref=e120]:
                - generic [ref=e121]: AKTİF XML KAYNAK
                - generic [ref=e122]: 
              - generic [ref=e124]:
                - generic [ref=e125]: "0"
                - generic [ref=e126]: Senkronizasyon aktif
            - generic [ref=e127]:
              - generic [ref=e128]:
                - generic [ref=e129]: PASİF XML KAYNAK
                - generic [ref=e130]: 
              - generic [ref=e132]:
                - generic [ref=e133]: "0"
                - generic [ref=e134]: Devre dışı kaynaklar
            - generic [ref=e135]:
              - generic [ref=e136]:
                - generic [ref=e137]: HATALI XML
                - generic [ref=e138]: 
              - generic [ref=e140]:
                - generic [ref=e141]: "0"
                - generic [ref=e142]: Bağlantı sorunu olanlar
            - generic [ref=e143]:
              - generic [ref=e144]:
                - generic [ref=e145]: BUGÜN XML GÜNCELLEME
                - generic [ref=e146]: 
              - generic [ref=e148]:
                - generic [ref=e149]: "0"
                - generic [ref=e150]: Bugün senkronize edilen
            - generic [ref=e151]:
              - generic [ref=e152]:
                - generic [ref=e153]: BUGÜNKÜ SİPARİ�?
                - generic [ref=e154]: 
              - generic [ref=e156]:
                - generic [ref=e157]: "0"
                - generic [ref=e158]: Bugün gelen sipariş
            - generic [ref=e159]:
              - generic [ref=e160]:
                - generic [ref=e161]: TOPLAM SİPARİ�?
                - generic [ref=e162]: 
              - generic [ref=e164]:
                - generic [ref=e165]: "0"
                - generic [ref=e166]: Tüm zamanlar
            - generic [ref=e167]:
              - generic [ref=e168]:
                - generic [ref=e169]: TOPLAM MARKA
                - generic [ref=e170]: 
              - generic [ref=e172]:
                - generic [ref=e173]: "0"
                - generic [ref=e174]: Havuzdaki marka
            - generic [ref=e175]:
              - generic [ref=e176]:
                - generic [ref=e177]: TOPLAM KATEGORİ
                - generic [ref=e178]: 
              - generic [ref=e180]:
                - generic [ref=e181]: "0"
                - generic [ref=e182]: Havuzdaki kategori
            - generic [ref=e183]:
              - generic [ref=e184]:
                - generic [ref=e185]: GÖNDERİME HAZIR
                - generic [ref=e186]: 
              - generic [ref=e188]:
                - generic [ref=e189]: "0"
                - generic [ref=e190]: 4/4 gate PASS
            - generic [ref=e191]:
              - generic [ref=e192]: KATEGORİ EŞLEŞTİ
              - generic [ref=e195]:
                - generic [ref=e196]: "0"
                - generic [ref=e197]: Gerçek mapping var
            - generic [ref=e198]:
              - generic [ref=e199]: KATEGORİ EKSİK
              - generic [ref=e202]:
                - generic [ref=e203]: "0"
                - generic [ref=e204]: Eşleşme bekliyor
          - generic [ref=e205]:
            - generic [ref=e206]:
              - generic [ref=e207]:
                - heading "XML ENTEGRASYON HUB" [level=3] [ref=e208]
                - paragraph [ref=e209]: XML Ürün Bilgileri ve Kaynak Yönetimi
                - paragraph [ref=e210]: Yükleniyor...
              - generic [ref=e211]:
                - button " Tümünü Senkronize Et" [ref=e212] [cursor=pointer]:
                  - generic [ref=e213]: 
                  - text: Tümünü Senkronize Et
                - button "+ Yeni XML Kaynağı Ekle" [ref=e214] [cursor=pointer]:
                  - generic [ref=e215]: +
                  - text: Yeni XML Kaynağı Ekle
            - table [ref=e217]:
              - rowgroup [ref=e218]:
                - row [ref=e219]:
                  - columnheader "Kaynak Adı" [ref=e220]
                  - columnheader "URL" [ref=e221]
                  - columnheader "Ürün Sayısı" [ref=e222]
                  - columnheader "Son Güncelleme" [ref=e223]
                  - columnheader "Durum" [ref=e224]
                  - columnheader "İşlemler" [ref=e225]
              - rowgroup [ref=e226]:
                - row [ref=e227]:
                  - cell "Yükleniyor..." [ref=e228]
        - text:  +        +                                        +          + +                 +                   +   +     +         + + +                          
  - text:                     +          
```

# Test source

```ts
  1   | import { test, expect, type Page } from 'playwright/test';
  2   | 
  3   | /**
  4   |  * GPT-5.6 RED TEAM — "Pazaryerine Gitmeyen" modülü tam E2E testi
  5   |  * Hedef: vanilla UI (http://localhost:4000) — modülün GERÇEK çalışma ortamı
  6   |  * Gerçek login, gerçek veri, UI ↔ API ↔ DB parite kontrolleri.
  7   |  */
  8   | 
  9   | const APP = 'http://localhost:4000';
  10  | const API = 'http://localhost:4000/api';
  11  | const EMAIL = 'admin@dgstok.com';
  12  | const PASSWORD = 'Admin1234!';
  13  | 
  14  | // ---------- Helpers ----------
  15  | 
  16  | // UI'nin /xml-sources fallback'inden seçtiği kaynağı dinamik al
  17  | // (UI: items[0].id — createdAt desc ilk kayıt; test sabit ID kullanmamalı)
  18  | let XML_SOURCE_ID = '';
  19  | 
  20  | // KÖK NEDEN FIX: getUiXmlSourceId bir kezlık fetch'te cookie yarışı (intermittent 401/HTML fallback)
  21  | // yüzünden sessizce '' dönebiliyordu → tüm RT-02..13 beforeEach'te domino fail.
  22  | // Çözüm: 200 + application/json + dolu ID gelene kadar poll; her denemenin HTTP status/content-type'ını raporla.
  23  | async function getUiXmlSourceId(page: Page, timeoutMs = 30000): Promise<string> {
  24  |   const started = Date.now();
  25  |   const attempts: string[] = [];
  26  |   while (Date.now() - started < timeoutMs) {
  27  |     const probe = await page.evaluate(async () => {
  28  |       try {
  29  |         const r = await fetch('/api/xml-sources', { credentials: 'include' });
  30  |         const ct = r.headers.get('content-type') || '';
  31  |         const text = await r.text();
  32  |         let j: any = null;
  33  |         if (ct.includes('application/json')) {
  34  |           try { j = JSON.parse(text); } catch { /* non-json */ }
  35  |         }
  36  |         // API response can be { items: [...] } or { data: { items: [...] } }
  37  |         const items = j?.items ?? j?.data?.items ?? [];
  38  |         const id = items?.[0]?.id ?? '';
  39  |         return { status: r.status, contentType: ct, id, snippet: text.slice(0, 120) };
  40  |       } catch (e: any) {
  41  |         return { status: 0, contentType: '', id: '', snippet: String(e?.message ?? e) };
  42  |       }
  43  |     });
  44  |     attempts.push(`status=${probe.status} ct=${probe.contentType} id=${probe.id || 'empty'}`);
  45  |     if (probe.status === 200 && probe.contentType.includes('application/json') && probe.id) return probe.id;
  46  |     await page.waitForTimeout(1000);
  47  |   }
> 48  |   throw new Error(`getUiXmlSourceId: ${timeoutMs}ms içinde ID alınamadı. Denemeler: [${attempts.join(' | ')}]`);
      |         ^ Error: getUiXmlSourceId: 30000ms içinde ID alınamadı. Denemeler: [status=0 ct= id=empty | status=0 ct= id=empty | status=0 ct= id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=401 ct=application/json; charset=utf-8 id=empty | status=0 ct= id=empty | status=0 ct= id=empty | status=0 ct= id=empty]
  49  | }
  50  | 
  51  | // ---------- Helpers ----------
  52  | 
  53  | async function login(page: Page) {
  54  |   await page.goto(APP, { waitUntil: 'domcontentloaded' });
  55  |   // Login modal açıksa doldur (default değerler zaten girili olabilir)
  56  |   const modal = page.locator('#login-modal');
  57  |   if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
  58  |     await page.fill('#login-email', EMAIL);
  59  |     await page.fill('#login-password', PASSWORD);
  60  |     await modal.locator('button[onclick="doLogin()"]').click();
  61  |   }
  62  |   // Uygulama ana konteyneri açılana kadar bekle
  63  |   await expect(page.locator('#app, #sidebar, main, body').first()).toBeVisible({ timeout: 15000 });
  64  |   // Login kapanmış mı kontrol et
  65  |   await expect(page.locator('#login-modal')).toBeHidden({ timeout: 15000 });
  66  |   // UI'nin seçeceği XML kaynağını dinamik belirle — poll'lu helper cookie yarışına dayanır;
  67  |   // ayrıca dolu ID, loadApp()'in refreshXmlSources'unun bittiğinin de kanıtıdır (sabit bekleme yerine)
  68  |   XML_SOURCE_ID = await getUiXmlSourceId(page);
  69  | }
  70  | 
  71  | async function gotoNotGoing(page: Page) {
  72  |   await page.evaluate(() => showPage('prep-not-going'));
  73  |   // Liste verisi GERÇEKTEN dolana kadar bekle: KPI toplamı '-' iken request hâlâ uçuşta
  74  |   // (UI'da #ng-loading request ÖNCESİ gizleniyor — loading indicator bug'ı; bu yüzden
  75  |   // KPI doluşunu ve satır render'ını beklemek tek güvenilir sinyal)
  76  |   await expect.poll(
  77  |     async () => await page.locator('#ng-stat-total').textContent(),
  78  |     { timeout: 60000, intervals: [500] }
  79  |   ).not.toBe('-');
  80  |   await page.waitForTimeout(1000); // render settle
  81  | }
  82  | 
  83  | async function apiGet(page: Page, path: string): Promise<any> {
  84  |   return page.evaluate(async (p) => {
  85  |     const res = await fetch(p, { credentials: 'include' });
  86  |     return { status: res.status, body: await res.json() };
  87  |   }, `${API}${path}`);
  88  | }
  89  | 
  90  | let consoleErrors: string[] = [];
  91  | function watchConsole(page: Page) {
  92  |   consoleErrors = [];
  93  |   page.on('console', (msg) => {
  94  |     if (msg.type() === 'error') consoleErrors.push(msg.text());
  95  |   });
  96  |   page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));
  97  | }
  98  | 
  99  | // ==================== TESTLER ====================
  100 | 
  101 | test.describe('RED TEAM — Pazaryerine Gitmeyen Modülü', () => {
  102 | 
  103 |   test.beforeEach(async ({ page }) => {
  104 |     watchConsole(page);
  105 |     await login(page);
  106 |   });
  107 | 
  108 |   // ---------- 1. SAYFA YÜKLEME ----------
  109 |   test('RT-01: Sayfa açılıyor + başlık + sidebar nav', async ({ page }) => {
  110 |     await gotoNotGoing(page);
  111 |     await expect(page.locator('#page-prep-not-going')).toBeVisible();
  112 |     await expect(page.locator('h2:has-text("Pazaryerine Gitmeyen")')).toBeVisible();
  113 |     // Sidebar linki aktif
  114 |     await expect(page.locator('#nav-prep-not-going')).toHaveClass(/active-nav/);
  115 |   });
  116 | 
  117 |   // ---------- 2. KPI STATS ----------
  118 |   test('RT-02: KPI değerleri doluyor ve API ile eşleşiyor', async ({ page }) => {
  119 |     await gotoNotGoing(page);
  120 |     const total = await page.locator('#ng-stat-total').textContent();
  121 |     const ready = await page.locator('#ng-stat-ready').textContent();
  122 |     const notReady = await page.locator('#ng-stat-notready').textContent();
  123 |     expect(total).toBeTruthy();
  124 |     expect(total).not.toBe('-');
  125 |     expect(ready).not.toBe('-');
  126 |     expect(notReady).not.toBe('-');
  127 |     // API paritesi
  128 |     const api = await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=1`);
  129 |     expect(api.status).toBe(200);
  130 |     expect(String(api.body.stats.total)).toBe(total!.replace(/\./g, '').replace(/,/g, ''));
  131 |   });
  132 | 
  133 |   // ---------- 3. LİSTE + SATIR VERİSİ ----------
  134 |   test('RT-03: Ürün listesi render + satır verisi API ile eşleşiyor', async ({ page }) => {
  135 |     await gotoNotGoing(page);
  136 |     const rows = page.locator('#ng-product-list > div');
  137 |     const rowCount = await rows.count();
  138 |     const api = await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=100&page=1`);
  139 |     expect(api.status).toBe(200);
  140 |     expect(rowCount).toBe(Math.min(api.body.items.length, 100));
  141 |     if (api.body.items.length > 0) {
  142 |       const first = api.body.items[0];
  143 |       const rowText = await rows.first().textContent();
  144 |       expect(rowText).toContain(first.title!.slice(0, 25));
  145 |     }
  146 |   });
  147 | 
  148 |   // ---------- 4. GATE FİLTRELERİ ----------
```