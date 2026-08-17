// LISTING PRICE RULE — FINAL CLOSURE AUDIT (READ-ONLY)
// DB'deki MarketplacePricingRule kayıtlarını tüm alanlarıyla inceler.
// HİÇBİR kayıt oluşturmaz, güncellemez, silmez.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function ruleTypeOf(r) {
  if (r.productId) return 'PRODUCT';
  if (r.categoryId) return 'CATEGORY';
  if (r.xmlSourceId) return 'XML';
  return 'GENERAL';
}

(async () => {
  console.log('================ MARKETPLACE LISTESI ================');
  const mps = await prisma.marketplace.findMany({ orderBy: { createdAt: 'asc' } });
  for (const m of mps) {
    console.log(`${m.key.padEnd(12)} id=${m.id} name=${m.name} active=${m.active}`);
  }

  console.log('\n================ XML SOURCE LISTESI ================');
  const xss = await prisma.xmlSource.findMany({ orderBy: { createdAt: 'asc' } });
  for (const x of xss) {
    console.log(`${(x.name || '').padEnd(24)} id=${x.id} active=${x.active} vatStatus=${x.purchasePriceVatStatus} vat=${x.vatRate}`);
  }

  console.log('\n================ MARKETPLACEPRICINGRULE (TUMU) ================');
  const rules = await prisma.marketplacePricingRule.findMany({ orderBy: [{ marketplaceId: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }] });
  console.log('TOPLAM KURAL:', rules.length);
  for (const r of rules) {
    const mp = mps.find((m) => m.id === r.marketplaceId);
    const xs = r.xmlSourceId ? xss.find((x) => x.id === r.xmlSourceId) : null;
    let product = null;
    let category = null;
    if (r.productId) product = await prisma.product.findUnique({ where: { id: r.productId }, select: { id: true, title: true, sku: true, barcode: true, xmlKey: true, xmlSourceId: true, status: true } });
    if (r.categoryId) category = await prisma.category.findUnique({ where: { id: r.categoryId }, select: { id: true, name: true } });
    console.log('---');
    console.log('  id            : ' + r.id);
    console.log('  ruleType      : ' + ruleTypeOf(r));
    console.log('  marketplace   : ' + (mp ? `${mp.key} (${mp.name})` : r.marketplaceId));
    console.log('  xmlSource     : ' + (xs ? `${xs.name}` : (r.xmlSourceId ? r.xmlSourceId + ' (BULUNAMADI)' : 'null')));
    console.log('  productId     : ' + (r.productId || 'null') + (product ? ` => ${product.title || ''} sku=${product.sku || '-'} status=${product.status}` : (r.productId ? ' (URUN YOK)' : '')));
    console.log('  categoryId    : ' + (r.categoryId || 'null') + (category ? ` => ${category.name}` : (r.categoryId ? ' (KATEGORI YOK)' : '')));
    console.log('  minPrice      : ' + r.minPrice);
    console.log('  maxPrice      : ' + r.maxPrice);
    console.log('  profitMargin  : ' + r.profitMargin);
    console.log('  fixedAmount   : ' + r.fixedAmount);
    console.log('  rounding      : ' + r.rounding);
    console.log('  applyVat      : ' + r.applyVat);
    console.log('  active        : ' + r.active);
    console.log('  priority      : ' + r.priority);
    console.log('  createdAt     : ' + r.createdAt.toISOString());
    console.log('  updatedAt     : ' + r.updatedAt.toISOString());
  }

  console.log('\n================ LISTINGLOG (son 40) ================');
  const logs = await prisma.listingLog.findMany({ orderBy: { createdAt: 'desc' }, take: 40 });
  console.log('ListingLog toplam kayit (son 40 gosteriliyor):');
  for (const l of logs) {
    console.log(`${l.createdAt.toISOString()} ruleId=${l.ruleId || 'null'} ruleType=${l.ruleType} vatIncluded=${l.vatIncludedPrice} margin=${l.profitMargin} calc=${l.calculatedPrice} status=${l.status}`);
  }
  const logCount = await prisma.listingLog.count();
  const logRuleIds = await prisma.listingLog.groupBy({ by: ['ruleId', 'ruleType'], _count: { _all: true } });
  console.log('\nListingLog TOPLAM:', logCount);
  console.log('ListingLog ruleId dagilimi:');
  for (const g of logRuleIds) console.log('  ruleId=' + (g.ruleId || 'null') + ' ruleType=' + g.ruleType + ' count=' + g._count._all);

  console.log('\n================ AUDITLOG (pricingRule/listing iliskili) ================');
  const audit = await prisma.auditLog.findMany({
    where: { OR: [{ entity: { contains: 'ricing' } }, { entity: { contains: 'isting' } }, { action: { contains: 'listing' } }, { action: { contains: 'ricing' } }] },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  console.log('AuditLog iliskili kayit:', audit.length);
  for (const a of audit) {
    console.log(`${a.createdAt.toISOString()} actor=${a.actorUserId || '-'} action=${a.action} entity=${a.entity || '-'} entityId=${a.entityId || '-'} success=${a.success} meta=${(a.meta || '').slice(0, 120)}`);
  }

  await prisma.$disconnect();
})().catch(async (e) => { console.error('AUDIT ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
