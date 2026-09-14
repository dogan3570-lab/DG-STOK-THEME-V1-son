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
 *   2. Either:
 *      a. Both apiKey AND apiSecret are configured (non-null, non-empty, NOT encrypted placeholders), OR
 *      b. apiUrl is configured AND is NOT a localhost/mock URL
 *
 * Rationale:
 * - active=true alone is insufficient (Hepsiburada/N11 are active but have zero real credentials)
 * - apiStatus='connected' is unreliable (can be stale/manually set)
 * - localhost/mock URLs (e.g. http://localhost:4099) are NOT real marketplace integrations
 * - Encrypted placeholder values (enc:v1:...) are NOT real credentials
 * - Both apiKey + apiSecret are required for OAuth/credential-based APIs (N11, Hepsiburada)
 * - Non-localhost apiUrl alone indicates a real endpoint (Trendyol uses URL-based integration)
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
  const hasApiKey = !!mp.apiKey && mp.apiKey.trim().length > 0 && !mp.apiKey.trim().startsWith('enc:');
  const hasApiSecret = !!mp.apiSecret && mp.apiSecret.trim().length > 0 && !mp.apiSecret.trim().startsWith('enc:');
  const hasApiUrl = !!mp.apiUrl && mp.apiUrl.trim().length > 0;

  // Both apiKey + apiSecret present → operational (credential-based integration)
  if (hasApiKey && hasApiSecret) return true;

  // apiUrl present and is NOT localhost/mock → operational (real endpoint integration)
  if (hasApiUrl) {
    const url = mp.apiUrl!.trim().toLowerCase();
    const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('[::1]');
    if (!isLocalhost) return true;
  }

  return false;
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
