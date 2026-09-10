/**
 * One-time backfill: stuck (status=XML ama tüm gate'leri geçen) ürünleri READY'ye promote eder.
 * Referans: server/src/routes/readyToShip.ts:379-381 yorumu:
 *   "For one-time backfill of existing stuck products, run: npx tsx src/scripts/backfill-reconcile.ts"
 * Bu script o yorumda öngörülen ama hiç yaratılmamış scripti tamamlar.
 * Mantık sıfırdan yazılmaz — mevcut syncReconcileStatus() (reconcileReadiness ile
 * birebir hizalı promote kriterleri) export edilip çağrılır. Sadece promote yapar,
 * demote yapmaz, veri silmez.
 *
 * Kullanım: cd server && npx tsx src/scripts/backfill-reconcile.ts
 */
import { prisma } from '../db/prisma.ts';
import { syncReconcileStatus } from '../routes/readyToShip.ts';

async function main() {
  const t0 = Date.now();
  console.log('[backfill-reconcile] Basliyor...');

  const readyBefore = await prisma.product.count({ where: { status: 'READY' } });
  const xmlBefore = await prisma.product.count({ where: { status: 'XML' } });
  console.log(`[backfill-reconcile] BEFORE: READY=${readyBefore} XML=${xmlBefore}`);

  const promoted = await syncReconcileStatus({ xmlSourceIds: [], marketplaceIds: [] });

  const readyAfter = await prisma.product.count({ where: { status: 'READY' } });
  const xmlAfter = await prisma.product.count({ where: { status: 'XML' } });
  console.log(`[backfill-reconcile] AFTER: READY=${readyAfter} XML=${xmlAfter}`);
  console.log(`[backfill-reconcile] Promoted: ${promoted} | Saniye: ${((Date.now() - t0) / 1000).toFixed(1)}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-reconcile] FATAL:', err);
  process.exit(1);
});
