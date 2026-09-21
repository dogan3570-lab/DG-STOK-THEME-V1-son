// scripts/rt-final-classification.ts
// READ-ONLY: Final classification of 728 products for bulk mapping plan
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  const allCats = await prisma.category.findMany({ select: { id: true, name: true, externalId: true, parentId: true } });
  const catByName = new Map<string, typeof allCats[0]>();
  for (const c of allCats) { const k = c.name.toLowerCase().trim(); if (!catByName.has(k)) catByName.set(k, c); }
  const parentIds = new Set(allCats.filter(c => c.parentId).map(c => c.parentId!));
  const isLeaf = (id: string) => !parentIds.has(id);

  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: MP, active: true, externalId: { not: null } },
    select: { categoryId: true, externalId: true },
  });
  const mapByCat = new Map(mappings.map(m => [m.categoryId, Number(m.externalId)]));

  const nullCat = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { id: true, xmlKey: true, supplierCategory: true, title: true },
  });

  const groups = new Map<string, typeof nullCat>();
  for (const p of nullCat) {
    const k = p.supplierCategory || '<NO_XML_CATEGORY>';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  type Row = { sc: string; count: number; leaf: string; target: string; extId: number | null; conf: string; auto: boolean };
  const rows: Row[] = [];

  for (const [sc, prods] of groups) {
    if (sc === '<NO_XML_CATEGORY>') {
      rows.push({ sc, count: prods.length, leaf: '—', target: '—', extId: null, conf: 'NO_MATCH', auto: false });
      continue;
    }
    const parts = sc.split(' > ').map(s => s.trim()).filter(Boolean);
    const leaf = parts[parts.length - 1] || '';
    const m = catByName.get(leaf.toLowerCase());
    if (m) {
      const hasMap = mapByCat.has(m.id);
      const extId = mapByCat.get(m.id) ?? (m.externalId ? Number(m.externalId) : null);
      const leafOk = isLeaf(m.id);
      let conf: string;
      if (hasMap && leafOk) conf = 'EXACT';
      else if (hasMap && !leafOk) conf = 'HIGH_CONFIDENCE';
      else conf = 'NEEDS_REVIEW';
      rows.push({ sc, count: prods.length, leaf, target: m.name, extId, conf, auto: conf === 'EXACT' });
    } else {
      rows.push({ sc, count: prods.length, leaf, target: '—', extId: null, conf: 'NO_MATCH', auto: false });
    }
  }

  rows.sort((a, b) => b.count - a.count);

  console.log('═══ FINAL CLASSIFICATION: 728 NULL-CATEGORY PRODUCTS ═══');
  console.log('');
  console.log('| # | Count | XML Supplier Category (leaf) | Target DG Category | ExtID | Confidence | Auto |');
  console.log('|---|-------|------------------------------|--------------------|-------|------------|------|');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const scShort = r.sc === '<NO_XML_CATEGORY>' ? '(XML kategorisi YOK)' : r.sc.substring(0, 45);
    console.log(`| ${(i+1).toString().padStart(2)} | ${r.count.toString().padStart(5)} | ${scShort.padEnd(44)} | ${r.target.substring(0,18).padEnd(18)} | ${(r.extId?.toString() || '—').padStart(5)} | ${r.conf.padEnd(15)} | ${r.auto ? '✅' : '❌'} |`);
  }
  console.log('');

  const sum = (c: string) => rows.filter(r => r.conf === c).reduce((s, r) => s + r.count, 0);
  console.log('═══ TOTALS ═══');
  console.log(`  EXACT          : ${sum('EXACT').toString().padStart(4)} products (${rows.filter(r=>r.conf==='EXACT').length} groups)`);
  console.log(`  HIGH_CONFIDENCE: ${sum('HIGH_CONFIDENCE').toString().padStart(4)} products (${rows.filter(r=>r.conf==='HIGH_CONFIDENCE').length} groups)`);
  console.log(`  NEEDS_REVIEW   : ${sum('NEEDS_REVIEW').toString().padStart(4)} products (${rows.filter(r=>r.conf==='NEEDS_REVIEW').length} groups)`);
  console.log(`  NO_MATCH       : ${sum('NO_MATCH').toString().padStart(4)} products (${rows.filter(r=>r.conf==='NO_MATCH').length} groups)`);
  console.log(`  TOTAL          : ${(sum('EXACT')+sum('HIGH_CONFIDENCE')+sum('NEEDS_REVIEW')+sum('NO_MATCH')).toString().padStart(4)} products`);
  console.log('');

  console.log('═══ EXACT GROUPS (auto-assignable) ═══');
  for (const r of rows.filter(r => r.conf === 'EXACT')) {
    console.log(`  ${r.count.toString().padStart(3)}x  "${r.leaf}" → ${r.target} (ext=${r.extId})`);
  }
  console.log('');
  console.log('═══ HIGH_CONFIDENCE GROUPS (name match, missing mapping/leaf) ═══');
  for (const r of rows.filter(r => r.conf === 'HIGH_CONFIDENCE')) {
    console.log(`  ${r.count.toString().padStart(3)}x  "${r.leaf}" → ${r.target} (ext=${r.extId})`);
  }
  console.log('');
  console.log('═══ NEEDS_REVIEW GROUPS (name match, no marketplace mapping) ═══');
  for (const r of rows.filter(r => r.conf === 'NEEDS_REVIEW')) {
    console.log(`  ${r.count.toString().padStart(3)}x  "${r.leaf}" → ${r.target}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
