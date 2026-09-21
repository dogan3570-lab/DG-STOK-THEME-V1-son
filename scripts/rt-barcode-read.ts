// scripts/rt-barcode-read.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  for (const id of ['00490a23-5441-4f09-bce1-d26e95d48b77', '006639df-c61b-41f3-8621-b9c3476aaeaf']) {
    const p = await prisma.product.findUnique({
      where: { id },
      select: { id: true, xmlKey: true, title: true, barcode: true, sku: true, xmlSourceId: true },
    });
    const states = await prisma.productMarketplaceState.findMany({
      where: { productId: id },
      select: { marketplaceId: true, status: true, externalRef: true, errorMessage: true, lastActionAt: true, listingId: true },
    });
    const mps = await prisma.marketplace.findMany({ select: { id: true, key: true, name: true } });
    const mpMap = new Map(mps.map(m => [m.id, m.key]));
    console.log(JSON.stringify({ product: p, states: states.map(s => ({ ...s, marketplaceKey: mpMap.get(s.marketplaceId) })) }, null, 2));
    console.log('---');
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
