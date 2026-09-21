// scripts/rt-xmlsource-inspect.ts
// READ-ONLY: Inspect XML source config + import mechanics
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const src = await prisma.xmlSource.findUnique({
    where: { id: '2fe5e126-3e1e-43a6-9b28-b77826300688' },
  });
  console.log('XmlSource record:');
  const safe = { ...src } as any;
  if (safe.url) console.log(`  url: ${safe.url.substring(0, 80)}...`);
  for (const [k, v] of Object.entries(safe)) {
    if (typeof v === 'string' && v.length > 100) console.log(`  ${k}: <${v.length} chars>`);
    else if (typeof v !== 'object') console.log(`  ${k}: ${v}`);
  }
  console.log('');

  // Compare product 5587 (null sc) vs a product with sc from same numeric range
  const p5587 = await prisma.product.findFirst({ where: { xmlKey: '5587' }, select: { id: true, xmlKey: true, title: true, supplierCategory: true, categoryId: true, createdAt: true, xmlBrandName: true, description: true } });
  console.log('Product xmlKey=5587 (NULL supplierCategory):');
  console.log(`  title: ${p5587?.title}`);
  console.log(`  supplierCategory: ${p5587?.supplierCategory ?? 'NULL'}`);
  console.log(`  description present: ${!!p5587?.description} (len=${p5587?.description?.length ?? 0})`);
  console.log('');

  // Find products with xmlKey starting 160 then 1607/1608
  const range = await prisma.product.findMany({
    where: { xmlKey: { startsWith: '1608' } },
    select: { xmlKey: true, supplierCategory: true, categoryId: true },
    orderBy: { xmlKey: 'asc' },
    take: 5,
  });
  console.log('Products xmlKey startsWith 1608:');
  for (const p of range) console.log(`  ${p.xmlKey}: sc=${p.supplierCategory ?? 'NULL'} catId=${p.categoryId ? 'SET' : 'NULL'}`);
  console.log('');

  // Do ANY products in the 1607/1608 range have supplierCategory?
  const withSc = await prisma.product.count({ where: { xmlKey: { in: ['1607','1608','160701','160801'] } } });
  const all160 = await prisma.product.findMany({ where: { OR: [{ xmlKey: { startsWith: '1607' } }, { xmlKey: { startsWith: '1608' } }] }, select: { xmlKey: true, supplierCategory: true } });
  const withScCount = all160.filter(p => p.supplierCategory).length;
  console.log(`Products 1607*/1608*: total=${all160.length}, with supplierCategory=${withScCount}, null=${all160.length - withScCount}`);
  console.log('');

  // Import item results — any errorDetail for the null-sc products?
  const nullSupp = await prisma.product.findMany({
    where: { supplierCategory: null, xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688' },
    select: { xmlKey: true },
  });
  const nullKeys = nullSupp.map(p => p.xmlKey);
  console.log(`NULL supplierCategory keys: ${nullKeys.length}`);
  console.log(`  first 10: ${nullKeys.slice(0, 10).join(', ')}`);
  console.log(`  last 10:  ${nullKeys.slice(-10).join(', ')}`);
  console.log('');

  // Check import runs total counts vs current
  console.log('Import runs detail:');
  const runs = await prisma.xmlImportRun.findMany({ where: { sourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688' }, orderBy: { startedAt: 'asc' } });
  for (const r of runs) {
    console.log(`  ${r.startedAt.toISOString()} status=${r.status} total=${r.totalProducts} new=${r.newProducts} upd=${r.updatedProducts} fail=${r.failedProducts} skip=${r.skippedProducts} del=${r.deletedProducts}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
