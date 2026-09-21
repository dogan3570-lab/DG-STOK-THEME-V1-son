// scripts/rt-import-sim.ts
// READ-ONLY: Replicate xmlImport category resolution for the 728 to prove Genel vs NULL
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';

  // Exact replication of xmlImport.ts:518-519, 530, 609-610
  const allCategories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryMap = new Map(allCategories.map(c => [c.name.toLowerCase(), c.id]));
  const defaultCategory = await prisma.category.findFirst({ where: { name: 'Genel' }, select: { id: true } });
  if (!defaultCategory) { console.error('Genel not found'); process.exit(1); }

  console.log(`categoryMap entries: ${categoryMap.size}`);
  console.log(`defaultCategory (Genel) id: ${defaultCategory.id}`);
  console.log('');

  const nullCat = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { id: true, xmlKey: true, supplierCategory: true },
  });

  let wouldBeGenel = 0, wouldBeReal = 0, wouldBeNullNoCatName = 0;
  const realAssignments = new Map<string, number>();
  const genelSamples: string[] = [];

  for (const p of nullCat) {
    const sc = p.supplierCategory;
    // Reconstruct item.category etc. from supplierCategory breadcrumb (last part = leaf)
    // In import, supplierCategory = [top, main, sub, category].filter(Boolean).join(' > ')
    const parts = (sc || '').split(' > ').map(s => s.trim()).filter(Boolean);
    const leaf = parts.length > 0 ? parts[parts.length - 1].toLowerCase().trim() : '';
    // catName = (item.category || item.subCategory || item.mainCategory || item.topCategory || '').toLowerCase().trim()
    // Approx: leaf is item.category
    const catName = leaf;
    const categoryId = catName ? categoryMap.get(catName) || defaultCategory.id : defaultCategory.id;

    if (categoryId === defaultCategory.id) {
      wouldBeGenel++;
      if (genelSamples.length < 5) genelSamples.push(`${p.xmlKey}: leaf="${leaf}" sc="${sc}"`);
    } else {
      wouldBeReal++;
      const cname = allCategories.find(c => c.id === categoryId)?.name || '?';
      realAssignments.set(cname, (realAssignments.get(cname) || 0) + 1);
    }
  }

  console.log('═══ What CURRENT import code WOULD assign to the 728 ═══');
  console.log(`  → Genel (no leaf match): ${wouldBeGenel}`);
  console.log(`  → Real category match:   ${wouldBeReal}`);
  console.log(`  → NULL (empty catName):  ${wouldBeNullNoCatName}`);
  console.log('');
  if (realAssignments.size > 0) {
    console.log('  Real assignments:');
    for (const [n, c] of [...realAssignments.entries()].sort((a,b)=>b[1]-a[1])) console.log(`    ${c}x ${n}`);
  }
  console.log('');
  console.log('  Genel samples:');
  for (const s of genelSamples) console.log(`    ${s}`);
  console.log('');

  console.log('═══ CONCLUSION ═══');
  if (wouldBeGenel === 728) {
    console.log('  Current import code would set ALL 728 to Genel.');
    console.log('  But DB has 0 Genel products → the DB was populated by DIFFERENT (older) code');
    console.log('  that set categoryId=NULL for unmatched products.');
  } else {
    console.log(`  Current import code would set ${wouldBeReal} to real categories, ${wouldBeGenel} to Genel.`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
