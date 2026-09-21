// scripts/rt-definitive-counts.ts
// READ-ONLY: Resolve 335/337/728 discrepancy with exact DB queries
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DEFINITIVE COUNT RESOLUTION — SOURCE 2fe5e126 (BUFFER)');
  console.log('═══════════════════════════════════════════════════════════════');

  // Active (non-deleted) products from this source
  const all = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { id: true, xmlKey: true, supplierCategory: true, categoryId: true, categoryMatch: true, matchedBy: true },
  });

  // Also include DELETED? No — scope is live products
  const deleted = await prisma.product.count({ where: { xmlSourceId: srcId, status: 'DELETED' } });

  const A = all.length;
  const D = all.filter(p => p.categoryId === null).length;               // categoryId IS NULL
  const B_all = all.filter(p => p.supplierCategory === null).length;     // supplierCategory IS NULL (all products)
  const B_in728 = all.filter(p => p.categoryId === null && p.supplierCategory === null).length; // within problem set
  const B_not728 = all.filter(p => p.categoryId !== null && p.supplierCategory === null).length; // null sc but categoryId set

  // Genel
  const genel = await prisma.category.findFirst({ where: { name: 'Genel' }, select: { id: true } });
  const E = all.filter(p => p.categoryId === genel?.id).length;

  // XML source check
  const xml = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) as c FROM "XmlSource" WHERE id = '${srcId}'`).catch(() => []);
  
  console.log('');
  console.log('A) Toplam aktif ürün (source):', A);
  console.log('   (silinmiş/DELETED hariç; DELETED=', deleted, ')');
  console.log('');
  console.log('D) categoryId IS NULL (problemli set):', D);
  console.log('B) supplierCategory IS NULL (TÜM ürünler):', B_all);
  console.log('   B1) supplierCategory NULL VE categoryId NULL (728 içinde):', B_in728);
  console.log('   B2) supplierCategory NULL AMA categoryId SET (728 dışında):', B_not728);
  console.log('   → B_all = B1 + B2 =', B_in728 + B_not728);
  console.log('');
  console.log('E) categoryId = Genel:', E);
  console.log('');
  console.log('Kesim:');
  console.log(`  728 problemli = categoryId NULL = ${D}`);
  console.log(`  ${B_all} = supplierCategory NULL (TÜM source) = 728-içi ${B_in728} + 728-dışı ${B_not728}`);
  console.log(`  XML'de CategoryBreadCrumb eksik = 337 = ${B_all} (aynı)`);
  console.log('');
  console.log('  335 vs 337 FARKI:');
  console.log(`    337 = TÜM source'ta supplierCategory NULL`);
  console.log(`    335 = bunların 728 problemli set İÇİNDE olanları`);
  console.log(`    2   = supplierCategory NULL ama categoryId ELLE/auto SET edilmiş (problemli DEĞİL)`);
  console.log('');

  // Show the 2
  const two = all.filter(p => p.categoryId !== null && p.supplierCategory === null);
  console.log('  2 ürün (supplierCategory NULL ama categoryId SET):');
  for (const p of two) {
    console.log(`    ${p.id.substring(0,8)} xmlKey=${p.xmlKey} matchedBy=${p.matchedBy} categoryId=${p.categoryId?.substring(0,8)}`);
  }
  console.log('');

  // Also verify DELETED products don't hide nulls
  const delNulls = await prisma.product.count({ where: { xmlSourceId: srcId, status: 'DELETED', supplierCategory: null } });
  console.log(`  DELETED ürünlerde supplierCategory NULL: ${delNulls}`);
  console.log('');

  // Full DB (not just source)
  const dbTotal = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const dbNullCat = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null } });
  const dbNullSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, supplierCategory: null } });
  console.log(`TÜM DB: total=${dbTotal}, categoryId NULL=${dbNullCat}, supplierCategory NULL=${dbNullSc}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
