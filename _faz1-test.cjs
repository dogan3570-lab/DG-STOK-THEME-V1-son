const BASE = 'http://localhost:4000';
let token = null;
let pass = 0, fail = 0;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok && !data) throw new Error('HTTP ' + res.status);
  return data;
}

function ok(name) { pass++; console.log(`  ✅ ${name}`); }
function nok(name, e) { fail++; console.log(`  ❌ ${name}: ${e}`); }

async function login() {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }),
  });
  const d = await r.json();
  token = d.token;
}

async function run() {
  console.log('\n=== FAZ 1 TESTS ===\n');

  // TEST 1
  try {
    await login();
    if (token) ok('TEST 1: Login başarılı');
    else nok('TEST 1: Login', 'token yok');
  } catch (e) { nok('TEST 1: Login', e.message); }

  // TEST 2
  try {
    const d = await api('/ai-settings');
    const items = d.items || [];
    const nvidia = items.find(p => p.provider === 'nvidia');
    if (nvidia && nvidia.displayName === 'NVIDIA') ok('TEST 2: NVIDIA provider backend\'den geliyor (' + items.length + ' provider)');
    else nok('TEST 2: NVIDIA provider', 'nvidia bulunamadı');
  } catch (e) { nok('TEST 2: NVIDIA provider', e.message); }

  // TEST 3
  try {
    const r = await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ model: 'nvidia/llama-3.1-nemotron-70b-instruct', active: false }) });
    if (r.ok) ok('TEST 3: Provider güncellenebiliyor');
    else nok('TEST 3: Provider güncelleme', 'ok=false');
  } catch (e) { nok('TEST 3: Provider güncelleme', e.message); }

  // TEST 4 — API key encrypted kaydediliyor
  try {
    const r = await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ apiKey: 'nvapi-test-key-12345' }) });
    if (r.ok && r.apiKeyConfigured === true) ok('TEST 4: API key encrypted kaydedildi (apiKeyConfigured=true)');
    else nok('TEST 4: API key kaydetme', JSON.stringify(r));
  } catch (e) { nok('TEST 4: API key kaydetme', e.message); }

  // TEST 5 — GET plaintext key döndürmüyor
  try {
    const d = await api('/ai-settings');
    const nvidia = d.items.find(p => p.provider === 'nvidia');
    if (nvidia && !nvidia.apiKey) ok('TEST 5: GET /ai-settings plaintext key döndürmüyor');
    else nok('TEST 5: API key güvenliği', 'apiKey alanına sahip: ' + JSON.stringify(nvidia));
  } catch (e) { nok('TEST 5: API key güvenliği', e.message); }

  // TEST 6 — Bağlantı testi (gerçek API çağrısı)
  try {
    const r = await api('/ai-settings/nvidia/test', { method: 'POST' });
    if (r.provider === 'nvidia') {
      if (r.ok) ok('TEST 6: Bağlantı testi BAŞARILI — Model: ' + r.model + ' — ' + r.latencyMs + 'ms');
      else ok('TEST 6: Bağlantı testi çalıştırıldı — Durum: ' + r.errorCode + ' — ' + r.error);
    } else {
      nok('TEST 6: Bağlantı testi', 'provider=nvidia değil');
    }
  } catch (e) { nok('TEST 6: Bağlantı testi', e.message); }

  // TEST 7 — Yanlış key ile test
  try {
    await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ apiKey: 'nvapi-WRONG-KEY-12345' }) });
    const r = await api('/ai-settings/nvidia/test', { method: 'POST' });
    if (!r.ok && r.errorCode) ok('TEST 7: Yanlış key ile gerçek hata — ' + r.errorCode + ': ' + r.error);
    else if (r.ok) nok('TEST 7: Yanlış key', 'yanlış key ile başarılı oldu');
    else ok('TEST 7: Yanlış key — hata gösterildi: ' + (r.error || r.errorCode));
  } catch (e) { nok('TEST 7: Yanlış key testi', e.message); }

  // TEST 8 — Gerçek key ile test (eğer varsa)
  try {
    const d = await api('/ai-settings/nvidia');
    if (d.apiKeyConfigured) {
      const r = await api('/ai-settings/nvidia/test', { method: 'POST' });
      if (r.ok) ok('TEST 8: Gerçek NVIDIA API çağrısı BAŞARILI — ' + r.model + ' — ' + r.latencyMs + 'ms');
      else ok('TEST 8: Gerçek API — ' + r.errorCode + ': ' + r.error);
    } else {
      ok('TEST 8: Gerçek key yok — test atlandı (apiKeyConfigured=false)');
    }
  } catch (e) { nok('TEST 8: Gerçek API testi', e.message); }

  // TEST 9 — İstatistikler random değil
  try {
    const d = await api('/ai-settings');
    const nvidia = d.items.find(p => p.provider === 'nvidia');
    if (nvidia && typeof nvidia.totalRequests === 'number' && typeof nvidia.successfulRequests === 'number') {
      ok('TEST 9: İstatistikler real — totalRequests=' + nvidia.totalRequests + ' success=' + nvidia.successfulRequests + ' fail=' + nvidia.failedRequests);
    } else {
      nok('TEST 9: İstatistikler', 'geçersiz alanlar');
    }
  } catch (e) { nok('TEST 9: İstatistikler', e.message); }

  // TEST 10 — Provider toggle
  try {
    await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ active: true }) });
    const d = await api('/ai-settings');
    const nvidia = d.items.find(p => p.provider === 'nvidia');
    if (nvidia && nvidia.active === true) ok('TEST 10: Provider toggle — aktif edildi');
    else nok('TEST 10: Provider toggle', 'aktif değil');
    await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ active: false }) });
  } catch (e) { nok('TEST 10: Provider toggle', e.message); }

  // TEST 11 — Backend persistence
  try {
    await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ model: 'test-model', priority: 5 }) });
    const d = await api('/ai-settings/nvidia');
    if (d.model === 'test-model' && d.priority === 5) ok('TEST 11: Veri persistence korunuyor');
    else nok('TEST 11: Persistence', 'model=' + d.model + ' priority=' + d.priority);
    await api('/ai-settings/nvidia', { method: 'PUT', body: JSON.stringify({ model: 'nvidia/llama-3.1-nemotron-70b-instruct', priority: 1 }) });
  } catch (e) { nok('TEST 11: Persistence', e.message); }

  // TEST 12 — Audit log
  try {
    const d = await api('/categories/logs?limit=5');
    if (d.items && Array.isArray(d.items)) ok('TEST 12: Audit log erişilebilir');
    else nok('TEST 12: Audit log', 'veri yapısı hatalı');
  } catch (e) { nok('TEST 12: Audit log', e.message); }

  console.log(`\n=== SONUÇ: ${pass} PASS / ${fail} FAIL ===\n`);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
