// scripts/rt-fin-verify.ts — XML→cost→listing fiyat zinciri doğrulaması (GERÇEK resolver)
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { resolveListingPrice } from '../server/src/services/listingPriceResolver.ts';

const prisma = new PrismaClient();

async function main() {
  const mp = await prisma.marketplace.findFirst({ where: { key: 'tt' }, select: { id: true, name: true, key: true } });
  const ruleRows = await prisma.marketplacePricingRule.findMany({
    where: { marketplaceId: mp!.id },
    select: { minPrice: true, maxPrice: true, profitMargin: true, fixedAmount: true, rounding: true },
    orderBy: { minPrice: 'asc' },
  });
  const rules = ruleRows.map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
  console.log('MARKETPLACE:', mp!.name, '| RULES:', JSON.stringify(rules));

  const sent = await prisma.product.findMany({
    where: { barcode: { in: ['7256195572668', '0125787001684'] } },
    select: { id: true, xmlKey: true, barcode: true, salePrice: true, purchasePrice: true, vatRate: true, title: true },
  });
  console.log('\n=== GERÇEKTEN GÖNDERİLEN 2 ÜRÜN ===');
  for (const p of sent) {
    const res = resolveListingPrice(p.salePrice, rules);
    console.log(`${p.barcode} xmlKey=${p.xmlKey} alış(salePrice)=${p.salePrice} purchasePrice=${p.purchasePrice} vat=${p.vatRate} => status=${res.status} listingPrice=${res.listingPrice} band=[${res.rule?.minPrice}-${res.rule?.maxPrice}]`);
  }

  const sample = await prisma.product.findMany({
    where: { status: { not: 'DELETED' } },
    select: { xmlKey: true, sku: true, barcode: true, salePrice: true, purchasePrice: true, vatRate: true, stock: true },
    skip: 500, take: 20,
    orderBy: { xmlKey: 'asc' },
  });
  console.log('\n=== 20 ÜRÜN UÇTAN UCA ZİNCİR ===');
  let ok = 0, fail = 0;
  for (const p of sample) {
    const res = resolveListingPrice(p.salePrice, rules);
    if (res.status === 'OK') ok++; else fail++;
    console.log(`${p.sku} | alış=${p.salePrice} | vat=${p.vatRate} | listing=${res.listingPrice} (${res.status}) | band=[${res.rule?.minPrice}-${res.rule?.maxPrice}] marj=%${res.rule?.profitMargin}`);
  }
  console.log(`\nÖZET: OK=${ok} FAIL=${fail} / 20`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
