// Repro: ngRefresh'in XML source fallback'i neden çalışmıyor?
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('requestfailed', (r) => consoleMsgs.push(`[REQFAIL] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`));

  await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
  const modal = page.locator('#login-modal');
  if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'Admin1234!');
    await modal.locator('button[onclick="doLogin()"]').click();
  }
  await page.waitForTimeout(4000);

  // contextState'i ve xml-sources API'sini incele
  const diag = await page.evaluate(async () => {
    const ctx = { ...contextState };
    let xsApi = null;
    try {
      const r = await fetch('/api/xml-sources', { credentials: 'include' });
      xsApi = { status: r.status, hasItems: false, first: null };
      const j = await r.json();
      xsApi.hasItems = !!(j.items && j.items.length > 0);
      xsApi.first = j.items?.[0] ? { id: j.items[0].id, active: j.items[0].active, name: j.items[0].name } : null;
      xsApi.keys = j.items?.[0] ? Object.keys(j.items[0]).slice(0, 15) : null;
    } catch (e) { xsApi = { error: String(e) }; }
    return { ctx, xsApi };
  });
  console.log('contextState:', JSON.stringify(diag.ctx));
  console.log('xml-sources API:', JSON.stringify(diag.xsApi));

  // ngRefresh'i tetikle ve sonucu izle
  await page.evaluate(() => showPage('prep-not-going'));
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => ({
    ngStateItems: ngState.items.length,
    ngTotal: ngState.total,
    ctx: { xmlSourceIds: contextState.xmlSourceIds },
    errVisible: !document.getElementById('ng-error').classList.contains('hidden'),
    errMsg: document.getElementById('ng-error-msg')?.textContent,
  }));
  console.log('AFTER notGoingLoad:', JSON.stringify(after));
  console.log('--- CONSOLE (son 15) ---');
  consoleMsgs.slice(-15).forEach((m) => console.log(m));

  await browser.close();
})();
