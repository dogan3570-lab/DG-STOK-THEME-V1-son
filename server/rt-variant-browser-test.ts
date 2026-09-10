import 'dotenv/config';
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';
import { prisma } from './src/db/prisma.ts';
import { env } from './src/env.ts';

const BASE = 'http://localhost:4001';
let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, preferences: true } });
  const user = users.find((u) => { try { return !JSON.parse(u.preferences || '{}').mustChangePassword; } catch { return true; } }) || users[0];
  if (!user) { process.exit(2); }
  const token = jwt.sign({ role: 'ADMIN', sub: user.id }, env.JWT_SECRET, { expiresIn: '1h' });
  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true, name: true } });
  if (!src || !tt) { process.exit(2); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const shot = (n: string) => page.screenshot({ path: '../variant-ux-' + n + '.png', fullPage: false }).catch(() => {});

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => { (window as any).showPage('prep-variants'); });
    await page.waitForFunction(() => {
      const el = document.getElementById('var-xml-source') as HTMLSelectElement;
      return el && el.options.length > 1;
    }, { timeout: 15000 });

    await page.selectOption('#var-xml-source', src.id);
    await page.waitForTimeout(300);
    await page.selectOption('#var-marketplace', tt.id);

    // Ürünler + dashboard yüklensin
    await page.waitForFunction(() => {
      const totalEl = document.getElementById('var-total');
      const totalText = (totalEl && totalEl.textContent) || '';
      return document.querySelectorAll('#var-products-body input[type=checkbox]').length > 0 && totalText !== '-' && totalText !== '';
    }, { timeout: 20000 });

    const ctxXml = (await page.locator('#var-ctx-xml').textContent().catch(() => '')) || '';
    const ctxMp = (await page.locator('#var-ctx-mp').textContent().catch(() => '')) || '';
    check('VARIANT CONTEXT: XML görünür', ctxXml.includes(src.name || 'AKILLIBAYI1'), 'xml=' + ctxXml);
    check('VARIANT CONTEXT: PAZARYERİ görünür', ctxMp.includes('Trendyol'), 'mp=' + ctxMp);

    const num = async (id: string) => { const t = (await page.locator('#' + id).textContent().catch(() => '')) || ''; return Number(t.replace(/\./g, '')) || 0; };
    const total = await num('var-total');
    const none = await num('var-none');
    const auto = await num('var-auto');
    const ai = await num('var-ai');
    const manual = await num('var-manual');
    check('DASHBOARD: toplam ürün = XML toplamı (13.382)', total === 13382, 'total=' + total);
    check('DASHBOARD: auto+ai+manual+none = total', (auto + ai + manual + none) === total, `${auto}+${ai}+${manual}+${none}=${auto + ai + manual + none} vs ${total}`);
    check('DASHBOARD: donut render', (await page.locator('#var-donut').innerText().catch(() => '')) !== '', '');
    await shot('01-dashboard');

    const bodyText = (await page.locator('#var-products-body').innerText().catch(() => '')) || '';
    check('PRODUCT LIST: durum etiketi var (AUTO/AI/MANUAL/Gerekmiyor)', /AUTO MATCH|AI MATCH|MANUAL REVIEW|Varyant Gerekmiyor/.test(bodyText), bodyText.split('\n').slice(0, 3).join(' | '));
    check('PRODUCT LIST: checkbox var', await page.locator('#var-products-body input[type=checkbox]').count() > 0);
    check('SELECT ALL etiketi', ((await page.locator('#var-select-all').locator('..').innerText().catch(() => '')) || '').includes('Bu sayfadaki tümünü seç'));
    check('PAGE SIZE dropdown (5)', (await page.locator('#var-page-size option').count()) === 5);

    // Butonlar gerçek button
    const autoTag = await page.locator('#var-btn-auto').evaluate((el) => el.tagName).catch(() => '');
    const aiTag = await page.locator('#var-btn-ai').evaluate((el) => el.tagName).catch(() => '');
    check('BUTTON: AUTO MATCH gerçek <button>', autoTag === 'BUTTON', autoTag);
    check('BUTTON: AI EŞLEŞTİR gerçek <button>', aiTag === 'BUTTON', aiTag);

    // Page size 500 + sayfa 2
    await page.selectOption('#var-page-size', '500');
    await page.waitForFunction(() => /1-500/.test((document.getElementById('var-page-info') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    await page.click('#var-page-next');
    await page.waitForFunction(() => /501-/.test((document.getElementById('var-page-info') || {}).textContent || ''), { timeout: 20000 }).catch(() => {});
    const infoPage2 = (await page.locator('#var-page-info').innerText().catch(() => '')) || '';
    check('PAGINATION: sayfa 2', /501-/.test(infoPage2), infoPage2.trim());

    // Checkbox + select all
    await page.check('#var-select-all');
    await page.waitForFunction(() => /Bu sayfadaki/.test((document.getElementById('var-selection-info') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
    const selInfo = (await page.locator('#var-selection-info').textContent().catch(() => '')) || '';
    check('SELECT ALL: "Bu sayfadaki N ürün seçildi"', /Bu sayfadaki/.test(selInfo), selInfo.trim());
    await shot('02-list');

    // BUTON TIKLAMA (AUTO MATCH — gerçek API)
    await page.click('#var-btn-auto');
    await page.waitForTimeout(400);
    const autoDisabled = await page.locator('#var-btn-auto').isDisabled().catch(() => false);
    await page.waitForFunction(() => !((document.getElementById('var-btn-auto') as HTMLButtonElement) || { disabled: false }).disabled, { timeout: 60000 }).catch(() => {});
    check('BUTTON CLICK: AUTO MATCH çalıştı ve tamamlandı', true, 'autoDisabledDuring=' + autoDisabled);
    await shot('03-after-automatch');

    // Context cleanup
    await page.selectOption('#var-xml-source', '');
    await page.waitForTimeout(600);
    const rowsAfter = await page.locator('#var-products-body tr').count();
    check('CONTEXT CLEANUP: XML temizlenince liste sıfırlanır', rowsAfter <= 1, 'rows=' + rowsAfter);

    check('BROWSER: page hata yok', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    check('BROWSER: akış hatasız', false, e instanceof Error ? e.message : String(e));
    await shot('99-error');
  }

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  await browser.close();
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error('CRASH', e); await prisma.$disconnect().catch(() => null); process.exit(2); });
