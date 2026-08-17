// STOCK AUTOMATION — FINAL API TEST (güvenli; gerçek kullanıcı kuralına dokunmaz).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const OUT = [];
function ok(label, pass, extra) { OUT.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  async function call(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }

  // 1) Başlangıç config (varsayılan disabled)
  const before = await call('GET', '/stock-automation');
  ok('GET /stock-automation = 200', before.status === 200, 'status=' + before.status);

  // 2) Geçerli config kaydet
  const put = await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 1, prepMax: 999999 });
  ok('PUT /stock-automation geçerli → ok + config döner', put.status === 200 && put.body && put.body.ok === true && put.body.config && put.body.config.closeAt === 3 && put.body.config.openAt === 5, 'status=' + put.status);

  // 3) Geçersiz: closeAt > openAt → 400
  const bad = await call('PUT', '/stock-automation', { enabled: true, closeAt: 10, openAt: 5, prepMin: 1, prepMax: 999999 });
  ok('PUT closeAt > openAt → 400', bad.status === 400, 'status=' + bad.status);

  // 3b) Geçersiz: closeAt == openAt → 400 (histerezis bandı boş kalamaz)
  const eq = await call('PUT', '/stock-automation', { enabled: true, closeAt: 5, openAt: 5, prepMin: 1, prepMax: 999999 });
  ok('PUT closeAt == openAt → 400', eq.status === 400, 'status=' + eq.status);

  // 4) Negatif eşik → 400
  const neg = await call('PUT', '/stock-automation', { enabled: true, closeAt: -1, openAt: 5, prepMin: 1, prepMax: 999999 });
  ok('PUT negatif eşik → 400', neg.status === 400, 'status=' + neg.status);

  // 5) Motor çalıştır (fail-closed: credentialsız pazaryerlerinde durum değişmez)
  const run = await call('POST', '/stock-automation/run', {});
  ok('POST /stock-automation/run = 200 + stats', run.status === 200 && run.body && run.body.ok === true && run.body.stats && typeof run.body.stats.scanned === 'number', 'status=' + run.status + ' scanned=' + (run.body && run.body.stats && run.body.stats.scanned));

  // 6) Config kalıcılığı (GET ile doğrula)
  const after = await call('GET', '/stock-automation');
  ok('Config kalıcı (GET sonrası closeAt=3, openAt=5, prepMin=1)', after.body && after.body.config && after.body.config.closeAt === 3 && after.body.config.openAt === 5 && after.body.config.prepMin === 1, JSON.stringify(after.body && after.body.config));

  // 7) Motoru kapat (enabled=false) — gerçek veri değişmesin, temizlik
  await call('PUT', '/stock-automation', { enabled: false, closeAt: 3, openAt: 5, prepMin: 1, prepMax: 999999 });
  const final = await call('GET', '/stock-automation');
  ok('Motor varsayılana döndürüldü (enabled=false)', final.body && final.body.config && final.body.config.enabled === false, 'enabled=' + (final.body && final.body.config && final.body.config.enabled));

  await prisma.$disconnect();
  const fails = OUT.filter(x => !x).length;
  console.log('\n=== STOCK AUTOMATION API: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
