export const MARKETPLACE_LOGOS: Record<string, string> = {
  trendyol: '🟠',
  hepsiburada: '🟠',
  amazon: '📦',
  n11: '🔴',
  gittigidiyor: '🟡',
  pazarama: '🔵',
  ciceksepeti: '🌸',
  default: '🛒',
};

export const STATUS_BADGE_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  passive: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  ready: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export const STATUS_BADGE_LABELS: Record<string, string> = {
  active: 'Aktif',
  passive: 'Pasif',
  pending: 'Beklemede',
  error: 'Hatalı',
  ready: 'Hazır',
  draft: 'Taslak',
};

export const STATUS_OPTIONS = [
  { value: '', label: 'Tümü' },
  { value: 'active', label: 'Aktif' },
  { value: 'passive', label: 'Pasif' },
  { value: 'pending', label: 'Beklemede' },
  { value: 'draft', label: 'Taslak' },
];

export const SEARCH_FIELDS = [
  { value: 'title', label: 'Ürün Adı' },
  { value: 'sku', label: 'SKU' },
  { value: 'barcode', label: 'Barkod' },
  { value: 'xmlKey', label: 'XML Key' },
];

export const SORT_OPTIONS = [
  { value: 'updatedAt:desc', label: 'Güncelleme (Yeni)' },
  { value: 'updatedAt:asc', label: 'Güncelleme (Eski)' },
  { value: 'title:asc', label: 'Ad (A-Z)' },
  { value: 'title:desc', label: 'Ad (Z-A)' },
  { value: 'salePrice:desc', label: 'Fiyat (Pahalı)' },
  { value: 'salePrice:asc', label: 'Fiyat (Ucuz)' },
  { value: 'stock:desc', label: 'Stok (Çok)' },
  { value: 'stock:asc', label: 'Stok (Az)' },
];
