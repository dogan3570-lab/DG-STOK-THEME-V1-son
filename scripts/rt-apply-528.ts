// scripts/rt-apply-528.ts
// Applies ONLY hand-verified unambiguous products from deep-528. Mode: dry | apply
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

// Hand-verified: leaf head-noun == product physical type (unambiguous)
const VERIFIED_XMLKEYS = [
  '127563','12801',              // Sweatshirt, Pantolon
  '160800',                     // Masaüstü Organizer
  '160815','160817','160818','160843', // Toka
  '2559',                       // Ayakkabı Bakım
  '8821',                       // Parfüm (şişe)
  '2886','2887',                // Selfie Çubuğu
  '160787',                     // Çerçeve (masaüstü)
  '2134',                       // Tablo (duvar süsü)
  '2215',                       // Düdük (hayatta kalma)
  '338',                        // Hurç (ayakkabı)
  '2953',                       // Fondöten
  '8825',                       // Klozet (kapağı poşeti)
  '2267',                       // Temizlik Bezi
  '1170','1272','559','638',    // Duvar Sticker (takvim/harita)
  '2847','2880','2882','2985',  // Şarj Kablosu
];

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));

  const deep = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', 'utf8'));
  const pick = deep.filter((d: any) => VERIFIED_XMLKEYS.includes(d.xmlKey) && d.decision === 'AUTO_SAFE' && d.targetCatId);

  console.log(`Mode: ${MODE} | picked: ${pick.length}`);
  const rows: any[] = [];
  let applied = 0;
  for (const d of pick) {
    const leaf = tree.leafById.get(d.targetCatId);
    const mapped = mapSet.has(d.targetCatId);
    if (!leaf || !mapped) { rows.push({ ...d, status: 'GATE_FAIL' }); continue; }
    rows.push({ xmlKey: d.xmlKey, productId: d.productId, dataset: d.dataset, oldCategoryId: null, newCategoryId: d.targetCatId,
      newCategoryName: d.target, targetExt: d.targetExt, isLeaf: true, mapping: true, visualEvidence: d.visualEvidence,
      method: 'hand_verified_product_level', evidence: 'leaf head-noun == product type (manual review)', status: 'AUTO_SAFE' });
    if (MODE === 'apply') {
      await prisma.product.update({ where: { id: d.productId }, data: { categoryId: d.targetCatId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
      await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: d.targetCatId,
        details: `[hand-verified-528] ${d.xmlKey} -> ${d.target} (ext=${d.targetExt})`,
        meta: JSON.stringify({ productId: d.productId, xmlKey: d.xmlKey, method: 'hand_verified_product_level', scope: 'PRODUCT', evidence: 'head-noun==leaf' }) } });
      applied++;
    }
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-528-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`AUTO_SAFE: ${rows.filter(r=>r.status==='AUTO_SAFE').length} | gateFail: ${rows.filter(r=>r.status==='GATE_FAIL').length} | applied: ${applied}`);
  const byLeaf = new Map<string, number>();
  for (const r of rows.filter(r => r.status === 'AUTO_SAFE')) byLeaf.set(r.newCategoryName, (byLeaf.get(r.newCategoryName) || 0) + 1);
  console.log('By leaf:', JSON.stringify([...byLeaf]));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
