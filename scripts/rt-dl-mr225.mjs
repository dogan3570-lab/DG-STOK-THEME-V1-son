// scripts/rt-dl-mr225.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const mr = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/mr225.json', 'utf8'));
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/mr225-imgs';
mkdirSync(dir, { recursive: true });
const map = {};
let ok = 0, no = 0, err = 0;
for (const d of mr) {
  const u = d.image;
  if (!u) { no++; continue; }
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { err++; continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(`${dir}/${d.xmlKey}.jpg`, buf);
    map[d.xmlKey] = d.target;
    ok++;
  } catch { err++; }
}
writeFileSync(`${dir}/_map.json`, JSON.stringify(map, null, 2));
console.log(`downloaded=${ok} noimg=${no} err=${err}`);
