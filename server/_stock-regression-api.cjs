// DG STOK — MODÜL REGRESYON API SMOKE TEST (localhost:4001).
// Mevcut modüllerin okuma endpoint'leri beklenmeyen 4xx/5xx döndürmemeli.
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
  const H = { Authorization: 'Bearer ' + token };

  // Variant dashboard context zorunlu (xmlSourceId); gerçek context ile doğrula.
  let contextXmlId = null;
  try {
    const xmlList = await (await fetch(BASE + '/xml-sources', { headers: H })).json();
    const first = (xmlList.items && xmlList.items[0]) || null;
    contextXmlId = first ? first.id : null;
  } catch (e) {}

  const endpoints = [
    ['Dashboard', '/dashboard/stats'],
    ['Product Pool stats', '/products/stats'],
    ['Product Pool list', '/products?page=1&limit=5'],
    ['Category stats', '/categories/stats'],
    ['Category tree', '/categories/tree'],
    ['Brand stats', '/brands/stats'],
    ['Brand list', '/brands'],
    ['Variant stats', '/variants/stats'],
    ['Variant dashboard (context)', '/variants/dashboard' + (contextXmlId ? '?xmlSourceId=' + contextXmlId : '')],
    ['Variant list', '/variants'],
    ['Listing (prep) summary', '/listings/stats/summary'],
    ['Listing Price Rules', '/listing-v2/rules'],
    ['Ready-to-Ship stats', '/ready-to-ship/stats'],
    ['Reports dashboard', '/reports/dashboard'],
    ['Reports products', '/reports/products'],
    ['Reports orders', '/reports/orders'],
    ['Marketplace list', '/marketplaces'],
    ['Marketplace manage stats', '/marketplace-manage/stats'],
    ['XML sources', '/xml-sources'],
    ['Orders stats', '/orders/stats'],
    ['Settings', '/settings'],
    ['Stock Automation', '/stock-automation'],
  ];

  let unexpected = 0;
  for (const [label, path] of endpoints) {
    try {
      const r = await fetch(BASE + path, { headers: H });
      const passOk = r.status >= 200 && r.status < 400;
      if (!passOk) unexpected++;
      ok(label + ' (' + path + ') → ' + r.status, passOk, '');
    } catch (e) {
      unexpected++;
      ok(label + ' (' + path + ') → hata', false, e.message);
    }
  }

  await prisma.$disconnect();
  const fails = OUT.filter(x => !x).length;
  console.log('\n=== REGRESSION API: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
