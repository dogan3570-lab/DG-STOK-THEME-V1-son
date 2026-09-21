// scripts/rt-brand-audit.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  console.log('=== Brand model ===');
  const brands = await prisma.brand.findMany({ select: { id: true, name: true, externalId: true }, orderBy: { name: 'asc' } });
  console.log(`Total brands: ${brands.length}`);
  for (const b of brands) console.log(`  ${b.name} | ext=${b.externalId ?? '—'} | id=${b.id.substring(0,8)}`);

  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  console.log(`\n=== Product brand stats (total ${total}) ===`);
  const brandIdNull = await prisma.product.count({ where: { status: { not: 'DELETED' }, brandId: null } });
  const xmlBrandNull = await prisma.product.count({ where: { status: { not: 'DELETED' }, xmlBrandName: null } });
  const brandMatchTrue = await prisma.product.count({ where: { status: { not: 'DELETED' }, brandMatch: true } });
  const brandMatchFalse = await prisma.product.count({ where: { status: { not: 'DELETED' }, brandMatch: false } });
  console.log(`brandId NULL: ${brandIdNull}`);
  console.log(`xmlBrandName NULL: ${xmlBrandNull}`);
  console.log(`brandMatch true: ${brandMatchTrue}`);
  console.log(`brandMatch false: ${brandMatchFalse}`);

  // brandMatch by matchedBy
  const mb = await prisma.product.groupBy({ by: ['matchedBy'], where: { status: { not: 'DELETED' }, brandMatch: true }, _count: true });
  console.log('brandMatch=true by matchedBy:', JSON.stringify(mb.map(m=>[m.matchedBy, m._count])));

  // Products with brandId but brand name != xmlBrandName (mismatch check)
  const prods = await prisma.product.findMany({ where: { status: { not: 'DELETED' } }, select: { id: true, xmlKey: true, xmlBrandName: true, customBrandName: true, brandId: true, brandMatch: true, brand: { select: { name: true, externalId: true } } } });
  let mismatch = 0; const mismatchSamples: string[] = [];
  let brandSetNoBrand = 0;
  for (const p of prods) {
    if (p.brandId && p.xmlBrandName && p.brand) {
      const a = p.xmlBrandName.toLowerCase().trim(), b = p.brand.name.toLowerCase().trim();
      if (!(a.includes(b) || b.includes(a))) { mismatch++; if (mismatchSamples.length < 20) mismatchSamples.push(`${p.xmlKey}: xml="${p.xmlBrandName}" -> brand="${p.brand.name}"`); }
    }
    if (p.brandId && !p.brandMatch) brandSetNoBrand++;
  }
  console.log(`\nbrandId set but name mismatch (potential FP): ${mismatch}`);
  for (const s of mismatchSamples) console.log('  ' + s);
  console.log(`brandId set but brandMatch=false: ${brandSetNoBrand}`);

  // Products with xmlBrandName but NO brandId
  const noBrand = await prisma.product.findMany({ where: { status: { not: 'DELETED' }, brandId: null }, select: { xmlKey: true, xmlBrandName: true, customBrandName: true } });
  console.log(`\nProducts with brandId NULL: ${noBrand.length}`);
  const xmlValues = new Map<string, number>();
  for (const p of noBrand) { const k = p.xmlBrandName || '(null)'; xmlValues.set(k, (xmlValues.get(k)||0)+1); }
  console.log('  xmlBrandName distribution:', JSON.stringify([...xmlValues.entries()].slice(0,20)));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
