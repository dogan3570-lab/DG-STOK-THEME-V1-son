// scripts/rt-postfilter.ts
// READ-ONLY: post-filter classifier output, expose false positives with sample titles
import { readFileSync } from 'node:fs';

const BLACK = new Set(['silikon','firca','mayo','poset','bal','baglama','yumurta','corek','pasta','maya','sakiz','findik','pirinc','kekik','nane','zerdecal','mantar','seker hamuru','plak','sut','cikolata','lokum','helva','pekmez','zeytin','peynir','cay','kahve','sebze','meyve','tursu','salca','baharat','tahil','bakliyat','kuru gida','icecek','su','kase','tabak','bardak','kutu','aksesuar','urun','genel','diger','canta aksesuari','deri','resim','fotograf','kumas','dugme','kalem','kagit','defter','kitap','oyuncak']);
const BLACK_TOKENS = new Set(['silikon','firca','mayo','poset','bal','baglama','yumurta','corek']);

const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', 'utf8'));
const safe = data.filter((d: any) => d.safe);

const byLeaf = new Map<string, any[]>();
for (const s of safe) { const k = s.targetLeaf; if (!byLeaf.has(k)) byLeaf.set(k, []); byLeaf.get(k)!.push(s); }

const kept: Array<{ leaf: string; ext: number; rows: any[] }> = [];
for (const [leaf, rows] of byLeaf) {
  const lf = leaf.toLowerCase();
  const toks = lf.split(' ');
  if (BLACK.has(lf) || toks.some(t => BLACK_TOKENS.has(t))) continue;
  if (lf.length < 4) continue;
  kept.push({ leaf, ext: rows[0].targetExt, rows });
}
kept.sort((a, b) => b.rows.length - a.rows.length);

console.log(`AUTO_SAFE total: ${safe.length}`);
console.log(`After blacklist: ${kept.reduce((s, k) => s + k.rows.length, 0)} products across ${kept.length} leaves`);
console.log('');
for (const k of kept) {
  console.log(`### ${k.rows.length}x  ${k.leaf} (${k.ext})`);
  for (const r of k.rows.slice(0, 3)) console.log(`     ${r.xmlKey}: ${String(r.title).slice(0, 80)}`);
}
