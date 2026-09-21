// scripts/rt-573-dryrun.ts
// READ-ONLY dry-run over the 573 remaining. Strict, title-only, group-verified candidates.
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}
const STOP = new Set(['ve','ile','icin','için','adet','cm','mm','ml','gr','kg','lt','model','urun','ürün','urunu','renk','renkli','ozel','özel','tasarim','tasarım','boyut','buyuk','büyük','kucuk','küçük','set','seti','the','and','for','with','x','li']);
function tokens(s: string): string[] { return foldTr(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)); }
const GENERIC_LEAF = new Set(['diger','digerleri','genel','aksesuar','aksesuarlar','urun','urunler','set','seti','cesitleri','malzemeleri']);

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();

  const df = new Map<string, number>(); const leafTokens = new Map<string, Set<string>>();
  for (const l of tree.leaves) { const ts = new Set(tokens(l.fullPath)); leafTokens.set(l.id, ts); for (const t of ts) df.set(t, (df.get(t) || 0) + 1); }
  const N = tree.leaves.length; const idf = (t: string) => Math.log(N / (1 + (df.get(t) || 0)));

  // valid mapped categories set
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mappedCatIds = new Set(maps.map(m => m.categoryId));

  function evaluate(p: { title: string | null; supplierCategory: string | null }) {
    const titleTokens = new Set(tokens(p.title || ''));
    for (const t of tokens(p.supplierCategory || '')) titleTokens.add(t);
    const titleFold = foldTr((p.title || '') + ' ' + (p.supplierCategory || ''));
    if (titleTokens.size === 0) return { reason: 'NO_MATCH', leaf: null as any, score: 0 };
    const scored: Array<{ leaf: any; score: number }> = [];
    for (const l of tree.leaves) {
      const lNameFold = foldTr(l.name);
      if (lNameFold.length < 4) continue;
      const ltoks = tokens(l.name);
      if (ltoks.length === 0) continue;
      if (ltoks.length === 1 && GENERIC_LEAF.has(ltoks[0])) continue;
      let accept = false;
      if (titleFold.includes(lNameFold)) accept = true;
      else if (ltoks.every(t => titleTokens.has(t)) && ltoks.some(t => idf(t) > 1.0)) accept = true;
      if (!accept) continue;
      const score = ltoks.filter(t => titleTokens.has(t)).reduce((s, t) => s + idf(t), 0);
      scored.push({ leaf: l, score: Number(score.toFixed(3)) });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return { reason: 'LEAF_NOT_FOUND', leaf: null as any, score: 0 };
    const best = scored[0]; const second = scored[1]?.score ?? 0;
    if (scored.length > 1 && (best.score - second) / best.score < 0.25) return { reason: 'MANUAL_REVIEW', leaf: null as any, score: best.score };
    return { reason: 'AUTO_CANDIDATE', leaf: best.leaf, score: best.score };
  }

  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, description: true, images: true, status: true },
    orderBy: { xmlKey: 'asc' },
  });

  const rows: any[] = [];
  const reasonCount = new Map<string, number>();
  for (const p of prods) {
    const r = evaluate(p);
    // mapping gate for AUTO_CANDIDATE
    let finalReason = r.reason;
    if (finalReason === 'AUTO_CANDIDATE' && r.leaf) {
      const cat = await prisma.category.findFirst({ where: { externalId: String(r.leaf.externalId) }, select: { id: true } });
      if (!cat || !mappedCatIds.has(cat.id)) finalReason = 'MANUAL_REVIEW';
    }
    reasonCount.set(finalReason, (reasonCount.get(finalReason) || 0) + 1);
    rows.push({ productId: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, reason: finalReason,
      targetLeaf: r.leaf?.name ?? null, targetExt: r.leaf?.externalId ?? null, targetPath: r.leaf?.fullPath ?? null, score: r.score,
      dataset: p.supplierCategory ? 'B_has_source' : 'A_no_source' });
  }

  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/573-dryrun.json', JSON.stringify(rows, null, 2), 'utf8');

  // group AUTO_CANDIDATE by leaf
  const cand = rows.filter(r => r.reason === 'AUTO_CANDIDATE');
  const byLeaf = new Map<string, any[]>();
  for (const c of cand) { const k = `${c.targetLeaf}|${c.targetExt}`; if (!byLeaf.has(k)) byLeaf.set(k, []); byLeaf.get(k)!.push(c); }

  console.log(`573 total | A(no-source)=${rows.filter(r=>r.dataset==='A_no_source').length} B(has-source)=${rows.filter(r=>r.dataset==='B_has_source').length}`);
  console.log('Reason counts:', JSON.stringify([...reasonCount]));
  console.log(`AUTO_CANDIDATE groups: ${byLeaf.size}, products: ${cand.length}`);
  console.log('');
  // print groups sorted by size with ALL titles for verification
  for (const [k, arr] of [...byLeaf.entries()].sort((a,b)=>b[1].length-a[1].length)) {
    console.log(`\n### ${arr.length}x  ${k}  [ds=${[...new Set(arr.map(a=>a.dataset))].join(',')}]`);
    for (const r of arr) console.log(`   ${r.xmlKey} | sc=${r.supplierCategory || '(null)'} | ${String(r.title).slice(0, 95)}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
