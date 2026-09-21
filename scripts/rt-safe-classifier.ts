// scripts/rt-safe-classifier.ts
// READ-ONLY: strict AUTO_SAFE classifier over the 728. Locks criteria.
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { resolveCategoryCandidates } from '../server/src/services/categoryCanonical.ts';
import { writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}
const STOP = new Set(['ve','ile','icin','için','adet','cm','mm','ml','gr','kg','lt','model','urun','ürün','urunu','renk','renkli','ozel','özel','tasarim','tasarım','boyut','buyuk','büyük','kucuk','küçük','set','seti','the','and','for','with','x','li','lİ','2li','3lu']);
function tokens(s: string): string[] {
  return foldTr(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}
// Ambiguous tokens that are lexical traps across domains
const TRAP = new Set(['tampon','silikon','bal','mayo','baglama','poset','firca','kablo','kutu','tel','sise','kase','tabak','kap','masa','saksi','kulp','askilik','tutucu','stand','aski','su','film','boya','lif','topu','yastik','ortu','kemer']);
const GENERIC_LEAF = new Set(['diger','digerleri','genel','aksesuar','aksesuarlar','urun','urunler','set','seti','cesitleri','malzemeleri']);

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();

  const df = new Map<string, number>();
  const leafTokens = new Map<string, Set<string>>();
  for (const l of tree.leaves) {
    const ts = new Set(tokens(l.fullPath));
    leafTokens.set(l.id, ts);
    for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = tree.leaves.length;
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) || 0)));

  function evaluate(p: { title: string | null; supplierCategory: string | null; description?: string | null }) {
    const titleTokens = new Set(tokens(p.title || ''));
    const supSegs = (p.supplierCategory || '').split('>').map(s => s.trim()).filter(Boolean);
    for (const t of tokens(p.supplierCategory || '')) titleTokens.add(t);
    const titleFold = foldTr((p.title || '') + ' ' + (p.supplierCategory || ''));

    if (titleTokens.size === 0) return { safe: false, reason: 'NO_DATA' as const, leaf: null, score: 0, second: 0, evidence: '' };

    const scored: Array<{ leaf: any; score: number; ev: string; leafToks: string[]; matched: string[]; trapOnly: boolean }> = [];
    for (const l of tree.leaves) {
      const lNameFold = foldTr(l.name);
      if (lNameFold.length < 4) continue;
      const ltoks = tokens(l.name);
      if (ltoks.length === 0) continue;
      if (ltoks.length === 1 && GENERIC_LEAF.has(ltoks[0])) continue;

      let accept = false; let ev = ''; let trapOnly = false;
      const matched = ltoks.filter(t => titleTokens.has(t));

      if (titleFold.includes(lNameFold)) { accept = true; ev = 'NAME_IN_TITLE'; }
      else if (matched.length === ltoks.length && ltoks.length >= 1 && matched.some(t => idf(t) > 1.0)) {
        accept = true; ev = 'ALL_TOKENS'; trapOnly = matched.every(t => TRAP.has(t));
        // trap-only: require path-domain overlap with title (a non-leaf-name path token present in title)
        if (trapOnly) {
          const pathToks = tokens(l.fullPath).filter(t => !ltoks.includes(t));
          if (!pathToks.some(t => titleTokens.has(t))) { accept = false; ev = 'TRAP_NO_DOMAIN'; }
        }
      }
      if (!accept) continue;
      // real leaf already guaranteed (tree.leaves)
      const score = Number(matched.reduce((s, t) => s + idf(t), 0).toFixed(3));
      scored.push({ leaf: l, score, ev, leafToks: ltoks, matched, trapOnly });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { safe: false, reason: 'LEAF_NOT_FOUND' as const, leaf: null, score: 0, second: 0, evidence: '' };
    const best = scored[0];
    const second = scored[1]?.score ?? 0;
    const margin = best.score > 0 ? (best.score - second) / best.score : 0;
    if (scored.length > 1 && margin < 0.25) {
      return { safe: false, reason: 'AMBIGUOUS' as const, leaf: null, score: best.score, second, evidence: `best=${best.leaf.name} vs ${scored[1].leaf.name}` };
    }
    return { safe: true, reason: 'AUTO_SAFE' as const, leaf: best.leaf, score: best.score, second, evidence: best.ev };
  }

  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, description: true, images: true, status: true },
    orderBy: { xmlKey: 'asc' },
  });

  const out: any[] = [];
  const reasonCount = new Map<string, number>();
  for (const p of prods) {
    const r = evaluate(p);
    reasonCount.set(r.reason, (reasonCount.get(r.reason) || 0) + 1);
    out.push({ productId: p.id, xmlKey: p.xmlKey, safe: r.safe, reason: r.reason,
      targetLeaf: r.leaf ? r.leaf.name : null, targetId: r.leaf ? r.leaf.id : null, targetExt: r.leaf ? r.leaf.externalId : null,
      targetPath: r.leaf ? r.leaf.fullPath : null, score: r.score, evidence: r.evidence,
      supplierCategory: p.supplierCategory, title: p.title });
  }

  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('REASON DISTRIBUTION (728):', JSON.stringify([...reasonCount]));
  console.log('');
  const safe = out.filter(o => o.safe);
  console.log(`AUTO_SAFE: ${safe.length}`);
  const byLeaf = new Map<string, any[]>();
  for (const s of safe) { const k = `${s.targetLeaf} (${s.targetExt})`; if (!byLeaf.has(k)) byLeaf.set(k, []); byLeaf.get(k)!.push(s); }
  for (const [k, arr] of [...byLeaf.entries()].sort((a,b)=>b[1].length-a[1].length)) {
    console.log(`  ${arr.length.toString().padStart(3)}x  ${k}`);
  }
  console.log('');
  console.log('LEAF_NOT_FOUND reason breakdown:');
  const lnf = out.filter(o => o.reason === 'LEAF_NOT_FOUND');
  console.log(`  ${lnf.length} products`);
  // show top supplier categories among LEAF_NOT_FOUND
  const scMap = new Map<string, number>();
  for (const o of lnf) scMap.set(o.supplierCategory || '(null)', (scMap.get(o.supplierCategory || '(null)') || 0) + 1);
  for (const [k, v] of [...scMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15)) console.log(`    ${v}x ${k}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
