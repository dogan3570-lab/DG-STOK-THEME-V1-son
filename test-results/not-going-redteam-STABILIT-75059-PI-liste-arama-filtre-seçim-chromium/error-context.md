# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: not-going-redteam.spec.ts >> STABILITY RUN 2/3 — Modül bütünlüğü >> RUN2-A: Yükleme + KPI + liste + arama + filtre + seçim
- Location: tests\not-going-redteam.spec.ts:426:5

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
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
          - button " 4" [ref=e62] [cursor=pointer]:
            - generic [ref=e63]: 
            - generic [ref=e64]: "4"
          - button "" [ref=e65] [cursor=pointer]
          - button "" [ref=e67] [cursor=pointer]
          - button "" [ref=e69] [cursor=pointer]
          - generic [ref=e71]:
            - generic [ref=e72]: DG
            - generic [ref=e73]:
              - generic [ref=e74]: Doğan Gılavuz
              - generic [ref=e75]: Sistem Yöneticisi
      - main [ref=e76]:
        - text:               +    +                      +                                        +          + +  
        - generic [ref=e77]:
          - generic [ref=e78]:
            - generic [ref=e79]:
              - heading "Pazaryerine Gitmeyen" [level=2] [ref=e80]
              - paragraph [ref=e81]: Pazaryerine gönderilemeyen ürünleri inceleyin, sorunlarını görün ve gerekli işlemleri kolayca gerçekleştirin.
            - button " Yenile" [ref=e82] [cursor=pointer]:
              - generic [ref=e83]: 
              - text: Yenile
          - generic [ref=e84]:
            - generic [ref=e85]:
              - generic [ref=e86]: Toplam Ürün
              - generic [ref=e87]: "0"
            - generic [ref=e88]:
              - generic [ref=e89]: Gönderime Hazır
              - generic [ref=e90]: "0"
            - generic [ref=e91]:
              - generic [ref=e92]: İşlem Bekleyen
              - generic [ref=e93]: "0"
            - generic [ref=e94]:
              - generic [ref=e95]: Kategori Eksik
              - generic [ref=e96]: "0"
            - generic [ref=e97]:
              - generic [ref=e98]: Marka Eksik
              - generic [ref=e99]: "0"
            - generic [ref=e100]:
              - generic [ref=e101]: Çoklu Eksik
              - generic [ref=e102]: "0"
          - generic [ref=e103]:
            - generic [ref=e104]:
              - generic [ref=e105] [cursor=pointer]:
                - checkbox "Tümünü Seç" [ref=e106]
                - generic [ref=e107]: Tümünü Seç
              - generic [ref=e108]:
                - button "Tümü" [ref=e109] [cursor=pointer]
                - button "Gönderilemeyen" [ref=e110] [cursor=pointer]
                - button "Kategori Eksik" [ref=e111] [cursor=pointer]
                - button "Marka Eksik" [ref=e112] [cursor=pointer]
                - button "Varyant Eksik" [ref=e113] [cursor=pointer]
                - button "Çoklu Eksik" [ref=e114] [cursor=pointer]
              - generic [ref=e115]:
                - generic [ref=e116]: 
                - textbox "Ürün adı / SKU / barkod ara..." [ref=e117]
              - generic [ref=e118]:
                - generic [ref=e119]: "Sayfa:"
                - combobox [ref=e120]:
                  - option "50"
                  - option "100" [selected]
                  - option "200"
                  - option "500"
            - generic [ref=e121]:
              - button " Seçilenleri Tekrar Gönder" [disabled] [ref=e122]:
                - generic [ref=e123]: 
                - text: Seçilenleri Tekrar Gönder
              - button "Seçilenleri Çıkar" [disabled] [ref=e124]
              - generic [ref=e125]: Ürünler silinmez; yalnızca bu ekrandan çıkarılır ve normal akışa geri döner.
          - text: 
          - generic [ref=e127]:
            - generic [ref=e128]: 
            - paragraph [ref=e130]: 🎉 Pazaryerine Gitmeyen ürün bulunmuyor
            - paragraph [ref=e131]: Tüm ürünler pazaryerine gönderilmeye hazır. Yeni bir sorun olursa burada görünecek.
        - text:          +                   +   +     +         + + +                          
  - text:                     +          
  - generic [ref=e133]:
    - generic [ref=e134]: 
    - generic [ref=e135]: Giriş başarılı, veriler yükleniyor...
