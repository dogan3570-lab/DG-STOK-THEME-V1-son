// scripts/rt-dl-single63b.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/final336.json','utf8'));
const singles = data.filter((d) => d.class === 'SINGLE_LEAF_PROVEN_CANDIDATE');
const dir = 'C:/Users/Dogan/AppData/Local/Temp/opencode/single63';
mkdirSync(dir, { recursive: true });
let ok=0, err=0, no=0;
for (const d of singles) {
  const p = await prisma.product.findUnique({ where: { id: d.productId }, select: { images: true } });
  const u = (p?.images || '').split(/[\s,]+/).find(x=>/^https?:\/\//.test(x));
  if (!u) { no++; continue; }
  try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) { err++; continue; } writeFileSync(`${dir}/${d.xmlKey}.jpg`, Buffer.from(await r.arrayBuffer())); ok++; } catch { err++; }
}
console.log(`downloaded=${ok} noimg=${no} err=${err}`);
await prisma.$disconnect();
