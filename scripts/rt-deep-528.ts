// scripts/rt-deep-528.ts
// READ-ONLY deep per-product classification of the 528 remaining.
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
const TRAP_HEAD = new Set(['tampon','silikon','bal','mayo','poset','firca','baglama','metre','kutu','tel','kablo','film','boya','saksi','lif','topu','kase','tabak','kap','masa','su','cam','kagit','bez','ip','yay','kilit','kulp','stand','tutucu','aski','kafa','uc']);

// coarse domain for CONFLICT detection
const DOMAINS: Array<[RegExp, string]> = [
  [/banyo yapi|hirdavat/i,'hardware'], [/kozmetik|kisisel bakim|cilt bak/i,'cosmetic'], [/supermarket|gida|icecek|pet shop/i,'supermarket'],
  [/ev & mobilya|ev dekorasyon|mobilya/i,'home'], [/elektronik|bilgisayar|telefon/i,'electronic'], [/hediye|promosyon/i,'gift'],
  [/mutfak|beyaz esya/i,'kitchen'], [/giyim|moda/i,'clothing'], [/spor|outdoor/i,'sports'], [/oto|otomotiv/i,'auto'],
  [/kirtasiye|ofis/i,'stationery'], [/anne|bebek|cocuk|oyuncak/i,'baby'], [/bahce/i,'garden'], [/hobi|eglence/i,'hobby'],
  [/aksesuar|taki|mucevher/i,'accessory'], [/otel|restoran|cafe/i,'horeca'], [/saglik/i,'health'],
];
function domainOf(s: string): string | null { for (const [re, d] of DOMAINS) if (re.test(s)) return d; return null; }

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mappedCatIds = new Set(maps.map(m => m.categoryId));
  const leafByExt = new Map(tree.leaves.map(l => [l.externalId, l]));

  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null },
    select: { id: true, xmlKey: true, title: true, description: true, supplierCategory: true, images: true, status: true },
    orderBy: { xmlKey: 'asc' },
  });

  const rows: any[] = [];
  const reason = new Map<string, number>();

  for (const p of prods) {
    const titleFold = foldTr(p.title || '');
    const hay = foldTr((p.title || '') + ' ' + (p.supplierCategory || ''));
    const supDomain = domainOf(p.supplierCategory || '');
    const img = (p.images || '').split(/[\s,]+/).find(u => /^https?:\/\//.test(u)) || null;

    // strict phrase candidates: full folded leaf name contained in hay
    const cands: any[] = [];
    for (const l of tree.leaves) {
      const lf = foldTr(l.name);
      if (lf.length < 4) continue;
      const ltoks = tokens(l.name);
      if (ltoks.length === 0) continue;
      if (ltoks.length === 1 && GENERIC_LEAF.has(ltoks[0])) continue;
      if (!hay.includes(lf)) continue;
      const leafDomain = domainOf(l.fullPath);
      const cat = await prisma.category.findFirst({ where: { externalId: String(l.externalId) }, select: { id: true } });
      const mapped = !!cat && mappedCatIds.has(cat.id);
      const head = lf.split(' ')[0];
      const trap = ltoks.length === 1 && TRAP_HEAD.has(head);
      const conflict = !!(supDomain && leafDomain && supDomain !== leafDomain);
      cands.push({ name: l.name, ext: l.externalId, path: l.fullPath, leafDomain, mapped, trap, conflict, catId: cat?.id ?? null });
    }

    // prefer non-conflict, non-trap, mapped
    cands.sort((a, b) => (Number(b.mapped) - Number(a.mapped)) || (Number(a.trap) - Number(b.trap)) || (Number(a.conflict) - Number(b.conflict)));

    let cls: string, chosen: any = null, note = '';
    const conflicting = cands.filter(c => c.conflict);
    const usable = cands.filter(c => !c.conflict && c.mapped);

    if (cands.length === 0) { cls = 'LEAF_NOT_FOUND'; }
    else if (conflicting.length && !usable.length) { cls = 'CONFLICT'; chosen = conflicting[0]; }
    else if (usable.length === 0) { cls = 'NO_MATCH'; }
    else {
      const top = usable[0];
      const second = usable[1];
      // ambiguity: two different leaf names share same prefix/score domain
      const ambiguous = usable.length > 1 && usable[0].name.toLowerCase().slice(0, 6) !== usable[1].name.toLowerCase().slice(0, 6);
      if (top.trap) { cls = 'MANUAL_REVIEW'; chosen = top; note = 'trap_head'; }
      else if (ambiguous && usable.length > 1) { cls = 'MANUAL_REVIEW'; chosen = top; note = `ambiguous (${top.name} vs ${usable[1].name})`; }
      else { cls = 'AUTO_SAFE'; chosen = top; }
    }

    reason.set(cls, (reason.get(cls) || 0) + 1);
    rows.push({ productId: p.id, xmlKey: p.xmlKey, dataset: p.supplierCategory ? 'B' : 'A', title: p.title,
      supplierCategory: p.supplierCategory, visualEvidence: !!img, image: img,
      decision: cls, target: chosen?.name ?? null, targetExt: chosen?.ext ?? null, targetCatId: chosen?.catId ?? null,
      targetPath: chosen?.path ?? null, isLeaf: !!chosen, mapping: !!chosen?.mapped, note,
      altCandidates: cands.slice(0, 5).map(c => `${c.name}|${c.conflict?'CONFLICT':''}${c.trap?'TRAP':''}${c.mapped?'':'-map'}`) });
  }

  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/deep-528.json', JSON.stringify(rows, null, 2), 'utf8');
  console.log('A:', rows.filter(r=>r.dataset==='A').length, 'B:', rows.filter(r=>r.dataset==='B').length);
  console.log('Decision counts:', JSON.stringify([...reason]));
  const auto = rows.filter(r => r.decision === 'AUTO_SAFE');
  console.log('');
  console.log(`AUTO_SAFE: ${auto.length}`);
  for (const a of auto) console.log(`  ${a.xmlKey} [${a.dataset}] ${a.target}(${a.targetExt}) | ${String(a.title).slice(0,75)}`);
  console.log('');
  console.log('CONFLICT:', rows.filter(r=>r.decision==='CONFLICT').length);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
