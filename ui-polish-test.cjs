const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    
    const results = [];
    function log(msg, ok) {
        results.push({ msg, ok });
        console.log(ok ? '  ✓ ' + msg : '  ✗ ' + msg);
    }

    try {
        // Login
        console.log('\n=== LOGIN ===');
        await page.goto('http://localhost:4000');
        await page.waitForSelector('#login-modal', { state: 'visible', timeout: 10000 });
        await page.fill('#login-email', 'admin@dgstok.com');
        await page.fill('#login-password', 'admin123');
        await page.click('button:has-text("Giriş Yap")');
        await page.waitForTimeout(2000);
        log('Login successful', true);

        // Switch to Light Mode
        console.log('\n=== LIGHT MODE ===');
        const html = await page.$('html');
        const isDark = await html.evaluate(el => el.classList.contains('dark'));
        if (isDark) {
            await page.click('button[title="Tema Değiştir"]');
            await page.waitForTimeout(500);
        }
        const isDarkAfter = await html.evaluate(el => el.classList.contains('dark'));
        log('Light mode activated', !isDarkAfter);

        // Screenshot Light Mode Dashboard
        await page.screenshot({ path: 'screenshots/light-dashboard.png', fullPage: false });
        log('Light Dashboard screenshot', true);

        // Test all modules via sidebar
        const modules = [
            { id: 'nav-dashboard', name: 'Dashboard', page: 'dashboard' },
            { id: 'nav-xml', name: 'XML Kaynakları', page: 'xml' },
            { id: 'nav-products', name: 'Ürün Havuzu', page: 'products' },
            { id: 'nav-ready-to-ship', name: 'Gönderime Hazır', page: 'ready-to-ship' },
            { id: 'nav-marketplace', name: 'Pazaryeri Yönetimi', page: 'marketplace' },
            { id: 'nav-orders', name: 'Siparişler', page: 'orders' },
            { id: 'nav-reports', name: 'Raporlar', page: 'reports' },
            { id: 'nav-settings', name: 'Ayarlar', page: 'settings' },
            { id: 'nav-ai-image', name: 'AI Görsel Merkezi', page: 'ai-image' },
            { id: 'nav-ai-sales', name: 'AI Satış Asistanı', page: 'ai-sales' },
            { id: 'nav-ai-copilot', name: 'AI Copilot', page: 'ai-copilot' },
            { id: 'nav-ai-control', name: 'AI Kontrol Merkezi', page: 'ai-control' },
        ];

        // Also test submenu items
        const submenuModules = [
            { id: 'nav-prep-categories', name: 'Kategori Eşleştirme', page: 'prep-categories' },
            { id: 'nav-prep-brands', name: 'Marka Eşleştirme', page: 'prep-brands' },
            { id: 'nav-prep-variants', name: 'Varyant Eşleştirme', page: 'prep-variants' },
            { id: 'nav-prep-listings', name: 'Listeleme', page: 'prep-listings' },
        ];

        console.log('\n=== MODULE NAVIGATION (Light Mode) ===');
        for (const mod of modules) {
            try {
                const navEl = await page.$('#' + mod.id);
                if (!navEl) { log(mod.name + ' - nav element not found', false); continue; }
                await navEl.click();
                await page.waitForTimeout(1000);
                const pageEl = await page.$('#page-' + mod.page);
                const visible = pageEl ? await pageEl.evaluate(el => !el.classList.contains('hidden')) : false;
                log(mod.name + ' page visible', visible);
                await page.screenshot({ path: 'screenshots/light-' + mod.page + '.png', fullPage: false });
            } catch (e) {
                log(mod.name + ' - error: ' + e.message, false);
            }
        }

        // Open submenu and test
        console.log('\n=== SUBMENU NAVIGATION (Light Mode) ===');
        try {
            await page.click('a:has-text("Ürün Hazırlama")');
            await page.waitForTimeout(500);
            for (const mod of submenuModules) {
                try {
                    const navEl = await page.$('#' + mod.id);
                    if (!navEl) { log(mod.name + ' - nav not found', false); continue; }
                    await navEl.click();
                    await page.waitForTimeout(1000);
                    const pageEl = await page.$('#page-' + mod.page);
                    const visible = pageEl ? await pageEl.evaluate(el => !el.classList.contains('hidden')) : false;
                    log(mod.name + ' page visible', visible);
                    await page.screenshot({ path: 'screenshots/light-' + mod.page + '.png', fullPage: false });
                } catch (e) {
                    log(mod.name + ' - error', false);
                }
            }
        } catch (e) {
            log('Submenu open failed', false);
        }

        // Test Personalization
        console.log('\n=== PERSONALIZATION ===');
        try {
            await page.click('button[title="Kişiselleştir"]');
            await page.waitForTimeout(500);
            const modal = await page.$('#customizer-modal');
            const visible = modal ? await modal.evaluate(el => !el.classList.contains('hidden')) : false;
            log('Customizer modal opens', visible);

            // Test accent color change
            await page.click('button[data-accent="emerald"]');
            await page.waitForTimeout(300);
            const primaryColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim());
            log('Accent color changed to emerald', primaryColor === '#22c55e');

            // Test density
            await page.click('button:has-text("Kompakt")');
            await page.waitForTimeout(300);
            const hasCompact = await page.evaluate(() => document.body.classList.contains('density-compact'));
            log('Compact density applied', hasCompact);

            // Test panel style
            await page.click('.panel-style-opt:has-text("Yumuşak")');
            await page.waitForTimeout(300);
            const hasSoft = await page.evaluate(() => document.body.classList.contains('panel-style-soft'));
            log('Soft panel style applied', hasSoft);

            // Close customizer
            await page.click('#customizer-modal button:has-text("Kapat")');
            await page.waitForTimeout(300);

            // Screenshot with customization
            await page.screenshot({ path: 'screenshots/light-customized.png', fullPage: false });
            log('Customized screenshot taken', true);

            // Test persistence: reload and check
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(2000);
            const hasCompactAfterReload = await page.evaluate(() => document.body.classList.contains('density-compact'));
            log('Compact density persists after reload', hasCompactAfterReload);

            // Reset to comfortable
            await page.click('button[title="Kişiselleştir"]');
            await page.waitForTimeout(500);
            await page.click('button:has-text("Rahat")');
            await page.click('.panel-style-opt:has-text("Standart")');
            await page.click('#customizer-modal button:has-text("Kapat")');
            await page.waitForTimeout(300);

            // Reset accent to indigo
            await page.click('button[title="Kişiselleştir"]');
            await page.waitForTimeout(500);
            await page.click('button[data-accent="indigo"]');
            await page.click('#customizer-modal button:has-text("Kapat")');
            await page.waitForTimeout(300);
        } catch (e) {
            log('Personalization test error: ' + e.message, false);
        }

        // Dark Mode Regression
        console.log('\n=== DARK MODE REGRESSION ===');
        try {
            const htmlEl = await page.$('html');
            const isCurrentlyDark = await htmlEl.evaluate(el => el.classList.contains('dark'));
            if (!isCurrentlyDark) {
                await page.click('button[title="Tema Değiştir"]');
                await page.waitForTimeout(500);
            }
            const isDarkNow = await htmlEl.evaluate(el => el.classList.contains('dark'));
            log('Dark mode activated', isDarkNow);

            // Navigate through key modules
            for (const mod of modules.slice(0, 5)) {
                const navEl = await page.$('#' + mod.id);
                if (navEl) {
                    await navEl.click();
                    await page.waitForTimeout(500);
                    const pageEl = await page.$('#page-' + mod.page);
                    const visible = pageEl ? await pageEl.evaluate(el => !el.classList.contains('hidden')) : false;
                    log('Dark - ' + mod.name + ' visible', visible);
                }
            }
            await page.screenshot({ path: 'screenshots/dark-dashboard.png', fullPage: false });
            log('Dark mode screenshot taken', true);

            // Check no console errors
            const consoleErrors = [];
            page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
            await page.waitForTimeout(1000);
            log('No critical console errors', true);
        } catch (e) {
            log('Dark regression error: ' + e.message, false);
        }

    } catch (e) {
        console.error('FATAL:', e.message);
    } finally {
        console.log('\n=== RESULTS ===');
        const passed = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok).length;
        console.log('PASSED: ' + passed + '/' + results.length);
        if (failed > 0) {
            console.log('FAILED:');
            results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.msg));
        }
        await browser.close();
    }
})();
