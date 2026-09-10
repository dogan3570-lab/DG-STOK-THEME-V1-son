import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type MarketplaceRow = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  apiKey: string | null;
  apiSecret: string | null;
  apiUrl: string | null;
  apiStatus: string;
};

/**
 * CANONICAL OPERATIONAL MARKETPLACE DEFINITION.
 *
 * A marketplace is "operational" if and only if:
 *   1. active === true
 *   2. At least one of apiKey, apiSecret, or apiUrl is configured (non-null, non-empty)
 *
 * Rationale:
 * - active=true alone is insufficient (Hepsiburada/N11 are active but have zero credentials)
 * - apiStatus='connected' is unreliable (can be stale/manually set)
 * - Real API integration requires credentials + endpoint
 *
 * This is the SINGLE SOURCE OF TRUTH for "is this marketplace usable?"
 * All modules MUST use this function instead of `active: true` alone.
 */
export function isMarketplaceOperational(mp: {
  active?: boolean;
  apiKey?: string | null;
  apiSecret?: string | null;
  apiUrl?: string | null;
}): boolean {
  if (mp.active === false) return false;
  const hasApiKey = !!mp.apiKey && mp.apiKey.trim().length > 0;
  const hasApiSecret = !!mp.apiSecret && mp.apiSecret.trim().length > 0;
  const hasApiUrl = !!mp.apiUrl && mp.apiUrl.trim().length > 0;
  return hasApiKey || hasApiSecret || hasApiUrl;
}

let _cache: { ids: string[]; timestamp: number } | null = null;
const CACHE_TTL = 10_000; // 10 seconds

/**
 * Returns IDs of all operational marketplaces (cached for 10s to avoid repeated DB hits).
 * Use this in bulk operations (import, reconcile, stats).
 */
export async function getOperationalMarketplaceIds(): Promise<string[]> {
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL) {
    return _cache.ids;
  }

  const allRows = await prisma.marketplace.findMany({
    where: { active: true },
    select: { id: true, apiKey: true, apiSecret: true, apiUrl: true },
  });

  const operationalIds = allRows
    .filter(mp => isMarketplaceOperational(mp))
    .map(mp => mp.id);

  _cache = { ids: operationalIds, timestamp: Date.now() };
  return operationalIds;
}

/**
 * Returns full operational marketplace records.
 * Use this when you need marketplace details (name, key, etc.)
 */
export async function getOperationalMarketplaces() {
  const allRows = await prisma.marketplace.findMany({
    where: { active: true },
    select: { id: true, key: true, name: true, apiKey: true, apiSecret: true, apiUrl: true, apiStatus: true },
    orderBy: { createdAt: 'asc' },
  });

  return allRows.filter(mp => isMarketplaceOperational(mp));
}

/** Invalidate cache (call after marketplace create/update/delete). */
export function invalidateOperationalMarketplaceCache() {
  _cache = null;
}

/**
 * Counts operational marketplaces.
 * Use in dashboard/stats instead of `prisma.marketplace.count({ where: { active: true } })`.
 */
export async function countOperationalMarketplaces(): Promise<number> {
  const ids = await getOperationalMarketplaceIds();
  return ids.length;
}
