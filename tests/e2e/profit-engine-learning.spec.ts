import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:4000';
const SHOT = 'C:/Users/Dogan/AppData/Local/Temp/opencode/pe-learning-tab.png';

test.describe('Kar Zarar Motoru - Ticari Ogrenme', () => {
  test('gercek veri durumu + izole simulasyon (UI)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('response', r => {
      const u = r.url();
      if (u.includes('/assets/')) console.log('ASSET', r.status(), u.split('/').pop());
      if (r.status() === 404) console.log('404 URL:', u);
    });
    page.on('requestfailed', r => console.log('REQ_FAILED', r.url(), r.failure()?.errorText));

    // Login (React SaasLogin)
    await page.goto(BASE);
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.fill('input[type="email"]', 'admin@dgstok.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3500);

    // Navigate to Profit Engine (kar-zarar)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('dgstok:navigate', { detail: 'kar-zarar' }));
    });
    await page.waitForTimeout(2000);

    await expect(page.getByText('Finans Yönetimi').first()).toBeVisible({ timeout: 15000 });

    // Loaded bundle proof
    const scriptSrc = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src'))
    );
    console.log('SCRIPT_SRC:', JSON.stringify(scriptSrc));
    expect(scriptSrc.some(s => (s || '').includes('/assets/index-'))).toBeTruthy();

    // Open Ogrenme tab
    await page.getByTestId('tab-öğrenme').click();
    await page.waitForTimeout(2000);

    // Real data status panel
    await expect(page.getByTestId('learn-data-status')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('learn-observations')).toBeVisible();

    // No real data -> data gap message must be visible (NOT fake KPI)
    await expect(page.getByTestId('learn-data-gap')).toBeVisible();
    await expect(page.getByText('Henüz yeterli gerçek veri yok').first()).toBeVisible();

    const obsBefore = (await page.getByTestId('learn-observations').textContent())?.trim();
    console.log('Observations before simulation:', obsBefore);
    expect(obsBefore).toBe('0');

    // Run ISOLATED simulation
    await page.getByTestId('learn-simulate-btn').click();
    await expect(page.getByTestId('learn-simulate-result')).toBeVisible({ timeout: 20000 });
    const simText = await page.getByTestId('learn-simulate-result').textContent();
    console.log('Simulation result (first 200):', (simText || '').slice(0, 200));
    expect(simText).toContain('"isolated"');

    // Isolation: production observations unchanged after simulation
    const obsAfter = (await page.getByTestId('learn-observations').textContent())?.trim();
    console.log('Observations after simulation:', obsAfter);
    expect(obsAfter).toBe('0');

    // Screenshot
    await page.screenshot({ path: SHOT, fullPage: true });

    // No critical JS errors
    const criticalErrors = errors.filter(e => !e.includes('401') && !e.includes('403') && !e.includes('Failed to fetch'));
    console.log('JS errors:', criticalErrors.length);
    criticalErrors.forEach(e => console.log('  ERROR:', e));
    expect(criticalErrors.length).toBe(0);
  });
});
