// TASK313-R3: Ürün havuzu KPI önbelleği — tek kaynak.
// Herhangi bir gate-write/reconcile gerçekleştiğinde invalidate edilir;
// böylece DB=API=UI parity bozulmaz (stale KPI saldırısı kapatıldı).
const cache = new Map<string, { data: unknown; timestamp: number }>();
const TTL = 30_000;

export function productsStatsGet(key: string): { data: unknown; timestamp: number } | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < TTL) return hit;
  if (hit) cache.delete(key);
  return undefined;
}

export function productsStatsSet(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export function invalidateProductsStats(): void {
  cache.clear();
}
