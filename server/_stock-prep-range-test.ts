import { prisma } from './src/db/prisma.ts';
import {
  STOCK_AUTO_KEYS,
  getStockAutomationConfig,
  isWithinPrepRange,
  DEFAULT_STOCK_AUTO_CONFIG,
} from './src/services/stockAutomation.ts';

/**
 * ÜRÜN HAZIRLAMA MIN/MAX — gerçek DB/config + gerçek isWithinPrepRange ile doğrulama.
 * prepMin=5, prepMax=100:
 *   0 → dışı, 4 → dışı, 5 → dahil, 50 → dahil, 100 → dahil, 101 → dışı
 */
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  // Test öncesi değerleri sakla
  const before = await getStockAutomationConfig();

  // Config'i gerçek DB'ye yaz (Setting upsert — migration/schema yok)
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.prepMin }, update: { value: '5' }, create: { key: STOCK_AUTO_KEYS.prepMin, value: '5' } });
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.prepMax }, update: { value: '100' }, create: { key: STOCK_AUTO_KEYS.prepMax, value: '100' } });

  // Gerçek DB'den oku (getStockAutomationConfig → prisma.setting)
  const cfg = await getStockAutomationConfig();
  check('DB config prepMin=5 okundu', cfg.prepMin === 5, 'prepMin=' + cfg.prepMin);
  check('DB config prepMax=100 okundu', cfg.prepMax === 100, 'prepMax=' + cfg.prepMax);

  // Gerçek isWithinPrepRange ile sınır değerleri
  check('stok 0 → hazırlama DIŞI', isWithinPrepRange(0, cfg.prepMin, cfg.prepMax) === false, '');
  check('stok 4 → hazırlama DIŞI', isWithinPrepRange(4, cfg.prepMin, cfg.prepMax) === false, '');
  check('stok 5 → hazırlama DAHİL (alt sınır)', isWithinPrepRange(5, cfg.prepMin, cfg.prepMax) === true, '');
  check('stok 50 → hazırlama DAHİL', isWithinPrepRange(50, cfg.prepMin, cfg.prepMax) === true, '');
  check('stok 100 → hazırlama DAHİL (üst sınır)', isWithinPrepRange(100, cfg.prepMin, cfg.prepMax) === true, '');
  check('stok 101 → hazırlama DIŞI', isWithinPrepRange(101, cfg.prepMin, cfg.prepMax) === false, '');

  // DB Setting satırlarının gerçek değerlerini doğrudan doğrula
  const rows = await prisma.setting.findMany({ where: { key: { in: [STOCK_AUTO_KEYS.prepMin, STOCK_AUTO_KEYS.prepMax] } } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  check('DB Setting satırı prepMin=5', map[STOCK_AUTO_KEYS.prepMin] === '5', map[STOCK_AUTO_KEYS.prepMin]);
  check('DB Setting satırı prepMax=100', map[STOCK_AUTO_KEYS.prepMax] === '100', map[STOCK_AUTO_KEYS.prepMax]);

  // Geri yükle (test öncesi değerler)
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.prepMin }, update: { value: String(before.prepMin) }, create: { key: STOCK_AUTO_KEYS.prepMin, value: String(before.prepMin) } });
  await prisma.setting.upsert({ where: { key: STOCK_AUTO_KEYS.prepMax }, update: { value: String(before.prepMax) }, create: { key: STOCK_AUTO_KEYS.prepMax, value: String(before.prepMax) } });
  const after = await getStockAutomationConfig();
  check('Config geri yüklendi (prepMin=' + DEFAULT_STOCK_AUTO_CONFIG.prepMin + ' prepMax=' + DEFAULT_STOCK_AUTO_CONFIG.prepMax + ')', after.prepMin === before.prepMin && after.prepMax === before.prepMax, `prep=${after.prepMin}-${after.prepMax}`);

  await prisma.$disconnect();
  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) for (const f of failures) console.log(' - ' + f);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exit(1); });
