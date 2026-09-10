import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import KpiCard from '../components/ui/KpiCard';
import Modal from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { STATUS_OPTIONS, SEARCH_FIELDS, SORT_OPTIONS } from '../lib/constants';
import { formatPrice, getImageList, getStockStatus, getQualityLevel, calculateProfitMargin, cn } from '../lib/utils';
import { useDebouncedCallback } from '../hooks/useDebounce';
import { useKeyboardShortcuts } from '../hooks/useKeyboard';

// ==================== TYPES ====================
interface ProductStats {
 totalProducts: number;
 activeProducts: number;
 passiveProducts: number;
 draftProducts: number;
 newProducts: number;
 updatedCount: number;
 deletedCount: number;
 readyForListing: number;
 missingInfo: number;
 pendingCategory: number;
 pendingBrand: number;
 pendingVariant: number;
 pendingTemplate: number;
 missingImages: number;
 missingBarcode: number;
 missingDescription: number;
 missingPrice: number;
 missingStock: number;
 missingSeo: number;
 errorProducts: number;
}

interface ProductItem {
 id: string;
 xmlKey: string;
 title: string | null;
 sku: string | null;
 barcode: string | null;
 stock: number;
 minStock: number;
 purchasePrice: number | null;
 salePrice: number | null;
 vatRate: number | null;
 profitMargin: number | null;
 images: string | null;
 status: string;
 errorMessage: string | null;
 aiScore: number | null;
 categoryMatch: boolean;
 brandMatch: boolean;
 variantMatch: boolean;
 templateMatch: boolean;
 categoryId: string | null;
 brandId: string | null;
 category?: { id: string; name: string } | null;
 brand?: { id: string; name: string } | null;
 variants?: Array<{ id: string; name: string; value: string }>;
 xmlSource?: { id: string; name: string; company: string | null } | null;
 description?: string | null;
 createdAt: string;
 updatedAt: string;
}

interface Pagination {
 page: number;
 limit: number;
 total: number;
 totalPages: number;
}

interface FilterState {
 search: string;
 searchField: string;
 status: string;
 categoryId: string;
 brandId: string;
 xmlSourceId: string;
 lowStock: boolean;
 hasImage: string;
 hasBarcode: string;
 hasDescription: string;
 categoryMatch: string;
 brandMatch: string;
 variantMatch: string;
 minPrice: string;
 maxPrice: string;
 minStock: string;
 maxStock: string;
 sortBy: string;
 sortOrder: string;
}

interface SelectOption {
 id: string;
 name: string;
}

const DEFAULT_FILTERS: FilterState = {
 search: '', searchField: '', status: '', categoryId: '', brandId: '',
 xmlSourceId: '', lowStock: false, hasImage: '', hasBarcode: '',
 hasDescription: '', categoryMatch: '', brandMatch: '', variantMatch: '',
 minPrice: '', maxPrice: '', minStock: '', maxStock: '',
 sortBy: 'createdAt', sortOrder: 'desc',
};

const STATUS_COLORS: Record<string, string> = {
 XML: 'text-current', READY: 'text-current', DRAFT: 'text-current',
 SENT: 'text-current', PASSIVE: 'text-current', ERROR: 'text-current',
};

