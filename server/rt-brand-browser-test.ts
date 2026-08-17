import 'dotenv/config';
import { chromium } from 'playwright';
import jwt from 'jsonwebtoken';
import { prisma } from './src/db/prisma.ts';
import { env } from './src/env.ts';

/**
 * BRAND BROWSER UX — gerçek Chromium üzerinde görsel kabul testi + screenshot.
 * API PASS değil, DOM/görünürlük doğrulanır.
 */
const BASE = 'http://localhost:4001';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, role: true, preferences: true } });
  let user = users.find((u) => { try { return !JSON.parse(u.preferences || '{}').mustChangePassword; } catch { return true; } }) || users[0];
  if (!user) { console.log('NO_USER'); await prisma.$disconnect(); process.exit(2); }
  const token = jwt.sign({ role: user.role, sub: user.id }, env.JWT_SECRET, { expiresIn: '1h' });

  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true, name: true } });
  if (!src || !tt) { console.log('NO_CONTEXT_DATA'); await prisma.$disconnect(); process.exit(2); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'token', value: token, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const shot = async (name: string) => { await page.screenshot({ path: '../brand-ux-' + name + '.png', fullPage: false }).catch(() => {}); };

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 });

    // Brand sayfasına geç (global context gizli; Brand kendi seçicilerini kullanır)
    await page.evaluate(() => { (window as any).showPage('prep-brands'); });
    await page.waitForFunction(() => {
      const el = document.getElementById('br-xml-source') as HTMLSelectElement;
      return el && el.options.length > 1;
    }, { timeout: 15000 });
    await page.selectOption('#br-xml-source', src.id);
    await page.waitForTimeout(500);
    await page.selectOption('#br-marketplace', tt.id);
    await page.waitForTimeout(500);

    const ctxXml = (await page.locator('#br-ctx-xml').textContent().catch(() => '')) || '';
    const ctxMp = (await page.locator('#br-ctx-mp').textContent().catch(() => '')) || '';
    check('TEST A: context başlığı XML görünür', ctxXml.includes(src.name || 'AKILLIBAYI1'), 'ctxXml=' + ctxXml);
    check('TEST A: context başlığı PAZARYERİ görünür', ctxMp.includes('Trendyol'), 'ctxMp=' + ctxMp);

    const ctxTotal = (await page.locator('#br-ctx-total').textContent().catch(() => '')) || '';
    check('TEST A: Ürünler sayacı dolu (gerçek sayı)', ctxTotal.trim() !== '' && ctxTotal.trim() !== '-', 'total=' + ctxTotal);
    await shot('01-context');

    // Ürünler, XML + Pazaryeri seçildikten sonra otomatik yüklenir (marka filtresi YOK).
    await page.waitForFunction(() => document.querySelectorAll('#br-products-body input[type=checkbox]').length > 0, { timeout: 20000 });

    const bodyText = (await page.locator('#br-products-body').innerText().catch(() => '')) || '';
    check('TEST B: ürün satırında "®" (MARKA ® ÜRÜN)', bodyText.includes('\u00ae'), 'örnek satır=' + bodyText.split('\n').slice(0, 4).join(' | '));
    check('TEST C: durum etiketi görünür (Eşleşti/XML markası/bekliyor)', /Eşleşti|XML markası kullanılacak|bekliyor/.test(bodyText), '');

    const sizeOpts = await page.locator('#br-page-size option').count();
    check('TEST D: page size dropdown var (5 seçenek)', sizeOpts === 5, 'opts=' + sizeOpts);

    const checkboxCount = await page.locator('#br-products-body input[type=checkbox]').count();
    check('TEST E: satır checkbox görünür', checkboxCount > 0, 'count=' + checkboxCount);

    const selAllLabel = (await page.locator('#br-select-all').locator('..').innerText().catch(() => '')) || '';
    check('TEST F: "Bu sayfadaki tümünü seç" etiketi görünür', selAllLabel.includes('Bu sayfadaki tümünü seç'), 'label=' + selAllLabel.trim());

    const pageNums = await page.locator('#br-page-numbers button').count();
    const pageInfo = (await page.locator('#br-page-info').innerText().catch(() => '')) || '';
    check('TEST G: pagination görünür (sayfa numaraları)', pageNums > 0, 'nums=' + pageNums);
    check('TEST G: toplam ürün sayısı görünür (1–N / total)', /ü r ü n|\/.*ürün|\d+\s*\/\s*[\d.]+/.test(pageInfo), 'info=' + pageInfo.trim());

    // TOTAL CONSISTENCY: header total === pagination.total (aynı dataset)
    const readTotals = async () => page.evaluate(() => {
      const h = ((document.getElementById('br-ctx-total') || {}).textContent || '').replace(/\./g, '');
      const info = (document.getElementById('br-page-info') || {}).textContent || '';
      const m = info.match(/\/(\s*[\d.]+)/);
      return { header: h, pagination: m ? m[1].trim().replace(/\./g, '') : '' };
    });
    await page.waitForFunction(() => {
      const h = ((document.getElementById('br-ctx-total') || {}).textContent || '').replace(/\./g, '');
      const info = (document.getElementById('br-page-info') || {}).textContent || '';
      const m = info.match(/\/(\s*[\d.]+)/);
      return !!m && h !== '' && h === m[1].trim().replace(/\./g, '');
    }, { timeout: 10000 }).catch(() => {});
    let totals = await readTotals();
    check('TOTAL CONSISTENCY: üst toplam = pagination.total (sayfa 1)', totals.header === totals.pagination && totals.pagination !== '', 'header=' + totals.header + ' pagination=' + totals.pagination);

    const xmlProductTotal = await prisma.product.count({ where: { xmlSourceId: src.id } });
    const brandGroup = await prisma.product.groupBy({ by: ['xmlBrandName'], where: { xmlSourceId: src.id, xmlBrandName: { not: null } }, _count: { id: true } });
    const maxBrandCount = brandGroup.reduce((m, r) => Math.max(m, r._count.id), 0);
    check('ÖZEL: header total = XML ürün toplamı (' + xmlProductTotal + ')', totals.header === String(xmlProductTotal), 'header=' + totals.header + ' xml=' + xmlProductTotal);
    check('ÖZEL: pagination.total = XML ürün toplamı', totals.pagination === String(xmlProductTotal), 'pagination=' + totals.pagination + ' xml=' + xmlProductTotal);
    check('ÖZEL: pagination.total tek marka filtresi DEĞİL (en büyük marka=' + maxBrandCount + ')', Number(totals.pagination) > maxBrandCount, 'pagination=' + totals.pagination + ' maxBrand=' + maxBrandCount);
    await shot('02-list');

    // Page size 500 + sayfa 2
    await page.selectOption('#br-page-size', '500');
    await page.waitForFunction(() => /1-500/.test((document.getElementById('br-page-info') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    const info500 = (await page.locator('#br-page-info').innerText().catch(() => '')) || '';
    check('PAGE SIZE: 500 seçilince liste güncellendi', /1-500/.test(info500), 'info=' + info500.trim());
    await page.click('#br-page-next');
    await page.waitForFunction(() => /501-/.test((document.getElementById('br-page-info') || {}).textContent || ''), { timeout: 20000 }).catch(() => {});
    const infoPage2 = (await page.locator('#br-page-info').innerText().catch(() => '')) || '';
    check('PAGINATION: sayfa 2\'ye geçildi', /501-/.test(infoPage2), 'info2=' + infoPage2.trim());
    await page.waitForFunction(() => {
      const h = ((document.getElementById('br-ctx-total') || {}).textContent || '').replace(/\./g, '');
      const info = (document.getElementById('br-page-info') || {}).textContent || '';
      const m = info.match(/\/(\s*[\d.]+)/);
      return !!m && h !== '' && h === m[1].trim().replace(/\./g, '');
    }, { timeout: 10000 }).catch(() => {});
    totals = await readTotals();
    check('TOTAL CONSISTENCY: üst toplam = pagination.total (sayfa 2)', totals.header === totals.pagination && totals.pagination !== '', 'header=' + totals.header + ' pagination=' + totals.pagination);

    // Select-all (sayfa kapsamı)
    await page.check('#br-select-all');
    await page.waitForFunction(() => /Bu sayfadaki/.test((document.getElementById('br-selection-info') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
    const selInfo = (await page.locator('#br-selection-info').textContent().catch(() => '')) || '';
    check('SELECT ALL: "Bu sayfadaki N ürün seçildi."', /Bu sayfadaki/.test(selInfo), 'info=' + selInfo.trim());
    await shot('04-selection');

    // Context değişimi temizliği
    await page.selectOption('#br-xml-source', '');
    await page.waitForTimeout(600);
    const prodRowsAfter = await page.locator('#br-products-body tr').count();
    const selInfoAfter = (await page.locator('#br-selection-info').textContent().catch(() => '')) || '';
    check('CONTEXT CLEANUP: XML temizlenince ürün listesi/seçim sıfırlanır', prodRowsAfter <= 1 && /0 ürün/.test(selInfoAfter), 'rows=' + prodRowsAfter + ' sel=' + selInfoAfter.trim());

    check('BROWSER: page hata yok', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    await shot('03-pagination');
  } catch (e) {
    check('BROWSER: akış hatasız tamamlandı', false, e instanceof Error ? e.message : String(e));
    await shot('99-error');
  }

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  await browser.close();
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect().catch(() => null);
  process.exit(2);
});
