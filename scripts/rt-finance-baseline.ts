// scripts/rt-finance-baseline.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const ppNonNull = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: { not: null } } });
  const ppPos = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: { gt: 0 } } });
  const ppZero = await prisma.product.count({ where: { status: { not: 'DELETED' }, purchasePrice: { lte: 0 } } });
  console.log('PRODUCTS:', JSON.stringify({ total, purchasePriceNonNull: ppNonNull, purchasePricePos: ppPos, purchasePriceZeroOrNull: ppZero }));
  let orderCount = 0, orderModel = 'none';
  try { orderCount = await prisma.order.count(); orderModel = 'Order'; } catch (e) { orderModel = 'ERR ' + String(e).slice(0, 60); }
  console.log('Order count:', orderCount, '(', orderModel, ')');
  // sample product cost fields
  const s = await prisma.product.findFirst({ where: { purchasePrice: { gt: 0 } }, select: { xmlKey: true, purchasePrice: true, salePrice: true, vatRate: true } });
  console.log('sample product:', JSON.stringify(s));
  // MarketplacePricingRule
  const rules = await prisma.marketplacePricingRule.findMany({ select: { minPrice: true, maxPrice: true, profitMargin: true, fixedAmount: true, applyVat: true, marketplaceId: true } });
  console.log('pricing rules:', JSON.stringify(rules));
  // orders model fields
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