// ==================== COMPONENT ====================
export default function Products() {
 // Stats
 const [stats, setStats] = useState<ProductStats | null>(null);
 const [statsLoading, setStatsLoading] = useState(true);

 // Products
 const [products, setProducts] = useState<ProductItem[]>([]);
 const [loading, setLoading] = useState(true);

 // Filters
 const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
 const [showFilters, setShowFilters] = useState(false);

 // Reference data
 const [categories, setCategories] = useState<SelectOption[]>([]);
 const [brands, setBrands] = useState<SelectOption[]>([]);
 const [xmlSources, setXmlSources] = useState<SelectOption[]>([]);

 // Pagination
 const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });

 // Selection
 const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
 const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
 const [showDetailModal, setShowDetailModal] = useState(false);

 // Bulk operations
 const [bulkMode, setBulkMode] = useState(false);
 const [bulkField, setBulkField] = useState('');
 const [bulkValue, setBulkValue] = useState('');
 const [bulkLoading, setBulkLoading] = useState(false);

 // Quick action
 const [analyzeLoading, setAnalyzeLoading] = useState(false);
 const [prepareLoading, setPrepareLoading] = useState(false);

 // ==================== API CALLS ====================
 async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T | null> {
 try {
 const res = await fetch(url, { credentials: 'include', signal });
 if (!res.ok) {
 if (res.status === 401) {
 localStorage.removeItem('dgstok_loggedin');
 window.location.href = '/';
 return null;
 }
 throw new Error(`HTTP ${res.status}`);
 }
 return await res.json();
 } catch (err) {
 if ((err as Error)?.name === 'AbortError') return null;
 throw err;
 }
 }

 async function fetchStats() {
 setStatsLoading(true);
 try {
 const data = await apiGet<ProductStats>('/products/stats');
 if (data) setStats(data);
 } catch {
 showToast('error', 'İstatistikler yüklenemedi');
 } finally {
 setStatsLoading(false);
 }
 }

 async function fetchReferenceData() {
 try {
 const [catData, brandData, xmlData] = await Promise.all([
 apiGet<{ items: SelectOption[] }>('/categories'),
 apiGet<{ items: SelectOption[] }>('/brands'),
 apiGet<{ items: SelectOption[] }>('/xml-sources'),
 ]);
 if (catData) setCategories(catData.items || []);
 if (brandData) setBrands(brandData.items || []);
 if (xmlData) setXmlSources(xmlData.items || []);
 } catch {
 // Non-critical
 }
 }

 useEffect(() => {
 fetchStats();
 fetchReferenceData();
 }, []);

 useEffect(() => {
 fetchProducts();
 }, [pagination.page, filters]);

 async function fetchProducts() {
 setLoading(true);
 try {
 const params = new URLSearchParams({
 page: String(pagination.page),
 limit: String(pagination.limit),
 });

 // Only add non-empty filter params
 const filterMap: Record<string, string | boolean> = {
 search: filters.search, searchField: filters.searchField,
 status: filters.status, categoryId: filters.categoryId,
 brandId: filters.brandId, xmlSourceId: filters.xmlSourceId,
 hasImage: filters.hasImage, hasBarcode: filters.hasBarcode,
 hasDescription: filters.hasDescription, categoryMatch: filters.categoryMatch,
 brandMatch: filters.brandMatch, variantMatch: filters.variantMatch,
 minPrice: filters.minPrice, maxPrice: filters.maxPrice,
 minStock: filters.minStock, maxStock: filters.maxStock,
 sortBy: filters.sortBy, sortOrder: filters.sortOrder,
 };

 for (const [key, value] of Object.entries(filterMap)) {
 if (value !== '' && value !== false) {
 params.append(key, String(value));
 }
 }
 if (filters.lowStock) params.append('lowStock', 'true');

 const data = await apiGet<{ items: ProductItem[]; pagination: Pagination }>(`/products?${params}`);
 if (data) {
 setProducts(data.items || []);
 if (data.pagination) setPagination(data.pagination);
 }
 } catch {
 showToast('error', 'Ürünler yüklenemedi');
 } finally {
 setLoading(false);
 }
 }

 // ==================== HANDLERS ====================
 const handleSearch = useDebouncedCallback((value: string) => {
 setFilters(prev => ({ ...prev, search: value }));
 setPagination(prev => ({ ...prev, page: 1 }));
 }, 300);

 function updateFilter(key: keyof FilterState, value: string | boolean) {
 setFilters(prev => ({ ...prev, [key]: value }));
 setPagination(prev => ({ ...prev, page: 1 }));
 }

 function clearFilters() {
 setFilters(DEFAULT_FILTERS);
 setPagination(prev => ({ ...prev, page: 1 }));
 }

 function toggleSelect(id: string) {
 setSelectedProducts(prev => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id);
 else next.add(id);
 return next;
 });
 }

 function toggleSelectAll() {
 setSelectedProducts(prev =>
 prev.size === products.length
 ? new Set()
 : new Set(products.map(p => p.id)),
 );
 }

 async function handleBulkUpdate() {
 if (!bulkField || bulkValue === '' || selectedProducts.size === 0) return;
 setBulkLoading(true);
 try {
 const val = ['stock', 'minStock', 'vatRate', 'profitMargin'].includes(bulkField)
 ? Number(bulkValue) : bulkValue;

 const res = await fetch('/products/bulk-update', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ ids: Array.from(selectedProducts), updates: { [bulkField]: val } }),
 });
 const data = await res.json();
 if (res.ok) {
 showToast('success', data.message || '✅ İşlem tamamlandı');
 setSelectedProducts(new Set());
 setBulkMode(false);
 fetchProducts();
 fetchStats();
 } else {
 showToast('error', data.error?.message || '❌ İşlem başarısız');
 }
 } catch {
 showToast('error', '❌ Ağ hatası');
 } finally {
 setBulkLoading(false);
 }
 }

 async function handleBulkDelete() {
 if (selectedProducts.size === 0) return;
 if (!confirm(`${selectedProducts.size} ürünü silmek istediğinizden emin misiniz?`)) return;
 setBulkLoading(true);
 try {
 const res = await fetch('/products/bulk-delete', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ ids: Array.from(selectedProducts) }),
 });
 const data = await res.json();
 if (res.ok) {
 showToast('success', data.message || '✅ Silme tamamlandı');
 setSelectedProducts(new Set());
 fetchProducts();
 fetchStats();
 } else {
 showToast('error', data.error?.message || '❌ Silme başarısız');
 }
 } catch {
 showToast('error', '❌ Ağ hatası');
 } finally {
 setBulkLoading(false);
 }
 }

 async function handleAnalyzeSelected() {
 if (selectedProducts.size === 0) return;
 setAnalyzeLoading(true);
 try {
 const res = await fetch('/products/analyze', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ ids: Array.from(selectedProducts) }),
 });
 const data = await res.json();
 if (data.ok) {
 showToast('success', `✅ ${data.analyzed} ürün analiz edildi`);
 fetchProducts();
 } else {
 showToast('error', '❌ Analiz başarısız');
 }
 } catch {
 showToast('error', '❌ Ağ hatası');
 } finally {
 setAnalyzeLoading(false);
 }
 }

 async function handlePrepareSelected() {
 if (selectedProducts.size === 0) return;
 const marketplaceId = prompt('Pazaryeri ID girin (boş geçilirse sadece kontrol yapılır):');
 setPrepareLoading(true);
 try {
 const res = await fetch('/products/prepare', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({
 ids: Array.from(selectedProducts),
 marketplaceId: marketplaceId || 'preview',
 }),
 });
 const data = await res.json();
 if (data.ok) {
 showToast('success', `✅ ${data.readyCount}/${data.prepared} ürün hazır`);
 fetchProducts();
 } else {
 showToast('error', '❌ Hazırlık başarısız');
 }
 } catch {
 showToast('error', '❌ Ağ hatası');
 } finally {
 setPrepareLoading(false);
 }
 }

 async function openProductDetail(product: ProductItem) {
 try {
 const res = await fetch(`/products/${product.id}`, { credentials: 'include' });
 if (res.ok) {
 setSelectedProduct(await res.json());
 } else {
 setSelectedProduct(product);
 }
 } catch {
 setSelectedProduct(product);
 }
 setShowDetailModal(true);
 }

 // ==================== KEYBOARD SHORTCUTS ====================
 useKeyboardShortcuts([
 { key: 'f', ctrl: true, handler: () => setShowFilters(prev => !prev) },
 { key: 'Escape', handler: () => { setShowDetailModal(false); setSelectedProduct(null); } },
 { key: 'a', ctrl: true, handler: () => toggleSelectAll() },
 ]);

 // ==================== COMPUTED ====================
 const hasActiveFilters = useMemo(() =>
 Object.entries(filters).some(([k, v]) =>
 !['sortBy', 'sortOrder'].includes(k) && v !== '' && v !== false,
 ),
 [filters],
 );

 const allSelected = products.length > 0 && selectedProducts.size === products.length;

 // ==================== RENDER ====================
 return (
 <div className="space-y-6">
 {/* ==================== KPI KARTLARI ==================== */}
 <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
 {statsLoading ? (
 Array.from({ length: 7 }).map((_, i) => (
 <KpiCard key={i} title="" value="" loading />
 ))
 ) : stats ? (
 <>
 <KpiCard title="Toplam Ürün" value={stats.totalProducts} color="blue" />
 <KpiCard title="Gönd. Hazır" value={stats.readyForListing} color="green" />
 <KpiCard title="Yeni (Bugün)" value={stats.newProducts} color="cyan" />
 <KpiCard title="Güncellenen" value={stats.updatedCount} color="teal" />
 <KpiCard title="Aktif" value={stats.activeProducts} color="green" />
 <KpiCard title="Pasif" value={stats.passiveProducts} color="slate" />
 <KpiCard title="Eksik Bilgi" value={stats.missingInfo} color="yellow" />
 <KpiCard title="Ktg. Bekleyen" value={stats.pendingCategory} color="orange" />
 <KpiCard title="Marka Bekleyen" value={stats.pendingBrand} color="orange" />
 <KpiCard title="Varyant Bekleyen" value={stats.pendingVariant} color="orange" />
 <KpiCard title="Hatalı" value={stats.errorProducts} color="red" />
 </>
 ) : null}
 </div>

 {/* ==================== HEADER ==================== */}
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-current">Ürün Havuzu</h2>
 <p className="text-sm text-current">Toplam {pagination.total.toLocaleString('tr-TR')} ürün</p>
 </div>
 <div className="flex items-center gap-2 flex-wrap">
 {/* AI Analiz Butonu */}
 {selectedProducts.size > 0 && (
 <>
 <button
 type="button"
 onClick={handleAnalyzeSelected}
 disabled={analyzeLoading}
 className="btn-ghost px-3 py-2 disabled:opacity-50 transition-colors"
 aria-label={`${selectedProducts.size} ürünü AI ile analiz et`}
 >
 {analyzeLoading ? '⏳ Analiz...' : '🤖 AI Analiz'}
 </button>
 <button
 type="button"
 onClick={handlePrepareSelected}
 disabled={prepareLoading}
 className="btn-ghost px-3 py-2 disabled:opacity-50 transition-colors"
 aria-label="Seçili ürünleri listelemeye hazırla"
 >
 {prepareLoading ? '⏳ Hazırlanıyor...' : '📋 Listelemeye Hazırla'}
 </button>
 </>
 )}
 {/* Filtre Toggle */}
 <button
 type="button"
 onClick={() => setShowFilters(!showFilters)}
 className={cn(
 'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
 showFilters || hasActiveFilters
 ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current'
 : 'border-current text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20',
 )}
 aria-expanded={showFilters}
 aria-label={showFilters ? 'Filtreleri gizle' : 'Filtreleri göster'}
 >
 🔍 {showFilters ? 'Filtreleri Gizle' : 'Filtreler'}
 {hasActiveFilters && <span className="ml-1 rounded-full bg-transparent px-1.5 py-0.5 text-xs">!</span>}
 </button>
 {hasActiveFilters && (
 <button
 type="button"
 onClick={clearFilters}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-2 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 aria-label="Filtreleri temizle"
 >
 ✕ Temizle
 </button>
 )}
 </div>
 </div>

 {/* ==================== TOPLU İŞLEM TOOLBAR ==================== */}
 {selectedProducts.size > 0 && (
 <div className="panel-theme p-4 backdrop-blur-sm" role="toolbar" aria-label="Toplu işlem araçları">
 <div className="flex flex-wrap items-center gap-3">
 <span className="text-sm font-medium text-current" aria-live="polite">
 {selectedProducts.size} ürün seçildi
 </span>

 <button
 type="button"
 onClick={() => setBulkMode(!bulkMode)}
 className="btn-ghost px-3 py-1.5 transition-colors"
 >
 {bulkMode ? 'İptal' : '📝 Toplu Güncelle'}
 </button>

 <button
 type="button"
 onClick={handleBulkDelete}
 disabled={bulkLoading}
 className="btn-ghost px-3 py-1.5 disabled:opacity-50 transition-colors"
 >
 🗑️ Toplu Sil
 </button>

 {bulkMode && (
 <div className="flex items-center gap-2 ml-2">
 <select
 value={bulkField}
 onChange={(e) => setBulkField(e.target.value)}
 className="select-theme px-2 py-1.5"
 aria-label="Güncellenecek alan"
 >
 <option value="">Alan Seç...</option>
 <option value="status">Durum</option>
 <option value="salePrice">Satış Fiyatı</option>
 <option value="vatRate">KDV Oranı</option>
 <option value="profitMargin">Kar Marjı</option>
 <option value="stock">Stok</option>
 <option value="categoryId">Kategori ID</option>
 <option value="brandId">Marka ID</option>
 </select>
 <input
 type="text"
 value={bulkValue}
 onChange={(e) => setBulkValue(e.target.value)}
 placeholder="Değer"
 className="w-24 select-theme px-2 py-1.5"
 aria-label="Yeni değer"
 />
 <button
 type="button"
 onClick={handleBulkUpdate}
 disabled={bulkLoading || !bulkField}
 className="btn-ghost px-3 py-1.5 disabled:opacity-50 transition-colors"
 >
 {bulkLoading ? '⏳' : '✅ Uygula'}
 </button>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ==================== SOL FİLTRE PANELİ + TABLO ==================== */}
 <div className="flex flex-col lg:flex-row gap-4">
 {/* Sol Filtre Paneli */}
 {showFilters && (
 <aside className="w-full lg:w-72 shrink-0 space-y-4 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 backdrop-blur-sm h-fit" aria-label="Filtreler">
 <h3 className="text-sm font-semibold text-current">Filtreler</h3>

 {/* Arama */}
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="search-input">Arama</label>
 <input
 id="search-input"
 type="text"
 defaultValue={filters.search}
 onChange={(e) => handleSearch(e.target.value)}
 placeholder="Ürün ara..."
 className="w-full input-theme px-2.5 py-1.5"
 />
 </div>
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="search-field">Arama Alanı</label>
 <select id="search-field" value={filters.searchField} onChange={(e) => updateFilter('searchField', e.target.value)}
 className="w-full select-theme px-2.5 py-1.5">
 {SEARCH_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
 </select>
 </div>

 {/* Durum */}
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="filter-status">Durum</label>
 <select id="filter-status" value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}
 className="w-full select-theme px-2.5 py-1.5">
 {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
 </select>
 </div>

 {/* Kategori */}
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="filter-category">Kategori</label>
 <select id="filter-category" value={filters.categoryId} onChange={(e) => updateFilter('categoryId', e.target.value)}
 className="w-full select-theme px-2.5 py-1.5">
 <option value="">Tümü</option>
 {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
 </select>
 </div>

 {/* Marka */}
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="filter-brand">Marka</label>
 <select id="filter-brand" value={filters.brandId} onChange={(e) => updateFilter('brandId', e.target.value)}
 className="w-full select-theme px-2.5 py-1.5">
 <option value="">Tümü</option>
 {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
 </select>
 </div>

 {/* XML Kaynağı */}
 <div>
 <label className="block text-xs text-current mb-1" htmlFor="filter-xml">XML Kaynağı</label>
 <select id="filter-xml" value={filters.xmlSourceId} onChange={(e) => updateFilter('xmlSourceId', e.target.value)}
 className="w-full select-theme px-2.5 py-1.5">
 <option value="">Tümü</option>
 {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 </div>

 {/* Stok Aralığı */}
 <fieldset>
 <legend className="text-xs text-current mb-1">Stok Aralığı</legend>
 <div className="flex gap-2">
 <input type="number" value={filters.minStock} onChange={(e) => updateFilter('minStock', e.target.value)}
 placeholder="Min" className="w-full select-theme px-2.5 py-1.5" />
 <input type="number" value={filters.maxStock} onChange={(e) => updateFilter('maxStock', e.target.value)}
 placeholder="Maks" className="w-full select-theme px-2.5 py-1.5" />
 </div>
 </fieldset>

 {/* Fiyat Aralığı */}
 <fieldset>
 <legend className="text-xs text-current mb-1">Fiyat Aralığı (₺)</legend>
 <div className="flex gap-2">
 <input type="number" value={filters.minPrice} onChange={(e) => updateFilter('minPrice', e.target.value)}
 placeholder="Min" className="w-full select-theme px-2.5 py-1.5" />
 <input type="number" value={filters.maxPrice} onChange={(e) => updateFilter('maxPrice', e.target.value)}
 placeholder="Maks" className="w-full select-theme px-2.5 py-1.5" />
 </div>
 </fieldset>

 {/* Checkbox Filtreleri */}
 <div className="space-y-2">
 <label className="flex items-center gap-2 text-xs text-current cursor-pointer">
 <input type="checkbox" checked={filters.lowStock} onChange={(e) => updateFilter('lowStock', e.target.checked)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Stokta Yok
 </label>
 <div className="flex gap-2">
 <select value={filters.hasImage} onChange={(e) => updateFilter('hasImage', e.target.value)}
 className="flex-1 select-theme px-2 py-1.5" aria-label="Resim filtresi">
 <option value="">Resim</option>
 <option value="true">Resmi Var</option>
 <option value="false">Resmi Yok</option>
 </select>
 <select value={filters.hasBarcode} onChange={(e) => updateFilter('hasBarcode', e.target.value)}
 className="flex-1 select-theme px-2 py-1.5" aria-label="Barkod filtresi">
 <option value="">Barkod</option>
 <option value="true">Barkodu Var</option>
 <option value="false">Barkodu Yok</option>
 </select>
 </div>
 <div className="flex gap-2">
 <select value={filters.categoryMatch} onChange={(e) => updateFilter('categoryMatch', e.target.value)}
 className="flex-1 select-theme px-2 py-1.5" aria-label="Kategori eşleşme filtresi">
 <option value="">Kategori</option>
 <option value="true">Eşleşmiş</option>
 <option value="false">Eşleşmemiş</option>
 </select>
 <select value={filters.brandMatch} onChange={(e) => updateFilter('brandMatch', e.target.value)}
 className="flex-1 select-theme px-2 py-1.5" aria-label="Marka eşleşme filtresi">
 <option value="">Marka</option>
 <option value="true">Eşleşmiş</option>
 <option value="false">Eşleşmemiş</option>
 </select>
 </div>
 </div>

 {/* Sıralama */}
 <fieldset>
 <legend className="text-xs text-current mb-1">Sıralama</legend>
 <div className="flex gap-2">
 <select value={filters.sortBy} onChange={(e) => updateFilter('sortBy', e.target.value)}
 className="flex-1 select-theme px-2 py-1.5" aria-label="Sıralama alanı">
 {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
 </select>
 <button
 type="button"
 onClick={() => updateFilter('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')}
 className="select-theme px-2 py-1.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 aria-label={`Sıralama: ${filters.sortOrder === 'asc' ? 'artan' : 'azalan'}`}
 >
 {filters.sortOrder === 'asc' ? '↑' : '↓'}
 </button>
 </div>
 </fieldset>
 </aside>
 )}

 {/* ==================== ÜRÜN TABLOSU ==================== */}
 <div className="flex-1 min-w-0">
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="flex flex-col items-center justify-center p-12 text-current" role="status">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current mb-3" />
 <span>Yükleniyor...</span>
 </div>
 ) : products.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-12 text-current">
 <div className="text-5xl mb-3">📦</div>
 <div className="text-lg font-medium text-current">Ürün bulunamadı</div>
 <p className="text-sm text-current mt-1">
 {hasActiveFilters ? 'Filtrelere uygun ürün yok' : 'Henüz hiçbir ürün eklenmemiş'}
 </p>
 {hasActiveFilters && (
 <button type="button" onClick={clearFilters} className="mt-4 btn-ghost px-4 py-2 transition-colors">
 Filtreleri Temizle
 </button>
 )}
 </div>
 ) : (
 <div className="overflow-x-auto" role="table" aria-label="Ürün listesi">
 <table className="w-full">
 <thead className="bg-slate-50 dark:bg-slate-800/30 sticky top-0 z-10">
 <tr>
 <th className="sticky left-0 z-20 bg-transparent px-3 py-3 text-left w-10" scope="col">
 <input type="checkbox" checked={allSelected}
 onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current focus:ring-0"
 aria-label="Tümünü seç" />
 </th>
 <th className="sticky left-10 z-20 bg-transparent px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[180px]" scope="col">Ürün</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[90px]" scope="col">SKU</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[100px]" scope="col">Barkod</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[80px]" scope="col">XML Kaynak</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[120px]" scope="col">Kategori / Marka</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[80px]" scope="col">Stok</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[100px]" scope="col">Alış / Satış</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[60px]" scope="col">KDV</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[60px]" scope="col">Kar</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[120px]" scope="col">Durum</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[80px]" scope="col">Kalite</th>
 <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current min-w-[90px]" scope="col">Son Güncelleme</th>
 <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-current min-w-[80px]" scope="col">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {products.map((product) => {
 const stockStatus = getStockStatus(product.stock, product.minStock);
 const images = getImageList(product.images);
 const quality = getQualityLevel(product.aiScore);
 const profitMargin = calculateProfitMargin(product.salePrice, product.purchasePrice, product.profitMargin);

 return (
 <tr key={product.id}
 className={cn(
 'transition-colors cursor-pointer',
 selectedProducts.has(product.id) ? 'bg-transparent' : 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700',
 )}
 onClick={() => openProductDetail(product)}
 tabIndex={0}
 onKeyDown={(e) => { if (e.key === 'Enter') openProductDetail(product); }}
 role="row"
 aria-selected={selectedProducts.has(product.id)}
 >
 {/* Checkbox */}
 <td className="sticky left-0 z-10 bg-transparent px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
 <input type="checkbox" checked={selectedProducts.has(product.id)}
 onChange={() => toggleSelect(product.id)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current focus:ring-0"
 aria-label={`${product.title || product.xmlKey} seç`} />
 </td>
 {/* Ürün Adı + Resim */}
 <td className="sticky left-10 z-10 bg-transparent px-3 py-2.5">
 <div className="flex items-center gap-2.5">
 {images.length > 0 ? (
 <img src={images[0]} alt="" className="h-9 w-9 rounded-lg object-cover bg-transparent shrink-0"
 onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23334155" width="100" height="100"/><text fill="%2394a3b8" font-size="12" x="50" y="55" text-anchor="middle">📦</text></svg>'; }} />
 ) : (
 <div className="h-9 w-9 rounded-lg bg-transparent flex items-center justify-center text-current shrink-0" aria-hidden="true">📦</div>
 )}
 <div className="min-w-0">
 <div className="text-sm font-medium text-current truncate max-w-[200px]">{product.title || product.xmlKey}</div>
 <div className="text-xs text-current font-mono truncate">{product.xmlKey}</div>
 {product.xmlSource && (
 <div className="text-xs text-current">{product.xmlSource.name}</div>
 )}
 </div>
 </div>
 </td>
 {/* SKU */}
 <td className="px-3 py-2.5 text-sm text-current font-mono">{product.sku || '-'}</td>
 {/* Barkod */}
 <td className="px-3 py-2.5 text-sm text-current">{product.barcode || '-'}</td>
 {/* XML Kaynak */}
 <td className="px-3 py-2.5 text-sm text-current">{product.xmlSource?.name || '-'}</td>
 {/* Kategori / Marka */}
 <td className="px-3 py-2.5">
 <div className="flex items-center gap-1.5">
 <span className={`text-xs ${product.categoryMatch ? 'text-current' : 'text-current'}`}>
 {product.category?.name || (product.categoryMatch ? '✅' : '❌')}
 </span>
 <span className="text-slate-700 dark:text-slate-300" aria-hidden="true">/</span>
 <span className={`text-xs ${product.brandMatch ? 'text-current' : 'text-current'}`}>
 {product.brand?.name || (product.brandMatch ? '✅' : '❌')}
 </span>
 </div>
 </td>
 {/* Stok */}
 <td className="px-3 py-2.5">
 <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stockStatus.color}`}
 aria-label={`Stok: ${product.stock}, ${stockStatus.label}`}>
 {product.stock}
 </span>
 </td>
 {/* Alış / Satış */}
 <td className="px-3 py-2.5 text-sm">
 <div className="text-slate-700 dark:text-slate-300">{formatPrice(product.purchasePrice)}</div>
 <div className="text-current font-medium">{formatPrice(product.salePrice)}</div>
 </td>
 {/* KDV */}
 <td className="px-3 py-2.5 text-sm text-current">%{product.vatRate ?? '-'}</td>
 {/* Kar Marjı */}
 <td className="px-3 py-2.5 text-sm">
 {profitMargin != null ? (
 <span className={profitMargin >= 20 ? 'text-current' : profitMargin >= 10 ? 'text-current' : 'text-current'}>
 %{profitMargin.toFixed(1)}
 </span>
 ) : '-'}
 </td>
 {/* Durum */}
 <td className="px-3 py-2.5">
 <span className={`rounded-full px-2.5 py-1 text-xs font-medium border ${STATUS_BADGE_COLORS[product.status] || 'bg-primary/10 text-primary border-current'}`}>
 {STATUS_BADGE_LABELS[product.status] || product.status}
 </span>
 </td>
 {/* Kalite Skoru */}
 <td className="px-3 py-2.5">
 <div className="flex items-center gap-1.5">
 <div className="h-1.5 w-16 rounded-full bg-transparent overflow-hidden" role="progressbar" aria-valuenow={product.aiScore ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`Kalite skoru: ${product.aiScore ?? 0}/100`}>
 <div className={`h-full rounded-full transition-all ${quality.color}`}
 style={{ width: `${product.aiScore ?? 0}%` }} />
 </div>
 <span className="text-xs text-current">{quality.label}</span>
 </div>
 </td>
 {/* Son Güncelleme */}
 <td className="px-3 py-2.5 text-xs text-current">
 {new Date(product.updatedAt).toLocaleDateString('tr-TR')}
 </td>
 {/* İşlem */}
 <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-end gap-1">
 <button type="button" onClick={() => openProductDetail(product)}
 className="rounded p-1.5 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current transition-colors"
 aria-label={`${product.title || product.xmlKey} detayını görüntüle`}>🔍</button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Pagination */}
 {pagination.totalPages > 1 && (
 <nav className="flex flex-col sm:flex-row items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 backdrop-blur-sm mt-4 gap-3" aria-label="Sayfalama">
 <div className="text-sm text-current">
 Toplam {pagination.total.toLocaleString('tr-TR')} ürün, Sayfa {pagination.page}/{pagination.totalPages}
 </div>
 <div className="flex gap-2">
 <button type="button"
 onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
 disabled={pagination.page <= 1}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50 transition-colors"
 aria-label="Önceki sayfa">
 ◀ Önceki
 </button>
 <button type="button"
 onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
 disabled={pagination.page >= pagination.totalPages}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50 transition-colors"
 aria-label="Sonraki sayfa">
 Sonraki ▶
 </button>
 </div>
 </nav>
 )}
 </div>
 </div>

 {/* ==================== ÜRÜN DETAY MODAL ==================== */}
 <Modal
 open={showDetailModal}
 onClose={() => { setShowDetailModal(false); setSelectedProduct(null); }}
 title={selectedProduct?.title || selectedProduct?.xmlKey || ''}
 subtitle={selectedProduct?.xmlKey}
 maxWidth="4xl"
 >
 {selectedProduct && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Sol - Resimler */}
 <div>
 <h4 className="text-sm font-semibold text-current mb-2">Görseller</h4>
 {getImageList(selectedProduct.images).length > 0 ? (
 <div className="grid grid-cols-2 gap-2">
 {getImageList(selectedProduct.images).map((img, idx) => (
 <img key={idx} src={img} alt={`Ürün görsel ${idx + 1}`}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 object-cover h-36 w-full bg-transparent"
 onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
 ))}
 </div>
 ) : (
 <div className="flex items-center justify-center h-36 rounded-lg bg-primary/10 text-primary">Resim Yok</div>
 )}

 {/* Kalite Skoru */}
 {selectedProduct.aiScore != null && (
 <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-3">Kalite Skoru: {selectedProduct.aiScore}/100</h4>
 <div className="h-2 w-full rounded-full bg-transparent overflow-hidden" role="progressbar" aria-valuenow={selectedProduct.aiScore} aria-valuemin={0} aria-valuemax={100}>
 <div className={`h-full rounded-full transition-all ${ selectedProduct.aiScore >= 70 ? 'bg-transparent' : selectedProduct.aiScore >= 40 ? 'bg-transparent' : 'bg-transparent' }`} style={{ width: `${selectedProduct.aiScore}%` }} />
 </div>
 </div>
 )}

 {/* XML Bilgisi */}
 {selectedProduct.xmlSource && (
 <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">XML Kaynağı</h4>
 <div className="text-sm text-current">{selectedProduct.xmlSource.name}</div>
 {selectedProduct.xmlSource.company && (
 <div className="text-xs text-current">{selectedProduct.xmlSource.company}</div>
 )}
 </div>
 )}
 </div>

 {/* Sağ - Bilgiler */}
 <div className="space-y-4">
 {/* Temel Bilgiler */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-3">Temel Bilgiler</h4>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">SKU:</span> <span className="text-current ml-1">{selectedProduct.sku || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Barkod:</span> <span className="text-current ml-1">{selectedProduct.barcode || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Stok:</span> <span className="text-current ml-1">{selectedProduct.stock}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Min Stok:</span> <span className="text-current ml-1">{selectedProduct.minStock}</span></div>
 </div>
 </div>

 {/* Fiyat Bilgileri */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-3">Fiyat Bilgileri</h4>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">Alış:</span> <span className="text-current ml-1">{formatPrice(selectedProduct.purchasePrice)}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Satış:</span> <span className="text-current ml-1 font-medium">{formatPrice(selectedProduct.salePrice)}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">KDV:</span> <span className="text-current ml-1">%{selectedProduct.vatRate ?? '-'}</span></div>
 </div>
 </div>

 {/* Eşleştirme Durumu */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-3">Eşleştirme Durumu</h4>
 <div className="flex flex-wrap gap-2">
 <span className={`rounded-full px-2 py-1 text-xs font-medium ${selectedProduct.categoryMatch ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
 {selectedProduct.categoryMatch ? '✅ Kategori' : '❌ Kategori'}
 </span>
 <span className={`rounded-full px-2 py-1 text-xs font-medium ${selectedProduct.brandMatch ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
 {selectedProduct.brandMatch ? '✅ Marka' : '❌ Marka'}
 </span>
 <span className={`rounded-full px-2 py-1 text-xs font-medium ${selectedProduct.variantMatch ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
 {selectedProduct.variantMatch ? '✅ Varyant' : '❌ Varyant'}
 </span>
 <span className={`rounded-full px-2 py-1 text-xs font-medium ${selectedProduct.templateMatch ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>
 {selectedProduct.templateMatch ? '✅ Şablon' : '❌ Şablon'}
 </span>
 </div>
 </div>

 {/* Varyantlar */}
 {selectedProduct.variants && selectedProduct.variants.length > 0 && (
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">Varyantlar</h4>
 <div className="flex flex-wrap gap-2">
 {selectedProduct.variants.map((v) => (
 <span key={v.id} className="rounded-lg bg-transparent px-2 py-1 text-xs text-current">
 {v.name}: {v.value}
 </span>
 ))}
 </div>
 </div>
 )}

 {/* Hata Mesajı */}
 {selectedProduct.errorMessage && (
 <div className="rounded-lg bg-transparent p-3 text-sm text-current" role="alert">
 {selectedProduct.errorMessage}
 </div>
 )}

 {/* Tarihler */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">Kayıt Bilgileri</h4>
 <div className="grid grid-cols-2 gap-2 text-xs">
 <div><span className="text-slate-700 dark:text-slate-300">Oluşturma:</span> <span className="text-current ml-1">{new Date(selectedProduct.createdAt).toLocaleString('tr-TR')}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Güncelleme:</span> <span className="text-current ml-1">{new Date(selectedProduct.updatedAt).toLocaleString('tr-TR')}</span></div>
 </div>
 </div>
 </div>
 </div>
 )}
 </Modal>
 </div>
 );
}

// ==================== STATUS BADGE HELPERS ====================
const STATUS_BADGE_COLORS: Record<string, string> = {
 XML: 'bg-primary/10 text-primary border-current',
 READY: 'bg-primary/10 text-primary border-current',
 DRAFT: 'bg-primary/10 text-primary border-current',
 SENT: 'bg-primary/10 text-primary border-current',
 PASSIVE: 'bg-primary/10 text-primary border-current',
 ERROR: 'bg-primary/10 text-primary border-current',
};

const STATUS_BADGE_LABELS: Record<string, string> = {
 XML: '🆕 Yeni', READY: '✅ Hazır', DRAFT: '⚠️ Eksik Bilgi',
 SENT: '📤 Gönderildi', PASSIVE: '⏸️ Pasif', ERROR: '❌ Hatalı',
};
