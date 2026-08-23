import { PrismaClient, Prisma } from '@prisma/client';
import { isPrepComplete } from './readiness.ts';

const prisma = new PrismaClient();

export interface ReconcileContext {
  xmlSourceId: string;
  marketplaceId: string;
  tx?: Prisma.TransactionClient;
}

/**
 * FIX(F-10): Route/service'lerdeki `reconcileProductGates(id).catch(...)` çağrıları
 * sınırsız sayıda paralel Prisma bağlantısı/promise üretebiliyordu (ör. 13K ürünlük
 * toplu işlemler). Bu kuyruk aynı ürün için mükerrer girişi tekilleştirir ve
 * eşzamanlılığı RECONCILE_CONCURRENCY ile sınırlar. Çağrı semantiği aynıdır:
 * non-blocking, hatalar yutulur, sonuç idempotent.
 */
const RECONCILE_CONCURRENCY = 4;
const _reconcileQueue: string[] = [];
const _reconcileQueued = new Set<string>();
let _reconcileActive = 0;

function pumpReconcileQueue(): void {
  while (_reconcileActive < RECONCILE_CONCURRENCY && _reconcileQueue.length > 0) {
    const productId = _reconcileQueue.shift() as string;
    _reconcileQueued.delete(productId);
    _reconcileActive++;
    reconcileProductGates(productId)
      .catch(() => null)
      .finally(() => {
        _reconcileActive--;
        pumpReconcileQueue();
      });
  }
}

export function queueReconcileProductGates(productId: string): void {
  if (!productId || _reconcileQueued.has(productId)) return;
  _reconcileQueued.add(productId);
  _reconcileQueue.push(productId);
  pumpReconcileQueue();
}

/**
 * Lifecycle reconcile: call after any gate-write (category, brand, variant, template, PMS, price).
 * Automatically resolves xmlSourceId + marketplaceId from the product's PMS.
 * Idempotent — safe to call multiple times for the same product.
 * Uses global prisma (non-transactional). For transactional paths, use reconcileReadiness() directly.
 */
export async function reconcileProductGates(productId: string): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      xmlSourceId: true,
      marketplaceStates: { select: { marketplaceId: true }, take: 1 },
    },
  });
  if (!product || !product.xmlSourceId || product.marketplaceStates.length === 0) return false;
  return reconcileReadiness(productId, {
    xmlSourceId: product.xmlSourceId,
    marketplaceId: product.marketplaceStates[0].marketplaceId,
  });
}

/**
 * Evaluate a single product and promote/demote its status atomically.
 * Returns true if status changed.
 */
export async function reconcileReadiness(productId: string, ctx: ReconcileContext): Promise<boolean> {
  const client = ctx.tx ?? prisma;

  // Fetch product with needed fields, PMS existence, and salePrice
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      status: true,
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantMatch: true,
      variantStatus: true,
      xmlSourceId: true,
      salePrice: true,
      marketplaceStates: {
        where: { marketplaceId: ctx.marketplaceId },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!product) return false;

  // Context isolation: ensure product belongs to the requested xmlSource
  if (product.xmlSourceId !== ctx.xmlSourceId) return false;

  const hasPms = product.marketplaceStates.length > 0;
  const allGates = isPrepComplete({
    status: product.status,
    categoryMatch: product.categoryMatch,
    brandMatch: product.brandMatch,
    templateMatch: product.templateMatch,
    variantMatch: product.variantMatch,
    variantStatus: product.variantStatus,
  });

  const currentlyReady = product.status === 'READY';
  const shouldBeReady = hasPms && allGates && product.salePrice != null;

  if (currentlyReady && !shouldBeReady) {
    // Demote
    await client.product.update({
      where: { id: productId, status: 'READY' },
      data: { status: 'XML' },
    });
    return true;
  }

  if (!currentlyReady && shouldBeReady && product.status === 'XML') {
    // Promote
    await client.product.update({
      where: { id: productId, status: 'XML' },
      data: { status: 'READY' },
    });
    return true;
  }

  return false;
}

/**
 * Batch reconcile for a context (used by /recheck endpoint and recovery script).
 * Processes in batches, each batch inside its own transaction.
 */
export async function reconcileBatch(ctx: ReconcileContext, batchSize = 500): Promise<{ promoted: number; demoted: number; checked: number }> {
  let promoted = 0;
  let demoted = 0;
  let checked = 0;
  let cursor: string | undefined;

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        xmlSourceId: ctx.xmlSourceId,
        marketplaceStates: { some: { marketplaceId: ctx.marketplaceId } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        status: true,
        categoryMatch: true,
        brandMatch: true,
        templateMatch: true,
        variantMatch: true,
        variantStatus: true,
        salePrice: true,
      },
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    if (products.length === 0) break;

    // Process this batch inside a transaction
    await prisma.$transaction(async (tx) => {
      for (const p of products) {
        const variantOk = p.variantMatch === true || p.variantStatus === 'NOT_REQUIRED';
        const allGates = p.categoryMatch && p.brandMatch && p.templateMatch && variantOk;
        const currentlyReady = p.status === 'READY';
        const shouldBeReady = allGates && p.salePrice != null; // PMS already guaranteed by the query

        if (currentlyReady && !shouldBeReady) {
          await tx.product.update({ where: { id: p.id, status: 'READY' }, data: { status: 'XML' } });
          demoted++;
        } else if (!currentlyReady && shouldBeReady && p.status === 'XML') {
          await tx.product.update({ where: { id: p.id, status: 'XML' }, data: { status: 'READY' } });
          promoted++;
        }
        checked++;
      }
    });

    cursor = products[products.length - 1].id;
    if (products.length < batchSize) break;
  }

  return { promoted, demoted, checked };
}