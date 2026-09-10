import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface Marketplace { id: string; key: string; name: string; isActive: boolean; }
interface MarketplaceContextType {
  marketplaces: Marketplace[];
  selectedMarketplace: Marketplace | null;
  setSelectedMarketplace: (mp: Marketplace | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const MarketplaceContext = createContext<MarketplaceContextType>({
  marketplaces: [], selectedMarketplace: null, setSelectedMarketplace: () => {},
  loading: false, refresh: async () => {},
});

export function MarketplaceProvider({ children }: { children: React.ReactNode }) {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [selectedMarketplace, setSelectedMarketplace] = useState<Marketplace | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<any>('/marketplaces');
      if (r.ok && r.data) {
        const list = Array.isArray(r.data) ? r.data : (r.data.items || []);
        setMarketplaces(list);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <MarketplaceContext.Provider value={{ marketplaces, selectedMarketplace, setSelectedMarketplace, loading, refresh }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace() { return useContext(MarketplaceContext); }
