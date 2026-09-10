// STOCK AUTOMATION — API VALIDATION + PERSISTENCE RED TEAM (localhost:4001).
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

  const base = await call('GET', '/stock-automation');
  const c0 = base.body.config;
  ok('GET /stock-automation → 200', base.status === 200 && !!c0, 'status=' + base.status);

  // TEST A — normal: close=3 open=5 → 200
  const a = await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 5, prepMax: 100 });
  ok('TEST A normal (close=3 open=5 prep=5-100) → 200', a.status === 200, 'status=' + a.status);

  // TEST B — close > open → 400
  const b = await call('PUT', '/stock-automation', { enabled: true, closeAt: 5, openAt: 3, prepMin: 5, prepMax: 100 });
  ok('TEST B close>open → 400', b.status === 400, 'status=' + b.status + ' code=' + (b.body && b.body.error && b.body.error.code));

  // close == open → 400 (closeAt >= openAt reddedilmeli)
  const b2 = await call('PUT', '/stock-automation', { enabled: true, closeAt: 5, openAt: 5, prepMin: 5, prepMax: 100 });
  ok('close == open → 400', b2.status === 400, 'status=' + b2.status);

  // TEST C — negatif close → 400
  const c = await call('PUT', '/stock-automation', { enabled: true, closeAt: -1, openAt: 5, prepMin: 5, prepMax: 100 });
  ok('TEST C close=-1 → 400', c.status === 400, 'status=' + c.status);

  // negatif prepMin → 400
  const c2 = await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: -5, prepMax: 100 });
  ok('prepMin=-5 → 400', c2.status === 400, 'status=' + c2.status);

  // TEST D — prepMin > prepMax → 400
  const d = await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 100, prepMax: 10 });
  ok('TEST D prepMin>prepMax → 400', d.status === 400, 'status=' + d.status);

  // NaN / string → 400
  const e = await call('PUT', '/stock-automation', { enabled: true, closeAt: 'abc', openAt: 5, prepMin: 1, prepMax: 999999 });
  ok('closeAt=NaN/string → 400', e.status === 400, 'status=' + e.status);

  // eksik alan → 400
  const f = await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5 });
  ok('prepMin/prepMax eksik → 400', f.status === 400, 'status=' + f.status);

  // TEST E — persistence: geçerli değer kaydet → GET aynı değer
  await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 7, prepMax: 77 });
  const g = await call('GET', '/stock-automation');
  const cfg = g.body.config;
  ok('TEST E persistence (prep=7-77 korunur)', g.status === 200 && cfg.prepMin === 7 && cfg.prepMax === 77 && cfg.closeAt === 3 && cfg.openAt === 5, JSON.stringify(cfg));

  // Final GO-LIVE config geri yükle
  await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 1, prepMax: 999999 });
  const fin = (await call('GET', '/stock-automation')).body.config;
  ok('Final config geri yüklendi (enabled=true close=3 open=5 prep=1-999999)', fin.enabled === true && fin.closeAt === 3 && fin.openAt === 5 && fin.prepMin === 1 && fin.prepMax === 999999, JSON.stringify(fin));

  await prisma.$disconnect();
  const fails = OUT.filter(x => !x).length;
  console.log('\n=== STOCK API RED TEAM: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
