// scripts/rt-apply-conflict.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

const EXT: Record<number, string[]> = {
  2886: ['342'],                       // Mousepad
  5504: ['1856'],                      // Şarj Kablosu
  3615: ['1945','1946'],               // Yüz Masaj Aleti
  3550: ['12766','12771','12772','2693','2694'], // Masaj Cihazı
  4011: ['2379'],                      // TV Askı Aparatı
  4473: ['761'],                       // Çırpıcı
  1855: ['2102'],                      // Çanta Aksesuarı
  3995: ['2175'],                      // Ses Kablosu
  1865: ['1073'],                      // Mama Önlüğü
  4051: ['1079'],                      // Dilek Feneri
  2799: ['2705'],                      // Yazı Tahtası
  5519: ['2367'],                      // Matkap Aksesuarları
  461:  ['120459'],                    // Çerçeve
  904:  ['736'],                       // Bardak
  932:  ['2504'],                      // Ampul
  4769: ['2304'],                      // Dil Temizleyici
  1017: ['1905'],                      // Saç Fırçası ve Tarak
  2467: ['2672'],                      // Tüy Toplayıcı
  4726: ['2513'],                      // Musluk Başlığı
  4088: ['266','535'],                 // Bebek Arabası Aksesuar
};

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  const rows: any[] = []; let applied = 0, fail = 0;
  for (const [extStr, keys] of Object.entries(EXT)) {
    const ext = Number(extStr);
    const leaf = tree.leaves.find(l => l.externalId === ext);
    const cat = await prisma.category.findFirst({ where: { externalId: String(ext) }, select: { id: true, name: true } });
    if (!leaf || !cat || !mapSet.has(cat.id)) { fail++; console.log(`GATE FAIL ext=${ext} leaf=${!!leaf} cat=${!!cat} map=${cat?mapSet.has(cat.id):false}`); continue; }
    for (const k of keys) {
      const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { id: true, categoryId: true } });
      if (!p) { fail++; continue; }
      if (p.categoryId !== null) { rows.push({ xmlKey: k, status: 'ALREADY' }); continue; }
      rows.push({ xmlKey: k, productId: p.id, newCategoryId: cat.id, newCategoryName: cat.name, targetExt: ext, isLeaf: true, mapping: true, method: 'conflict_rootcause_semantic', evidence: 'title/semantic (+image where inspected)', status: 'AUTO_SAFE' });
      if (MODE === 'apply') {
        await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
        await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id, details: `[conflict-resolved-85] ${k} -> ${cat.name} (ext=${ext})`, meta: JSON.stringify({ productId: p.id, xmlKey: k, method: 'conflict_rootcause_semantic', scope: 'PRODUCT', evidence: 'candidate was lexical trap; SC generic; real leaf matched', newCategoryId: cat.id }) } });
        applied++;
      }
    }
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-conflict-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  const auto = rows.filter(r => r.status === 'AUTO_SAFE');
  console.log(`Mode=${MODE} AUTO_SAFE=${auto.length} applied=${applied} fail=${fail}`);
  const byLeaf = new Map<string, number>();
  for (const r of auto) byLeaf.set(r.newCategoryName, (byLeaf.get(r.newCategoryName) || 0) + 1);
  console.log('By leaf:', JSON.stringify([...byLeaf]));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
