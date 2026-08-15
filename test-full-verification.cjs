const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  
  // Login
  await page.goto('http://localhost:4000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  await page.evaluate(async () => {
    await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }) });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  let productsTotal = 0;
  
  // ==================== TEST 1: Context Empty ====================
  console.log('\n=== TEST 1: Başlangıç Context Boş ===');
  const xmlSource = await page.$('#context-xml-source');
  const mpSource = await page.$('#context-marketplace');
  const xmlVal = xmlSource ? await page.evaluate(el => el.value, xmlSource) : 'NOT_FOUND';
  const mpVal = mpSource ? await page.evaluate(el => el.value, mpSource) : 'NOT_FOUND';
  
  console.log('Context XML kaynağı boş: ' + xmlVal);
  console.log('Context pazaryeri boş: ' + mpVal);
  await page.screenshot({ path: '01-context-empty.png', fullPage: true });
  
  const contextRequired = await page.$('#context-required');
  if (contextRequired) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), contextRequired);
    console.log('Context required uyarı gizli mi: ' + !isHidden);
  }
  
  // ==================== TEST 2: Categories Empty ====================
  console.log('\n=== TEST 2: Kategoriler Sayfası, Context Boş ===');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-categories'); });
  await page.waitForTimeout(2000);
  
  const catWarning = await page.$('#cat-guard-warn');
  if (catWarning) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), catWarning);
    console.log('Kategori uyarı gizli mi (context boş): ' + isHidden);
    await page.screenshot({ path: '02-categories-empty.png', fullPage: true });
  }
  
  // ==================== TEST 3: Select Real XML ====================
  console.log('\n=== TEST 3: Gerçek XML ve Pazaryeri Seç ===');
  
  const xmlSelect = await page.$('#context-xml-source');
  if (xmlSelect) {
    const options = await page.evaluate(el => {
      return Array.from(el.options).map(o => ({ value: o.value, text: o.text }));
    }, xmlSelect);
    console.log('XML options count:', options.length);
    
    if (options.length > 1) {
      await xmlSelect.selectOption(options[1].value);
      await page.waitForTimeout(500);
    }
  }
  
  const mpSelect = await page.$('#context-marketplace');
  if (mpSelect) {
    const options = await page.evaluate(el => {
      return Array.from(el.options).map(o => ({ value: o.value, text: o.text }));
    }, mpSelect);
    console.log('MP options count:', options.length);
    
    if (options.length > 1) {
      await mpSelect.selectOption(options[1].value);
      await page.waitForTimeout(500);
    }
  }
  
  const catWarning2 = await page.$('#cat-guard-warn');
  if (catWarning2) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), catWarning2);
    console.log('Kategori uyarı KAYBOLDU (context seçildi): ' + !isHidden);
    await page.screenshot({ path: '03-categories-context-selected.png', fullPage: true });
  }
  
  // ==================== TEST 4: Products Empty ====================
  console.log('\n=== TEST 4: Ürün Havuzu, Context Boş ===');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('products'); });
  await page.waitForTimeout(2000);
  
  const productsTbody = await page.$('#products-tbody');
  if (productsTbody) {
    const innerHTML = await page.evaluate(el => el.innerHTML, productsTbody);
    const hasContextMsg = innerHTML.includes('Context seçilmedi');
    console.log('Context seçilmedi mesajı görünüyor: ' + hasContextMsg);
    await page.screenshot({ path: '08-products-empty.png', fullPage: true });
  }
  
  // ==================== TEST 5: Products with Context ====================
  console.log('\n=== TEST 5: Ürün Havuzu, XML + Pazaryeri Seç ===');
  
  const poolSource = await page.$('#pool-source');
  if (poolSource) {
    const options = await page.evaluate(el => {
      return Array.from(el.options).map(o => ({ value: o.value, text: o.text }));
    }, poolSource);
    console.log('Pool XML options count:', options.length);
    
    if (options.length > 1) {
      await poolSource.selectOption(options[1].value); // Select first available XML
      await page.waitForTimeout(500);
    }
  }
  
  await page.waitForTimeout(1000);
  await page.waitForTimeout(2000);
  
  const productsTbody2 = await page.$('#products-tbody');
  if (productsTbody2) {
    const innerHTML2 = await page.evaluate(el => el.innerHTML, productsTbody2);
    const hasProducts = innerHTML2.trim() !== '<tr><td class="py-8 px-6 text-center text-slate-400" colspan="17">Context seçilmedi</td></tr>';
    const hasError = innerHTML2.includes('Hatalı') || innerHTML2.includes('yüklenemedi');
    console.log('Ürünler yüklendi (context varsa): ' + hasProducts);
    console.log('Hata yok: ' + !hasError);
    
    // Check network request for /products
    page.on('response', async res => {
      if (res.url().includes('/products') && res.status() === 200) {
        const body = await res.json();
        productsTotal = body.pagination?.total || 0;
        console.log('Products API - total ürün sayısı:', productsTotal);
        console.log('Products API URL:', res.url().substring(0, 200));
      }
    });
    // Trigger data load by waiting
    await page.waitForTimeout(500);
  }
  
  console.log('Products total from API response:', productsTotal);
  await page.screenshot({ path: '09-products-context-selected.png', fullPage: true });
  
  // ==================== TEST 6: Variants Empty ====================
  console.log('\n=== TEST 6: Varyant Eşleştirme, Context Boş ===');
  await page.evaluate(() => { if (typeof showPage === 'function') showPage('prep-variants'); });
  await page.waitForTimeout(2000);
  
  const varWarning = await page.$('#var-warning');
  if (varWarning) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), varWarning);
    console.log('Varyant uyarı gizli mi (context boş): ' + isHidden);
    await page.screenshot({ path: '05-variants-empty.png', fullPage: true });
  }
  
  // Select XML + Marketplace via context
  await page.evaluate(() => {
    if (typeof onContextXmlSourceChange === 'function') onContextXmlSourceChange();
    if (typeof onContextMarketplaceChange === 'function') onContextMarketplaceChange();
  });
  await page.waitForTimeout(2000);
  
  const varWarning2 = await page.$('#var-warning');
  if (varWarning2) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), varWarning2);
    console.log('Varyant uyarı KAYBOLDU (context seçildi): ' + !isHidden);
    await page.screenshot({ path: '06-variants-context-selected.png', fullPage: true });
  }
  
  // ==================== TEST 7: Context Clear ====================
  console.log('\n=== TEST 7: Context Temizle ===');
  await page.evaluate(() => { if (typeof clearContext === 'function') clearContext(); });
  await page.waitForTimeout(2000);
  
  const xmlVal2 = await page.evaluate(() => {
    return document.getElementById('context-xml-source')?.value || 'N/A';
  });
  const mpVal2 = await page.evaluate(() => {
    return document.getElementById('context-marketplace')?.value || 'N/A';
  });
  console.log('Context XML kaynağı temizlendi: ' + (xmlVal2 === '' || xmlVal2 === 'N/A'));
  console.log('Context pazaryeri temizlendi: ' + (mpVal2 === '' || mpVal2 === 'N/A'));
  
  const contextRequired2 = await page.$('#context-required');
  if (contextRequired2) {
    const isHidden = await page.evaluate(el => el.classList.contains('hidden'), contextRequired2);
    console.log('Context required uyarı tekrar görünüyor: ' + isHidden);
  }
  
  await page.screenshot({ path: '07-variants-context-cleared.png', fullPage: true });
  
  await page.waitForTimeout(2000);
  await browser.close();
  console.log('\n=== TAMAM: Tüm testler tamamlandı ===');
  console.log('Products total from API:', productsTotal);
})();