import { prisma } from '../db/prisma.ts';
import { resolveListingTemplate, hasListingTemplate, invalidateTemplateCache } from './listingTemplateResolver.ts';
import { queueReconcileProductGates } from './readinessService.ts';
import { invalidateProductsStats } from './productsStatsCache.ts';
import { getOperationalMarketplaceIds } from './marketplaceTruth.ts';

/**
 * TEMPLATE SYNC SERVICE — Incremental background sync for templateMatch field.
 *
 * 3 mod:
 *  1. FULL: templateMatch=false olan TÜM ürünleri tarar (ilk çalıştırmada/backfill)
 *  2. INCREMENTAL: Belirli ürün setini sync eder (template CRUD tetiklemesi)
 *  3. CATEGORY: Belirli category'deki ürünleri sync eder (category template değişimi)
 *
 * Dedup: Aynı target seti 5s pencere içinde tekrar tetiklenirse job atlanır.
 * Concurrency: Aynı anda yalnizca 1 sync job calisir.
 */

const BATCH_SIZE = 500;
const DEDUP_WINDOW_MS = 5_000;

// ─── STATE ────────────────────────────────────────────────
let _syncRunning = false;
let _syncPending = false;
let _syncAbortRequested = false;
let _lastRunStart: number | null = null;
let _lastRunEnd: number | null = null;
let _lastSyncedCount = 0;
let _lastError: string | null = null;
let _fullSyncRequested = false;

// Dedup: son tetikleme zamanları (target key → timestamp)
const _recentTriggers = new Map<string, number>();

// ─── PUBLIC API ───────────────────────────────────────────

/**
 * Full sync tetikle (tüm templateMatch=false ürünler).
 * İlk çalıştırmada veya backfill gerektiğinde kullanılır.
 */
export function requestFullSync(): void {
  _fullSyncRequested = true;
  _syncPending = true;
  if (!_syncRunning) {
    _runBackgroundSync().catch(() => null);
  }
}

/**
 * Incremental sync: belirli ürünleri sync et.
 * Template CRUD'da çağrılır.
 */
export function requestIncrementalSync(productIds: string[]): void {
  if (productIds.length === 0) return;

  // Dedup: aynı ürün seti 5s içinde tekrar tetiklenirse atla
  const key = 'incr:' + productIds.sort().join(',');
  const now = Date.now();
  const last = _recentTriggers.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  _recentTriggers.set(key, now);

  // Cooldown temizliği
  if (_recentTriggers.size > 1000) {
    for (const [k, ts] of _recentTriggers) {
      if (now - ts > 60_000) _recentTriggers.delete(k);
    }
  }

  _pendingIncremental.push(...productIds);
  _syncPending = true;
  if (!_syncRunning) {
    _runBackgroundSync().catch(() => null);
  }
}

/**
 * Category-based sync: belirli bir category'deki tüm ürünleri sync et.
 * Category template değişimi veya CategoryMapping değişimi gerektiğinde.
 */
export function requestCategorySync(categoryId: string, marketplaceId?: string): void {
  if (!categoryId) return;

  const key = 'cat:' + categoryId + ':' + (marketplaceId ?? '');
  const now = Date.now();
  const last = _recentTriggers.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  _recentTriggers.set(key, now);

  _pendingCategories.push({ categoryId, marketplaceId });
  _syncPending = true;
  if (!_syncRunning) {
    _runBackgroundSync().catch(() => null);
  }
}

/**
 * Marketplace-based sync: belirli bir marketplace'teki ürünleri sync et.
 * Marketplace API key değişimi gerektiğinde.
 */
export function requestMarketplaceSync(marketplaceId: string): void {
  if (!marketplaceId) return;

  const key = 'mp:' + marketplaceId;
  const now = Date.now();
  const last = _recentTriggers.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  _recentTriggers.set(key, now);

  _pendingMarketplaces.push(marketplaceId);
  _syncPending = true;
  if (!_syncRunning) {
    _runBackgroundSync().catch(() => null);
  }
}

/**
 * Mevcut context ile tetikle (backward compatible).
 */
export function requestTemplateSync(context?: { xmlSourceIds?: string[]; marketplaceIds?: string[] }): void {
  if (context?.marketplaceIds?.length) {
    for (const mpId of context.marketplaceIds) {
      requestMarketplaceSync(mpId);
    }
  } else {
    requestFullSync();
  }
}

/**
 * Sync durumunu raporla.
 */
export function getTemplateSyncStatus(): {
  running: boolean;
  pending: boolean;
  lastRunStart: number | null;
  lastRunEnd: number | null;
  lastSyncedCount: number;
  lastError: string | null;
  pendingIncremental: number;
  pendingCategories: number;
} {
  return {
    running: _syncRunning,
    pending: _syncPending,
    lastRunStart: _lastRunStart,
    lastRunEnd: _lastRunEnd,
    lastSyncedCount: _lastSyncedCount,
    lastError: _lastError,
    pendingIncremental: _pendingIncremental.length,
    pendingCategories: _pendingCategories.length,
  };
}

/**
 * Abort iste.
 */
export function requestTemplateSyncAbort(): void {
  _syncAbortRequested = true;
}

// ─── INTERNAL PENDING QUEUES ──────────────────────────────

const _pendingIncremental: string[] = [];
const _pendingCategories: Array<{ categoryId: string; marketplaceId?: string }> = [];
const _pendingMarketplaces: string[] = [];

// ─── BACKGROUND SYNC ENGINE ───────────────────────────────

async function _runBackgroundSync(): Promise<void> {
  if (_syncRunning) return;

  _syncRunning = true;
  _syncPending = false;
  _syncAbortRequested = false;
  _lastRunStart = Date.now();
  _lastSyncedCount = 0;
  _lastError = null;

  try {
    let totalUpdated = 0;

    // 1. Process incremental (specific product IDs)
    while (_pendingIncremental.length > 0 && !_syncAbortRequested) {
      const batch = _pendingIncremental.splice(0, BATCH_SIZE);
      const updated = await _syncProductIds(batch);
      totalUpdated += updated;
    }

    // 2. Process category-based
    while (_pendingCategories.length > 0 && !_syncAbortRequested) {
      const { categoryId, marketplaceId } = _pendingCategories.shift()!;
      const updated = await _syncCategory(categoryId, marketplaceId);
      totalUpdated += updated;
    }

    // 3. Process marketplace-based
    while (_pendingMarketplaces.length > 0 && !_syncAbortRequested) {
      const mpId = _pendingMarketplaces.shift()!;
      const updated = await _syncMarketplace(mpId);
      totalUpdated += updated;
    }

    // 4. Full sync if requested
    if (_fullSyncRequested && !_syncAbortRequested) {
      const updated = await _executeFullSync();
      totalUpdated += updated;
      _fullSyncRequested = false;
    }

    _lastSyncedCount = totalUpdated;
  } catch (error: any) {
    _lastError = error?.message ?? String(error);
    console.error('[TEMPLATE_SYNC] Background sync failed:', _lastError);
  } finally {
    _lastRunEnd = Date.now();
    _syncRunning = false;

    // Yeni tetikleme varsa tekrar çalıştır
    if (_syncPending && !_syncAbortRequested) {
      _runBackgroundSync().catch(() => null);
    }
  }
}

// ─── INCREMENTAL: SPECIFIC PRODUCTS ───────────────────────

async function _syncProductIds(productIds: string[]): Promise<number> {
  const operationalMpIds = await getOperationalMarketplaceIds();
  if (operationalMpIds.length === 0) return 0;

  let updated = 0;
  const chunks = [];
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    chunks.push(productIds.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    if (_syncAbortRequested) break;

    const products = await prisma.product.findMany({
      where: { id: { in: chunk } },
      select: { id: true, categoryId: true },
    });

    for (const p of products) {
      if (_syncAbortRequested) break;

      let resolved = false;
      for (const mpId of operationalMpIds) {
        const result = await resolveListingTemplate({
          productId: p.id,
          categoryId: p.categoryId,
          marketplaceId: mpId,
        });
        if (hasListingTemplate(result)) {
          resolved = true;
          break;
        }
      }

      const currentProduct = await prisma.product.findUnique({
        where: { id: p.id },
        select: { templateMatch: true },
      });

      if (resolved && !currentProduct?.templateMatch) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: true },
        });
        queueReconcileProductGates(p.id);
        updated++;
      } else if (!resolved && currentProduct?.templateMatch) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: false },
        });
        queueReconcileProductGates(p.id);
        updated++;
      }
    }
  }

  if (updated > 0) {
    invalidateProductsStats();
    invalidateTemplateCache();
  }

  return updated;
}

