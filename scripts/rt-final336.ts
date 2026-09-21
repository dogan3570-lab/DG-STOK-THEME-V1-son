// scripts/rt-final336.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
function fold(s: string): string { return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim(); }
const STOP = new Set(['ve','ile','icin','adet','cm','mm','ml','gr','kg','lt','model','urun','renk','renkli','ozel','tasarim','boyut','set','seti','x','li','lu','pratik','kolay','fonksiyonlu','amacli','cok','mini','buyuk','kucuk','yeni']);
function toks(s: string): string[] { return fold(s).split(' ').filter(t => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t)); }
const GENERIC = new Set(['urun','urunler','aksesuar','genel','diger','malzeme','parca','aparat','alet','set','takim','dekoratif','plastik','metal']);
async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true, externalId: true } });
  const mappedExt = new Set(maps.map(m => Number(m.externalId)));
  const catByExt = new Map<number,string>();
  for (const c of await prisma.category.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true } })) catByExt.set(Number(c.externalId), c.id);
  const leafById = new Map(tree.leaves.map(l=>[l.id,l]));

  const prods = await prisma.product.findMany({ where: { categoryId: null, status: { not: 'DELETED' } }, select: { id: true, xmlKey: true, title: true, description: true, supplierCategory: true, images: true }, orderBy: { xmlKey: 'asc' } });
  console.log(`remaining unmatched: ${prods.length}`);

  const out: any[] = [];
  const counts = new Map<string, number>();
  for (const p of prods) {
    const hay = fold((p.title || '') + ' ' + (p.supplierCategory || ''));
    const titleT = new Set(toks(p.title || ''));
    const cands: Array<{ leaf:any; how:string }> = [];
    for (const l of tree.leaves) {
      if (!(l.externalId > 0) || !mappedExt.has(l.externalId)) continue;
      const lf = fold(l.name);
      if (lf.length < 4) continue;
      const lt = toks(l.name);
      if (lt.length === 0 || (lt.length === 1 && GENERIC.has(lt[0]))) continue;
      let how = '';
      if (hay.includes(lf)) how = 'NAME';
      else if (lt.length >= 2 && lt.every(t => titleT.has(t))) how = 'TOKENS';
      else if (lt.length === 1 && titleT.has(lt[0])) how = 'HEAD';
      if (how) cands.push({ leaf: l, how });
    }
    // dedup by leaf id
    const uniq = [...new Map(cands.map(c=>[c.leaf.id,c])).values()];
    let cls: string;
    if (uniq.length === 0) {
      const anyTok = toks(p.title||'').length > 0;
      cls = anyTok ? 'TRUE_NO_VALID_LEAF' : 'STILL_INSUFFICIENT';
    } else if (uniq.length === 1) cls = 'SINGLE_LEAF_PROVEN_CANDIDATE';
    else cls = 'MULTIPLE_STILL_VALID';
    counts.set(cls, (counts.get(cls)||0)+1);
    out.push({ xmlKey: p.xmlKey, productId: p.id, title: p.title, sc: p.supplierCategory, class: cls,
      cands: uniq.slice(0,5).map(c=>`${c.leaf.name}|${c.leaf.externalId}|${c.how}`) });
  }
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/final336.json', JSON.stringify(out,null,2),'utf8');
  console.log('CLASS COUNTS:', JSON.stringify([...counts]));
  console.log('\nSINGLE_LEAF_PROVEN_CANDIDATE list:');
  for (const r of out.filter(x=>x.class==='SINGLE_LEAF_PROVEN_CANDIDATE')) console.log(`  ${r.xmlKey} | ${r.cands[0]} | ${String(r.title).slice(0,70)}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
