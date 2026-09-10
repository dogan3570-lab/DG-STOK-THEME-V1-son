// RED TEAM — READY_TO_SHIP zinciri API kanıtı (localhost:4001). SADECE OKUMA.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

function ok(label, pass, extra) { console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  async function call(path) {
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }

  // 1) ready-to-ship stats (global)
  const st = await call('/ready-to-ship/stats');
  console.log('READY_STATS:', JSON.stringify(st.body));
  ok('READY_TO_SHIP missingVariant=0 (NO_VARIANTS variant adımı PASS)', st.body && st.body.missingVariant === 0, 'missingVariant=' + (st.body && st.body.missingVariant));
  ok('READY_TO_SHIP readyCount=6092 (AKILLIBAYI1 4/4)', st.body && st.body.readyCount === 6092, 'readyCount=' + (st.body && st.body.readyCount));

  // 2) ready-to-ship filter=ready XML context
  const ready = await call('/ready-to-ship?filter=ready&xmlSourceId=' + XS + '&limit=10');
  const readyTotal = ready.body && ready.body.pagination && ready.body.pagination.total;
  console.log('READY_LIST total:', readyTotal);
  ok('READY_LIST (XML) total=6092', readyTotal === 6092, 'total=' + readyTotal);

  // 3) Hedef ürün ready listesinde DEĞİL (templateMatch=false, status=XML)
  const hedef = await prisma.product.findFirst({ where: { xmlSourceId: XS, title: { contains: 'Apple Airpods 3 (3.nesil) Spor Delikli Kilif - Siyah-Beyaz' } } });
  const q = '/ready-to-ship?filter=ready&xmlSourceId=' + XS + '&search=' + encodeURIComponent('Airpods 3 Spor Delikli');
  const r = await call(q);
  const items = (r.body && r.body.items) || [];
  const hedefReady = items.some(p => p.id === hedef.id);
  console.log('HEDEF ready listesinde mi:', hedefReady, '| hedef templateMatch=false/status=XML olduğu için ready DEĞİL (listing adımı bekliyor)');
  ok('HEDEF ürün variant adımı PASS (NO_VARIANTS) — listing adımı beklediği için ready DEĞİL', !hedefReady, '');

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