// ─── INCREMENTAL: CATEGORY-BASED ──────────────────────────

async function _syncCategory(categoryId: string, marketplaceId?: string): Promise<number> {
  const operationalMpIds = await getOperationalMarketplaceIds();
  const resolveMpIds = marketplaceId
    ? operationalMpIds.filter(id => id === marketplaceId)
    : operationalMpIds;

  if (resolveMpIds.length === 0) return 0;

  let updated = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore && !_syncAbortRequested) {
    const products = await prisma.product.findMany({
      where: { categoryId, templateMatch: false },
      select: { id: true, categoryId: true },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (products.length === 0) { hasMore = false; break; }

    for (const p of products) {
      if (_syncAbortRequested) break;

      let resolved = false;
      for (const mpId of resolveMpIds) {
        const result = await resolveListingTemplate({
          productId: p.id,
          categoryId: p.categoryId,
          marketplaceId: mpId,
        });
        if (hasListingTemplate(result)) {
          resolved = true;
          break;
        }
      }
      if (resolved) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: true },
        });
        queueReconcileProductGates(p.id);
        updated++;
      }
    }

    offset += products.length;
    if (products.length < BATCH_SIZE) hasMore = false;
  }

  if (updated > 0) {
    invalidateProductsStats();
    invalidateTemplateCache();
  }

  return updated;
}

// ─── INCREMENTAL: MARKETPLACE-BASED ───────────────────────

async function _syncMarketplace(marketplaceId: string): Promise<number> {
  const operationalMpIds = await getOperationalMarketplaceIds();
  if (!operationalMpIds.includes(marketplaceId)) return 0;

  let updated = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore && !_syncAbortRequested) {
    const products = await prisma.product.findMany({
      where: {
        templateMatch: false,
        marketplaceStates: { some: { marketplaceId } },
      },
      select: { id: true, categoryId: true },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (products.length === 0) { hasMore = false; break; }

    for (const p of products) {
      if (_syncAbortRequested) break;

      const result = await resolveListingTemplate({
        productId: p.id,
        categoryId: p.categoryId,
        marketplaceId,
      });
      if (hasListingTemplate(result)) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: true },
        });
        queueReconcileProductGates(p.id);
        updated++;
      }
    }

    offset += products.length;
    if (products.length < BATCH_SIZE) hasMore = false;
  }

  if (updated > 0) {
    invalidateProductsStats();
    invalidateTemplateCache();
  }

  return updated;
}

// ─── FULL SYNC (backward compatible) ──────────────────────

async function _executeFullSync(): Promise<number> {
  const operationalMpIds = await getOperationalMarketplaceIds();
  if (operationalMpIds.length === 0) return 0;

  let updated = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore && !_syncAbortRequested) {
    const products = await prisma.product.findMany({
      where: { templateMatch: false },
      select: { id: true, categoryId: true },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (products.length === 0) { hasMore = false; break; }

    for (const p of products) {
      if (_syncAbortRequested) break;

      let resolved = false;
      for (const mpId of operationalMpIds) {
        const result = await resolveListingTemplate({
          productId: p.id,
          categoryId: p.categoryId,
          marketplaceId: mpId,
        });
        if (hasListingTemplate(result)) {
          resolved = true;
          break;
        }
      }
      if (resolved) {
        await prisma.product.update({
          where: { id: p.id },
          data: { templateMatch: true },
        });
        queueReconcileProductGates(p.id);
        updated++;
      }
    }

    offset += products.length;
    if (products.length < BATCH_SIZE) hasMore = false;
  }

  if (updated > 0) {
    invalidateProductsStats();
    invalidateTemplateCache();
  }

  return updated;
}
