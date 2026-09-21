// scripts/rt-leaf-crosscheck.ts
// READ-ONLY: Do the 67 XML leaf names match ANY Trendyol leaf (normalizeName or foldTr)?
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
const prisma = new PrismaClient();

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tree = await loadTrendyolTree();
  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null, supplierCategory: { not: null } },
    select: { supplierCategory: true },
  });
  const leaves = new Set<string>();
  for (const p of prods) {
    const segs = (p.supplierCategory || '').split('>').map(s => s.trim()).filter(Boolean);
    if (segs.length) leaves.add(segs[segs.length - 1]);
  }
  console.log(`Distinct XML leaf names among 393: ${leaves.size}`);
  console.log('');
  let normHit = 0, foldHit = 0;
  for (const leaf of [...leaves].sort()) {
    const nHits = tree.leafByNormName.get(leaf.toLowerCase().trim()) || [];
    const fKey = foldTr(leaf);
    const fHits = tree.leaves.filter(l => foldTr(l.name) === fKey);
    if (nHits.length) normHit++;
    if (fHits.length) foldHit++;
    const mark = (nHits.length || fHits.length) ? ' <== MATCH' : '';
    console.log(`  "${leaf}" | norm=${nHits.length} fold=${fHits.length}${mark}`);
  }
  console.log('');
  console.log(`Leaves with normalizeName hit: ${normHit}`);
  console.log(`Leaves with foldTr hit: ${foldHit}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
