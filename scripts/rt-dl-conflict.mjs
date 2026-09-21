// scripts/rt-dl-conflict.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/conflict85.json', 'utf8'));
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/conflict85-imgs';
mkdirSync(dir, { recursive: true });
let ok = 0, no = 0, err = 0;
for (const d of c) {
  if (!d.image) { no++; continue; }
  try {
    const r = await fetch(d.image, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { err++; continue; }
    writeFileSync(`${dir}/${d.xmlKey}.jpg`, Buffer.from(await r.arrayBuffer()));
    ok++;
  } catch { err++; }
}
console.log(`downloaded=${ok} noimg=${no} err=${err}`);
