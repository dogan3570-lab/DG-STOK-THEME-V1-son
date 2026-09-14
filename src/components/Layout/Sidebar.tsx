import React from 'react';

interface Props {
  activePage: string;
  onPageChange: (key: string) => void;
  collapsed: boolean;
  userRole: string;
}

const MENU_ITEMS = [
  { key: 'kontrol', label: 'Kontrol Paneli', icon: '📊' },
  { key: 'xml', label: 'XML Kaynakları', icon: '🔗' },
  { key: 'urunhavuzu', label: 'Ürün Havuzu', icon: '📦' },
  { key: 'urunhazirlama', label: 'Ürün Hazırlama', icon: '⚙️' },
  { key: 'gonderimehazir', label: 'Gönderime Hazır', icon: '✅' },
  { key: 'varyant', label: 'Varyant İstisnaları', icon: '🔀' },
  { key: 'ai-kontrol', label: 'AI Kontrol', icon: '🧠' },
  { key: 'ai-image', label: 'AI Görsel', icon: '🖼️' },
  { key: 'ai-sales', label: 'AI Satış', icon: '💰' },
  { key: 'copilot', label: 'AI Copilot', icon: '🤖' },
  { key: 'pazaryeri', label: 'Pazaryeri', icon: '🛒' },
  { key: 'siparis', label: 'Siparişler', icon: '📑' },
  { key: 'rapor', label: 'Raporlar', icon: '📊' },
  { key: 'ayar', label: 'Ayarlar', icon: '⚙️' },
];

const ADMIN_ONLY_ITEMS = [
  { key: 'musteriler', label: 'Müşteriler', icon: '👥' },
  { key: 'automation', label: 'Stok Otomasyonu', icon: '⚙️' },
];

export default function Sidebar({ activePage, onPageChange, collapsed, userRole }: Props) {
  const isAdminOrOperator = userRole === 'ADMIN' || userRole === 'OPERATOR';
  const visibleItems = isAdminOrOperator ? [...MENU_ITEMS, ...ADMIN_ONLY_ITEMS] : MENU_ITEMS;

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-white dark:bg-[#0f1520] border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300`}>
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
        {!collapsed && <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">DG STOK</span>}
        <button onClick={() => onPageChange('toggle-collapse')} className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {visibleItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onPageChange(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              activePage === item.key
                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}
