// GEÇİCİ — variantAnalysis temizliği (yalnızca bu XML'in ürünleri).
process.env.DATABASE_URL = 'file:C:/PROJE 1/DG-STOK-THEME-V1/server/prisma/dev.db';
const { PrismaClient } = require('./node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
  const products = await p.product.findMany({ where: { xmlSourceId: xsId }, select: { id: true } });
  const ids = products.map((x) => x.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const r = await p.variantAnalysis.deleteMany({ where: { productId: { in: batch } } });
    deleted += r.count;
  }
  console.log('VARIANT_ANALYSIS_DELETED', deleted);
  const dist = await p.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: xsId }, _count: { id: true } });
  console.log('STATUS_DIST', JSON.stringify(dist));
  const vc = await p.variant.count({ where: { product: { xmlSourceId: xsId } } });
  console.log('VARIANT_COUNT', vc);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
