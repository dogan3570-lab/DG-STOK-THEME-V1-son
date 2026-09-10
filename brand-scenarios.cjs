const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('401')) errs.push(msg.text()); });

    await page.goto('http://localhost:4000');
    await page.waitForTimeout(3000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);

    // ============ SENARYO 1: XML MARKASI ESLESTIRME ============
    console.log('=== SENARYO 1: XML MARKASI ESLESTIRME ===');
    
    // 1. Navigate to brands
    await page.evaluate(() => showPage('prep-brands'));
    await page.waitForTimeout(5000);
    
    // 2. Check current state
    const s1_before = await page.evaluate(() => ({
        xmlBrandsCount: prepBrandState.xmlBrands.length,
        xmlBrands: prepBrandState.xmlBrands.map(b => b.name),
        mappingsCount: prepBrandState.mappings.length,
        groupsCount: prepBrandState.groups.length,
        groups: prepBrandState.groups.map(g => ({ xml: g.xmlBrand, status: g.status, productCount: g.productCount }))
    }));
    console.log('1a. Before state:', JSON.stringify(s1_before, null, 2));
    
    // 3. Select source and marketplace
    await page.selectOption('#br-xml-source', { index: 1 });
    await page.selectOption('#br-marketplace', { index: 1 });
    await page.waitForTimeout(2000);
    
    // 4. If akilli bayi is 'ai' status, approve it first
    const akilliGroup = await page.evaluate(() => prepBrandState.groups.find(g => g.xmlBrand === 'akilli bayi'));
    console.log('1b. akilli bayi group:', JSON.stringify(akilliGroup));
    
    // 5. First unmatch to test manual match from scratch
    if (akilliGroup && (akilliGroup.status === 'matched' || akilliGroup.status === 'ai')) {
        console.log('1c. Unmatching akilli bayi first...');
        const unmatchRes = await page.evaluate(async () => {
            const r = await api('/brands/unmatch', { method: 'POST', body: { xmlBrandName: 'akilli bayi' } });
            return r;
        });
        console.log('1d. Unmatch result:', JSON.stringify(unmatchRes));
        
        // Reload data
        await page.evaluate(async () => {
            await prepBrandLoadData();
            prepBrandComputeGroups();
            prepBrandFlowRender();
        });
        await page.waitForTimeout(1000);
        
        const afterUnmatch = await page.evaluate(() => prepBrandState.groups.find(g => g.xmlBrand === 'akilli bayi'));
        console.log('1e. After unmatch:', JSON.stringify(afterUnmatch));
    }
    
    // 6. Now manually match akilli bayi to a DG brand
    console.log('1f. Manual matching akilli bayi...');
    const matchResult = await page.evaluate(async () => {
        const brands = await api('/brands');
        const targetBrand = brands.items.find(b => b.name === 'akilli bayi') || brands.items[0];
        if (!targetBrand) return { error: 'No brand found to match with' };
        
        const r = await api('/brands/match', { method: 'POST', body: { 
            xmlBrandName: 'akilli bayi', 
            dgBrandId: targetBrand.id 
        }});
        return { brandName: targetBrand.name, brandId: targetBrand.id, matchResult: r };
    });
    console.log('1g. Match result:', JSON.stringify(matchResult));
    
    // 7. Verify in database directly
    const dbCheck1 = await page.evaluate(async () => {
        const mappings = await api('/brands/mappings');
        const akilliMapping = mappings.items.find(m => m.xmlBrandName === 'akilli bayi');
        const prods = await api('/brands/products?page=1&limit=3');
        const matchedProds = prods.items.filter(p => p.brand && p.brand.name === 'akilli bayi' && p.brandMatch);
        return { 
            mapping: akilliMapping, 
            matchedProductsCount: matchedProds.length,
            sampleProduct: matchedProds[0] ? { title: matchedProds[0].title, brandMatch: matchedProds[0].brandMatch, matchedBy: matchedProds[0].matchedBy, brandId: matchedProds[0].brandId } : null
        };
    });
    console.log('1h. DB check after match:', JSON.stringify(dbCheck1, null, 2));
    
    // 8. Reload page and verify persistence
    await page.evaluate(() => location.reload());
    await page.waitForTimeout(5000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);
    await page.evaluate(() => showPage('prep-brands'));
    await page.waitForTimeout(5000);
    await page.selectOption('#br-xml-source', { index: 1 });
    await page.selectOption('#br-marketplace', { index: 1 });
    await page.waitForTimeout(3000);
    
    const afterReload = await page.evaluate(() => ({
        groups: prepBrandState.groups.map(g => ({ xml: g.xmlBrand, status: g.status, matchedBrandName: g.matchedBrandName })),
        mappings: prepBrandState.mappings.filter(m => m.xmlBrandName === 'akilli bayi')
    }));
    console.log('1i. After FULL RELOAD:', JSON.stringify(afterReload, null, 2));
    console.log('1j. SENARYO 1:', afterReload.mappings.length > 0 ? 'PASS' : 'FAIL');
    
    // ============ SENARYO 2: UNMATCH ============
    console.log('\n=== SENARYO 2: UNMATCH ===');
    const unmatchRes2 = await page.evaluate(async () => {
        const r = await api('/brands/unmatch', { method: 'POST', body: { xmlBrandName: 'akilli bayi' } });
        return r;
    });
    console.log('2a. Unmatch result:', JSON.stringify(unmatchRes2));
    
    await page.evaluate(async () => {
        await prepBrandLoadData();
        prepBrandComputeGroups();
        prepBrandFlowRender();
    });
    await page.waitForTimeout(1000);
    
    const afterUnmatch2 = await page.evaluate(() => ({
        groups: prepBrandState.groups.find(g => g.xmlBrand === 'akilli bayi'),
        mappings: prepBrandState.mappings.filter(m => m.xmlBrandName === 'akilli bayi')
    }));
    console.log('2b. After unmatch:', JSON.stringify(afterUnmatch2));
    
    // Reload and verify unmatch persisted
    await page.evaluate(() => location.reload());
    await page.waitForTimeout(5000);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.click('button:has-text("Giri")');
    await page.waitForTimeout(3000);
    await page.evaluate(() => showPage('prep-brands'));
    await page.waitForTimeout(5000);
    await page.selectOption('#br-xml-source', { index: 1 });
    await page.selectOption('#br-marketplace', { index: 1 });
    await page.waitForTimeout(3000);
    
    const afterUnmatchReload = await page.evaluate(() => ({
        mappings: prepBrandState.mappings.filter(m => m.xmlBrandName === 'akilli bayi'),
        akilliGroup: prepBrandState.groups.find(g => g.xmlBrand === 'akilli bayi')
    }));
    console.log('2c. After unmatch+reload:', JSON.stringify(afterUnmatchReload));
    console.log('2d. SENARYO 2:', afterUnmatchReload.mappings.length === 0 ? 'PASS' : 'FAIL');
    
    // ============ SENARYO 3: AI MATCH ============
    console.log('\n=== SENARYO 3: AI MATCH ===');
    const aiRes = await page.evaluate(async () => {
        const r = await api('/brands/ai-match', { method: 'POST', body: {} });
        return r;
    });
    console.log('3a. AI match result:', JSON.stringify(aiRes));
    
    await page.evaluate(async () => {
        await prepBrandLoadData();
        prepBrandComputeGroups();
        prepBrandFlowRender();
    });
    await page.waitForTimeout(1000);
    
    const afterAi = await page.evaluate(() => ({
        akilliGroup: prepBrandState.groups.find(g => g.xmlBrand === 'akilli bayi'),
        allGroups: prepBrandState.groups.map(g => ({ xml: g.xmlBrand, status: g.status, matchedBrandName: g.matchedBrandName, suggestedBrandName: g.suggestedBrandName }))
    }));
    console.log('3b. After AI match:', JSON.stringify(afterAi, null, 2));
    console.log('3c. SENARYO 3:', afterAi.akilliGroup && (afterAi.akilliGroup.status === 'matched' || afterAi.akilliGroup.status === 'ai') ? 'PASS' : 'FAIL');
    
    // ============ SENARYO 4: MARKASIZ URUN ============
    console.log('\n=== SENARYO 4: MARKASIZ URUN ===');
    const unbrandedGroup = await page.evaluate(() => prepBrandState.groups.find(g => g.xmlBrand === '(Markasiz)'));
    console.log('4a. Markasiz group:', JSON.stringify(unbrandedGroup));
    console.log('4b. SENARYO 4:', unbrandedGroup && unbrandedGroup.status === 'none' ? 'PASS' : 'FAIL');
    
    // ============ SENARYO 5: DEFAULT BRAND ============
    console.log('\n=== SENARYO 5: DEFAULT BRAND ===');
    const defBrand1 = await page.evaluate(async () => await api('/brands/default-brand'));
    console.log('5a. Current default:', defBrand1.defaultBrand);
    await page.evaluate(async () => {
        await api('/brands/default-brand', { method: 'PUT', body: { brand: 'DG STORE TEST' } });
    });
    const defBrand2 = await page.evaluate(async () => await api('/brands/default-brand'));
    console.log('5b. After set:', defBrand2.defaultBrand);
    await page.evaluate(async () => {
        await api('/brands/default-brand', { method: 'PUT', body: { brand: 'DG STORE' } });
    });
    const defBrand3 = await page.evaluate(async () => await api('/brands/default-brand'));
    console.log('5c. After restore:', defBrand3.defaultBrand);
    console.log('5d. SENARYO 5:', defBrand2.defaultBrand === 'DG STORE TEST' && defBrand3.defaultBrand === 'DG STORE' ? 'PASS' : 'FAIL');
    
    console.log('\nConsole errors:', errs.length === 0 ? 'NONE' : errs.join('\n  '));
    
    await browser.close();
    console.log('\n=== ALL SCENARIOS COMPLETE ===');
})().catch(e => console.error('FATAL:', e.message));
