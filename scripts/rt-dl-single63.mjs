// scripts/rt-dl-single63.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/final336.json','utf8'));
const singles = data.filter((d) => d.class === 'SINGLE_LEAF_PROVEN_CANDIDATE');
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/single63';
mkdirSync(dir, { recursive: true });
let ok=0;
for (const d of singles) {
  // fetch from API product endpoint? use stored image url not available here; fetch via DB later
  ok++;
}
console.log('singles', singles.length, 'keys', singles.map(s=>s.xmlKey).join(','));
