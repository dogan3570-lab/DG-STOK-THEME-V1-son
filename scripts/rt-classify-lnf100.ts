// scripts/rt-classify-lnf100.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
function fold(s: string): string { return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim(); }
const STOP = new Set(['ve','ile','icin','adet','cm','mm','ml','gr','kg','lt','model','urun','renk','renkli','ozel','tasarim','boyut','set','seti','x','li','lu']);
function toks(s: string): string[] { return fold(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)); }
async function main() {
  const tree = await loadTrendyolTree();
  const rows = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-lnf-apply.json','utf8'));
  const src = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json','utf8'));
  const titleByKey = new Map<string,string>(src.map((d:any)=>[d.xmlKey, d.title]));
  const un = rows.filter((r:any)=>r.status==='UNRESOLVED').map((r:any)=>({ ...r, title: titleByKey.get(r.xmlKey) || '' }));
  const leafTok = new Set<string>();
  for (const l of tree.leaves) for (const t of toks(l.name)) leafTok.add(t);
  let hasTok = 0, noTok = 0; const out:any[]=[];
  for (const r of un) {
    const tt = toks(r.title || '');
    const hit = tt.filter(t => leafTok.has(t));
    if (hit.length) { hasTok++; out.push({ xmlKey: r.xmlKey, cls: 'AMBIGUOUS_MANUAL', hits: hit.slice(0,4), title: r.title }); }
    else { noTok++; out.push({ xmlKey: r.xmlKey, cls: 'TRUE_LEAF_NOT_FOUND', hits: [], title: r.title }); }
  }
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf100-class.json', JSON.stringify(out,null,2),'utf8');
  console.log(`UNRESOLVED=100 -> AMBIGUOUS_MANUAL (leaf-token present)=${hasTok} | TRUE_LEAF_NOT_FOUND=${noTok}`);
  console.log('\nTRUE_LEAF_NOT_FOUND samples:');
  for (const r of out.filter(x=>x.cls==='TRUE_LEAF_NOT_FOUND').slice(0,25)) console.log(`  ${r.xmlKey} | ${String(r.title).slice(0,72)}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
