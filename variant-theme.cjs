const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await page.goto('http://localhost:4000');
    await page.waitForTimeout(3000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);

    // DARK MODE
    console.log('=== DARK MODE ===');
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'variant-dark.png', fullPage: false });
    console.log('Dark mode screenshot saved');

    // Check dark mode elements
    var darkCheck = await page.evaluate(() => ({
        body: document.documentElement.classList.contains('dark'),
        flowVisible: document.getElementById('var-flow-list').children.length > 0,
        stepperVisible: document.getElementById('var-stepper').children.length > 0,
    }));
    console.log('Dark mode check:', JSON.stringify(darkCheck));

    // LIGHT MODE
    console.log('\n=== LIGHT MODE ===');
    await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'variant-light.png', fullPage: false });
    console.log('Light mode screenshot saved');

    // Check light mode elements
    var lightCheck = await page.evaluate(() => ({
        body: document.documentElement.classList.contains('light'),
        flowVisible: document.getElementById('var-flow-list').children.length > 0,
    }));
    console.log('Light mode check:', JSON.stringify(lightCheck));

    // Check contrast
    var contrast = await page.evaluate(() => {
        var el = document.querySelector('#var-flow-list .grid');
        if (!el) return 'no element';
        var style = getComputedStyle(el);
        return { color: style.color, bg: style.backgroundColor };
    });
    console.log('Contrast check:', JSON.stringify(contrast));

    // Switch back to dark for final
    await page.evaluate(() => {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(500);

    // SCROLL TEST
    await page.evaluate(() => {
        var flowList = document.getElementById('var-flow-list');
        if (flowList) flowList.scrollTop = flowList.scrollHeight;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'variant-dark-scrolled.png', fullPage: false });
    console.log('Scrolled screenshot saved');

    // CONSOLE ERRORS
    var errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.evaluate(() => showPage('prep-variants'));
    await page.waitForTimeout(3000);
    console.log('\nConsole errors:', errors.length === 0 ? 'NONE' : errors.join('\n  '));

    await browser.close();
    console.log('\n=== LIGHT/DARK TEST COMPLETE ===');
})().catch(e => console.error('FATAL:', e.message));
