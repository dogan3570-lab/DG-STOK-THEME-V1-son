import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  // Full pricing rule details
  const rules = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: MP, active: true },
    orderBy: { minPrice: 'asc' },
  });
  console.log('=== MEVCUT PRICING RULELAR ===');
  for (const r of rules) {
    console.log(`  id=${r.id} | min=${r.minPrice} max=${r.maxPrice} | margin=${r.profitMargin}% fixed=${r.fixedAmount} | rounding=${r.rounding} | xmlSource=${r.xmlSourceId} | priority=${r.priority} | vat=${r.applyVat}`);
  }

  // 21 blocked products - get their exact salePrice
  const blockedIds = [
    '49d591b9-d1b9-4eb2-a739-40d798d0669a','cbecc681-8e6b-45ad-a199-14df00da63e7',
    '429f6352-7277-4f32-a718-7c2777c26312','a176dbc7-95c1-477a-b132-e59e2a0b7df9',
    '01f127bd-2052-4b75-b62e-33f4fb4f3064','831719f8-dd75-4a1a-b1a9-b2a999f01f7c',
    '69ffa09d-fbe0-4514-8811-56aefbb25fa1','567354a4-677b-4414-b230-bf248555c2a1',
    '65440352-fa8a-4185-96a4-8614fee8e510','614dbe13-4100-4b88-b479-ab4aeb3cae9f',
    '870c5be4-6fe9-47fa-a4e8-5b9b26d66c0e','a9b863a8-e8bc-4cf0-822d-f08f9a08e13b',
    '8496f336-ce42-40de-80c4-df055d3275d5','c1034ed5-ec09-4cf3-9521-7b308d7e14a9',
    'c4e810c3-d766-42f0-9a53-0bf6f167b3d6','271ddbec-5cd7-41b4-a037-ad6319448bb1',
    '34743225-d4f6-4cce-97ec-7edba203ae03','11bb31b0-5d2d-460a-837a-938d6e4a21c7',
    'd455aab4-ca3a-49dc-9a75-97d4a4555bc4','a79fdd5c-b171-4c36-af00-97f77dccf449',
    '71c465ba-6bde-4f7b-b51a-d3db99da9ac5',
  ];
  const products = await prisma.product.findMany({
    where: { id: { in: blockedIds } },
    select: { id: true, salePrice: true, xmlSourceId: true, title: true },
  });
  console.log('\n=== 21 BLOKLI FİYAT ÜRÜNÜ ===');
  for (const p of products) {
    console.log(`  ${p.id} | salePrice=${p.salePrice} | xmlSource=${p.xmlSourceId}`);
  }

  // Min price that would cover all 21
  const prices = products.map(p => p.salePrice!).filter(Boolean).sort((a, b) => a - b);
  console.log('\nFiyat aralığı:', prices[0], '-', prices[prices.length - 1]);
  console.log('Minimum gerekli minPrice:', Math.floor(prices[0]));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
