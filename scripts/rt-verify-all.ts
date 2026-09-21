// scripts/rt-verify-all.ts
// READ-ONLY verification: 71->186 resolution + 155 application proof + regression
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();

  // ---------- PART 1: 71 -> 186 resolution ----------
  const snap = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', 'utf8'));
  const applied = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-apply.json', 'utf8'));

  const reasonCount = new Map<string, number>();
  for (const d of snap) reasonCount.set(d.reason, (reasonCount.get(d.reason) || 0) + 1);
  const snapNullSc = snap.filter((d: any) => !d.supplierCategory).length;
  const snapHasSc = snap.filter((d: any) => !!d.supplierCategory).length;
  const lnf = snap.filter((d: any) => d.reason === 'LEAF_NOT_FOUND');
  const lnfNull = lnf.filter((d: any) => !d.supplierCategory).length;
  const lnfHas = lnf.filter((d: any) => !!d.supplierCategory).length;

  const snapByPid = new Map<string, any>(snap.map((d: any) => [d.productId, d]));
  const appliedNoSource = applied.filter((a: any) => a.newCategoryId && !snapByPid.get(a.productId)?.supplierCategory).length;
  const appliedHasSource = applied.filter((a: any) => a.newCategoryId && !!snapByPid.get(a.productId)?.supplierCategory).length;
  // remaining no-source breakdown by snapshot reason
  const appliedPids = new Set(applied.filter((a: any) => a.newCategoryId).map((a: any) => a.productId));
  const remainingNoSource = snap.filter((d: any) => !d.supplierCategory && !appliedPids.has(d.productId));
  const remByReason = new Map<string, number>();
  for (const d of remainingNoSource) remByReason.set(d.reason, (remByReason.get(d.reason) || 0) + 1);

  // current DB
  const curNullCat = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null } });
  const curNullSc = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null, supplierCategory: null } });
  const curHasSc = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null, supplierCategory: { not: null } } });
  const allNullSc = await prisma.product.count({ where: { xmlSourceId: srcId, status: { not: 'DELETED' }, supplierCategory: null } });

  console.log('══════════ PART 1: 71 -> 186 ══════════');
  console.log('Snapshot (728 pre-application) reason counts:', JSON.stringify([...reasonCount]));
  console.log(`Snapshot supplierCategory:  null=${snapNullSc}  has=${snapHasSc}  (total=${snap.length})`);
  console.log(`LEAF_NOT_FOUND: total=${lnf.length}  nullSc=${lnfNull}  hasSc=${lnfHas}`);
  console.log(`Applied (155):  no-source=${appliedNoSource}  has-source=${appliedHasSource}`);
  console.log(`Remaining no-source (186) by snapshot reason:`, JSON.stringify([...remByReason]));
  console.log(`Current DB (source): nullCat=${curNullCat}  nullCat&nullSc=${curNullSc}  nullCat&hasSc=${curHasSc}`);
  console.log(`Current DB: supplierCategory NULL (all products) = ${allNullSc}`);
  console.log('');
  console.log('RECONCILIATION:');
  console.log(`  Start no-source in 728                        = ${snapNullSc}`);
  console.log(`  Applied no-source (categoryId set)            = ${appliedNoSource}`);
  console.log(`  Remaining no-source (categoryId still NULL)   = ${curNullSc}`);
  console.log(`  Check: ${snapNullSc} - ${appliedNoSource} = ${snapNullSc - appliedNoSource}  (DB says ${curNullSc})  -> ${snapNullSc - appliedNoSource === curNullSc ? 'MATCH' : 'MISMATCH'}`);
  console.log(`  '71' was: classifier run-1 (WITH description) LEAF_NOT_FOUND ∩ nullSc (an INTERMEDIATE number)`);
  console.log(`  run-2 (no description) LEAF_NOT_FOUND nullSc = ${lnfNull}`);
  console.log('');

  // ---------- PART 2: 155 DB verification ----------
  const ids = applied.filter((a: any) => a.newCategoryId).map((a: any) => a.productId);
  const prods = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, xmlKey: true, categoryId: true, categoryMatch: true, matchedBy: true, updatedAt: true } });
  const prodMap = new Map(prods.map(p => [p.id, p]));

  let okCat = 0, okCatName = 0, okLeaf = 0, okMapping = 0, okMatch = 0, okManual = 0, okAudit = 0, missing = 0;
  const catIds = [...new Set(applied.map((a: any) => a.newCategoryId).filter(Boolean))];
  const cats = await prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, externalId: true } });
  const catMap = new Map(cats.map(c => [c.id, c]));
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, categoryId: { in: catIds }, externalId: { not: null } }, select: { categoryId: true, externalId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  const auditRows = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', entity: 'category', entityId: { in: catIds }, meta: { contains: 'semantic_verified_product_level' } }, select: { entityId: true, meta: true } });
  const auditByProduct = new Map<string, number>();
  for (const a of auditRows) {
    try { const m = JSON.parse(a.meta || '{}'); if (m.productId) auditByProduct.set(m.productId, (auditByProduct.get(m.productId) || 0) + 1); } catch {}
  }

  const bad: any[] = [];
  for (const a of applied) {
    if (!a.newCategoryId) continue;
    const p = prodMap.get(a.productId);
    if (!p) { missing++; bad.push({ xmlKey: a.xmlKey, issue: 'PRODUCT_NOT_FOUND' }); continue; }
    if (p.categoryId === a.newCategoryId) okCat++; else bad.push({ xmlKey: a.xmlKey, issue: 'categoryId_mismatch', db: p.categoryId, expected: a.newCategoryId });
    const cat = catMap.get(a.newCategoryId);
    if (cat && cat.externalId) okCatName++; else bad.push({ xmlKey: a.xmlKey, issue: 'category_missing_extId' });
    if (tree.leafById.has(a.newCategoryId)) okLeaf++; else bad.push({ xmlKey: a.xmlKey, issue: 'NOT_LEAF' });
    if (mapSet.has(a.newCategoryId)) okMapping++; else bad.push({ xmlKey: a.xmlKey, issue: 'NO_MAPPING' });
    if (p.categoryMatch === true) okMatch++;
    if (p.matchedBy === 'manual') okManual++; else bad.push({ xmlKey: a.xmlKey, issue: 'matchedBy=' + p.matchedBy });
    if (auditByProduct.get(a.productId) === 1) okAudit++; else if ((auditByProduct.get(a.productId) || 0) > 1) bad.push({ xmlKey: a.xmlKey, issue: 'AUDIT_DUPLICATE' }); else bad.push({ xmlKey: a.xmlKey, issue: 'AUDIT_MISSING' });
  }

  const dupAudit = [...auditByProduct.entries()].filter(([, c]) => c > 1);

  console.log('══════════ PART 2: 155 DB VERIFICATION ══════════');
  const n = applied.filter((a: any) => a.newCategoryId).length;
  console.log(`  applied rows: ${n}`);
  console.log(`  categoryId correct: ${okCat}/${n}`);
  console.log(`  category name/extId present: ${okCatName}/${n}`);
  console.log(`  target is REAL TREE LEAF: ${okLeaf}/${n}`);
  console.log(`  active Trendyol mapping: ${okMapping}/${n}`);
  console.log(`  categoryMatch=true: ${okMatch}/${n}`);
  console.log(`  matchedBy='manual': ${okManual}/${n}`);
  console.log(`  audit present (1 each): ${okAudit}/${n}`);
  console.log(`  missing products: ${missing}`);
  console.log(`  duplicate audits: ${dupAudit.length}`);
  console.log(`  problem rows: ${bad.length}`);
  if (bad.length) console.log('  problems:', JSON.stringify(bad.slice(0, 20)));

  // ---------- PART 3: regression ----------
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const categories = await prisma.category.count();
  const mappings = await prisma.categoryMapping.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const rules = await prisma.marketplacePricingRule.count();
  const matched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  console.log('');
  console.log('══════════ PART 3: REGRESSION ══════════');
  console.log(JSON.stringify({ total, matched, nullCat: curNullCat, categories, mappings, tpa, rules }));

  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/verify-155.json', JSON.stringify({ n, okCat, okCatName, okLeaf, okMapping, okMatch, okManual, okAudit, missing, dupAudit: dupAudit.length, bad }, null, 2), 'utf8');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
