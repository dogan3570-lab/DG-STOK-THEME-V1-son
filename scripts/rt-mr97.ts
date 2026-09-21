// scripts/rt-mr97.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
function fold(s: string): string { return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim(); }
const STOP = new Set(['ve','ile','icin','adet','cm','mm','ml','gr','kg','lt','model','urun','renk','renkli','ozel','tasarim','boyut','set','seti','x','li','lu','pratik','kolay','fonksiyonlu','amacli']);
function toks(s: string): string[] { return fold(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)); }
async function main() {
  const tree = await loadTrendyolTree();
  const cls = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf100-class.json','utf8'));
  const amb = cls.filter((c:any)=>c.cls==='AMBIGUOUS_MANUAL');
  const src = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json','utf8'));
  const byKey = new Map<string,any>(src.map((d:any)=>[d.xmlKey,d]));
  const mapLeaf = new Map<string, any[]>();
  for (const l of tree.leaves) for (const t of toks(l.name)) { if (!mapLeaf.has(t)) mapLeaf.set(t, []); mapLeaf.get(t)!.push(l); }
  const rows: any[] = [];
  for (const c of amb) {
    const d = byKey.get(c.xmlKey);
    const tt = toks(d.title || '');
    const cand = new Map<string, any>();
    for (const t of tt) for (const l of (mapLeaf.get(t) || [])) cand.set(l.name, l);
    rows.push({ xmlKey: c.xmlKey, title: d.title, sc: d.supplierCategory, image: d.image, hits: c.hits, cands: [...cand.keys()].slice(0,8) });
  }
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/mr97.json', JSON.stringify(rows,null,2),'utf8');
  console.log(`97 extraction: ${rows.length}`);
  for (const r of rows) console.log(`${r.xmlKey} | ${String(r.title).slice(0,66)} | cand=[${r.cands.join(', ')}]`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
