// scripts/rt-apply-573.ts
// Applies ONLY manually-verified clean leaf groups. Product-level. Mode: dry | apply
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

// Manually verified clean groups (leaf head-noun == product type; ALL titles reviewed)
const WHITELIST_EXT = [
  971,   // Omuz Çantası
  904,   // Bardak (Meşrubat Bardağı)
  3628,  // Kaş Makası
  2573,  // Banyo Aynası
  4447,  // Limon Sıkacağı
  5557,  // Multimetre
  2512,  // Tornavida (set)
  4125,  // Damacana Pompası
  3167,  // Küllük
  1842,  // Sahte Para Kontrol Cihazı
  3013,  // Hava Nemlendirici
  5492,  // Dönüştürücü
  4785,  // Pasta Cila
  4563,  // Kapı Zili
  867,   // Epilatör
  2643,  // Budama Testeresi
  4753,  // Akü Takviye Kablosu
  3748,  // Mekik Aleti
  2544,  // Kapı Stoperi
  3228,  // Silikon Tabancası
  4726,  // Musluk Başlığı
  4699,  // Cam Silme Aparatı
  4028,  // Çöp Kovası
  814,   // Suluk & Matara
  2884,  // Sabunluk
  3465,  // Duvar Sticker
  2102,  // Kasa
  2993,  // Banyo Paspası
  865,   // Saç Düzleştirici
];

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true, externalId: true } });
  const mapByCat = new Map(maps.map(m => [m.categoryId, m.externalId!]));

  const dry = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/573-dryrun.json', 'utf8'));
  const cand = dry.filter((d: any) => d.reason === 'AUTO_CANDIDATE' && WHITELIST_EXT.includes(d.targetExt));

  console.log(`Mode: ${MODE} | candidates: ${cand.length}`);
  const rows: any[] = [];
  let applied = 0, evidenceFail = 0, gateFail = 0;

  for (const c of cand) {
    const leaf = tree.leaves.find(l => l.externalId === c.targetExt);
    const cat = await prisma.category.findFirst({ where: { externalId: String(c.targetExt) }, select: { id: true, name: true } });
    if (!leaf || !cat || !mapByCat.has(cat.id)) { gateFail++; rows.push({ ...c, status: 'GATE_FAIL' }); continue; }
    // evidence: leaf name (folded) must appear in title or supplierCategory (substring, TR suffix tolerant)
    const hay = foldTr((c.title || '') + ' ' + (c.supplierCategory || ''));
    const lf = foldTr(leaf.name);
    const head = lf.split(' ')[0];
    const ok = hay.includes(lf) || hay.includes(head);
    if (!ok) { evidenceFail++; rows.push({ ...c, status: 'EVIDENCE_FAIL', leaf: leaf.name }); continue; }
    rows.push({ xmlKey: c.xmlKey, productId: c.productId, oldCategoryId: null, newCategoryId: cat.id, newCategoryName: cat.name,
      targetExt: c.targetExt, isLeaf: true, oldStatus: 'XML', method: 'semantic_verified_product_level',
      evidence: 'title/SC head-noun == leaf', confidence: c.score, status: 'AUTO_SAFE' });
    if (MODE === 'apply') {
      await prisma.product.update({ where: { id: c.productId }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
      await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id,
        details: `[semantic-verified-573] ${c.xmlKey} -> ${cat.name} (ext=${c.targetExt})`,
        meta: JSON.stringify({ productId: c.productId, xmlKey: c.xmlKey, method: 'semantic_verified_product_level', scope: 'PRODUCT', evidence: 'head-noun==leaf', confidence: c.score, newCategoryId: cat.id }) } });
      applied++;
    }
  }

  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  const byLeaf = new Map<string, number>();
  for (const r of rows.filter(r => r.status === 'AUTO_SAFE')) byLeaf.set(r.newCategoryName, (byLeaf.get(r.newCategoryName) || 0) + 1);
  console.log(`AUTO_SAFE: ${rows.filter(r=>r.status==='AUTO_SAFE').length} | gateFail: ${gateFail} | evidenceFail: ${evidenceFail} | applied: ${applied}`);
  console.log('By leaf:', JSON.stringify([...byLeaf]));
  console.log(`Report: apply-573-${MODE}.json`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
