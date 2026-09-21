// scripts/rt-apply-mr26.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';
const SAFE: Record<string, number> = { '5835': 5460 /*Çamaşır Yıkama Topu & Filesi*/, '765': 5460, '2088': 3980 /*Laptop Sehpası*/ };
async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  let applied = 0;
  for (const [k, ext] of Object.entries(SAFE)) {
    const leaf = tree.leaves.find(l => l.externalId === ext);
    const cat = await prisma.category.findFirst({ where: { externalId: String(ext) }, select: { id: true, name: true } });
    if (!leaf || !cat || !mapSet.has(cat.id)) { console.log('GATE_FAIL', k); continue; }
    const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { id: true, categoryId: true } });
    if (!p?.id || p.categoryId !== null) { console.log('SKIP', k); continue; }
    console.log(`${MODE}: ${k} -> ${cat.name} (ext=${ext})`);
    if (MODE === 'apply') {
      await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
      await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id, details: `[mr26-resolved] ${k} -> ${cat.name} (ext=${ext})`, meta: JSON.stringify({ productId: p.id, xmlKey: k, method: 'image_verified_single_leaf', scope: 'PRODUCT', visualVerified: true, newCategoryId: cat.id }) } });
      applied++;
    }
  }
  console.log('applied:', applied);
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const matched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const nullCat = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null } });
  console.log('RECOUNT:', JSON.stringify({ total, matched, nullCat }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
