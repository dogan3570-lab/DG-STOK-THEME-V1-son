// scripts/rt-apply-verified.ts
// Applies the VERIFIED whitelist via PRODUCT-LEVEL updates only. Mode: dry | apply
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

// Verified clean leaf groups (title head-noun == leaf; all samples checked)
const WHITELIST_EXT = [934, 1881, 1795, 384, 2197, 4956, 931];

const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true, name: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();

  const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', 'utf8'));
  const candidates = data.filter((d: any) => d.safe && WHITELIST_EXT.includes(d.targetExt));

  console.log(`Mode: ${MODE}`);
  console.log(`Whitelist candidates: ${candidates.length}`);

  // Verify each target is a REAL LEAF in V2 tree + has active mapping
  const leafOk = new Map<number, boolean>();
  const mapOk = new Map<number, { catId: string; ext: string } | null>();
  for (const ext of WHITELIST_EXT) {
    const leaf = tree.leaves.find(l => l.externalId === ext);
    leafOk.set(ext, !!leaf);
    const cat = await prisma.category.findFirst({ where: { externalId: String(ext) }, select: { id: true, name: true } });
    let mapping = null;
    if (cat) {
      const m = await prisma.categoryMapping.findFirst({ where: { categoryId: cat.id, marketplaceId: MP, active: true, externalId: { not: null } }, select: { externalId: true } });
      if (m) mapping = { catId: cat.id, ext: m.externalId! };
    }
    mapOk.set(ext, mapping);
    console.log(`  ext=${ext} leaf=${!!leaf}(${leaf?.name ?? '-'}) catMapping=${mapping ? 'OK(ext='+mapping.ext+')' : 'MISSING'}`);
  }
  console.log('');

  const usable = candidates.filter((c: any) => leafOk.get(c.targetExt) && mapOk.get(c.targetExt));
  console.log(`Usable (leaf+mapping OK): ${usable.length} / ${candidates.length}`);
  console.log('');

  // Per-product rows
  const rows: any[] = [];
  let applied = 0, skipped = 0;
  for (const c of usable) {
    const p = await prisma.product.findUnique({ where: { id: c.productId }, select: { id: true, xmlKey: true, categoryId: true, status: true, categoryMatch: true } });
    if (!p) { skipped++; continue; }
    if (p.categoryId !== null) { skipped++; rows.push({ ...c, skipped: 'already_matched' }); continue; }
    const mapping = mapOk.get(c.targetExt)!;
    rows.push({
      xmlKey: c.xmlKey, productId: c.productId, oldCategoryId: p.categoryId, newCategoryId: mapping.catId,
      oldStatus: p.status, targetCategory: c.targetLeaf, targetExt: c.targetExt, isLeaf: true,
      method: 'semantic_verified_product_level', confidence: c.score, evidence: 'title_head_noun==leaf (whitelist verified)',
    });
    if (MODE === 'apply') {
      await prisma.product.update({
        where: { id: c.productId },
        data: { categoryId: mapping.catId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() },
      });
      await prisma.auditLog.create({
        data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: mapping.catId,
          details: `[semantic-verified] ${c.xmlKey} -> ${c.targetLeaf} (ext=${c.targetExt})`,
          meta: JSON.stringify({ productId: c.productId, xmlKey: c.xmlKey, method: 'semantic_verified_product_level', evidence: 'title_head_noun==leaf', confidence: c.score, oldCategoryId: null, newCategoryId: mapping.catId, scope: 'PRODUCT' }) },
      });
      applied++;
    }
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Rows: ${rows.length} | applied: ${applied} | skipped: ${skipped}`);
  if (MODE === 'apply') {
    const byLeaf = new Map<string, number>();
    for (const r of rows) if (r.newCategoryId) byLeaf.set(r.targetCategory, (byLeaf.get(r.targetCategory) || 0) + 1);
    console.log('Applied by leaf:', JSON.stringify([...byLeaf]));
  }
  console.log(`Report: C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-${MODE}.json`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
