// scripts/rt-null-suppliercat-rootcause.ts
// READ-ONLY: Root cause of 335 NULL supplierCategory + 728 NULL categoryId
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('ROOT CAUSE: 335 NULL supplierCategory + 728 NULL categoryId');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  // ── 1) All null-category products ──
  const nullCat = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: { not: null }, status: { not: 'DELETED' } },
    select: {
      id: true, xmlKey: true, title: true, supplierCategory: true,
      createdAt: true, updatedAt: true, status: true,
      categoryMatch: true, matchedBy: true, aiSuggestedCategoryId: true,
      xmlSourceId: true, brandId: true, salePrice: true,
    },
  });

  console.log(`Total categoryId=NULL: ${nullCat.length}`);
  console.log(`  With NULL supplierCategory: ${nullCat.filter(p => !p.supplierCategory).length}`);
  console.log(`  With supplierCategory:      ${nullCat.filter(p => !!p.supplierCategory).length}`);
  console.log('');

  // ── 2) createdAt range ──
  const dates = nullCat.map(p => p.createdAt.getTime()).sort((a, b) => a - b);
  if (dates.length) {
    console.log('createdAt range:');
    console.log(`  earliest: ${new Date(dates[0]).toISOString()}`);
    console.log(`  latest:   ${new Date(dates[dates.length-1]).toISOString()}`);
  }
  console.log('');

  // ── 3) Do OTHER products from same source have categoryId? ──
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const srcStats = await prisma.product.groupBy({
    by: ['categoryId'],
    where: { xmlSourceId: srcId, status: { not: 'DELETED' } },
    _count: true,
  });
  const withCat = srcStats.filter(g => g.categoryId !== null).reduce((s, g) => s + g._count, 0);
  const withoutCat = srcStats.filter(g => g.categoryId === null).reduce((s, g) => s + g._count, 0);
  console.log(`Source ${srcId.substring(0,8)} products:`);
  console.log(`  categoryId != NULL: ${withCat}`);
  console.log(`  categoryId == NULL: ${withoutCat}`);
  console.log('');

  // ── 4) supplierCategory stats for the WHOLE source ──
  const srcAll = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { categoryId: true, supplierCategory: true, categoryMatch: true, matchedBy: true },
  });
  const nullSuppCat = srcAll.filter(p => !p.supplierCategory).length;
  const emptySuppCat = srcAll.filter(p => p.supplierCategory === '').length;
  console.log(`Source-wide supplierCategory:`);
  console.log(`  NULL:  ${nullSuppCat}`);
  console.log(`  empty: ${emptySuppCat}`);
  console.log('');

  // ── 5) Cross-tab: categoryId vs supplierCategory ──
  console.log('CROSS-TAB (whole source):');
  const crosstab: Record<string, number> = {};
  for (const p of srcAll) {
    const catKey = p.categoryId ? 'cat!=null' : 'cat=null';
    const scKey = p.supplierCategory ? 'sc!=null' : 'sc=null';
    const k = `${catKey} | ${scKey}`;
    crosstab[k] = (crosstab[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(crosstab)) console.log(`  ${k}: ${v}`);
  console.log('');

  // ── 6) Default 'Genel' category ──
  const genel = await prisma.category.findFirst({ where: { name: 'Genel' }, select: { id: true, name: true, externalId: true, parentId: true } });
  console.log(`Default "Genel" category: ${genel ? JSON.stringify(genel) : 'MISSING'}`);
  console.log('');

  // ── 7) Sample the 335: full record ──
  const sample = nullCat.filter(p => !p.supplierCategory).slice(0, 10);
  console.log('SAMPLE 10 products with NULL supplierCategory:');
  for (const p of sample) {
    console.log(`  ${p.id.substring(0,8)} | xmlKey=${p.xmlKey} | catId=${p.categoryId ?? 'NULL'} | match=${p.categoryMatch} by=${p.matchedBy} | created=${p.createdAt.toISOString().substring(0,10)}`);
    console.log(`      title: ${p.title?.substring(0, 70)}`);
  }
  console.log('');

  // ── 8) Compare: do products WITH supplierCategory have categoryId? ──
  const withSupp = srcAll.filter(p => p.supplierCategory);
  const withSuppAndCat = withSupp.filter(p => p.categoryId);
  console.log(`Source products WITH supplierCategory: ${withSupp.length}`);
  console.log(`  ...of which have categoryId: ${withSuppAndCat.length}`);
  console.log(`  ...of which NULL categoryId:  ${withSupp.length - withSuppAndCat.length}`);
  console.log('');

  // ── 9) matchedBy distribution among null-category ──
  const mby: Record<string, number> = {};
  for (const p of nullCat) mby[p.matchedBy ?? '(null)'] = (mby[p.matchedBy ?? '(null)'] || 0) + 1;
  console.log(`matchedBy distribution (null-category products): ${JSON.stringify(mby)}`);
  console.log('');

  // ── 10) Check import runs for this source ──
  const runs = await prisma.xmlImportRun.findMany({
    where: { sourceId: srcId },
    orderBy: { startedAt: 'desc' },
    take: 10,
    select: { id: true, startedAt: true, finishedAt: true, status: true, totalProducts: true, newProducts: true, updatedProducts: true, failedProducts: true, errorDetail: true },
  });
  console.log(`Recent import runs for source (${runs.length}):`);
  for (const r of runs) {
    console.log(`  ${r.startedAt.toISOString().substring(0,19)} | status=${r.status} | total=${r.totalProducts} new=${r.newProducts} upd=${r.updatedProducts} fail=${r.failedProducts}${r.errorDetail ? ` | err=${r.errorDetail.substring(0,60)}` : ''}`);
  }
  console.log('');

  // ── 11) Do the 335 share a common xmlKey range or prefix? ──
  const nullSupp = nullCat.filter(p => !p.supplierCategory);
  const prefixes = new Map<string, number>();
  for (const p of nullSupp) {
    const prefix = (p.xmlKey || '').substring(0, 4);
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
  }
  console.log('xmlKey prefixes among 335 NULL-supplierCategory:');
  for (const [pfx, cnt] of [...prefixes.entries()].sort((a,b) => b[1]-a[1]).slice(0, 15)) {
    console.log(`  "${pfx}": ${cnt}`);
  }
  console.log('');

  // ── 12) Also check: 393 products WITH supplierCategory — their categoryId status ──
  const withSuppNullCat = nullCat.filter(p => p.supplierCategory);
  console.log(`393 products with supplierCategory but NULL categoryId: ${withSuppNullCat.length}`);
  console.log('  Top supplierCategory values:');
  const scMap = new Map<string, number>();
  for (const p of withSuppNullCat) scMap.set(p.supplierCategory!, (scMap.get(p.supplierCategory!) || 0) + 1);
  for (const [sc, cnt] of [...scMap.entries()].sort((a,b) => b[1]-a[1]).slice(0, 20)) {
    console.log(`    ${cnt.toString().padStart(3)}x  ${sc}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
