// scripts/rt-apply-mr225.ts
// Applies ONLY the 31 image+semantic verified products. Mode: dry | apply
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

const EXT: Record<number, string[]> = {
  934:  ['160720','160721','160746','160747','160901'],          // Avize
  1795: ['160816','160819','160820','160821','160822','160823','160824'], // Toka
  461:  ['160785'],                                              // Çerçeve
  4769: ['8828'],                                                // Dil Temizleyici
  477:  ['5591','5592','5593','5594','5595','5596','5597','5598','5599','5600','5601','5602'], // Alez
  1805: ['5829'],                                                // Atkı & Bere & Eldiven Set
  2192: ['12598','12606'],                                       // Kaşıklık
  5434: ['818'],                                                 // Ceviz ve Fındık Kıracağı
  4937: ['160848'],                                              // Tuvalet Kağıtlığı
};

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));

  const rows: any[] = [];
  let applied = 0, fail = 0;
  for (const [extStr, keys] of Object.entries(EXT)) {
    const ext = Number(extStr);
    const leaf = tree.leaves.find(l => l.externalId === ext);
    const cat = await prisma.category.findFirst({ where: { externalId: String(ext) }, select: { id: true, name: true } });
    if (!leaf || !cat || !mapSet.has(cat.id)) { fail++; console.log(`GATE FAIL ext=${ext} leaf=${!!leaf} cat=${!!cat} map=${cat?mapSet.has(cat.id):false}`); continue; }
    for (const k of keys) {
      const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { id: true, categoryId: true, title: true } });
      if (!p) { fail++; continue; }
      if (p.categoryId !== null) { rows.push({ xmlKey: k, status: 'ALREADY' }); continue; }
      rows.push({ xmlKey: k, productId: p.id, newCategoryId: cat.id, newCategoryName: cat.name, targetExt: ext, isLeaf: true,
        mapping: true, method: 'image_semantic_verified', evidence: 'visual+semantic', status: 'AUTO_SAFE' });
      if (MODE === 'apply') {
        await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
        await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id,
          details: `[image-verified-mr225] ${k} -> ${cat.name} (ext=${ext})`,
          meta: JSON.stringify({ productId: p.id, xmlKey: k, method: 'image_semantic_verified', scope: 'PRODUCT', evidence: 'visual+semantic', newCategoryId: cat.id }) } });
        applied++;
      }
    }
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-mr225-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  const auto = rows.filter(r => r.status === 'AUTO_SAFE');
  console.log(`Mode=${MODE} AUTO_SAFE=${auto.length} applied=${applied} fail=${fail} already=${rows.filter(r=>r.status==='ALREADY').length}`);
  const byLeaf = new Map<string, number>();
  for (const r of auto) byLeaf.set(r.newCategoryName, (byLeaf.get(r.newCategoryName) || 0) + 1);
  console.log('By leaf:', JSON.stringify([...byLeaf]));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
