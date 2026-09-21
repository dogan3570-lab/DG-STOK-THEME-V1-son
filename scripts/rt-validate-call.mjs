// scripts/rt-validate-call.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
const p = await prisma.product.findFirst({ where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] }, select: { id: true, xmlKey: true, xmlSourceId: true } });
const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
console.log(`validate for product ${p.xmlKey} (${p.id}) mp=${mp.id} src=${p.xmlSourceId}`);
const res = await fetch('http://localhost:4000/api/ready-to-ship/send/validate', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ productIds: [p.id], marketplaceId: mp.id, xmlSourceIds: [p.xmlSourceId] }),
});
const body = await res.text();
console.log('HTTP', res.status);
console.log(body.slice(0, 2000));
await prisma.$disconnect();
