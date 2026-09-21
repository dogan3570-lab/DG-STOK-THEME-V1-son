// scripts/rt-whitelist-verify.ts
// READ-ONLY: print ALL titles for candidate reliable leaves for manual verification
import { readFileSync, writeFileSync } from 'node:fs';

const RELIABLE = ['Avize','Vazo','Toka','Bere','Abajur','El Çantası','Tablet Standı','Omuz Çantası','Anahtarlık','Duvar Dekorasyon Ürünü','Yazı Tahtası','Çok Amaçlı Dolap','Led Işık','Model Bebek','Banyo Seti','Tuvalet Kağıdı','Şerit Metre'];

const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', 'utf8'));
const safe = data.filter((d: any) => d.safe);

const outLines: string[] = [];
for (const leaf of RELIABLE) {
  const rows = safe.filter((d: any) => d.targetLeaf === leaf);
  if (!rows.length) continue;
  outLines.push(`\n===== ${leaf} -> ${rows.length} products (ext=${rows[0].targetExt}) =====`);
  for (const r of rows) outLines.push(`  ${r.xmlKey} | ${r.title}`);
}
const txt = outLines.join('\n');
writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/whitelist-verify.txt', txt, 'utf8');
console.log(txt);
