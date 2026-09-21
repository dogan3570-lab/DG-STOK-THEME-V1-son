import { test, expect } from '@playwright/test';

test('Kâr Zarar UI modern check', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('dgstok_loggedin', 'true');
    localStorage.setItem('dgstok_role', 'ADMIN');
    localStorage.setItem('dgstok_user', JSON.stringify({ name: 'Test' }));
    localStorage.setItem('dgstok_token', 'dummy');
  });
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR', msg.text());
  });
  await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
  console.log('URL after base', page.url());
  console.log('TITLE', await page.title());
  await page.waitForTimeout(5000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('BODY SAMPLE', bodyText.slice(0,800));
  const checks = {
    'Kâr Dağılımı': bodyText.includes('Kâr Dağılımı'),
    'Kâr Değişimi': bodyText.includes('Kâr Değişimi'),
    'Öğrenme Sistemi': bodyText.includes('Öğrenme Sistemi') || bodyText.includes('Öğrenme'),
    'Resmî Veri': bodyText.includes('Resmî Veri') || bodyText.includes('Gerçek Veri'),
    'Modern panel': bodyText.includes('panel-theme')
  };
  console.log('CHECKS', checks);
  console.log('CANLI KÂR/ZARAR UI:', checks['Kâr Dağılımı'] && checks['Kâr Değişimi'] && checks['Öğrenme Sistemi'] ? 'MODERN' : 'ESKİ');
});
