// scripts/rt-validate-call2.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
// READY 4/4 with PMS status PENDING (not SENDING)
const cands = await prisma.product.findMany({
  where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }], marketplaceStates: { some: { marketplaceId: mp.id, status: 'PENDING' } }, stock: { gt: 0 } },
  select: { id: true, xmlKey: true, xmlSourceId: true, salePrice: true, stock: true }, take: 1,
});
const p = cands[0];
console.log(`candidate: ${p?.xmlKey} stock=${p?.stock} price=${p?.salePrice}`);
const res = await fetch('http://localhost:4000/api/ready-to-ship/send/validate', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ productIds: [p.id], marketplaceId: mp.id, xmlSourceIds: [p.xmlSourceId] }),
});
const body = await res.text();
console.log('HTTP', res.status);
console.log(body.slice(0, 2500));
await prisma.$disconnect();
