// scripts/rt-resolve-lnf192.ts
// READ-ONLY: re-match the 192 with improved normalization (NFKD + strip combining marks)
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));
  const catByExt = new Map<number, string>();
  for (const c of await prisma.category.findMany({ where: { externalId: { not: null } }, select: { externalId: true, id: true } })) catByExt.set(Number(c.externalId), c.id);

  const lnf = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json', 'utf8'));
  const GOAL_EXTS = [5284 /*Katı Sabun*/, 2337 /*Bebek Sabunu*/, 934 /*Avize*/, 1877 /*Dekoratif Obje ve Biblo*/];

  const rows: any[] = [];
  const byExt = new Map<number, number>();
  for (const d of lnf) {
    const hay = fold((d.title || '') + ' ' + (d.supplierCategory || ''));
    const cands: Array<{ ext: number; name: string; catId: string | null; mapped: boolean }> = [];
    for (const l of tree.leaves) {
      const lf = fold(l.name);
      if (lf.length < 4) continue;
      if (!hay.includes(lf)) continue;
      const catId = catByExt.get(l.externalId) ?? null;
      cands.push({ ext: l.externalId, name: l.name, catId, mapped: !!catId && mapSet.has(catId) });
    }
    if (!cands.length) { rows.push({ xmlKey: d.xmlKey, dataset: d.dataset, title: d.title, supplierCategory: d.supplierCategory, status: 'STILL_LNF' }); continue; }
    // prefer goal exts if present
    const goal = cands.find(c => GOAL_EXTS.includes(c.ext));
    const pick = goal || cands[0];
    byExt.set(pick.ext, (byExt.get(pick.ext) || 0) + 1);
    rows.push({ xmlKey: d.xmlKey, productId: d.productId, dataset: d.dataset, title: d.title, supplierCategory: d.supplierCategory,
      target: pick.name, targetExt: pick.ext, targetCatId: pick.catId, mapping: pick.mapped, status: pick.mapped ? 'CANDIDATE' : 'UNMAPPED' });
  }
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192-rematch.json', JSON.stringify(rows, null, 2), 'utf8');
  console.log('Re-match status counts:', JSON.stringify([...(() => { const m = new Map<string, number>(); for (const r of rows) m.set(r.status, (m.get(r.status) || 0) + 1); return m; })()]));
  console.log('\nCandidate leaf distribution (ext -> count):');
  for (const [e, n] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) {
    const leaf = tree.leaves.find(l => l.externalId === e);
    console.log(`  ${String(n).padStart(3)}x ${leaf?.name} (ext=${e})`);
  }
  console.log('');
  // print still-LNF samples
  const still = rows.filter(r => r.status === 'STILL_LNF');
  console.log(`STILL_LNF: ${still.length}. Samples:`);
  for (const r of still.slice(0, 30)) console.log(`  ${r.xmlKey} | ${String(r.title).slice(0, 75)}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
