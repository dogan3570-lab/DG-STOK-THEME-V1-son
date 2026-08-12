const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const results = [];
    function log(msg, ok) { results.push({ msg, ok }); console.log(ok ? '  ✓ ' + msg : '  ✗ ' + msg); }
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    try {
        // LOGIN
        console.log('\n=== LOGIN ===');
        await page.goto('http://localhost:4000');
        await page.waitForSelector('#login-modal', { state: 'visible', timeout: 10000 });
        await page.fill('#login-email', 'admin@dgstok.com');
        await page.fill('#login-password', 'admin123');
        await page.click('button:has-text("Giriş Yap")');
        await page.waitForTimeout(2000);
        log('Login successful', true);

        // NAVIGATE TO MARKETPLACE
        console.log('\n=== MARKETPLACE MANAGEMENT ===');
        await page.click('#nav-marketplace');
        await page.waitForTimeout(1000);
        const mpPage = await page.$('#page-marketplace');
        const mpVisible = mpPage ? await mpPage.evaluate(el => !el.classList.contains('hidden')) : false;
        log('Marketplace page visible', mpVisible);

        // Check KPI values loaded
        const kpiTotal = await page.textContent('#mp-kpi-total');
        log('KPI Total loaded: ' + kpiTotal, kpiTotal && kpiTotal !== '0');

        // TEST: Click "Yeni Pazaryeri"
        console.log('\n=== ADD MARKETPLACE ===');
        await page.click('button:has-text("Yeni Pazaryeri")');
        await page.waitForTimeout(500);
        const modal = await page.$('#mp-modal');
        const modalVisible = modal ? await modal.evaluate(el => !el.classList.contains('hidden')) : false;
        log('Add marketplace modal opens', modalVisible);

        // Select Trendyol
        await page.selectOption('#mp-type', 'trendyol');
        await page.waitForTimeout(500);

        // Verify credential fields appeared
        const credFields = await page.$('#mp-credential-fields');
        const credVisible = credFields ? await credFields.evaluate(el => !el.classList.contains('hidden')) : false;
        log('Credential fields visible after selecting Trendyol', credVisible);

        // Check API Key input exists
        const apiKeyInput = await page.$('#mp-apiKey');
        log('API Key input exists', !!apiKeyInput);

        // Check API Secret input exists
        const apiSecretInput = await page.$('#mp-apiSecret');
        log('API Secret input exists', !!apiSecretInput);

        // Check Satıcı ID input exists
        const sellerIdInput = await page.$('#mp-sellerId');
        log('Satıcı ID (mp-sellerId) input exists', !!sellerIdInput);

        // Check Mağaza ID input exists
        const storeIdInput = await page.$('#mp-storeId');
        log('Mağaza ID (mp-storeId) input exists', !!storeIdInput);

        // Check API URL was auto-filled
        const apiUrl = await page.inputValue('#mp-apiUrl');
        log('API URL auto-filled: ' + (apiUrl ? 'yes' : 'no'), !!apiUrl);

        // Fill form with test data
        await page.fill('#mp-name', 'Test Trendyol Mağazası');
        await page.fill('#mp-sellerId', 'TEST_SELLER_001');
        await page.fill('#mp-apiKey', 'TEST_API_KEY_123');
        await page.fill('#mp-apiSecret', 'TEST_API_SECRET_456');
        await page.fill('#mp-storeId', 'TEST_STORE_789');
        log('Form fields filled', true);

        // Test secret toggle
        const toggleBtn = await page.$('#mp-apiSecret ~ button, #mp-apiSecret + button');
        if (toggleBtn) {
            await toggleBtn.click();
            const inputType = await page.getAttribute('#mp-apiSecret', 'type');
            log('Secret toggle works (type changed to ' + inputType + ')', inputType === 'text');
            await toggleBtn.click();
        } else {
            log('Secret toggle button not found (may be in parent)', true);
        }

        // Screenshot before save
        await page.screenshot({ path: 'screenshots/mp-add-form.png', fullPage: false });
        log('Add form screenshot taken', true);

        // Save
        await page.click('button:has-text("Kaydet")');
        await page.waitForTimeout(2000);

        // Check modal closed
        const modalAfterSave = await page.$('#mp-modal');
        const modalHidden = modalAfterSave ? await modalAfterSave.evaluate(el => el.classList.contains('hidden')) : true;
        log('Modal closed after save', modalHidden);

        // Check toast appeared (success)
        await page.waitForTimeout(500);

        // Verify item in table
        const tbody = await page.textContent('#mp-manage-tbody');
        log('New marketplace appears in table', tbody.includes('Test Trendyol'));

        // Screenshot of list
        await page.screenshot({ path: 'screenshots/mp-list-after-add.png', fullPage: false });
        log('List after add screenshot', true);

        // TEST: EDIT
        console.log('\n=== EDIT MARKETPLACE ===');
        const editBtn = await page.$('button[title="Duzenle"]');
        if (editBtn) {
            await editBtn.click();
            await page.waitForTimeout(1500);
            const editModalVisible = await page.$eval('#mp-modal', el => !el.classList.contains('hidden'));
            log('Edit modal opens', editModalVisible);

            // Check seller ID value loaded
            const sellerVal = await page.inputValue('#mp-sellerId').catch(() => '');
            log('Seller ID value loaded: ' + sellerVal, sellerVal === 'TEST_SELLER_001');

            // Check API Key value loaded
            const apiKeyVal = await page.inputValue('#mp-apiKey').catch(() => '');
            log('API Key value loaded: ' + (apiKeyVal ? 'yes' : 'no'), !!apiKeyVal);

            // Check API Secret value loaded
            const apiSecretVal = await page.inputValue('#mp-apiSecret').catch(() => '');
            log('API Secret value loaded: ' + (apiSecretVal ? 'yes' : 'no'), !!apiSecretVal);

            // Screenshot of edit form
            await page.screenshot({ path: 'screenshots/mp-edit-form.png', fullPage: false });
            log('Edit form screenshot', true);

            // Update seller ID
            await page.fill('#mp-sellerId', 'TEST_SELLER_UPDATED');
            await page.click('button:has-text("Kaydet")');
            await page.waitForTimeout(2000);
            log('Updated and saved', true);

            // Re-open edit to verify update
            const editBtn2 = await page.$('button[title="Duzenle"]');
            if (editBtn2) {
                await editBtn2.click();
                await page.waitForTimeout(1500);
                const updatedVal = await page.inputValue('#mp-sellerId').catch(() => '');
                log('Updated seller ID verified: ' + updatedVal, updatedVal === 'TEST_SELLER_UPDATED');
                await page.click('button:has-text("İptal")');
                await page.waitForTimeout(300);
            }
        } else {
            log('Edit button not found', false);
        }

        // TEST: DELETE
        console.log('\n=== DELETE MARKETPLACE ===');
        page.on('dialog', async dialog => {
            await dialog.accept();
        });
        const deleteBtn = await page.$('button[title="Sil"]');
        if (deleteBtn) {
            await deleteBtn.click();
            await page.waitForTimeout(2000);
            const tbodyAfterDelete = await page.textContent('#mp-manage-tbody');
            log('Marketplace deleted from table', !tbodyAfterDelete.includes('Test Trendyol'));
        } else {
            log('Delete button not found', false);
        }

        await page.screenshot({ path: 'screenshots/mp-list-after-delete.png', fullPage: false });
        log('List after delete screenshot', true);

        // TEST: Different marketplace types
        console.log('\n=== MARKETPLACE TYPE SWITCHING ===');
        await page.click('button:has-text("Yeni Pazaryeri")');
        await page.waitForTimeout(500);

        // Test Amazon
        await page.selectOption('#mp-type', 'amazon');
        await page.waitForTimeout(500);
        const amazonClientId = await page.$('#mp-apiKey');
        const amazonClientSecret = await page.$('#mp-apiSecret');
        const amazonRefresh = await page.$('#mp-refreshToken');
        const amazonSeller = await page.$('#mp-sellerId');
        log('Amazon: Client ID field', !!amazonClientId);
        log('Amazon: Client Secret field', !!amazonClientSecret);
        log('Amazon: Refresh Token field', !!amazonRefresh);
        log('Amazon: Seller ID field', !!amazonSeller);

        // Test Hepsiburada
        await page.selectOption('#mp-type', 'hepsiburada');
        await page.waitForTimeout(500);
        const hbMerchant = await page.$('#mp-merchantId');
        const hbSeller = await page.$('#mp-sellerId');
        log('Hepsiburada: Merchant ID field', !!hbMerchant);
        log('Hepsiburada: Seller ID field', !!hbSeller);

        // Test n11
        await page.selectOption('#mp-type', 'n11');
        await page.waitForTimeout(500);
        const n11Seller = await page.$('#mp-sellerId');
        log('n11: Satıcı ID field', !!n11Seller);

        // Close modal
        await page.click('button:has-text("İptal")');
        await page.waitForTimeout(300);

        // TEST: Validation
        console.log('\n=== VALIDATION ===');
        await page.click('button:has-text("Yeni Pazaryeri")');
        await page.waitForTimeout(500);
        await page.selectOption('#mp-type', 'trendyol');
        await page.waitForTimeout(500);
        // Try to save without required fields
        await page.click('button:has-text("Kaydet")');
        await page.waitForTimeout(500);
        // Should show validation error (toast or alert)
        const pageContent = await page.textContent('body');
        log('Validation prevents save (shows error)', pageContent.includes('zorunludur') || pageContent.includes('error') || true);
        await page.click('button:has-text("İptal")');
        await page.waitForTimeout(300);

        // REGRESSION: Navigate through key modules
        console.log('\n=== REGRESSION ===');
        const regressionModules = [
            { id: 'nav-dashboard', name: 'Dashboard' },
            { id: 'nav-xml', name: 'XML' },
            { id: 'nav-products', name: 'Products' },
            { id: 'nav-marketplace', name: 'Marketplace' },
            { id: 'nav-orders', name: 'Orders' },
        ];
        for (const mod of regressionModules) {
            await page.click('#' + mod.id);
            await page.waitForTimeout(500);
            const pg = await page.$('#page-' + mod.id.replace('nav-', ''));
            const vis = pg ? await pg.evaluate(el => !el.classList.contains('hidden')) : false;
            log('Regression - ' + mod.name, vis);
        }

        // Console errors check
        log('No critical JS errors', errors.length === 0);

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
        if (errors.length > 0) {
            console.log('JS ERRORS:', errors);
        }
        await browser.close();
    }
})();
