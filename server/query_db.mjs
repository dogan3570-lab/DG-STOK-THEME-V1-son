import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check Product table
  const total = await prisma.product.count();
  const withCost = await prisma.product.count({ where: { purchasePrice: { not: null, gt: 0 } } });
  const withPrice = await prisma.product.count({ where: { salePrice: { not: null, gt: 0 } } });
  console.log("Product stats:", { total, withCost, withPrice, withoutCost: total - withCost });
  
  // Sample products
  const samples = await prisma.product.findMany({
    take: 10,
    select: { id: true, title: true, purchasePrice: true, salePrice: true, stock: true }
  });
  console.log("Sample products:", samples);
  
  // Orders
  const orderCount = await prisma.order.count();
  const orderSamples = await prisma.order.findMany({
    take: 5,
    select: { id: true, orderNo: true, total: true, status: true, marketplaceId: true }
  });
  console.log("Order count:", orderCount);
  console.log("Order samples:", orderSamples);
  
  // Marketplaces
  const mps = await prisma.marketplace.findMany({
    select: { id: true, name: true, key: true, active: true }
  });
  console.log("Marketplaces:", mps);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });