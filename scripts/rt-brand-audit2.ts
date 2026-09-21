// scripts/rt-brand-audit2.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
function fold(s: string): string { return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim(); }
async function main() {
  // distinct xmlBrandName
  const grp = await prisma.product.groupBy({ by: ['xmlBrandName'], where: { status: { not: 'DELETED' } }, _count: true });
  console.log('=== distinct xmlBrandName ===');
  for (const g of grp) console.log(`  "${g.xmlBrandName}" x${g._count}`);

  // brandId distribution
  const bg = await prisma.product.groupBy({ by: ['brandId'], where: { status: { not: 'DELETED' } }, _count: true });
  console.log('\n=== brandId distribution ===');
  for (const g of bg) { const b = g.brandId ? await prisma.brand.findUnique({ where: { id: g.brandId }, select: { name: true, externalId: true } }) : null; console.log(`  ${b?.name ?? '(null)'} (ext=${b?.externalId ?? '—'}) x${g._count}`); }

  // normalized mismatch
  const prods = await prisma.product.findMany({ where: { status: { not: 'DELETED' } }, select: { xmlKey: true, xmlBrandName: true, brand: { select: { name: true } } } });
  let mismatch = 0; const samples: string[] = [];
  for (const p of prods) {
    if (p.xmlBrandName && p.brand) {
      const a = fold(p.xmlBrandName), b = fold(p.brand.name);
      if (a !== b && !a.includes(b) && !b.includes(a)) { mismatch++; if (samples.length<20) samples.push(`${p.xmlKey}: xml="${p.xmlBrandName}" -> "${p.brand.name}"`); }
    }
  }
  console.log(`\n=== normalized name mismatch: ${mismatch} ===`);
  for (const s of samples) console.log('  '+s);

  // brands without externalId (marketplace mapping)
  const noExt = await prisma.brand.findMany({ where: { externalId: null }, select: { name: true } });
  console.log(`\nBrands without externalId: ${noExt.length} -> ${noExt.map(b=>b.name).join(', ')}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
