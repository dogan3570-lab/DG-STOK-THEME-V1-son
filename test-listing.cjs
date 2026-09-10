const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // Login
    await page.goto('http://localhost:4000');
    await page.waitForTimeout(3000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);

    let pass = 0, fail = 0;
    function check(name, ok, detail) {
        if (ok) { pass++; console.log('  PASS: ' + name); }
        else { fail++; console.log('  FAIL: ' + name + (detail ? ' — ' + detail : '')); }
    }

    console.log('========== LISTING MODULE TEST ==========\n');

    // Navigate to Listing
    await page.evaluate(() => showPage('prep-listings'));
    await page.waitForTimeout(2000);

    // Check page structure
    const pageVisible = await page.$eval('#page-prep-listings', el => !el.classList.contains('hidden'));
    check('Page renders', pageVisible);

    // Check guard warning visible
    const guardWarn = await page.$('#li-guard-warn');
    const guardVisible = guardWarn ? !(await guardWarn.evaluate(el => el.classList.contains('hidden'))) : false;
    check('Guard warning visible (no selection)', guardVisible);

    // Check main content hidden
    const mainHidden = await page.$eval('#li-main-content', el => el.classList.contains('hidden'));
    check('Main content hidden (no selection)', mainHidden);

    // Check XML source dropdown populated
    const xmlOpts = await page.$$eval('#li-xml-source option', opts => opts.map(o => ({ v: o.value, t: o.textContent })));
    check('XML dropdown populated', xmlOpts.length > 1, 'options: ' + xmlOpts.length);
    console.log('    XML options:', xmlOpts.map(o => o.t).join(', '));

    // Check marketplace dropdown populated
    const mpOpts = await page.$$eval('#li-marketplace option', opts => opts.map(o => ({ v: o.value, t: o.textContent })));
    check('MP dropdown populated', mpOpts.length > 1, 'options: ' + mpOpts.length);
    console.log('    MP options:', mpOpts.map(o => o.t).join(', '));

    // Select XML source
    const validXml = xmlOpts.find(o => o.v && o.v !== '');
    if (validXml) {
        await page.selectOption('#li-xml-source', validXml.v);
        await page.waitForTimeout(500);
        check('XML selected', true);
    }

    // Select marketplace
    const validMp = mpOpts.find(o => o.v && o.v !== '');
    if (validMp) {
        await page.selectOption('#li-marketplace', validMp.v);
        await page.waitForTimeout(2000);
        check('MP selected', true);
    }

    // Guard should now be hidden, main visible
    const guardHiddenAfter = await page.$eval('#li-guard-warn', el => el.classList.contains('hidden'));
    check('Guard hidden after selection', guardHiddenAfter);
    const mainVisibleAfter = await page.$eval('#li-main-content', el => !el.classList.contains('hidden'));
    check('Main content visible after selection', mainVisibleAfter);

    // KPI cards
    const kpiTotal = await page.$eval('#li-stat-total', el => el.textContent);
    check('KPI Total loaded', kpiTotal !== '-', 'value: ' + kpiTotal);
    const kpiActive = await page.$eval('#li-stat-active', el => el.textContent);
    check('KPI Active loaded', kpiActive !== '-', 'value: ' + kpiActive);
    const kpiInactive = await page.$eval('#li-stat-inactive', el => el.textContent);
    check('KPI Inactive loaded', kpiInactive !== '-', 'value: ' + kpiInactive);

    // Tab switching
    console.log('\n--- Tab Tests ---');
    
    // Templates tab (default)
    const templatesPanel = await page.$eval('#li-panel-templates', el => !el.classList.contains('hidden'));
    check('Templates tab visible (default)', templatesPanel);

    // Switch to Rules tab
    await page.click('#li-tab-rules');
    await page.waitForTimeout(300);
    const rulesPanel = await page.$eval('#li-panel-rules', el => !el.classList.contains('hidden'));
    check('Rules tab visible', rulesPanel);
    const templatesHidden = await page.$eval('#li-panel-templates', el => el.classList.contains('hidden'));
    check('Templates tab hidden', templatesHidden);

    // Switch to Logs tab
    await page.click('#li-tab-logs');
    await page.waitForTimeout(300);
    const logsPanel = await page.$eval('#li-panel-logs', el => !el.classList.contains('hidden'));
    check('Logs tab visible', logsPanel);

    // Switch to Forbidden tab
    await page.click('#li-tab-forbidden');
    await page.waitForTimeout(300);
    const forbiddenPanel = await page.$eval('#li-panel-forbidden', el => !el.classList.contains('hidden'));
    check('Forbidden tab visible', forbiddenPanel);

    // Back to Templates
    await page.click('#li-tab-templates');
    await page.waitForTimeout(300);

    // Templates table
    const tbodyContent = await page.$eval('#li-tbody', el => el.innerHTML);
    const hasRows = !tbodyContent.includes('Yukleniyor') && !tbodyContent.includes('Sablon yok');
    check('Templates table has data', hasRows);

    // Template selects
    const previewOpts = await page.$$eval('#li-preview-template option', opts => opts.length);
    check('Preview template dropdown populated', previewOpts > 0, 'options: ' + previewOpts);
    const matchOpts = await page.$$eval('#li-match-template option', opts => opts.length);
    check('Match template dropdown populated', matchOpts > 0, 'options: ' + matchOpts);

    // V2 Calculator
    console.log('\n--- V2 Calculator ---');
    await page.click('#li-tab-rules');
    await page.waitForTimeout(300);
    const v2Price = await page.$('#li-v2-price');
    check('V2 price input exists', !!v2Price);
    const v2Vat = await page.$('#li-v2-vat');
    check('V2 VAT input exists', !!v2Vat);
    const v2Margin = await page.$('#li-v2-margin');
    check('V2 margin input exists', !!v2Margin);
    const v2Rounding = await page.$('#li-v2-rounding');
    check('V2 rounding select exists', !!v2Rounding);

    // Price Rules table
    const rulesTable = await page.$('#li-rules-table');
    check('Rules table container exists', !!rulesTable);

    // Back to Templates
    await page.click('#li-tab-templates');
    await page.waitForTimeout(300);

    // Console errors
    const realErrors = errors.filter(e => !e.includes('401'));
    check('No JS errors', realErrors.length === 0);
    if (realErrors.length > 0) realErrors.forEach(e => console.log('  Error: ' + e));

    // Screenshots
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\list-light.png', fullPage: false });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'C:\\PROJE 1\\DG-STOK-THEME-V1\\list-dark.png', fullPage: false });

    console.log('\n========== RESULTS ==========');
    console.log('PASS: ' + pass);
    console.log('FAIL: ' + fail);

    await browser.close();
})();
