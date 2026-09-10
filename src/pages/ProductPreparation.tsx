import React, { useState, useEffect } from 'react';
import BrandMatchTab from './prep/BrandMatchTab';
import CategoryMatchTab from './prep/CategoryMatchTab';
import VariantMatchTab from './prep/VariantMatchTab';
import ListingTemplateTab from './prep/ListingTemplateTab';

type TabKey = 'kategori' | 'marka' | 'varyant' | 'listeleme';

interface ProductPreparationProps {
  defaultTab?: TabKey;
}

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'kategori', label: 'Kategori Eşleştirme', icon: '📂' },
  { key: 'marka', label: 'Marka Eşleştirme', icon: '🏷️' },
  { key: 'varyant', label: 'Varyant Eşleştirme', icon: '🎨' },
  { key: 'listeleme', label: 'Listeleme Şablonları', icon: '📋' },
];

export default function ProductPreparation({ defaultTab }: ProductPreparationProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab || 'kategori');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && ['kategori', 'marka', 'varyant', 'listeleme'].includes(detail)) {
        setActiveTab(detail as TabKey);
      }
    };
    window.addEventListener('dgstok:prep-tab', handler);
    return () => window.removeEventListener('dgstok:prep-tab', handler);
  }, []);

  useEffect(() => {
    if (defaultTab && ['kategori', 'marka', 'varyant', 'listeleme'].includes(defaultTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'kategori': return <CategoryMatchTab />;
      case 'marka': return <BrandMatchTab />;
      case 'varyant': return <VariantMatchTab />;
      case 'listeleme': return <ListingTemplateTab />;
      default: return <CategoryMatchTab />;
    }
  };

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-center gap-1 rounded-2xl border bg-transparent p-1 shadow-soft">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-transparent text-current shadow-sm'
                : 'text-current hover:bg-transparent hover:bg-transparent'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      {renderTab()}
    </div>
  );
}
