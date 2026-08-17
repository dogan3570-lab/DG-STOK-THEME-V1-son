import { prisma } from './src/db/prisma.ts';
import {
  runStockAutomation,
  STOCK_AUTO_KEYS,
} from './src/services/stockAutomation.ts';
import { updateMarketplaceInventory } from './src/services/marketplace/marketplaceApi.ts';
import { classifyHttpStatus } from './src/services/marketplace/errors.ts';
import { assertSafeApiUrl } from './src/services/marketplace/ssrfGuard.ts';

/**
 * API FAILURE RED TEAM — fail-closed kanıtı (gerçek motor + gerçek DB).
 * - HTTP durum sınıflandırması: 4xx/5xx → hata, 2xx → başarı
 * - SSRF guard: private IP engellenir (fail-closed)
 * - UNSUPPORTED marketplace (Hepsiburada) fail-closed
 * - Motor: API başarısızsa ProductMarketplaceState DEĞİŞMEZ, sahte başarı logu YAZILMAZ
 */

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const HE = '52fd366c-2ba4-4c65-8c23-bfc8239c1506'; // Hepsiburada (adapter'da inventory update YOK)

async function main() {
  // ---- HTTP durum sınıflandırması (adapter ok:true YALNIZCA gerçek 2xx) ----
  check('classify 400 → VALIDATION_ERROR (permanent, retry yok)', classifyHttpStatus(400, null).code === 'VALIDATION_ERROR' && classifyHttpStatus(400, null).retryable === false);
  check('classify 401 → CREDENTIAL_ERROR', classifyHttpStatus(401, null).code === 'CREDENTIAL_ERROR');
  check('classify 403 → CREDENTIAL_ERROR', classifyHttpStatus(403, null).code === 'CREDENTIAL_ERROR');
  check('classify 404 → RESOURCE_NOT_FOUND', classifyHttpStatus(404, null).code === 'RESOURCE_NOT_FOUND');
  check('classify 409 → DUPLICATE', classifyHttpStatus(409, null).code === 'DUPLICATE');
  check('classify 429 → RATE_LIMIT (retryable)', classifyHttpStatus(429, 5).retryable === true && classifyHttpStatus(429, 5).code === 'RATE_LIMIT');
  check('classify 500 → PROVIDER_ERROR (retryable)', classifyHttpStatus(500, null).code === 'PROVIDER_ERROR' && classifyHttpStatus(500, null).retryable === true);
  check('classify 503 → PROVIDER_ERROR', classifyHttpStatus(503, null).code === 'PROVIDER_ERROR');

  // ---- SSRF guard: private/localhost engellenir ----
  const ssrf = await assertSafeApiUrl('http://127.0.0.1:9999/x');
  check('SSRF guard → private IP engellenir (BLOCKED_IP)', ssrf.ok === false && (ssrf.reason === 'BLOCKED_IP' || ssrf.reason === 'PRIVATE_IP'), 'reason=' + ssrf.reason);

  // ---- UNSUPPORTED marketplace (Hepsiburada) ----
  const unsup = await updateMarketplaceInventory({
    marketplaceId: HE,
    payload: { barcode: 'x', sku: null, stock: 0, price: null },
  });
  check('UNSUPPORTED marketplace → ok=false + UNSUPPORTED', unsup.ok === false && unsup.error?.code === 'UNSUPPORTED', 'code=' + (unsup.error?.code));

  // ---- Motor fail-closed: gerçek Hepsiburada (adapter inventory update YOK → UNSUPPORTED) ----
  const testKey = 'stockauto-fail-' + Date.now();
  const tmpProduct = await prisma.product.create({
    data: {
      xmlKey: testKey,
      title: 'STOCKAUTO FAIL TEST',
      stock: 2,
      status: 'READY',
      purchasePrice: 10,
      salePrice: 20,
    },
  });
  const tmpState = await prisma.productMarketplaceState.create({
    data: { productId: tmpProduct.id, marketplaceId: HE, status: 'ACTIVE', stock: 5 },
  });

  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.enabled }, update: { value: 'true' }, create: { key: STOCK_AUTO_KEYS.enabled, value: 'true' } });
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.closeAt }, update: { value: '3' }, create: { key: STOCK_AUTO_KEYS.closeAt, value: '3' } });
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.openAt }, update: { value: '5' }, create: { key: STOCK_AUTO_KEYS.openAt, value: '5' } });

  const stats = await runStockAutomation();
  check('Motor API başarısızında hata sayar (errors >= 1)', stats.errors >= 1, 'errors=' + stats.errors + ' closed=' + stats.closed);

  const stateAfter = await prisma.productMarketplaceState.findUnique({ where: { id: tmpState.id } });
  check('API başarısız → DB state DEĞİŞMEDİ (hâlâ ACTIVE)', stateAfter?.status === 'ACTIVE', 'status=' + stateAfter?.status);

  const failLog = await prisma.auditLog.findFirst({
    where: { entity: 'StockAutomation', entityId: tmpState.id, action: 'STOCK_AUTO_CLOSE_FAILED' },
  });
  check('API başarısız → başarısızlık audit kaydı yazıldı (success=false)', !!failLog && failLog.success === false, 'action=' + (failLog?.action));

  const successLog = await prisma.auditLog.findFirst({
    where: { entity: 'StockAutomation', entityId: tmpState.id, action: 'STOCK_AUTO_CLOSE' },
  });
  check('API başarısız → SAHTE başarı logu YOK', successLog === null, '');

  // ---- Temizlik ----
  await prisma.auditLog.deleteMany({ where: { entity: 'StockAutomation', entityId: tmpState.id } });
  await prisma.productMarketplaceState.delete({ where: { id: tmpState.id } });
  await prisma.product.delete({ where: { id: tmpProduct.id } });
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.enabled }, update: { value: 'false' }, create: { key: STOCK_AUTO_KEYS.enabled, value: 'false' } });

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) for (const f of failures) console.log(' - ' + f);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exit(1); });
