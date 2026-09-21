// scripts/rt-catid-mechanism.ts
// READ-ONLY: Determine how categoryId became NULL empirically
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const genel = await prisma.category.findFirst({ where: { name: 'Genel' }, select: { id: true } });

  console.log('═══ categoryId distribution for source products ═══');
  const all = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { categoryId: true, status: true, categoryMatch: true, matchedBy: true, supplierCategory: true, xmlKey: true, createdAt: true, updatedAt: true },
  });
  const byCat = new Map<string, number>();
  for (const p of all) {
    const k = p.categoryId === null ? '<NULL>' : p.categoryId === genel?.id ? 'Genel' : 'OTHER';
    byCat.set(k, (byCat.get(k) || 0) + 1);
  }
  console.log(`  Total: ${all.length}`);
  for (const [k, v] of byCat) console.log(`  ${k}: ${v}`);
  console.log('');

  console.log('═══ status distribution among NULL-category ═══');
  const nullc = all.filter(p => p.categoryId === null);
  const byStatus = new Map<string, number>();
  const byMatch = new Map<string, number>();
  for (const p of nullc) {
    byStatus.set(p.status, (byStatus.get(p.status) || 0) + 1);
    byMatch.set(`match=${p.categoryMatch} by=${p.matchedBy ?? 'null'}`, (byMatch.get(`match=${p.categoryMatch} by=${p.matchedBy ?? 'null'}`) || 0) + 1);
  }
  console.log(`  status: ${JSON.stringify([...byStatus])}`);
  console.log(`  flags:  ${JSON.stringify([...byMatch])}`);
  console.log('');

  console.log('═══ createdAt/updatedAt of NULL-category vs import runs ═══');
  const nc = nullc.map(p => ({ key: p.xmlKey, c: p.createdAt.toISOString(), u: p.updatedAt.toISOString() }));
  nc.sort((a, b) => a.c.localeCompare(b.c));
  console.log(`  NULL-cat createdAt earliest: ${nc[0]?.c}`);
  console.log(`  NULL-cat createdAt latest:   ${nc[nc.length-1]?.c}`);
  const ncu = [...nc].sort((a, b) => a.u.localeCompare(b.u));
  console.log(`  NULL-cat updatedAt earliest: ${ncu[0]?.u}`);
  console.log(`  NULL-cat updatedAt latest:   ${ncu[ncu.length-1]?.u}`);
  console.log('');

  console.log('═══ Products WITH categoryId (non-null) createdAt/updatedAt ═══');
  const withc = all.filter(p => p.categoryId !== null);
  const wu = withc.map(p => p.updatedAt.toISOString()).sort();
  const wc = withc.map(p => p.createdAt.toISOString()).sort();
  console.log(`  createdAt earliest: ${wc[0]}  latest: ${wc[wc.length-1]}`);
  console.log(`  updatedAt earliest: ${wu[0]}  latest: ${wu[wu.length-1]}`);
  console.log('');

  console.log('═══ ALL products with categoryId=Genel (whole DB) ═══');
  const genelCount = await prisma.product.count({ where: { categoryId: genel?.id } });
  console.log(`  categoryId=Genel products: ${genelCount}`);
  console.log('');

  console.log('═══ xmlKeys NULL-cat: are they contiguous ranges? ═══');
  const keys = nullc.map(p => parseInt(p.xmlKey, 10)).filter(Number.isFinite).sort((a,b)=>a-b);
  console.log(`  min=${keys[0]} max=${keys[keys.length-1]} count=${keys.length}`);
  // Group into ranges
  const ranges: Array<[number, number, number]> = [];
  let start = keys[0], prev = keys[0], cnt = 1;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] === prev + 1) { prev = keys[i]; cnt++; }
    else { ranges.push([start, prev, cnt]); start = keys[i]; prev = keys[i]; cnt = 1; }
  }
  ranges.push([start, prev, cnt]);
  console.log(`  Contiguous ranges: ${ranges.length}`);
  for (const [s, e, c] of ranges.slice(0, 20)) console.log(`    ${s}-${e} (${c} products)`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