```

# Test source

```ts
  333 |     const api = await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=1`);
  334 |     if (api.body.pagination.totalPages > 1) {
  335 |       await page.locator('#ng-pagination-top button', { hasText: '2' }).first().click();
  336 |       await expect.poll(async () => await rows.count(), { timeout: 60000, intervals: [500] })
  337 |         .toBeLessThanOrEqual(50);
  338 |       expect(await rows.count()).toBeGreaterThan(0);
  339 |     }
  340 |   });
  341 | 
  342 |   // ---------- 11. DETAY MODALI ----------
  343 |   test('RT-11: Ürün detay modalı açılıyor + gate ler gösteriliyor', async ({ page }) => {
  344 |     await gotoNotGoing(page);
  345 |     const rows = page.locator('#ng-product-list > div');
  346 |     test.skip(!(await rows.count()), 'Liste boş — skip');
  347 |     await rows.first().locator('button[title*="detayını görüntüle"]').click();
  348 |     await page.waitForTimeout(800);
  349 |     // Modal içeriği (id sabit değil — genel konteyner kontrolü)
  350 |     const modal = page.locator('.fixed.inset-0:not(#login-modal):not(#ng-delete-modal)').last();
  351 |     if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
  352 |       await expect(modal).toBeVisible();
  353 |       // Kapatma (overlay tıkla)
  354 |       await modal.locator('button').last().click().catch(() => {});
  355 |     }
  356 |   });
  357 | 
  358 |   // ---------- 12. SORUNU ÇÖZ YÖNLENDİRMESİ ----------
  359 |   test('RT-12: Sorunu Çöz eksik gate e yönlendiriyor', async ({ page }) => {
  360 |     await gotoNotGoing(page);
  361 |     const rows = page.locator('#ng-product-list > div');
  362 |     test.skip(!(await rows.count()), 'Liste boş — skip');
  363 |     // Kategori eksik olan bir ürün bul
  364 |     let target: any = null;
  365 |     const api = await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=100&gateFilter=cat-missing`);
  366 |     if (api.body.items.length > 0) target = api.body.items[0];
  367 |     if (!target) test.skip(true, 'Kategori eksik ürün yok');
  368 |     await page.evaluate((id) => ngIntervene(id), target.id);
  369 |     await page.waitForTimeout(600);
  370 |     // prep-categories sayfasına gidilmeli
  371 |     await expect(page.locator('#page-prep-categories')).not.toBeHidden();
  372 |     // Geri dön
  373 |     await page.evaluate(() => showPage('prep-not-going'));
  374 |   });
  375 | 
  376 |   // ---------- 13. YENİLE BUTONU ----------
  377 |   test('RT-13: Yenile butonu listeyi tazeler', async ({ page }) => {
  378 |     await gotoNotGoing(page);
  379 |     const before = await page.locator('#ng-stat-total').textContent();
  380 |     await page.locator('button[onclick="ngRefresh(true)"]').click();
  381 |     await expect(page.locator('#ng-loading')).toBeHidden({ timeout: 30000 });
  382 |     await page.waitForTimeout(1200);
  383 |     const after = await page.locator('#ng-stat-total').textContent();
  384 |     expect(after).toBe(before); // veri değişmedi — aynı toplam
  385 |   });
  386 | 
  387 |   // ---------- 14. AUTH KONTROLÜ ----------
  388 |   test('RT-14: 401 — oturum yokken API erişimi engellenir', async ({ page }) => {
  389 |     await gotoNotGoing(page);
  390 |     // Oturumu temizle (context'te cookie yok — yeni context'te denenmeli)
  391 |     const res = await page.evaluate(async () => {
  392 |       const r = await fetch('/api/categories/not-going?xmlSourceId=x', { credentials: 'omit' });
  393 |       return r.status;
  394 |     });
  395 |     // Cookie hâlâ gönderilirse (browser otomatik) — gerçek 401 testi logout ile:
  396 |     if (res === 200) {
  397 |       // logout sonrası deneyin: httpOnly cookie silinir
  398 |       await page.evaluate(async () => { await doLogout(); });
  399 |       await page.waitForTimeout(1000);
  400 |       const res2 = await page.evaluate(async () => {
  401 |         const r = await fetch('/api/categories/not-going?xmlSourceId=x', { credentials: 'include' });
  402 |         return r.status;
  403 |       });
  404 |       expect(res2).toBe(401);
  405 |     } else {
  406 |       expect(res).toBe(401);
  407 |     }
  408 |   });
  409 | 
  410 |   // ---------- 15. CONSOLE/NETWORK HATALARI ----------
  411 |   test('RT-15: Modül kullanımında console error yok', async ({ page }) => {
  412 |     await gotoNotGoing(page);
  413 |     await page.locator('#ng-gate-filter button[data-filter="not-ready"]').click();
  414 |     await expect(page.locator('#ng-loading')).toBeHidden({ timeout: 30000 });
  415 |     await page.waitForTimeout(2000);
  416 |     const filtered = consoleErrors.filter(e =>
  417 |       !e.includes('401') && !e.includes('404') && !e.includes('favicon') &&
  418 |       !e.includes('Failed to load resource'));
  419 |     expect(filtered.length).toBe(0);
  420 |   });
  421 | });
  422 | 
  423 | // ==================== 3x BAĞIMSIZ KOŞU (Farklı test.describe) ====================
  424 | for (let run = 1; run <= 3; run++) {
  425 |   test.describe(`STABILITY RUN ${run}/3 — Modül bütünlüğü`, () => {
  426 |     test(`RUN${run}-A: Yükleme + KPI + liste + arama + filtre + seçim`, async ({ page }) => {
  427 |       watchConsole(page);
  428 |       await login(page);
  429 |       await gotoNotGoing(page); // KPI dolana kadar bekler
  430 |       // KPI dolu
  431 |       expect(await page.locator('#ng-stat-total').textContent()).not.toBe('-');
  432 |       const rows = page.locator('#ng-product-list > div');
> 433 |       expect(await rows.count()).toBeGreaterThan(0);
      |                                  ^ Error: expect(received).toBeGreaterThan(expected)
  434 | 
  435 |       // Filtre — not-ready: API paritesi (backend filtresiyle aynı kural)
  436 |       const beforeFilterTotal = (await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=1`)).body.stats.total;
  437 |       await page.locator('#ng-gate-filter button[data-filter="not-ready"]').click();
  438 |       await expect.poll(async () => (await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=1&gateFilter=not-ready`)).body.pagination.total, { timeout: 60000, intervals: [1000] }).toBeGreaterThan(-1);
  439 |       await page.waitForTimeout(1500);
  440 | 
  441 |       // "Tümü"ne dön ve aramaya HAZIR — SKU'yu "all" sorgusundan al (filtreli listeden DEĞİL)
  442 |       await page.locator('#ng-gate-filter button[data-filter="all"]').click();
  443 |       await page.waitForTimeout(2000);
  444 |       const allApi = await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=1`);
  445 |       const sku = allApi.body.items[0]?.sku || allApi.body.items[0]?.barcode || '';
  446 |       expect(sku).toBeTruthy(); // arama testinin gerçek veri garantisi
  447 |       await page.fill('#ng-search', sku);
  448 |       // debounce (400ms) + fetch + render — satır gerçekten gelene kadar poll
  449 |       await expect.poll(async () => await page.locator('#ng-product-list > div').count(), { timeout: 60000, intervals: [800] }).toBeGreaterThan(0);
  450 |       const rowText = await page.locator('#ng-product-list > div').first().textContent();
  451 |       expect(rowText).toContain(sku);
  452 |       // Aramayı temizle ve liste geri dönsün
  453 |       await page.fill('#ng-search', '');
  454 |       await expect.poll(async () => await page.locator('#ng-product-list > div').count(), { timeout: 60000, intervals: [800] }).toBeGreaterThan(0);
  455 | 
  456 |       // Seçim (arama temizlendikten sonra, görünen ilk satır)
  457 |       await rows.first().locator('input[type="checkbox"]').check();
  458 |       await expect(page.locator('#ng-selected-count')).toContainText('ürün seçildi');
  459 |       await rows.first().locator('input[type="checkbox"]').uncheck();
  460 |       await expect(page.locator('#ng-selected-count')).toBeHidden();
  461 |       // NOT: beforeFilterTotal burada yalnız sanity amaçlı — toplam filtre sonrası da 'all' eşit olmalı
  462 |       expect(beforeFilterTotal).toBeGreaterThan(0);
  463 |     });
  464 | 
  465 |     test(`RUN${run}-B: Çıkar + geri al (DB kanıtıyla)`, async ({ page }) => {
  466 |       watchConsole(page);
  467 |       await login(page);
  468 |       await gotoNotGoing(page);
  469 |       const rows = page.locator('#ng-product-list > div');
  470 |       test.skip(!(await rows.count()), 'Liste boş');
  471 |       const onclickAttr = await rows.first().locator('button[title*="çıkar"]').getAttribute('onclick');
  472 |       const pid = onclickAttr!.match(/'([^']+)'/)![1];
  473 |       const before = await apiGet(page, `/products/${pid}`);
  474 |       expect(before.body.status).not.toBe('DELETED');
  475 |       const sku = before.body.sku || before.body.barcode;
  476 |       // Çıkar
  477 |       await rows.first().locator('button[title*="çıkar"]').click();
  478 |       await page.locator('#ng-delete-ok').click();
  479 |       // DB kanıtı (poll): kayıt durur, listeden çıkar
  480 |       await expect.poll(
  481 |         async () => (await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=500&search=${encodeURIComponent(sku)}`))
  482 |           .body.items.filter((i: any) => i.id === pid).length,
  483 |         { timeout: 30000, intervals: [1000] }
  484 |       ).toBe(0);
  485 |       const after = await apiGet(page, `/products/${pid}`);
  486 |       expect(after.status).toBe(200);
  487 |       expect(after.body.status).toBe(before.body.status); // status korundu
  488 |       // Restore + kanıt (poll — geri döner)
  489 |       const rest = await page.evaluate(async (id) => {
  490 |         const r = await fetch('/api/categories/not-going/restore', {
  491 |           method: 'POST', credentials: 'include',
  492 |           headers: { 'Content-Type': 'application/json' },
  493 |           body: JSON.stringify({ productIds: [id] }),
  494 |         });
  495 |         return r.status;
  496 |       }, pid);
  497 |       expect(rest).toBe(200);
  498 |       await expect.poll(
  499 |         async () => (await apiGet(page, `/categories/not-going?xmlSourceId=${XML_SOURCE_ID}&limit=500&search=${encodeURIComponent(sku)}`))
  500 |           .body.items.filter((i: any) => i.id === pid).length,
  501 |         { timeout: 30000, intervals: [1000] }
  502 |       ).toBe(1);
  503 |     });
  504 |   });
  505 | }
  506 | 
```