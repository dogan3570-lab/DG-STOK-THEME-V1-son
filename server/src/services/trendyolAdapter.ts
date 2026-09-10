/**
 * TRENDYOL ADAPTER — Trendyol marketplace için CategoryCore adapter implementasyonu.
 *
 * Trendyol'a özgü:
 *  - Category tree yükleme (DB'den)
 *  - Marketplace ID çözümleme
 *  - ExternalId doğrulama (pozitif integer)
 *
 * Marketplace-agnostic Core fonksiyonları bu adapter üzerinden çalışır.
 */
import { loadTrendyolTree, loadTrendyolMarketplaceId, type TreeIndex } from './categoryMatchEngine.ts';
import type { MarketplaceAdapter } from './categoryCore.ts';

export class TrendyolAdapter implements MarketplaceAdapter {
  readonly key = 'tt';
  readonly name = 'Trendyol';

  private cachedTree: TreeIndex | null = null;
  private cachedMarketplaceId: string | null = null;
  private cacheTime = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika

  async loadTree(): Promise<TreeIndex> {
    const now = Date.now();
    if (this.cachedTree && (now - this.cacheTime) < this.CACHE_TTL_MS) {
      return this.cachedTree;
    }
    this.cachedTree = await loadTrendyolTree();
    this.cacheTime = now;
    return this.cachedTree;
  }

  async loadMarketplaceId(): Promise<string | null> {
    if (this.cachedMarketplaceId) return this.cachedMarketplaceId;
    this.cachedMarketplaceId = await loadTrendyolMarketplaceId();
    return this.cachedMarketplaceId;
  }

  validateExternalId(externalId: number): boolean {
    return Number.isFinite(externalId) && externalId > 0;
  }

  invalidateCache(): void {
    this.cachedTree = null;
    this.cachedMarketplaceId = null;
    this.cacheTime = 0;
  }
}

// Singleton
let _instance: TrendyolAdapter | null = null;

export function getTrendyolAdapter(): TrendyolAdapter {
  if (!_instance) _instance = new TrendyolAdapter();
  return _instance;
}
