const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('401')) errs.push(msg.text()); });

    await page.goto('http://localhost:4000');
    await page.waitForTimeout(3000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);

    console.log('=== FINAL VERIFICATION ===\n');

    // Check all pages load
    var pages = ['dashboard', 'xml-sources', 'products', 'product-pool', 'prep-categories', 'prep-brands', 'prep-variants', 'prep-listings'];
    for (var p of pages) {
        await page.evaluate((name) => showPage(name), p);
        await page.waitForTimeout(1500);
        var visible = await page.evaluate((name) => {
            var el = document.getElementById('page-' + name);
            return el && !el.classList.contains('hidden');
        }, p);
        console.log(p + ':', visible ? 'PASS' : 'FAIL');
    }

    // Final variant page check
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(5000);
    var final = await page.evaluate(() => ({
        stats: varState.stats,
        rows: varState.rows.length,
        xmlItems: varState.xmlVariantItems.length,
        variantRecords: varState.variantRecords.length,
        stepper: document.getElementById('var-stepper').children.length,
        flowRows: document.getElementById('var-flow-list').children.length,
        progressRing: document.getElementById('var-progress-ring').innerHTML.length > 50,
        summary: document.getElementById('var-summary').innerHTML.length > 50,
        aiTips: document.getElementById('var-ai-tips').children.length,
        logs: document.getElementById('var-logs').children.length,
        screen: document.getElementById('var-screen-body').children.length,
        xmlSources: document.getElementById('var-xml-source').options.length,
        marketplaces: document.getElementById('var-marketplace').options.length,
    }));
    console.log('\nFinal variant state:', JSON.stringify(final, null, 2));
    console.log('\nConsole errors:', errs.length === 0 ? 'NONE' : errs.join('\n  '));

    await page.screenshot({ path: 'variant-final-verified.png', fullPage: false });
    await browser.close();
    console.log('\n=== FINAL VERIFICATION COMPLETE ===');
})().catch(e => console.error('FATAL:', e.message));
