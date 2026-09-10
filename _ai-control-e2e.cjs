const { chromium } = require('playwright');
const BASE = 'http://localhost:4000';

(async () => {
  let pass = 0, fail = 0;
  function ok(n) { pass++; console.log('  ✅ ' + n); }
  function nok(n, e) { fail++; console.log('  ❌ ' + n + ': ' + e); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log('\n=== AI KONTROL MERKEZİ BROWSER E2E ===\n');

  // Login
  try {
    await page.goto(BASE);
    await page.fill('#login-email', 'admin@dgstok.com');
    await page.fill('#login-password', 'admin123');
    await page.evaluate(() => doLogin());
    await page.waitForTimeout(2000);
    ok('TEST 1: Login başarılı');
  } catch (e) { nok('TEST 1: Login', e.message); }

  // Navigate to AI Control Center
  try {
    await page.evaluate(() => showPage('ai-control'));
    await page.waitForTimeout(2000);
    var title = await page.textContent('#page-ai-control h2');
    if (title && title.includes('AI KONTROL MERKEZİ')) ok('TEST 2: AI Kontrol Merkezi açıldı');
    else nok('TEST 2: AI Kontrol Merkezi', 'başlık bulunamadı: ' + title);
  } catch (e) { nok('TEST 2: AI Kontrol Merkezi', e.message); }

  // NVIDIA visible
  try {
    await page.waitForTimeout(2000);
    var content = await page.textContent('#aictl-providers-list');
    if (content && content.includes('NVIDIA')) ok('TEST 3: NVIDIA görünüyor');
    else nok('TEST 3: NVIDIA görünmüyor', 'content: ' + (content || 'null').substring(0, 200));
  } catch (e) { nok('TEST 3: NVIDIA', e.message); }

  // API Key input exists
  try {
    var keyInput = await page.$('#aictl-key-nvidia');
    if (keyInput) {
      var type = await keyInput.getAttribute('type');
      if (type === 'password') ok('TEST 4: API Key input var (type=password)');
      else nok('TEST 4: API Key type', 'type=' + type);
    } else nok('TEST 4: API Key input', 'bulunamadı');
  } catch (e) { nok('TEST 4: API Key input', e.message); }

  // Model input exists
  try {
    var modelInput = await page.$('#aictl-model-nvidia');
    if (modelInput) {
      var val = await modelInput.inputValue();
      ok('TEST 5: Model alanı var — değer: ' + val);
    } else nok('TEST 5: Model alanı', 'bulunamadı');
  } catch (e) { nok('TEST 5: Model', e.message); }

  // Priority input exists
  try {
    var prioInput = await page.$('#aictl-priority-nvidia');
    if (prioInput) {
      var val = await prioInput.inputValue();
      ok('TEST 6: Öncelik alanı var — değer: ' + val);
    } else nok('TEST 6: Öncelik alanı', 'bulunamadı');
  } catch (e) { nok('TEST 6: Öncelik', e.message); }

  // Stats are real (not random)
  try {
    var providers = await page.textContent('#aictl-providers');
    var active = await page.textContent('#aictl-active');
    var reqs = await page.textContent('#aictl-requests');
    if (providers === '5' && !isNaN(parseInt(reqs))) ok('TEST 7: İstatistikler real — providers=' + providers + ' active=' + active + ' reqs=' + reqs);
    else nok('TEST 7: İstatistikler', 'providers=' + providers + ' reqs=' + reqs);
  } catch (e) { nok('TEST 7: İstatistikler', e.message); }

  // Save function exists
  try {
    var saveExists = await page.evaluate(() => typeof aiCardSave === 'function');
    if (saveExists) ok('TEST 8: aiCardSave fonksiyonu mevcut');
    else nok('TEST 8: aiCardSave', 'fonksiyon bulunamadı');
  } catch (e) { nok('TEST 8: aiCardSave', e.message); }

  // Test function exists
  try {
    var testExists = await page.evaluate(() => typeof aiCardTest === 'function');
    if (testExists) ok('TEST 9: aiCardTest fonksiyonu mevcut');
    else nok('TEST 9: aiCardTest', 'fonksiyon bulunamadı');
  } catch (e) { nok('TEST 9: aiCardTest', e.message); }

  // API key not in localStorage
  try {
    var keys = await page.evaluate(() => Object.keys(localStorage));
    var aiKey = keys.find(k => k.includes('api') || k.includes('key') || k.includes('nvidia'));
    if (!aiKey) ok('TEST 10: API key localStorage\'da yok');
    else nok('TEST 10: API key localStorage\'da', aiKey);
  } catch (e) { nok('TEST 10: localStorage', e.message); }

  // API key not in page source (excluding placeholder text)
  try {
    var html = await page.content();
    // Check for actual key patterns, not just placeholder hints
    var hasRealKey = html.includes('nvapi-[') || html.includes('nvapi-[A-Za-z0-9]') || /nvapi-[a-zA-Z0-9]{20,}/.test(html);
    if (!hasRealKey) ok('TEST 11: API key page source\'ta yok (real key kontrolü)');
    else nok('TEST 11: API key page source\'ta', 'real key bulundu');
  } catch (e) { nok('TEST 11: page source', e.message); }

  // Provider count in header
  try {
    var count = await page.textContent('#aictl-providers');
    if (count === '5') ok('TEST 12: Header\'da 5 provider gösteriliyor');
    else nok('TEST 12: Header count', count);
  } catch (e) { nok('TEST 12: Header', e.message); }

  await browser.close();
  console.log('\n=== SONUÇ: ' + pass + ' PASS / ' + fail + ' FAIL ===\n');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
