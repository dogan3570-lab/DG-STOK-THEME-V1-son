# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: not-going-redteam.spec.ts >> STABILITY RUN 2/3 — Modül bütünlüğü >> RUN2-B: Çıkar + geri al (DB kanıtıyla)
- Location: tests\not-going-redteam.spec.ts:465:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000/
Call log:
  - navigating to "http://localhost:4000/", waiting until "domcontentloaded"

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
  48  |   throw new Error(`getUiXmlSourceId: ${timeoutMs}ms içinde ID alınamadı. Denemeler: [${attempts.join(' | ')}]`);
  49  | }
  50  | 
  51  | // ---------- Helpers ----------
  52  | 
  53  | async function login(page: Page) {
> 54  |   await page.goto(APP, { waitUntil: 'domcontentloaded' });
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000/
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
  149 |   test('RT-04: Gate filtre butonları çalışıyor (5 filtre)', async ({ page }) => {
  150 |     await gotoNotGoing(page);
  151 |     // Her filtreye geç: istek atılır, liste render edilir, toplam değişir/dönen veri filtreyle uyumlu olur
  152 |     const totals: Record<string, number> = {};
  153 |     for (const f of ['not-ready', 'cat-missing', 'brand-missing', 'var-missing', 'multi-missing']) {
  154 |       await page.locator(`#ng-gate-filter button[data-filter="${f}"]`).click();
```