// RED TEAM — LIVE RELEASE KONTROLÜ (health + kritik API + ek false-positive). SADECE OKUMA.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const XS = '949855eb-d68c-4920-b378-c622a6a665e2';
const MP = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

(async () => {
  // 1) DB false-positive ek kontroller
  console.log('=== EK FALSE-POSITIVE (DB, AKILLIBAYI1) ===');
  for (const pat of ['Sanayi', '220V', '1 L', '1.5 L', '18 Inc', '137CM', '500 ml']) {
    const where = { xmlSourceId: XS, title: { contains: pat } };
    const [total, notReq, other] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, variantStatus: 'NOT_REQUIRED' } }),
      prisma.product.count({ where: { ...where, variantStatus: { not: 'NOT_REQUIRED' } } }),
    ]);
    console.log(`  "${pat}" -> eslesen=${total} NOT_REQUIRED=${notReq} DIGER=${other} ${other === 0 ? 'OK' : '<<< FALSE-POSITIVE!'}`);
  }

  // 2) health + login + kritik API
  console.log('\n=== LIVE API (localhost:4001) ===');
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const H = { Authorization: 'Bearer ' + token };

  async function chk(label, path, opts) {
    try {
      const r = await fetch(BASE + path, { headers: H, ...(opts || {}) });
      console.log(`  ${label}: HTTP ${r.status}`);
      return r.status;
    } catch (e) {
      console.log(`  ${label}: ERR ${String(e).slice(0, 80)}`);
      return -1;
    }
  }

  await chk('GET /health (public)', '/health', { headers: {} });
  await chk('GET /api-status (public)', '/api-status', { headers: {} });
  await chk('GET /products/stats?xmlSourceId', `/products/stats?xmlSourceId=${XS}`);
  await chk('GET /categories/stats?xmlSourceId', `/categories/stats?xmlSourceId=${XS}`);
  await chk('GET /variants/dashboard', `/variants/dashboard?xmlSourceId=${XS}&marketplaceId=${MP}`);
  await chk('GET /variants/products', `/variants/products?xmlSourceId=${XS}`);
  await chk('GET /ready-to-ship/stats', '/ready-to-ship/stats');
  await chk('GET /xml-sources', '/xml-sources');
  await chk('GET /marketplaces', '/marketplaces');
  await chk('GET /dashboard/stats', '/dashboard/stats');

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
