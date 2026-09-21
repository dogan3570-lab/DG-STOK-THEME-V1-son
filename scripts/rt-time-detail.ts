// scripts/rt-time-detail.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const d = (ms: any) => ms ? new Date(Number(ms)).toISOString().slice(0, 19) : null;
async function main() {
  const ll = await prisma.listingLog.findMany({});
  console.log('LISTINGLOG (' + ll.length + '):');
  console.log(JSON.stringify(ll, null, 2).slice(0, 1200));

  const pmsTotal = await prisma.productMarketplaceState.count();
  const pmsPrice = await prisma.productMarketplaceState.count({ where: { price: { not: null } } });
  const pmsAction = await prisma.productMarketplaceState.count({ where: { lastActionAt: { not: null } } });
  const pmsStock = await prisma.productMarketplaceState.count({ where: { stock: { not: null } } });
  const pmsByStatus = await prisma.productMarketplaceState.groupBy({ by: ['status'], _count: true });
  console.log('\nPMS total=' + pmsTotal, 'price!=null=' + pmsPrice, 'lastActionAt!=null=' + pmsAction, 'stock!=null=' + pmsStock);
  console.log('PMS status:', JSON.stringify(pmsByStatus));

  // Product createdAt day histogram
  const prods = await prisma.product.findMany({ select: { createdAt: true, updatedAt: true } });
  const byDay = new Map<string, number>();
  const byDayUpd = new Map<string, number>();
  for (const p of prods) {
    const k = new Date(p.createdAt as any).toISOString().slice(0, 10); byDay.set(k, (byDay.get(k) || 0) + 1);
    const u = new Date(p.updatedAt as any).toISOString().slice(0, 10); byDayUpd.set(u, (byDayUpd.get(u) || 0) + 1);
  }
  console.log('\nProduct createdAt by day:', JSON.stringify([...byDay.entries()].sort()));
  console.log('Product updatedAt by day:', JSON.stringify([...byDayUpd.entries()].sort()));

  // AuditLog actions that look financial
  const finActions: any[] = await prisma.$queryRawUnsafe(
    "SELECT action, COUNT(*) c FROM AuditLog GROUP BY action ORDER BY c DESC LIMIT 25"
  );
  console.log('\nAuditLog top actions:', JSON.stringify(finActions));

  const runs = await prisma.xmlImportRun.findMany({ orderBy: { startedAt: 'asc' } });
  console.log('\nXmlImportRun:', JSON.stringify(runs.map(r => ({ id: r.id.slice(0, 8), startedAt: d(r.startedAt), finishedAt: d(r.finishedAt), created: (r as any).createdProducts, updated: (r as any).updatedProducts })), null, 2));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
