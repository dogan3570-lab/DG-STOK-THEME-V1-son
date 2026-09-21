// scripts/rt-verify-10high.ts
// READ-ONLY: Verify the 10 HIGH_CONFIDENCE target categories
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const names = ['Telefon','Masaj Aleti','Pet Shop','Bebek Beslenme ve Emzirme','Spor & Outdoor','Ekipman & Aksesuar','Ev Tekstili','Oyuncak','Ev Dekorasyon','Elektrik Tesisat Malzemesi'];

  const all = await prisma.category.findMany({ select: { id: true, name: true, externalId: true, parentId: true } });
  const childrenOf = new Map<string, number>();
  for (const c of all) if (c.parentId) childrenOf.set(c.parentId, (childrenOf.get(c.parentId) || 0) + 1);
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true, externalId: true, source: true } });
  const mapByCat = new Map(maps.map(m => [m.categoryId, m]));

  console.log('| Name | catId | catExtId | children | isLeaf | Mapping? | mapExtId | mapSource |');
  console.log('|------|-------|----------|----------|--------|----------|----------|-----------|');
  for (const n of names) {
    const c = all.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (!c) { console.log(`| ${n} | NOT FOUND | | | | | | |`); continue; }
    const m = mapByCat.get(c.id);
    const ch = childrenOf.get(c.id) || 0;
    console.log(`| ${n} | ${c.id.substring(0,8)} | ${c.externalId ?? '—'} | ${ch} | ${ch===0?'YES':'no'} | ${m?'YES':'no'} | ${m?.externalId ?? '—'} | ${m?.source ?? '—'} |`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
