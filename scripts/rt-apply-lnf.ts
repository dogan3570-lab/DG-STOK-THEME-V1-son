// scripts/rt-apply-lnf.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const RULES: Array<{ name: string; test: (d: any, nt: string) => boolean; ext: number }> = [
  { name: 'soap',      ext: 5284, test: (d, nt) => /sabun|grubu/.test(nt) && Number(d.xmlKey) >= 46059 && Number(d.xmlKey) <= 46135 },
  { name: 'soap2',     ext: 5284, test: (d) => d.xmlKey === '46113' },
  { name: 'mumluk',    ext: 1882, test: (d, nt) => /mumluk/.test(nt) },
  { name: 'avize',     ext: 934,  test: (d, nt) => /avize/.test(nt) },
  { name: 'biblo',     ext: 1877, test: (d, nt) => /biblo/.test(nt) },
  { name: 'zibin',     ext: 936,  test: (d) => ['5830','5831'].includes(d.xmlKey) },
  { name: 'battaniye', ext: 2365, test: (d) => ['5836','5837','5838'].includes(d.xmlKey) },
  { name: 'kalemlik',  ext: 1511, test: (d) => d.xmlKey === '160788' },
  { name: 'vites',     ext: 4262, test: (d) => ['5684','5685','5686','5687','5688'].includes(d.xmlKey) },
  { name: 'surahi',    ext: 906,  test: (d) => ['13509','13510','13511'].includes(d.xmlKey) },
];

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  const lnf = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json', 'utf8'));

  const rows: any[] = []; let applied = 0;
  for (const d of lnf) {
    let matched = false;
    const nt = fold(d.title || '');
    for (const r of RULES) {
      if (!r.test(d, nt)) continue;
      matched = true;
      const leaf = tree.leaves.find(l => l.externalId === r.ext);
      const cat = await prisma.category.findFirst({ where: { externalId: String(r.ext) }, select: { id: true, name: true } });
      if (!leaf || !cat || !mapSet.has(cat.id)) { rows.push({ xmlKey: d.xmlKey, status: 'GATE_FAIL', rule: r.name }); break; }
      const p = await prisma.product.findUnique({ where: { xmlKey: d.xmlKey }, select: { id: true, categoryId: true } });
      if (!p) break;
      if (p.categoryId !== null) { rows.push({ xmlKey: d.xmlKey, status: 'ALREADY' }); break; }
      rows.push({ xmlKey: d.xmlKey, productId: p.id, rule: r.name, newCategoryId: cat.id, newCategoryName: cat.name, targetExt: r.ext, isLeaf: true, mapping: true, method: 'normalization_semantic_verified', evidence: r.name + ' (+image for soap)', status: 'AUTO_SAFE' });
      if (MODE === 'apply') {
        await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
        await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: cat.id, details: `[lnf192-resolved] ${d.xmlKey} -> ${cat.name} (ext=${r.ext})`, meta: JSON.stringify({ productId: p.id, xmlKey: d.xmlKey, method: 'normalization_semantic_verified', scope: 'PRODUCT', rule: r.name, newCategoryId: cat.id }) } });
        applied++;
      }
      break;
    }
    if (!matched) rows.push({ xmlKey: d.xmlKey, status: 'UNRESOLVED' });
  }
  writeFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/apply-lnf-${MODE}.json`, JSON.stringify(rows, null, 2), 'utf8');
  const auto = rows.filter(r => r.status === 'AUTO_SAFE');
  const byLeaf = new Map<string, number>();
  for (const r of auto) byLeaf.set(r.newCategoryName, (byLeaf.get(r.newCategoryName) || 0) + 1);
  console.log(`Mode=${MODE} AUTO_SAFE=${auto.length} applied=${applied} unresolved=${rows.filter(r=>r.status==='UNRESOLVED').length} gateFail=${rows.filter(r=>r.status==='GATE_FAIL').length}`);
  console.log('By leaf:', JSON.stringify([...byLeaf]));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
