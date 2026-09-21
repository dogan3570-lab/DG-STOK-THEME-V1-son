// scripts/rt-dl-lnf.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const l = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192.json', 'utf8'));
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/lnf192-imgs';
mkdirSync(dir, { recursive: true });
let ok = 0;
for (const d of l) {
  if (!d.image) continue;
  try { const r = await fetch(d.image, { signal: AbortSignal.timeout(20000) }); if (!r.ok) continue; writeFileSync(`${dir}/${d.xmlKey}.jpg`, Buffer.from(await r.arrayBuffer())); ok++; } catch {}
}
console.log('downloaded', ok);
