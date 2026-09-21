// scripts/rt-rts-baseline.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const w = { status: { not: 'DELETED' } };
  const total = await prisma.product.count({ where: w });
  const catMatched = await prisma.product.count({ where: { ...w, categoryMatch: true } });
  const brandMatched = await prisma.product.count({ where: { ...w, brandMatch: true } });
  const nr = await prisma.product.count({ where: { ...w, variantStatus: 'NOT_REQUIRED' } });
  const templateMatch = await prisma.product.count({ where: { ...w, templateMatch: true } });
  const statusDist = await prisma.product.groupBy({ by: ['status'], where: w, _count: true });

  const FOUR4 = { categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] };
  const A = await prisma.product.count({ where: { ...w, status: 'READY', ...FOUR4 } });
  const B = await prisma.product.count({ where: { ...w, categoryMatch: false } });
  const C = await prisma.product.count({ where: { ...w, brandMatch: false } });
  const D = await prisma.product.count({ where: { ...w, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } });
  const E = await prisma.product.count({ where: { ...w, templateMatch: false } });
  const waiting = await prisma.product.count({ where: { ...w, status: { not: 'READY' }, ...FOUR4 } });
  const blocked = await prisma.product.count({ where: { ...w, OR: [{ status: 'ERROR' }, { categoryMatch: false }, { brandMatch: false }, { templateMatch: false }, { AND: [{ variantMatch: false }, { variantStatus: { not: 'NOT_REQUIRED' } }] }] } });

  const pms = await prisma.productMarketplaceState.groupBy({ by: ['status'], _count: true });
  const pmsTotal = await prisma.productMarketplaceState.count();

  console.log('=== BASELINE ===');
  console.log(JSON.stringify({ total, catMatched, brandMatched, variantNR: nr, templateMatch }, null, 0));
  console.log('Product.status:', JSON.stringify(statusDist.map(s=>[s.status, s._count])));
  console.log('\n=== RTS GROUPS ===');
  console.log(JSON.stringify({ A_ready44: A, waiting, blocked, B_missingCategory: B, C_missingBrand: C, D_missingVariant: D, E_missingTemplate: E }));
  console.log('\n=== ProductMarketplaceState ===');
  console.log('total:', pmsTotal, 'by status:', JSON.stringify(pms.map(s=>[s.status, s._count])));

  // H: ERROR products
  const err = await prisma.productMarketplaceState.findMany({ where: { status: 'ERROR' }, select: { productId: true, marketplaceId: true, status: true, errorMessage: true }, take: 5 });
  console.log('ERROR samples:', JSON.stringify(err));
  // I: success
  const succ = await prisma.productMarketplaceState.groupBy({ by: ['status'], where: { status: { in: ['READY','SENT','SUCCESS','ACTIVE','LISTED'] } }, _count: true });
  console.log('success-like statuses:', JSON.stringify(succ.map(s=>[s.status, s._count])));
  // F: marketplace state missing (tt)
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true } });
  const withState = await prisma.productMarketplaceState.count({ where: { marketplaceId: tt!.id } });
  console.log('tt marketplace states:', withState, '| products without tt state:', total - withState);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
