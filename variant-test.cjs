const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Login
    await page.goto('http://localhost:4000');
    await page.waitForTimeout(3000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);

    async function apiGet(url) {
        return await page.evaluate(async (u) => {
            var res = await fetch(u, { credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }, url);
    }

    async function apiPost(url, body) {
        return await page.evaluate(async (u, b) => {
            var res = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
            if (!res.ok) { var d = null; try { d = await res.json(); } catch(e) {} throw new Error((d && d.error && (d.error.message || d.error)) || 'HTTP ' + res.status); }
            return res.json();
        }, url, body);
    }

    async function apiPut(url, body) {
        return await page.evaluate(async (u, b) => {
            var res = await fetch(u, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
            if (!res.ok) { var d = null; try { d = await res.json(); } catch(e) {} throw new Error((d && d.error && (d.error.message || d.error)) || 'HTTP ' + res.status); }
            return res.json();
        }, url, body);
    }

    async function apiDelete(url) {
        return await page.evaluate(async (u) => {
            var res = await fetch(u, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }, url);
    }

    console.log('=== TESTING ALL 28 VARIANT ENDPOINTS ===\n');
    var pass = 0, fail = 0;

    // 1. Stats
    try { var r = await apiGet('/variants/stats'); console.log('1.  GET /stats: PASS -', r.totalVariants, 'variants,', r.matchedProducts, 'matched'); pass++; } catch(e) { console.log('1.  GET /stats: FAIL -', e.message); fail++; }

    // 2. XML Variants
    try { var r = await apiGet('/variants/xml-variants'); console.log('2.  GET /xml-variants: PASS -', r.totalProducts, 'products,', r.productsWithDetectedVariants, 'detected'); pass++; } catch(e) { console.log('2.  GET /xml-variants: FAIL -', e.message); fail++; }

    // 3. Unmatched Products
    try { var r = await apiGet('/variants/unmatched-products?limit=5'); console.log('3.  GET /unmatched-products: PASS -', r.total, 'total'); pass++; } catch(e) { console.log('3.  GET /unmatched-products: FAIL -', e.message); fail++; }

    // 4. Batch - use existing variant records
    try {
        var existing = await apiGet('/variants/?limit=1');
        var pid = existing.items[0].productId;
        var r = await apiPost('/variants/batch', { name: 'TestBatch', value: 'TestVal', productIds: [pid] });
        console.log('4.  POST /batch: PASS -', r.created, 'created'); pass++;
    } catch(e) { console.log('4.  POST /batch: FAIL -', e.message); fail++; }

    // 5. Auto-Detect
    try { var r = await apiPost('/variants/auto-detect', {}); console.log('5.  POST /auto-detect: PASS -', r.totalDetected, 'detected'); pass++; } catch(e) { console.log('5.  POST /auto-detect: FAIL -', e.message); fail++; }

    // 6. Bulk Match - use xml-variants data
    try {
        var xmlVars = await apiGet('/variants/xml-variants');
        var item = xmlVars.items[0];
        var matches = [{ productId: item.productId, variants: item.detectedVariants.map(function(d) { return { name: d.name, value: d.value }; }) }];
        var r = await apiPost('/variants/bulk-match', { matches: matches });
        console.log('6.  POST /bulk-match: PASS -', r.totalCreated, 'created'); pass++;
    } catch(e) { console.log('6.  POST /bulk-match: FAIL -', e.message); fail++; }

    // 7. List
    try { var r = await apiGet('/variants/?limit=5'); console.log('7.  GET /: PASS -', r.total, 'total'); pass++; } catch(e) { console.log('7.  GET /: FAIL -', e.message); fail++; }

    // 8. Types
    try { var r = await apiGet('/variants/types'); console.log('8.  GET /types: PASS -', r.items.length, 'types'); pass++; } catch(e) { console.log('8.  GET /types: FAIL -', e.message); fail++; }

    // 9. Get Single
    try { var list = await apiGet('/variants/?limit=1'); var r = await apiGet('/variants/' + list.items[0].id); console.log('9.  GET /:id: PASS -', r.item.name, ':', r.item.value); pass++; } catch(e) { console.log('9.  GET /:id: FAIL -', e.message); fail++; }

    // 10. Create
    try { var r = await apiPost('/variants/', { name: 'TestCreate', value: 'TestVal123' }); console.log('10. POST /: PASS -', r.item.name, ':', r.item.value); pass++; } catch(e) { console.log('10. POST /: FAIL -', e.message); fail++; }

    // 11. Update
    try { var list = await apiGet('/variants/?limit=1'); var r = await apiPut('/variants/' + list.items[0].id, { value: 'Updated' }); console.log('11. PUT /:id: PASS -', r.item.value); pass++; } catch(e) { console.log('11. PUT /:id: FAIL -', e.message); fail++; }

    // 12. Delete
    try { var list = await apiGet('/variants/?limit=1&search=TestCreate'); if (list.items.length > 0) { await apiDelete('/variants/' + list.items[0].id); console.log('12. DELETE /:id: PASS'); pass++; } else { console.log('12. DELETE /:id: SKIP'); } } catch(e) { console.log('12. DELETE /:id: FAIL -', e.message); fail++; }

    // 13. AI Suggest
    try { var r = await apiPost('/variants/ai-suggest', { title: 'Kirmizi XL Tisort Siyah' }); console.log('13. POST /ai-suggest: PASS -', r.suggestions.length, 'suggestions'); pass++; } catch(e) { console.log('13. POST /ai-suggest: FAIL -', e.message); fail++; }

    // 14. Bulk AI Suggest
    try { var r = await apiPost('/variants/bulk-ai-suggest', {}); console.log('14. POST /bulk-ai-suggest: PASS -', r.totalScanned, 'scanned'); pass++; } catch(e) { console.log('14. POST /bulk-ai-suggest: FAIL -', e.message); fail++; }

    // 15. Universal Attributes
    try { var r = await apiGet('/variants/universal-attributes'); console.log('15. GET /universal-attributes: PASS -', r.items.length, 'attrs'); pass++; } catch(e) { console.log('15. GET /universal-attributes: FAIL -', e.message); fail++; }

    // 16. Marketplace Attributes
    try { var r = await apiGet('/variants/marketplace-attributes/trendyol'); console.log('16. GET /marketplace-attributes: PASS -', r.items.length, 'attrs'); pass++; } catch(e) { console.log('16. GET /marketplace-attributes: FAIL -', e.message); fail++; }

    // 17. Screen
    try { var r = await apiGet('/variants/screen?page=1&limit=5'); console.log('17. GET /screen: PASS -', r.total, 'total'); pass++; } catch(e) { console.log('17. GET /screen: FAIL -', e.message); fail++; }

    // 18. Problems
    try { var r = await apiGet('/variants/problems?page=1&limit=5'); console.log('18. GET /problems: PASS -', r.total, 'total'); pass++; } catch(e) { console.log('18. GET /problems: FAIL -', e.message); fail++; }

    // 19. Auto Match
    try { var products = await apiGet('/variants/unmatched-products?limit=3'); var ids = []; products.items.forEach(function(p) { if (p.id) ids.push(p.id); }); var r = await apiPost('/variants/auto-match', { productIds: ids }); console.log('19. POST /auto-match: PASS -', r.matched, 'matched'); pass++; } catch(e) { console.log('19. POST /auto-match: FAIL -', e.message); fail++; }

    // 20. Confirm Match
    try { var products = await apiGet('/variants/unmatched-products?limit=1'); if (products.items.length > 0) { var r = await apiPost('/variants/confirm-match', { matches: [{ productId: products.items[0].id }] }); console.log('20. POST /confirm-match: PASS -', r.totalUpdated, 'updated'); pass++; } else { console.log('20. POST /confirm-match: SKIP'); } } catch(e) { console.log('20. POST /confirm-match: FAIL -', e.message); fail++; }

    // 21. Manual Match
    try { var products = await apiGet('/variants/unmatched-products?limit=2'); var ids = []; products.items.forEach(function(p) { if (p.id) ids.push(p.id); }); var r = await apiPost('/variants/manual-match', { matches: [{ productIds: ids }] }); console.log('21. POST /manual-match: PASS -', r.totalUpdated, 'updated'); pass++; } catch(e) { console.log('21. POST /manual-match: FAIL -', e.message); fail++; }

    // 22. Approve
    try { var products = await apiGet('/variants/unmatched-products?limit=1'); if (products.items.length > 0) { var r = await apiPost('/variants/approve', { productIds: [products.items[0].id] }); console.log('22. POST /approve: PASS -', r.updated, 'updated'); pass++; } else { console.log('22. POST /approve: SKIP'); } } catch(e) { console.log('22. POST /approve: FAIL -', e.message); fail++; }

    // 23. Reanalyze
    try { var products = await apiGet('/variants/unmatched-products?limit=2'); var ids = []; products.items.forEach(function(p) { if (p.id) ids.push(p.id); }); var r = await apiPost('/variants/reanalyze', { productIds: ids }); console.log('23. POST /reanalyze: PASS -', r.analyzed, 'analyzed'); pass++; } catch(e) { console.log('23. POST /reanalyze: FAIL -', e.message); fail++; }

    // 24. Scan
    try { var r = await apiPost('/variants/scan', {}); console.log('24. POST /scan: PASS -', r.totalDetected, 'detected'); pass++; } catch(e) { console.log('24. POST /scan: FAIL -', e.message); fail++; }

    // 25. Logs
    try { var r = await apiGet('/variants/logs?limit=5'); console.log('25. GET /logs: PASS -', r.items.length, 'entries'); pass++; } catch(e) { console.log('25. GET /logs: FAIL -', e.message); fail++; }

    // 26. Thresholds GET
    try { var r = await apiGet('/variants/thresholds'); console.log('26. GET /thresholds: PASS -', JSON.stringify(r.items)); pass++; } catch(e) { console.log('26. GET /thresholds: FAIL -', e.message); fail++; }

    // 27. Thresholds PUT
    try { var r = await apiPut('/variants/thresholds', { auto_accept: 90 }); console.log('27. PUT /thresholds: PASS -', JSON.stringify(r.items)); pass++; } catch(e) { console.log('27. PUT /thresholds: FAIL -', e.message); fail++; }

    // 28. Unmatch
    try { var products = await apiGet('/variants/unmatched-products?limit=1'); if (products.items.length > 0) { var r = await apiPost('/variants/unmatch', { productId: products.items[0].id }); console.log('28. POST /unmatch: PASS -', r.message); pass++; } else { console.log('28. POST /unmatch: SKIP'); } } catch(e) { console.log('28. POST /unmatch: FAIL -', e.message); fail++; }

    console.log('\n=== RESULTS: ' + pass + ' PASS, ' + fail + ' FAIL ===');

    // ============ UI CHECK ============
    console.log('\n=== CHROME UI CHECK ===');
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(5000);
    var ui = await page.evaluate(() => ({
        stepper: document.getElementById('var-stepper').children.length > 0,
        flowRows: document.getElementById('var-flow-list').children.length,
        progressRing: document.getElementById('var-progress-ring').children.length > 0,
        summary: document.getElementById('var-summary').children.length > 0,
        aiTips: document.getElementById('var-ai-tips').children.length > 0,
        logs: document.getElementById('var-logs').children.length > 0,
        screen: document.getElementById('var-screen-body').children.length > 0,
        xmlSources: document.getElementById('var-xml-source').options.length,
        marketplaces: document.getElementById('var-marketplace').options.length,
    }));
    console.log('UI:', JSON.stringify(ui));

    // ============ REGRESSION ============
    console.log('\n=== REGRESSION CHECK ===');
    var pages = ['dashboard', 'xml-sources', 'products', 'product-pool', 'prep-categories', 'prep-brands', 'prep-variants', 'prep-listings'];
    for (var p of pages) {
        await page.evaluate((name) => showPage(name), p);
        await page.waitForTimeout(1000);
        var visible = await page.evaluate((name) => {
            var el = document.getElementById('page-' + name);
            return el && !el.classList.contains('hidden');
        }, p);
        console.log(p + ':', visible ? 'PASS' : 'FAIL');
    }

    // ============ BUILD ============
    console.log('\n=== BUILD ===');

    await browser.close();
    console.log('\n=== ALL DONE ===');
})().catch(e => console.error('FATAL:', e.message));
