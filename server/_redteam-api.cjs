// RED TEAM API KANIT — localhost:4001 (yeni build + kod değişiklikleriyle)
// SADECE OKUMA + geçici mustChangePassword=false (test verisi, parola değiştirilmez).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4001';
const prisma = new PrismaClient();

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* */ }
  return { status: r.status, body: j };
}

function ok(label, pass, extra) {
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : ''));
}

(async () => {
  // 1) mustChangePassword=false (test kolaylaştırıcı — parola değişmez)
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  if (u) {
    let prefs = {};
    try { prefs = JSON.parse(u.preferences || '{}'); } catch { prefs = {}; }
    prefs.mustChangePassword = false;
    await prisma.user.update({ where: { id: u.id }, data: { preferences: JSON.stringify(prefs) } });
    console.log('INFO | mustChangePassword=false (admin ' + u.id + ')');
  }

  // 2) Token üretimi (login handler atlanır — mustChangePassword tetiklenmez)
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '8h' });

  const xs = await call('GET', '/xml-sources', { token });
  const mps = await call('GET', '/marketplaces', { token });
  const src = (xs.body && xs.body.items && xs.body.items[0]) || {};
  const tt = (mps.body && mps.body.items || []).find(m => (m.key || '').toLowerCase() === 'tt') || (mps.body && mps.body.items || [])[0] || {};
  console.log('XML source:', src.id, src.name);
  console.log('Marketplace:', tt.id, tt.name, tt.key);

  const srcQ = '?xmlSourceId=' + encodeURIComponent(src.id);

  const stats = await call('GET', '/products/stats' + srcQ, { token });
  ok('Product Pool pendingCategory (DB/API)', stats.status === 200, 'pendingCategory=' + (stats.body && stats.body.pendingCategory) + ' total=' + (stats.body && stats.body.totalProducts));

  const catStats = await call('GET', '/categories/stats' + srcQ, { token });
  ok('Category stats uncategorizedProducts (DB/API)', catStats.status === 200, 'unmatchedProducts=' + (catStats.body && catStats.body.unmatchedProducts));

  const catProds = await call('GET', '/categories/products' + srcQ + '&limit=20000', { token });
  const catTotal = catProds.body && catProds.body.pagination && catProds.body.pagination.total;
  const catLen = catProds.body && catProds.body.items && catProds.body.items.length;
  ok('Category products tam küme (limit=20000)', catProds.status === 200 && catTotal === catLen, 'pagination.total=' + catTotal + ' items.length=' + catLen);

  const dash = await call('GET', '/variants/dashboard' + srcQ + '&marketplaceId=' + encodeURIComponent(tt.id), { token });
  ok('Variant dashboard (DB/API)', dash.status === 200, JSON.stringify(dash.body));

  const varProds = await call('GET', '/variants/products' + srcQ + '&limit=1000', { token });
  const varTotal = varProds.body && varProds.body.pagination && varProds.body.pagination.total;
  ok('Variant products total (NOT_REQUIRED hariç)', varProds.status === 200, 'total=' + varTotal);
  const hedef = varProds.body && (varProds.body.items || []).filter(p => /Siyah-Beyaz/i.test(p.title || ''));
  ok('HEDEF ürün Variant listesinde YOK', hedef && hedef.length === 0, 'hedef görünme=' + (hedef ? hedef.length : '?'));

  const varStats = await call('GET', '/variants/stats' + srcQ, { token });
  ok('Variant stats (DB/API)', varStats.status === 200, JSON.stringify(varStats.body));

  if (catTotal === catLen) {
    const nullCount = (catProds.body.items || []).filter(p => !p.categoryId).length;
    ok('API: categoryId IS NULL sayısı == pendingCategory', nullCount === (stats.body && stats.body.pendingCategory), 'null=' + nullCount + ' pending=' + (stats.body && stats.body.pendingCategory));
  }

  await prisma.$disconnect();
})().catch(e => { console.error('API PROBE ERROR:', e); process.exitCode = 1; });
