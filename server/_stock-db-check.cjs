// DG STOK — DB KALINTI KONTROLÜ (test ürün/state/audit yok, pricingRules=3 korunur).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OUT = [];
function ok(label, pass, extra) { OUT.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + label + (extra ? ' | ' + extra : '')); }

(async () => {
  const testProducts = await prisma.product.count({ where: { OR: [{ xmlKey: { startsWith: 'stockauto-fail-' } }, { title: 'STOCKAUTO FAIL TEST' }] } });
  ok('Test ürün kalıntısı yok', testProducts === 0, 'count=' + testProducts);

  const testStates = await prisma.productMarketplaceState.count({
    where: { product: { OR: [{ xmlKey: { startsWith: 'stockauto-fail-' } }, { title: 'STOCKAUTO FAIL TEST' }] } },
  });
  ok('Test marketplace state kalıntısı yok', testStates === 0, 'count=' + testStates);

  const testAudits = await prisma.auditLog.count({ where: { entity: 'StockAutomation', action: { in: ['STOCK_AUTO_CLOSE_FAILED', 'STOCK_AUTO_CLOSE', 'STOCK_AUTO_OPEN'] } } });
  ok('Test audit kalıntısı yok (fail test auditleri temizlendi)', testAudits === 0, 'count=' + testAudits);

  // Gerçek fiyat kuralları korunmalı (pricingRules = 3)
  const pricingRules = await prisma.marketplacePricingRule.count();
  ok('Mevcut gerçek fiyat kuralları korunuyor (pricingRules = 3)', pricingRules === 3, 'count=' + pricingRules);

  // Config son durumu (go-live)
  const keys = ['stockAuto.enabled', 'stockAuto.closeAt', 'stockAuto.openAt', 'stockAuto.prepMin', 'stockAuto.prepMax'];
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  ok('Config go-live (enabled=true close=3 open=5 prep=1-999999)', map['stockAuto.enabled'] === 'true' && map['stockAuto.closeAt'] === '3' && map['stockAuto.openAt'] === '5' && map['stockAuto.prepMin'] === '1' && map['stockAuto.prepMax'] === '999999', JSON.stringify(map));

  await prisma.$disconnect();
  const fails = OUT.filter(x => !x).length;
  console.log('\n=== STOCK DB CHECK: ' + (OUT.length - fails) + '/' + OUT.length + ' PASS ===');
  process.exitCode = fails === 0 ? 0 : 1;
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exitCode = 1; });
