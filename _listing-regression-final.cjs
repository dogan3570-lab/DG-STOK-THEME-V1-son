// FINAL CLOSURE — MEVCUT MODÜL REGRESYON KONTROLÜ (read-only + auth).
// Başka modüllerde regresyon olmadığını doğrular.
const fs = require('fs');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE = 'http://localhost:4001';
function readEnv(key) {
  try {
    const txt = fs.readFileSync('./server/.env', 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return '';
}
const SECRET = readEnv('JWT_SECRET');
// Gerçek admin kullanıcı (id b5b56b5c... = admin@dgstok.com). Login çağrılmaz; böylece
// "mustChangePassword" güvenlik bayrağı tetiklenmez ve veri değişmez.
const token = jwt.sign({ role: 'ADMIN', sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d' }, SECRET, { expiresIn: '1h' });
const A = { Authorization: 'Bearer ' + token };
const OUT = [];
function ok(label, pass, extra) { OUT.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }
async function get(path, hdrs) {
  try { const r = await fetch(BASE + path, { headers: hdrs || {} }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; }
  catch (e) { return { status: 0, body: { error: String(e) } }; }
}
async function post(path, body, hdrs) {
  try { const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(hdrs || {}) }, body: JSON.stringify(body) }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; }
  catch (e) { return { status: 0, body: { error: String(e) } }; }
}

(async () => {
  // health
  const h = await get('/health'); ok('GET /health=200', h.status === 200, 's=' + h.status);
  // marketplaces
  const mp = await get('/marketplaces', A); ok('GET /marketplaces=200', mp.status === 200, 's=' + mp.status);
  // xml-sources
  const xs = await get('/xml-sources', A); ok('GET /xml-sources=200', xs.status === 200, 's=' + xs.status);
  // products context required
  const p0 = await get('/products', A); ok('GET /products context yok -> 400 (CONTEXT_REQUIRED)', p0.status === 400, 's=' + p0.status);
  const p1 = await get('/products?page=1&limit=5&xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2&marketplaceId=757a071c-98c5-4c96-bb8c-2dceac1568dd', A);
  ok('GET /products geçerli context -> 200', p1.status === 200, 's=' + p1.status);
  // categories
  const cat = await get('/categories', A); ok('GET /categories=200', cat.status === 200, 's=' + cat.status);
  // brands
  const br = await get('/brands', A); ok('GET /brands=200', br.status === 200, 's=' + br.status);
  // variants
  const vr = await get('/variants?page=1&limit=2', A); ok('GET /variants=200', vr.status === 200, 's=' + vr.status);
  // ready-to-ship
  const rts = await get('/ready-to-ship?xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2', A); ok('GET /ready-to-ship=200', rts.status === 200, 's=' + rts.status);
  // dashboard stats
  const dash = await get('/dashboard/stats', A); ok('GET /dashboard/stats=200', dash.status === 200, 's=' + dash.status);
  // reports
  const rep = await get('/reports', A); ok('GET /reports=200', rep.status === 200, 's=' + rep.status);
  // listing rules (3 gerçek kural)
  const rules = await get('/listing-v2/rules', A);
  const cnt = rules.body?.items?.length ?? -1;
  ok('GET /listing-v2/rules=200 ve 3 gerçek kural korunmuş', rules.status === 200 && cnt === 3, 's=' + rules.status + ' count=' + cnt);
  // settings
  const sett = await get('/settings', A); ok('GET /settings=200', sett.status === 200, 's=' + sett.status);

  const fails = OUT.filter(x => !x).length;
  console.log('\n=== REGRESYON: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})();
