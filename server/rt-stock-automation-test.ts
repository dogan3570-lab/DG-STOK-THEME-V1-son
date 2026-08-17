import { decideSalesAction, isWithinPrepRange } from './src/services/stockAutomation.ts';

/**
 * GLOBAL STOK OTOMASYONU — saf histerezis motoru testi.
 * closeAt=3, openAt=5. Zorunlu akış:
 *   10→OPEN, 5→OPEN, 4→HOLD(OPEN), 3→CLOSE, 2→CLOSED, 1→CLOSED, 0→CLOSED,
 *   4→HOLD(CLOSED), 5→OPEN, 6→OPEN
 */
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const CLOSE = 3;
const OPEN = 5;

// Kullanıcının verdiği örnek akış (durum geçişleriyle)
check('10 (AÇIK) → HOLD', decideSalesAction(10, CLOSE, OPEN, 'OPEN') === 'HOLD');
check('5 (AÇIK) → HOLD', decideSalesAction(5, CLOSE, OPEN, 'OPEN') === 'HOLD');
check('4 (AÇIK) → HOLD (mevcut korunur)', decideSalesAction(4, CLOSE, OPEN, 'OPEN') === 'HOLD');
check('3 (AÇIK) → CLOSE', decideSalesAction(3, CLOSE, OPEN, 'OPEN') === 'CLOSE');
check('2 (KAPALI) → HOLD', decideSalesAction(2, CLOSE, OPEN, 'CLOSED') === 'HOLD');
check('1 (KAPALI) → HOLD', decideSalesAction(1, CLOSE, OPEN, 'CLOSED') === 'HOLD');
check('0 (KAPALI) → HOLD', decideSalesAction(0, CLOSE, OPEN, 'CLOSED') === 'HOLD');
check('4 (KAPALI) → HOLD (3↔4 arası çakır yok)', decideSalesAction(4, CLOSE, OPEN, 'CLOSED') === 'HOLD');
check('5 (KAPALI) → OPEN', decideSalesAction(5, CLOSE, OPEN, 'CLOSED') === 'OPEN');
check('6 (AÇIK) → HOLD', decideSalesAction(6, CLOSE, OPEN, 'OPEN') === 'HOLD');

// Sınır değerler
check('3 (KAPALI) → HOLD (zaten kapalı, tekrar kapatma yok)', decideSalesAction(3, CLOSE, OPEN, 'CLOSED') === 'HOLD');
check('5 (AÇIK) → HOLD (zaten açık, tekrar açma yok)', decideSalesAction(5, CLOSE, OPEN, 'OPEN') === 'HOLD');
check('2 (AÇIK) → CLOSE', decideSalesAction(2, CLOSE, OPEN, 'OPEN') === 'CLOSE');
check('100 (KAPALI) → OPEN', decideSalesAction(100, CLOSE, OPEN, 'CLOSED') === 'OPEN');

// Hazırlama stok aralığı (ayrı kural)
check('prepRange: 4 içeride (1-999999)', isWithinPrepRange(4, 1, 999999) === true);
check('prepRange: 0 dışarıda (min 1)', isWithinPrepRange(0, 1, 999999) === false);
check('prepRange: 1 sınır içeride', isWithinPrepRange(1, 1, 999999) === true);
check('prepRange: 999999 sınır içeride', isWithinPrepRange(999999, 1, 999999) === true);
check('prepRange: 1000000 dışarıda (max aşımı)', isWithinPrepRange(1000000, 1, 999999) === false);

console.log('========================================');
console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
if (failures.length) { for (const f of failures) console.log(' - ' + f); }
process.exit(fail > 0 ? 1 : 0);
