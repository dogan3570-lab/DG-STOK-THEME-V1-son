// scripts/rt-send-real.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
const xmlKey = process.argv[2];
const p = await prisma.product.findUnique({ where: { xmlKey }, select: { id: true, xmlKey: true, xmlSourceId: true, salePrice: true, stock: true } });
const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
const before = await prisma.productMarketplaceState.findFirst({ where: { productId: p.id, marketplaceId: mp.id }, select: { status: true, listingId: true, errorMessage: true, lastActionAt: true } });
console.log(`BEFORE: product=${p.xmlKey} (${p.id}) price=${p.salePrice} stock=${p.stock} pms=${JSON.stringify(before)}`);

const res = await fetch('http://localhost:4000/api/ready-to-ship/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ productIds: [p.id], marketplaceId: mp.id, xmlSourceIds: [p.xmlSourceId] }),
});
const jres = await res.json();
console.log(`SEND HTTP ${res.status}:`, JSON.stringify(jres));
const jobId = jres.jobId;
if (!jobId) { console.log('NO JOB — abort'); await prisma.$disconnect(); process.exit(0); }

console.log('waiting for dispatch job...');
let final = null;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const jr = await fetch(`http://localhost:4000/api/ready-to-ship/jobs/${jobId}`, { headers: { Authorization: 'Bearer ' + token } });
  const jb = await jr.json();
  const st = jb.job?.status;
  if (i % 3 === 0) console.log(`  [${i*3}s] jobStatus=${st} progress=${jb.job?.processedCount ?? '?'}/${jb.job?.totalCount ?? '?'}`);
  if (st === 'completed' || st === 'failed' || st === 'COMPLETED' || st === 'FAILED') { final = jb.job; break; }
}
console.log('FINAL JOB:', JSON.stringify(final, null, 2).slice(0, 2500));

const after = await prisma.productMarketplaceState.findFirst({ where: { productId: p.id, marketplaceId: mp.id }, select: { status: true, listingId: true, listingUrl: true, errorMessage: true, lastActionAt: true } });
console.log('AFTER PMS:', JSON.stringify(after));
await prisma.$disconnect();
