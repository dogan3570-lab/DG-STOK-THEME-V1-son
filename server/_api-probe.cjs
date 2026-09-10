// DG STOK — REAL API PROBE (localhost:4001). Gerçek context ile endpoint yanıtları.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4001';
const XML = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1
const MP = '757a071c-98c5-4c96-bb8c-2dceac1568dd';   // Trendyol (tt)

(async () => {
  const u = await prisma.user.findFirst({ where: { email: 'admin@dgstok.com' } });
  const token = jwt.sign({ role: u.role, sub: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const H = { Authorization: 'Bearer ' + token };
  async function get(path) {
    const r = await fetch(BASE + path, { headers: H });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }

  const out = {};

  // 1) Ready-to-Ship
  const rtsStats = await get('/ready-to-ship/stats');
  out.rtsStats = { status: rtsStats.status, body: rtsStats.body };

  const rtsAll = await get(`/ready-to-ship?page=1&limit=5&xmlSourceId=${XML}`);
  out.rtsAll = { status: rtsAll.status, total: rtsAll.body && rtsAll.body.pagination ? rtsAll.body.pagination.total : null, items: (rtsAll.body && rtsAll.body.items || []).length };

  const rtsReady = await get(`/ready-to-ship?page=1&limit=5&filter=ready&xmlSourceId=${XML}`);
  out.rtsReady = { status: rtsReady.status, total: rtsReady.body && rtsReady.body.pagination ? rtsReady.body.pagination.total : null, items: (rtsReady.body && rtsReady.body.items || []).length };

  const rtsNotReady = await get(`/ready-to-ship?page=1&limit=5&filter=not-ready&xmlSourceId=${XML}`);
  out.rtsNotReady = { status: rtsNotReady.status, total: rtsNotReady.body && rtsNotReady.body.pagination ? rtsNotReady.body.pagination.total : null };

  // 2) Category
  const catStats = await get(`/categories/stats?xmlSourceId=${XML}`);
  out.catStats = { status: catStats.status, body: catStats.body };

  const catProducts = await get(`/categories/products?limit=100&xmlSourceId=${XML}&marketplaceId=${MP}`);
  out.catProducts = { status: catProducts.status, total: catProducts.body && catProducts.body.pagination ? catProducts.body.pagination.total : (catProducts.body && catProducts.body.items ? catProducts.body.items.length : null), items: (catProducts.body && catProducts.body.items || []).length };

  const catTreeNoMp = await get('/categories/tree?limit=20000');
  out.catTreeNoMp = { status: catTreeNoMp.status, items: (catTreeNoMp.body && catTreeNoMp.body.items || []).length, flat: (catTreeNoMp.body && catTreeNoMp.body.flat || []).length };

  const catTreeMp = await get(`/categories/tree?limit=20000&marketplaceId=${MP}`);
  out.catTreeMp = { status: catTreeMp.status, items: (catTreeMp.body && catTreeMp.body.items || []).length, flat: (catTreeMp.body && catTreeMp.body.flat || []).length };

  // 3) Products (Product Pool)
  const prodStats = await get('/products/stats');
  out.prodStats = { status: prodStats.status, body: prodStats.body };
  const prodList = await get(`/products?page=1&limit=5&xmlSourceId=${XML}`);
  out.prodList = { status: prodList.status, total: prodList.body && prodList.body.pagination ? prodList.body.pagination.total : null, items: (prodList.body && prodList.body.items || []).length };

  // 4) Brands / Variants / Listings
  const brandStats = await get(`/brands/stats?xmlSourceId=${XML}`);
  out.brandStats = { status: brandStats.status, body: brandStats.body };
  const variantDash = await get(`/variants/dashboard?xmlSourceId=${XML}&marketplaceId=${MP}`);
  out.variantDash = { status: variantDash.status, body: variantDash.body };
  const listingSummary = await get('/listings/stats/summary');
  out.listingSummary = { status: listingSummary.status, body: listingSummary.body };
  const rules = await get('/listing-v2/rules');
  out.rules = { status: rules.status, count: (rules.body && (rules.body.items || rules.body.rules || []).length) };

  // 5) Marketplace send state
  const mpState = await prisma.productMarketplaceState.groupBy({ by: ['status'], _count: { _all: true } });
  out.mpState = mpState;

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exit(1); });
