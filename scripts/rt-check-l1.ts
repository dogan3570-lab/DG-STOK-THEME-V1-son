// scripts/rt-check-l1.ts
// READ-ONLY: Why don't the 10 HIGH_CONFIDENCE leaf names match V2 L1?
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}

async function main() {
  const tree = await loadTrendyolTree();
  console.log(`V2 tree leaves: ${tree.leaves.length}`);
  console.log('');

  const names = ['Telefon','Masaj Aleti','Pet Shop','Bebek Beslenme ve Emzirme','Spor & Outdoor','Ekipman & Aksesuar','Ev Tekstili','Oyuncak','Ev Dekorasyon','Elektrik Tesisat Malzemesi'];
  for (const n of names) {
    const folded = foldTr(n);
    const hits = tree.leafByNormName.get(folded) || [];
    console.log(`"${n}" (folded="${folded}")`);
    console.log(`  leafByNormName hits: ${hits.length}`);
    for (const h of hits.slice(0, 5)) console.log(`    -> ${h.name} (ext=${h.externalId}) path=${h.fullPath.substring(0,70)}`);
    if (hits.length === 0) {
      // search partial
      const partial = tree.leaves.filter(l => foldTr(l.name).includes(folded) || folded.includes(foldTr(l.name))).slice(0, 5);
      console.log(`  partial matches: ${partial.map(p => `${p.name}(ext=${p.externalId})`).join(', ') || 'NONE'}`);
    }
  }
  console.log('');

  // Also: is "Telefon" a leaf in V2 tree? Check its children WITH externalId
  const telefon = await prisma.category.findFirst({ where: { name: 'Telefon', externalId: '5250' }, select: { id: true } });
  if (telefon) {
    const kids = await prisma.category.findMany({ where: { parentId: telefon.id }, select: { name: true, externalId: true } });
    console.log(`"Telefon" children: ${kids.length}`);
    for (const k of kids) console.log(`  child: ${k.name} ext=${k.externalId ?? 'null'}`);
    console.log(`  In V2 leaves? ${tree.leafById.has(telefon.id) ? 'YES' : 'NO'}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
