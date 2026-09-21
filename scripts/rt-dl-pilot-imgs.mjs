// scripts/rt-dl-pilot-imgs.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const json = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/pilot-30.json', 'utf8'));
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/pilot-imgs';
mkdirSync(dir, { recursive: true });
for (const p of json) {
  const u = p.image;
  if (!u) { console.log('NOIMG', p.xmlKey); continue; }
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.log('HTTP', r.status, p.xmlKey); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(`${dir}/${p.xmlKey}.jpg`, buf);
    console.log('OK', p.xmlKey, buf.length, 'bytes');
  } catch (e) { console.log('ERR', p.xmlKey, String(e).slice(0, 60)); }
}
