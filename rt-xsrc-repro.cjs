// Kök neden repro: login sonrası getUiXmlSourceId neden boş dönüyor?
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const log = [];
  page.on('response', async (r) => {
    if (r.url().includes('xml-sources') || r.url().includes('auth/login') || r.url().includes('auth/me')) {
      const cookies = await page.context().cookies().catch(() => []);
      log.push(`${r.request().method()} ${r.url().replace('http://localhost:4000', '')} -> ${r.status()} | cookies=${cookies.map(c => c.name + (c.httpOnly ? '(H)' : '') + (c.secure ? '(SECURE!)' : '')).join(',')}`);
    }
  });

  await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
  const modal = page.locator('#login-modal');
  if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'Admin1234!');
    await modal.locator('button[onclick="doLogin()"]').click();
  }
  await page.waitForTimeout(2500);

  // Test helper'ının BİREBİR aynısı
  const result = await page.evaluate(async () => {
    const r = await fetch('/api/xml-sources', { credentials: 'include' });
    const status = r.status;
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    return {
      fetchStatus: status,
      hasItems: !!(j && Array.isArray(j.items)),
      itemCount: j && Array.isArray(j.items) ? j.items.length : -1,
      firstId: j && j.items && j.items[0] ? j.items[0].id : null,
      rawSnippet: text.slice(0, 200),
      keys: j ? Object.keys(j) : null,
    };
  });
  console.log('=== getUiXmlSourceId repro ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('=== Network/cookie izleri ===');
  log.forEach((l) => console.log(l));

  const cookies = await page.context().cookies();
  console.log('=== Context cookies ===');
  cookies.forEach((c) => console.log(`${c.name} domain=${c.domain} secure=${c.secure} httpOnly=${c.httpOnly} path=${c.path}`));

  await browser.close();
})();
