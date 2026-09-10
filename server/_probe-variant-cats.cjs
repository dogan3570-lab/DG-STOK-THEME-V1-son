// GEÇİCİ — varyant attribute'u olan Trendyol kategorisini gerçek catalog üzerinden bul.
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
const TOKEN = process.argv[2] || '';
const BASE = 'http://localhost:4000';
const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

(async () => {
  const mappings = await p.categoryMapping.findMany({ where: { marketplaceId: mpId, active: true }, select: { categoryId: true, externalId: true, category: { select: { name: true } } } });
  const numeric = mappings.filter((m) => /^\d+$/.test(String(m.externalId || '')));
  const catIds = numeric.map((m) => m.categoryId);
  // Her kategori için bir MANUAL_REVIEW ürünü bul
  const products = await p.product.findMany({
    where: { xmlSourceId: xsId, variantStatus: 'MANUAL_REVIEW', categoryId: { in: catIds } },
    select: { id: true, categoryId: true, title: true },
    take: 100,
  });
  const byCat = {};
  for (const pr of products) { if (!byCat[pr.categoryId]) byCat[pr.categoryId] = pr; }

  for (const m of numeric) {
    const pr = byCat[m.categoryId];
    if (!pr) continue;
    const r = await fetch(`${BASE}/variants/manual-options?productId=${pr.id}&marketplaceId=${mpId}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
    const d = await r.json();
    const attrs = (d && d.attributes) || [];
    console.log('CAT', m.externalId, '|', (m.category && m.category.name) || '?', '| attrs:', attrs.length, attrs.length ? JSON.stringify(attrs.map((a) => a.attributeName)) : '');
    if (attrs.length > 0) {
      console.log('TARGET_PRODUCT', JSON.stringify({ id: pr.id, title: pr.title }));
      break;
    }
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
