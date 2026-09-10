// SATIŞ OTOMASYONU ↔ HAZIRLAMA MIN/MAX AYRIMI — config izolasyon testi.
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
  ok('Başlangıç config okundu', base.status === 200 && c0, '');

  // 1) Yalnızca prepMin/prepMax değiştir → closeAt/openAt DEĞİŞMEMELİ
  await call('PUT', '/stock-automation', { enabled: c0.enabled, closeAt: c0.closeAt, openAt: c0.openAt, prepMin: 5, prepMax: 100 });
  const c1 = (await call('GET', '/stock-automation')).body.config;
  ok('prepMin/prepMax değişimi closeAt/openAt ETKİLEMEZ', c1.closeAt === c0.closeAt && c1.openAt === c0.openAt, `close=${c1.closeAt} open=${c1.openAt}`);
  ok('prepMin/prepMax değişimi uygulandı', c1.prepMin === 5 && c1.prepMax === 100, `prep=${c1.prepMin}-${c1.prepMax}`);

  // 2) Yalnızca closeAt/openAt değiştir → prepMin/prepMax DEĞİŞMEMELİ
  await call('PUT', '/stock-automation', { enabled: c0.enabled, closeAt: 2, openAt: 4, prepMin: c1.prepMin, prepMax: c1.prepMax });
  const c2 = (await call('GET', '/stock-automation')).body.config;
  ok('closeAt/openAt değişimi prepMin/prepMax ETKİLEMEZ', c2.prepMin === c1.prepMin && c2.prepMax === c1.prepMax, `prep=${c2.prepMin}-${c2.prepMax}`);

  // 3) Final GO-LIVE config geri yükle
  await call('PUT', '/stock-automation', { enabled: true, closeAt: 3, openAt: 5, prepMin: 1, prepMax: 999999 });
  const fin = (await call('GET', '/stock-automation')).body.config;
  ok('Final config (enabled=true close=3 open=5 prep=1-999999)', fin.enabled === true && fin.closeAt === 3 && fin.openAt === 5 && fin.prepMin === 1 && fin.prepMax === 999999, JSON.stringify(fin));

  await prisma.$disconnect();
  const fails = OUT.filter(x => !x).length;
  console.log('\n=== SEPARATION: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
