// scripts/rt-ie41.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();
function fold(s: string): string { return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim(); }
const STOP = new Set(['ve','ile','icin','adet','cm','mm','ml','gr','kg','lt','model','urun','renk','renkli','ozel','tasarim','boyut','set','seti','x','li','lu','pratik','kolay','fonksiyonlu','amacli','cok']);
function toks(s: string): string[] { return fold(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)); }

// synonym expansion: product term -> tree search terms
const SYN: Array<[RegExp, string[]]> = [
  [/guvenlik kilidi|dolap cekmece emniyet|bebek koruma/i, ['koruyucu ve kilit','kilit','guvenlik']],
  [/mama onlugu|emzirme onlugu/i, ['mama onlugu','onluk']],
  [/mama tabagi|tabldot/i, ['mama tabagi','tabak','mama seti']],
  [/cam asir yikama torbasi|camasir yikama filesi|kirli filesi/i, ['camasir yikama topu','filesi']],
  [/huni/i, ['huni','suzgec']],
  [/kitap okuma standi|kitap standi/i, ['kitap tutucu']],
  [/dizustu destek|laptop standi/i, ['laptop sehpa']],
  [/dudak dolgun|fullips/i, ['dudak']],
  [/parmak koruyucu/i, ['parmak','koruyucu']],
  [/tuy alma|epilasyon|yayli/i, ['tuу','epilasyon','agda']],
  [/camsil|cam silme/i, ['cam silme']],
  [/termos|suluk/i, ['termos','suluk']],
  [/kalemlik|isimlik/i, ['kalemlik']],
  [/saksi/i, ['saksi']],
  [/masa ustu|masaustu/i, ['masaustu organizer','masa']],
  [/sac boyama|cicek/i, ['sac boya','cicek']],
  [/vazo/i, ['vazo']],
  [/sabun/i, ['kati sabun']],
];

async function main() {
  const tree = await loadTrendyolTree();
  const mr97 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/mr97.json','utf8'));
  const live = await prisma.product.findMany({ where: { xmlKey: { in: mr97.map((m:any)=>m.xmlKey) }, categoryId: null }, select: { xmlKey: true } });
  const liveKeys = new Set(live.map(p=>p.xmlKey));
  const remaining = mr97.filter((m:any)=>liveKeys.has(m.xmlKey));
  console.log(`mr97 total=${mr97.length} still unmatched=${remaining.length}`);

  // for each, deep search with synonym + token proximity over full tree
  const rows: any[] = [];
  for (const m of remaining) {
    const hay = fold((m.title||'') + ' ' + (m.sc||''));
    const hitLeaves = new Set<string>();
    for (const l of tree.leaves) {
      const lf = fold(l.name);
      if (lf.length < 4) continue;
      if (hay.includes(lf)) hitLeaves.add(l.name);
    }
    rows.push({ xmlKey: m.xmlKey, title: m.title, sc: m.sc, hits: [...hitLeaves] });
  }
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/ie41.json', JSON.stringify(rows,null,2),'utf8');
  console.log('\nRemaining with exact leaf-name-in-hay hits:');
  for (const r of rows) console.log(`${r.xmlKey} | hits=[${r.hits.slice(0,6).join(', ')}] | ${String(r.title).slice(0,60)}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
