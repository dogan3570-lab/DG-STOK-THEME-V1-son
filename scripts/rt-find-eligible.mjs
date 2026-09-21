// scripts/rt-find-eligible.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const token = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/token.txt', 'utf8').trim();
const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
const cands = await prisma.product.findMany({
  where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }], salePrice: { gt: 0 }, stock: { gt: 0 }, marketplaceStates: { some: { marketplaceId: mp.id, status: 'PENDING' } } },
  select: { id: true, xmlKey: true, xmlSourceId: true, salePrice: true, stock: true },
  take: 40,
});
console.log(`candidates: ${cands.length}`);
const res = await fetch('http://localhost:4000/api/ready-to-ship/send/validate', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ productIds: cands.map(c => c.id), marketplaceId: mp.id, xmlSourceIds: [cands[0].xmlSourceId] }),
});
const j = await res.json();
console.log('eligibleCount:', j.eligibleCount, 'blockedCount:', j.blockedCount);
const eligible = (j.products || []).filter(x => x.eligible);
console.log('ELIGIBLE:');
for (const e of eligible.slice(0, 5)) {
  const c = cands.find(x => x.id === e.productId);
  console.log(`  xmlKey=${c?.xmlKey} id=${e.productId} price=${c?.salePrice} stock=${c?.stock} tpl=${e.templateSource}`);
}
console.log('sample blocked reasons:', JSON.stringify((j.products || []).filter(x=>!x.eligible).slice(0,3).map(x=>[x.productId.substring(0,8), x.missingGates])));
await prisma.$disconnect();
