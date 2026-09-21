// scripts/rt-apply-mr97.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

// image-verified single valid leaf
const SAFE: Record<string, number> = {
  '3251': 4809, // Ayak Törpüsü
  '2736': 1509, // Hesap Makinesi
  '2712': 4769, // Dil Temizleyici
  '2896': 3995, // Ses Kablosu
};

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  const rows: any[] = []; let applied = 0;
  for (const [k, ext] of Object.entries(SAFE)) {
    const leaf = tree.leaves.find(l => l.externalId === ext);
    const cat = await prisma.category.findFirst({ where: { externalId: String(ext) }, select: { id: true, name: true } });
    if (!leaf || !cat || !mapSet.has(cat.id)) { rows.push({ xmlKey: k, status: 'GATE_FAIL' }); continue; }
    const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { id: true, categoryId: true } });
    if (!p?.id) { rows.push({ xmlKey: k, status: 'NO_PRODUCT' }); continue; }
    if (p.categoryId !== null) { rows.push({ xmlKey: k, status: 'ALREADY' }); continue; }
    rows.push({ xmlKey: k, productId: p.id, newCategoryId: cat.id, newCategoryName: cat.name, targetExt: ext, isLeaf: true, mapping: true, visualVerified: true, method: 'image_verified', evidence: 'image confirms single valid leaf', status: 'SAFE_TO_MATCH' });
    if (MODE === 'apply') {
      await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
      await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id, details: `[mr97-resolved] ${k} -> ${cat.name} (ext=${ext})`, meta: JSON.stringify({ productId: p.id, xmlKey: k, method: 'image_verified', scope: 'PRODUCT', visualVerified: true, newCategoryId: cat.id }) } });
      applied++;
    }
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-mr97-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Mode=${MODE} SAFE_TO_MATCH=${rows.filter(r=>r.status==='SAFE_TO_MATCH').length} applied=${applied} fail=${rows.filter(r=>r.status==='GATE_FAIL').length}`);
  console.log(JSON.stringify(rows.map(r=>`${r.xmlKey}->${r.newCategoryName}`)));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
