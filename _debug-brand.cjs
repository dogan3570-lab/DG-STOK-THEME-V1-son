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
  
  // Select AKILLIBAYI1
  await page.selectOption('#br-xml-source', { index: 2 });
  await page.waitForTimeout(1500);
  
  // Select D&G
  await page.selectOption('#br-xml-brand', { index: 1 });
  await page.waitForTimeout(1500);
  
  // Type manual brand
  await page.fill('#br-manual-brand', 'HOBİBAHÇEM');
  await page.waitForTimeout(200);
  
  // Check if match button is enabled
  const matchDisabled = await page.locator('#br-match-btn').isDisabled();
  console.log('Match button disabled:', matchDisabled);
  
  // Click match
  console.log('Clicking match...');
  await page.click('#br-match-btn');
  await page.waitForTimeout(5000);
  
  // Check preview data
  const previewData = await page.evaluate(() => {
    return JSON.stringify(window.prepBrandState ? window.prepBrandState.previewData : 'undefined');
  });
  console.log('Preview data:', previewData);
  
  // Check summary
  const summary = await page.evaluate(() => {
    const el = document.getElementById('br-summary');
    return el ? el.className : 'NOT FOUND';
  });
  console.log('Summary classes:', summary);
  
  const sumText = await page.evaluate(() => {
    return document.getElementById('br-sum-status')?.textContent || 'NOT FOUND';
  });
  console.log('Sum status:', sumText);
  
  // Check save button state
  const saveDisabled = await page.locator('#br-save-btn').isDisabled();
  console.log('Save button disabled:', saveDisabled);
  
  // Click save
  console.log('Clicking save...');
  await page.click('#br-save-btn');
  await page.waitForTimeout(5000);
  
  const afterSave = await page.evaluate(() => {
    return document.getElementById('br-sum-status')?.textContent || 'NOT FOUND';
  });
  console.log('After save status:', afterSave);
  
  // Check first product display
  const firstProduct = await page.evaluate(() => {
    const rows = document.querySelectorAll('#br-products-body tr');
    if (rows.length === 0) return 'NO ROWS';
    const cell = rows[0].querySelector('td:nth-child(2)');
    return cell ? cell.textContent : 'NO CELL';
  });
  console.log('First product:', firstProduct);
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
