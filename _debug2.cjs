const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE ERR:', msg.text()); });
  
  await page.goto('http://localhost:4000', { timeout: 15000 });
  await page.evaluate(() => { doLogin(); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { showPage('prep-brands'); });
  await page.waitForTimeout(1500);
  
  await page.selectOption('#br-xml-source', { index: 2 });
  await page.waitForTimeout(1500);
  await page.selectOption('#br-xml-brand', { index: 1 });
  await page.waitForTimeout(1500);
  await page.fill('#br-manual-brand', 'HOBİBAHÇEM');
  await page.waitForTimeout(200);
  
  // Click match
  await page.click('#br-match-btn');
  await page.waitForTimeout(5000);
  
  // Check if prepBrandSave exists
  const fnExists = await page.evaluate(() => typeof window.prepBrandSave);
  console.log('prepBrandSave type:', fnExists);
  
  // Check save button onclick
  const onclick = await page.evaluate(() => {
    const btn = document.getElementById('br-save-btn');
    return btn ? btn.getAttribute('onclick') : 'NOT FOUND';
  });
  console.log('Save button onclick:', onclick);
  
  // Try calling save directly
  console.log('Calling prepBrandSave directly...');
  const saveResult = await page.evaluate(async () => {
    try {
      await prepBrandSave();
      return 'OK';
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  });
  console.log('Save result:', saveResult);
  
  await page.waitForTimeout(3000);
  
  const afterSave = await page.evaluate(() => {
    return document.getElementById('br-sum-status')?.textContent || 'NOT FOUND';
  });
  console.log('After save status:', afterSave);
  
  const firstProduct = await page.evaluate(() => {
    const rows = document.querySelectorAll('#br-products-body tr');
    if (rows.length === 0) return 'NO ROWS';
    return rows[0].querySelector('td:nth-child(2)')?.textContent || 'NO CELL';
  });
  console.log('First product:', firstProduct);
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
