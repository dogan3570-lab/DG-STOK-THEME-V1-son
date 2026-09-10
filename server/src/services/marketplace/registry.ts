import type { MarketplaceAdapter, MarketplaceKey } from './types.ts';
import {
  amazonTrAdapter,
  hepsiburadaAdapter,
  n11Adapter,
  pazaramaAdapter,
  trendyolAdapter,
} from './adapters.ts';

const REGISTRY: Record<MarketplaceKey, MarketplaceAdapter> = {
  tt: trendyolAdapter,
  he: hepsiburadaAdapter,
  n11: n11Adapter,
  amazon: amazonTrAdapter,
  pazarama: pazaramaAdapter,
};

export function getAdapter(key: string): MarketplaceAdapter | null {
  return (REGISTRY as Record<string, MarketplaceAdapter>)[key] ?? null;
}

export function listAdapters(): MarketplaceAdapter[] {
  return Object.values(REGISTRY);
}
