// ==================== VARYANT EŞLEŞTİRME MERKEZİ V6.0 ENTERPRISE ====================
// DG STOK V5.0 - IQ300 Master Prompt Implementation
// Professional Virtual DataGrid - 100K ürün desteği
// Sabit kolonlar + Yatay kaydırma + Canlı durum paneli + AI destekli toplu eşleştirme
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';

// ==================== TYPES ====================

interface LiveStats {
 totalVariantProducts: number;
 totalParentProducts: number;
 totalChildSkus: number;
 aiCompleted: number;
 manualPending: number;
 errorProducts: number;
 readyProducts: number;
 successRate: number;
 lastUpdate: string;
 marketplaceKey: string;
}

interface ParentProduct {
 parentSku: string;
 title: string;
 brandName: string | null;
 totalVariants: number;
 variantStatus: 'ready' | 'partial' | 'pending' | 'error';
 childrenCount: number;
 totalStock: number;
 children: ChildProduct[];
}

interface ChildProduct {
 id: string;
 sku: string | null;
 xmlKey: string;
 title: string | null;
 barcode: string | null;
 stock: number;
 status: string;
 variantMatch: boolean;
 brandName: string | null;
 variants: Array<{ id: string; name: string; value: string }>;
}

interface VariantSuggestion {
 name: string;
 value: string;
 confidence: number;
 source: string;
}

interface MarketplaceItem {
 id: string;
 key: string;
 name: string;
}

interface PageInfo {
 page: number;
 pageSize: number;
 total: number;
 totalPages: number;
}

// ==================== CONSTANTS ====================

const PAGE_SIZES = [50, 100, 200, 500, 1000];

const STATUS_ICONS: Record<string, { icon: string; color: string; label: string }> = {
 ready: { icon: '🟢', color: 'text-current', label: 'Hazır' },
 partial: { icon: '🟡', color: 'text-current', label: 'Kısmi' },
 pending: { icon: '🔴', color: 'text-current', label: 'Bekliyor' },
 error: { icon: '⛔', color: 'text-current', label: 'Hatalı' },
};

const VARIANT_COLORS = [
 { name: 'Renk', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Beden', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Numara', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Kapasite', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Hacim', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Materyal', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Model', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Desen', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
 { name: 'Ölçü', bg: 'bg-transparent', text: 'text-current', border: 'border-current' },
];

// ==================== COMPONENT ====================

export default function VariantsPage() {
 // ==================== STATE ====================
 const [marketplaces, setMarketplaces] = useState<MarketplaceItem[]>([]);
 const [activeMarketplace, setActiveMarketplace] = useState('trendyol');
 const [stats, setStats] = useState<LiveStats | null>(null);
 const [parents, setParents] = useState<ParentProduct[]>([]);
 const [pagination, setPagination] = useState<PageInfo>({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
 const [search, setSearch] = useState('');
 const [statusFilter, setStatusFilter] = useState('');
 const [pageSize, setPageSize] = useState(50);
 const [currentPage, setCurrentPage] = useState(1);
 const [loading, setLoading] = useState(true);
 const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
 const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
 const [selectAll, setSelectAll] = useState(false);

 // AI / Modal states
 const [showAiModal, setShowAiModal] = useState(false);
 const [aiSuggestions, setAiSuggestions] = useState<Array<{ productId: string; productTitle: string; suggestions: VariantSuggestion[] }>>([]);
 const [aiLoading, setAiLoading] = useState(false);
 const [showTestModal, setShowTestModal] = useState(false);
 const [testResults, setTestResults] = useState<Array<{ name: string; passed: boolean; duration: number; details: string }>>([]);
 const [showMappingModal, setShowMappingModal] = useState(false);
 const [mappingXmlValue, setMappingXmlValue] = useState('');
 const [mappingAttrType, setMappingAttrType] = useState('Renk');
 const [mappingResult, setMappingResult] = useState<{ mappedValue: string; confidence: number; source: string } | null>(null);

 const scrollRef = useRef<HTMLDivElement>(null);

 // ==================== API ====================

 const fetchMarketplaces = useCallback(async () => {
 const res = await apiFetch<{ items: MarketplaceItem[] }>('/variants/vcm/marketplaces');
 if (res.ok && res.data) setMarketplaces(res.data.items);
 }, []);

 const fetchStats = useCallback(async () => {
 const res = await apiFetch<LiveStats>(`/variants/vcm/live-stats?marketplace=${activeMarketplace}`);
 if (res.ok && res.data) setStats(res.data);
 }, [activeMarketplace]);

 const fetchParents = useCallback(async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams({
 marketplace: activeMarketplace,
 page: String(currentPage),
 pageSize: String(pageSize),
 search,
 status: statusFilter,
 });
 const res = await apiFetch<{ items: ParentProduct[]; pagination: PageInfo }>(
 `/variants/vcm/parent-products?${params}`
 );
 if (res.ok && res.data) {
 setParents(res.data.items);
 setPagination(res.data.pagination);
 }
 } catch (err) {
 console.error('[VCM] fetch error:', err);
 } finally {
 setLoading(false);
 }
 }, [activeMarketplace, currentPage, pageSize, search, statusFilter]);

 useEffect(() => { fetchMarketplaces(); }, []);
 useEffect(() => { fetchStats(); }, [activeMarketplace]);
 useEffect(() => { fetchParents(); }, [activeMarketplace, currentPage, pageSize, search, statusFilter]);

 // Auto-refresh stats every 15 seconds
 useEffect(() => {
 const interval = setInterval(fetchStats, 15000);
 return () => clearInterval(interval);
 }, [fetchStats]);

 // ==================== HANDLERS ====================

 const handleMarketplaceChange = (key: string) => {
 setActiveMarketplace(key);
 setCurrentPage(1);
 setSelectedRows(new Set());
 setSelectAll(false);
 setExpandedRows(new Set());
 };

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setCurrentPage(1);
 };

 const toggleRowExpand = (sku: string) => {
 const next = new Set(expandedRows);
 if (next.has(sku)) next.delete(sku);
 else next.add(sku);
 setExpandedRows(next);
 };

 const toggleRowSelect = (sku: string) => {
 const next = new Set(selectedRows);
 if (next.has(sku)) next.delete(sku);
 else next.add(sku);
 setSelectAll(false);
 setSelectedRows(next);
 };

 const toggleSelectAll = () => {
 if (selectAll) {
 setSelectedRows(new Set());
 setSelectAll(false);
 } else {
 const all = new Set(parents.map(p => p.parentSku));
 setSelectedRows(all);
 setSelectAll(true);
 }
 };

 const getSelectedProductIds = useCallback((): string[] => {
 const ids: string[] = [];
 for (const parent of parents) {
 if (selectedRows.has(parent.parentSku)) {
 for (const child of parent.children) {
 ids.push(child.id);
 }
 }
 }
 return ids;
 }, [parents, selectedRows]);

 // ==================== AI OPERATIONS ====================

 const handleAiSuggest = async () => {
 const productIds = getSelectedProductIds();
 if (productIds.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }
 setAiLoading(true);
 try {
 const res = await apiFetch<{
 totalScanned: number;
 totalSuggestions: number;
 results: Array<{ productId: string; productTitle: string; suggestions: VariantSuggestion[] }>;
 }>('/variants/vcm/ai-suggest-batch', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: productIds.slice(0, 500) }),
 });
 if (res.ok && res.data) {
 setAiSuggestions(res.data.results);
 setShowAiModal(true);
 showToast('success', `🤖 AI ${res.data.totalSuggestions} öneri buldu`);
 }
 } catch (err) {
 showToast('error', 'AI öneri başarısız');
 } finally {
 setAiLoading(false);
 }
 };

 const handleAiAutoApply = async () => {
 const productIds = getSelectedProductIds();
 if (productIds.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }
 setAiLoading(true);
 try {
 const res = await apiFetch<{
 autoApplied: number;
 needsApproval: number;
 message: string;
 }>('/variants/vcm/ai-auto-apply', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: productIds.slice(0, 500) }),
 });
 if (res.ok && res.data) {
 showToast('success', `🤖 ${res.data.message}`);
 fetchParents();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'AI otomatik uygulama başarısız');
 } finally {
 setAiLoading(false);
 }
 };

 const handleBatchApply = async () => {
 const productIds = getSelectedProductIds();
 if (productIds.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }
 try {
 // Apply detected variants from AI suggestions
 const matches = aiSuggestions
 .filter(s => productIds.includes(s.productId))
 .map(s => ({
 productId: s.productId,
 variants: s.suggestions.map(v => ({ name: v.name, value: v.value })),
 }));

 if (matches.length === 0) {
 showToast('warning', 'Önce AI önerisi alın');
 return;
 }

 const res = await apiFetch<{
 totalCreated: number;
 message: string;
 }>('/variants/vcm/batch-apply', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ matches }),
 });
 if (res.ok && res.data) {
 showToast('success', `✅ ${res.data.message}`);
 setShowAiModal(false);
 fetchParents();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Toplu uygulama başarısız');
 }
 };

 // ==================== VALIDATION ====================

 const handleValidate = async () => {
 const productIds = getSelectedProductIds();
 if (productIds.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }
 try {
 const res = await apiFetch<{
 totalChecked: number;
 ready: number;
 needsReview: number;
 blocked: number;
 results: Array<{ productId: string; score: number; validationStatus: string; errors: string[] }>;
 }>('/variants/vcm/validate', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: productIds.slice(0, 500), marketplaceKey: activeMarketplace }),
 });
 if (res.ok && res.data) {
 const summary = `✅ ${res.data.ready} Hazır | 🟡 ${res.data.needsReview} İnceleme | ⛔ ${res.data.blocked} Engelli`;
 showToast('info', `Doğrulama: ${summary}`);
 }
 } catch (err) {
 showToast('error', 'Doğrulama başarısız');
 }
 };

 // ==================== TEST CENTER ====================

 const handleTest = async () => {
 setShowTestModal(true);
 try {
 const res = await apiFetch<{
 allPassed: boolean;
 totalDuration: number;
 tests: Array<{ name: string; passed: boolean; duration: number; details: string }>;
 }>('/variants/vcm/test', { method: 'POST' });
 if (res.ok && res.data) {
 setTestResults(res.data.tests);
 if (res.data.allPassed) {
 showToast('success', `✅ Tüm testler başarılı (${res.data.totalDuration}ms)`);
 } else {
 showToast('error', '❌ Bazı testler başarısız');
 }
 }
 } catch (err) {
 showToast('error', 'Test başarısız');
 }
 };

 // ==================== SCAN / RESCAN ====================

 const handleRescan = async () => {
 showToast('info', '🔍 Varyant grupları taranıyor...');
 try {
 const res = await apiFetch<{
 newGroupsFound: number;
 productsGrouped: number;
 message: string;
 }>('/variants/vcm/scan', { method: 'POST' });
 if (res.ok && res.data) {
 showToast('success', `🔍 ${res.data.message}`);
 fetchParents();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Tarama başarısız');
 }
 };

 // ==================== MAPPING ====================

 const handleMapValue = async () => {
 if (!mappingXmlValue.trim()) return;
 try {
 const res = await apiFetch<{ mappedValue: string; confidence: number; source: string }>(
 '/variants/vcm/map-value',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 xmlValue: mappingXmlValue,
 attributeType: mappingAttrType,
 marketplaceKey: activeMarketplace,
 }),
 }
 );
 if (res.ok && res.data) {
 setMappingResult(res.data);
 }
 } catch (err) {
 showToast('error', 'Eşleştirme başarısız');
 }
 };

 // ==================== HELPERS ====================

 function getVariantColor(name: string) {
 return VARIANT_COLORS.find(v => v.name === name) || VARIANT_COLORS[0];
 }

 function getConfidenceColor(confidence: number) {
 if (confidence >= 99) return 'bg-primary/10 text-primary border-current';
 if (confidence >= 95) return 'bg-primary/10 text-primary border-current';
 if (confidence >= 90) return 'bg-primary/10 text-primary border-current';
 if (confidence >= 80) return 'bg-primary/10 text-primary border-current';
 return 'bg-primary/10 text-primary border-current';
 }

 // ==================== RENDER ====================

 return (
 <div className="space-y-4">
 {/* ========== ÜST PANEL ========== */}
 <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 backdrop-blur-sm">
 <div className="flex items-center gap-4">
 <div>
 <label className="block text-[10px] font-medium uppercase tracking-wider text-current mb-1">Pazaryeri</label>
 <div className="flex gap-1">
 {marketplaces.length > 0 ? marketplaces.map(mp => (
 <button
 key={mp.key}
 onClick={() => handleMarketplaceChange(mp.key)}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${ activeMarketplace === mp.key ? 'bg-primary text-white shadow-lg shadow-primary/25 ' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-current' }`}
 >
 {mp.name}
 </button>
 )) : (
 <select
 value={activeMarketplace}
 onChange={(e) => handleMarketplaceChange(e.target.value)}
 className="select-theme px-3 py-1.5"
 >
 <option value="trendyol">Trendyol</option>
 <option value="hepsiburada">Hepsiburada</option>
 <option value="amazon">Amazon</option>
 <option value="n11">N11</option>
 </select>
 )}
 </div>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <input
 type="text"
 value={search}
 onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
 placeholder="Ürün, SKU, barkod ara..."
 className="w-56 input-theme px-3 py-1.5 focus:border-current focus:outline-none"
 />
 <select
 value={statusFilter}
 onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
 className="select-theme px-3 py-1.5"
 >
 <option value="">Tümü</option>
 <option value="ready">Hazır</option>
 <option value="pending">Bekleyen</option>
 <option value="error">Hatalı</option>
 </select>
 </div>
 </div>

 {/* ========== CANLI DURUM PANELİ ========== */}
 {stats && (
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
 <StatCard
 label="Toplam Varyantlı Ürün"
 value={(stats.totalVariantProducts ?? 0).toLocaleString()}
 icon="📦"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Toplam Parent Ürün"
 value={(stats.totalParentProducts ?? 0).toLocaleString()}
 icon="👑"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Toplam Çocuk SKU"
 value={(stats.totalChildSkus ?? 0).toLocaleString()}
 icon="🔗"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="AI Tamamlanan"
 value={(stats.aiCompleted ?? 0).toLocaleString()}
 icon="🤖"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Manuel Bekleyen"
 value={(stats.manualPending ?? 0).toLocaleString()}
 icon="⏳"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Hatalı"
 value={(stats.errorProducts ?? 0).toLocaleString()}
 icon="⛔"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Hazır"
 value={(stats.readyProducts ?? 0).toLocaleString()}
 icon="✅"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <StatCard
 label="Başarı Oranı"
 value={`%${stats.successRate ?? 0}`}
 icon="📊"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor={(stats.successRate ?? 0) >= 80 ? 'text-current' : (stats.successRate ?? 0) >= 50 ? 'text-current' : 'text-current'}
 />
 </div>
 )}

 {/* ========== TOPLU İŞLEM ARAÇ ÇUBUĞU ========== */}
 <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <div className="flex items-center gap-2">
 <label className="flex items-center gap-1.5 text-xs text-current cursor-pointer hover:text-current">
 <input
 type="checkbox"
 checked={selectAll}
 onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 Hepsini Seç ({parents.length})
 </label>
 {selectedRows.size > 0 && (
 <span className="text-xs text-current font-medium">{selectedRows.size} seçili</span>
 )}
 </div>

 <div className="flex flex-wrap items-center gap-1.5">
 <ActionButton onClick={handleAiSuggest} disabled={aiLoading || selectedRows.size === 0} icon="🤖" label="AI Öner" color="purple" />
 <ActionButton onClick={handleAiAutoApply} disabled={aiLoading || selectedRows.size === 0} icon="⚡" label="AI Otomatik" color="indigo" />
 <ActionButton onClick={handleValidate} disabled={selectedRows.size === 0} icon="✅" label="Test Et" color="emerald" />
 {showAiModal && (
 <ActionButton onClick={handleBatchApply} icon="💾" label="Kaydet" color="blue" />
 )}
 <ActionButton onClick={handleRescan} icon="🔄" label="Yeniden Tara" color="slate" />
 <ActionButton onClick={handleTest} icon="🧪" label="Test Merkezi" color="amber" />
 <ActionButton onClick={() => setShowMappingModal(true)} icon="🔗" label="Varyant Eşleştir" color="teal" />
 </div>

 {/* Sayfa Boyutu */}
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] text-current uppercase">Sayfa</span>
 {PAGE_SIZES.map(size => (
 <button
 key={size}
 onClick={() => handlePageSizeChange(size)}
 className={`rounded px-2 py-0.5 text-xs font-medium transition-all ${ pageSize === size ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 {size}
 </button>
 ))}
 </div>
 </div>

 {/* ========== DATAGRID ========== */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm overflow-hidden">
 {/* Grid Container */}
 <div className="relative">
 {/* Horizontal Scroll Area */}
 <div
 ref={scrollRef}
 className="overflow-x-auto overflow-y-hidden"
 style={{ maxHeight: 'calc(100vh - 380px)' }}
 onWheel={(e) => {
 // Shift + Mouse Wheel = horizontal scroll
 if (e.shiftKey) {
 e.preventDefault();
 if (scrollRef.current) {
 scrollRef.current.scrollLeft += e.deltaY;
 }
 }
 }}
 >
 <table className="w-full min-w-[1200px]">
 {/* HEADER */}
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
 {/* Fixed Columns */}
 <THFixed style={{ width: 40 }}>
 <input
 type="checkbox"
 checked={selectAll}
 onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 </THFixed>
 <THFixed style={{ width: 32 }}>▶</THFixed>
 <THFixed style={{ width: 200, minWidth: 200 }}>Ürün</THFixed>
 <THFixed style={{ width: 120, minWidth: 120 }}>Parent SKU</THFixed>
 <THFixed style={{ width: 80, minWidth: 80 }}>Stok</THFixed>
 <THFixed style={{ width: 130, minWidth: 130 }}>Barkod</THFixed>
 <THFixed style={{ width: 100, minWidth: 100 }}>Marka</THFixed>
 <THFixed style={{ width: 90, minWidth: 90 }}>Durum</THFixed>

 {/* Scrollable Variant Columns */}
 {['Renk', 'Beden', 'Numara', 'Kapasite', 'Hacim', 'Materyal', 'Model', 'Desen', 'Ölçü', 'AI', 'Validation'].map(col => (
 <TH key={col} style={{ width: 100, minWidth: 100 }}>{col}</TH>
 ))}
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan={20} className="text-center py-12">
 <div className="flex items-center justify-center gap-2 text-current">
 <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
 <span className="text-sm">Yükleniyor...</span>
 </div>
 </td>
 </tr>
 ) : parents.length === 0 ? (
 <tr>
 <td colSpan={20} className="text-center py-12 text-sm text-slate-600 dark:text-slate-400">
 {search ? 'Aramanızla eşleşen ürün bulunamadı' : 'Varyantlı ürün bulunamadı. "Yeniden Tara" butonunu kullanın.'}
 </td>
 </tr>
 ) : (
 parents.map((parent) => (
 <React.Fragment key={parent.parentSku}>
 {/* Parent Row */}
 <tr
 className={`border-b border-slate-100 dark:border-slate-800/60 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer ${ selectedRows.has(parent.parentSku) ? 'bg-transparent' : '' }`}
 onClick={() => toggleRowExpand(parent.parentSku)}
 >
 <TDFixed>
 <input
 type="checkbox"
 checked={selectedRows.has(parent.parentSku)}
 onChange={() => toggleRowSelect(parent.parentSku)}
 onClick={(e) => e.stopPropagation()}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 </TDFixed>
 <TDFixed>
 <span className={`transition-transform inline-block ${expandedRows.has(parent.parentSku) ? 'rotate-90' : ''}`}>
 ▶
 </span>
 </TDFixed>
 <TDFixed>
 <div className="truncate max-w-[190px]" title={parent.title}>
 <span className="text-sm text-current font-medium">{parent.title}</span>
 </div>
 </TDFixed>
 <TDFixed>
 <code className="rounded bg-transparent px-1.5 py-0.5 text-xs font-mono text-current">
 {parent.parentSku}
 </code>
 </TDFixed>
 <TDFixed>
 <span className={`text-sm font-medium ${parent.totalStock > 0 ? 'text-current' : 'text-current'}`}>
 {parent.totalStock}
 </span>
 </TDFixed>
 <TDFixed>
 <span className="text-xs text-current font-mono">
 {parent.children[0]?.barcode || '-'}
 </span>
 </TDFixed>
 <TDFixed>
 <span className="text-xs text-current">{parent.brandName || '-'}</span>
 </TDFixed>
 <TDFixed>
 <StatusBadge status={parent.variantStatus} />
 </TDFixed>

 {/* Scrollable Cells - Summary */}
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Renk')}
 color="pink"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Beden')}
 color="blue"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Numara')}
 color="green"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Kapasite')}
 color="purple"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Hacim')}
 color="cyan"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Materyal')}
 color="orange"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Model')}
 color="indigo"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Desen')}
 color="rose"
 />
 </TD>
 <TD>
 <VariantSummaryBadge
 variants={parent.children.flatMap(c => c.variants).filter(v => v.name === 'Ölçü')}
 color="teal"
 />
 </TD>
 <TD>
 <span className={`text-xs font-medium ${parent.variantStatus === 'ready' ? 'text-current' : 'text-current'}`}>
 {parent.variantStatus === 'ready' ? '✅' : '⏳'}
 </span>
 </TD>
 <TD>
 <span className={`text-xs font-medium ${ parent.variantStatus === 'ready' ? 'text-current' : parent.variantStatus === 'partial' ? 'text-current' : 'text-current' }`}>
 {parent.variantStatus === 'ready' ? '🟢' :
 parent.variantStatus === 'partial' ? '🟡' : '🔴'}
 </span>
 </TD>
 </tr>

 {/* Expanded Child Rows */}
 {expandedRows.has(parent.parentSku) && parent.children.map((child) => (
 <tr
 key={child.id}
 className="border-b border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 >
 <TDFixed>{' '}</TDFixed>
 <TDFixed>
 <span className="text-[10px] text-current ml-1">└</span>
 </TDFixed>
 <TDFixed>
 <div className="flex items-center gap-1.5">
 <span className="h-1.5 w-1.5 rounded-full bg-transparent shrink-0" />
 <span className="text-xs text-current truncate max-w-[180px]">{child.title || child.xmlKey}</span>
 </div>
 </TDFixed>
 <TDFixed>
 <code className="text-[11px] font-mono text-current">{child.sku || '-'}</code>
 </TDFixed>
 <TDFixed>
 <span className={`text-xs font-medium ${child.stock > 0 ? 'text-current' : 'text-current'}`}>
 {child.stock}
 </span>
 </TDFixed>
 <TDFixed>
 <code className="text-[11px] font-mono text-current">{child.barcode || '-'}</code>
 </TDFixed>
 <TDFixed>
 <span className="text-[11px] text-current">{child.brandName || '-'}</span>
 </TDFixed>
 <TDFixed>
 {child.variantMatch ? (
 <span className="text-[10px] text-current">🟢</span>
 ) : (
 <span className="text-[10px] text-current">🟡</span>
 )}
 </TDFixed>

 {/* Child Variant Values */}
 {['Renk', 'Beden', 'Numara', 'Kapasite', 'Hacim', 'Materyal', 'Model', 'Desen', 'Ölçü'].map(attr => {
 const variant = child.variants.find(v => v.name === attr);
 return (
 <TD key={attr}>
 {variant ? (
 <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] text-current font-medium">
 {variant.value}
 </span>
 ) : (
 <span className="text-[11px] text-current">-</span>
 )}
 </TD>
 );
 })}
 <TD>{' '}</TD>
 <TD>{' '}</TD>
 </tr>
 ))}
 </React.Fragment>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Pagination Footer */}
 {pagination.totalPages > 0 && (
 <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-4 py-2.5">
 <div className="text-xs text-current">
 Toplam {pagination.total} ürün · Sayfa {pagination.page}/{pagination.totalPages}
 </div>
 <div className="flex items-center gap-1">
 <PagButton onClick={() => setCurrentPage(1)} disabled={currentPage === 1} label="««" />
 <PagButton onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} label="«" />
 <span className="px-3 py-1 text-xs text-current">
 {currentPage} / {pagination.totalPages}
 </span>
 <PagButton onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))} disabled={currentPage === pagination.totalPages} label="»" />
 <PagButton onClick={() => setCurrentPage(pagination.totalPages)} disabled={currentPage === pagination.totalPages} label="»»" />
 </div>
 </div>
 )}
 </div>

 {/* ========== AI MODAL ========== */}
 {showAiModal && (
 <Modal onClose={() => setShowAiModal(false)} title="🤖 AI Varyant Önerileri">
 <div className="max-h-96 overflow-y-auto space-y-3">
 {aiSuggestions.length === 0 ? (
 <div className="text-sm text-current text-center py-8">AI önerisi bulunamadı</div>
 ) : (
 aiSuggestions.map((item) => (
 <div key={item.productId} className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-sm font-medium text-current mb-2 truncate">{item.productTitle}</div>
 <div className="flex flex-wrap gap-1.5">
 {item.suggestions.map((s, i) => (
 <span
 key={i}
 className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getConfidenceColor(s.confidence)}`}
 >
 {s.name}: {s.value}
 <span className="opacity-70">(%{s.confidence})</span>
 </span>
 ))}
 </div>
 </div>
 ))
 )}
 </div>
 <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <button onClick={() => setShowAiModal(false)} className="btn-ghost px-4 py-2">
 Kapat
 </button>
 <button onClick={handleBatchApply} className="btn-ghost px-4 py-2">
 💾 Önerileri Uygula
 </button>
 </div>
 </Modal>
 )}

 {/* ========== TEST MODAL ========== */}
 {showTestModal && (
 <Modal onClose={() => setShowTestModal(false)} title="🧪 Test Merkezi">
 <div className="space-y-2">
 {testResults.length === 0 ? (
 <div className="flex items-center justify-center py-8">
 <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
 </div>
 ) : (
 testResults.map((test, i) => (
 <div key={i} className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${ test.passed ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40' : 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40' }`}>
 <div className="flex items-center gap-2">
 <span className={test.passed ? 'text-current' : 'text-current'}>
 {test.passed ? '✅' : '❌'}
 </span>
 <div>
 <span className="text-sm text-current font-medium">{test.name}</span>
 <span className="text-xs text-current ml-2">({test.duration}ms)</span>
 </div>
 </div>
 <span className={`text-xs ${test.passed ? 'text-current' : 'text-current'}`}>
 {test.details}
 </span>
 </div>
 ))
 )}
 </div>
 <div className="flex justify-end mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <button onClick={() => setShowTestModal(false)} className="btn-ghost px-4 py-2">
 Kapat
 </button>
 </div>
 </Modal>
 )}

 {/* ========== MAPPING MODAL ========== */}
 {showMappingModal && (
 <Modal onClose={() => setShowMappingModal(false)} title="🔗 Varyant Eşleştirme">
 <div className="space-y-4">
 <p className="text-sm text-current">XML varyant değerini pazaryeri değerine eşleştirin</p>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Varyant Tipi</label>
 <select
 value={mappingAttrType}
 onChange={(e) => setMappingAttrType(e.target.value)}
 className="w-full select-theme px-3 py-2"
 >
 {['Renk', 'Beden', 'Numara', 'Kapasite', 'Hacim', 'Materyal', 'Model'].map(t => (
 <option key={t} value={t}>{t}</option>
 ))}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">XML Değeri</label>
 <input
 type="text"
 value={mappingXmlValue}
 onChange={(e) => setMappingXmlValue(e.target.value)}
 placeholder="Örn: Black, XL, 42..."
 className="w-full input-theme px-3 py-2"
 />
 </div>
 </div>
 <button
 onClick={handleMapValue}
 disabled={!mappingXmlValue.trim()}
 className="w-full btn-ghost px-4 py-2 disabled:opacity-50"
 >
 🔗 Eşleştir
 </button>
 {mappingResult && (
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-sm text-current font-medium">Eşleşme Sonucu</div>
 <div className="mt-2 flex items-center gap-2">
 <span className="rounded-lg bg-transparent px-2 py-1 text-sm text-current">{mappingXmlValue}</span>
 <span className="text-slate-700 dark:text-slate-300">→</span>
 <span className="rounded-lg bg-transparent px-2 py-1 text-sm text-current font-medium">{mappingResult.mappedValue}</span>
 </div>
 <div className="mt-2 flex gap-2 text-xs">
 <span className={`rounded-full px-2 py-0.5 font-medium ${getConfidenceColor(mappingResult.confidence)}`}>
 Güven: %{mappingResult.confidence}
 </span>
 <span className="rounded-full bg-transparent px-2 py-0.5 text-current">
 Kaynak: {mappingResult.source}
 </span>
 </div>
 </div>
 )}
 </div>
 <div className="flex justify-end mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <button onClick={() => { setShowMappingModal(false); setMappingResult(null); setMappingXmlValue(''); }}
 className="btn-ghost px-4 py-2">
 Kapat
 </button>
 </div>
 </Modal>
 )}
 </div>
 );
}

// ==================== SUB-COMPONENTS ====================

function TH({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return (
 <th className="sticky top-0 z-10 whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent backdrop-blur-sm border-b border-slate-100 dark:border-slate-800/60"
 style={style}>
 {children}
 </th>
 );
}

function THFixed({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return (
 <th className="sticky left-0 z-20 whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent backdrop-blur-sm border-b border-slate-100 dark:border-slate-800/60 border-r border-current"
 style={style}>
 {children}
 </th>
 );
}

function TD({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return (
 <td className="whitespace-nowrap px-3 py-2 text-sm" style={style}>{children}</td>
 );
}

function TDFixed({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return (
 <td className="sticky left-0 z-10 whitespace-nowrap px-3 py-2 text-sm bg-transparent border-r border-current" style={style}>
 {children}
 </td>
 );
}

function StatCard({ label, value, icon, color, textColor }: {
 label: string; value: string; icon: string; color: string; textColor: string;
}) {
 return (
 <div className={`rounded-xl border ${color} p-3 backdrop-blur-sm transition-all hover:scale-[1.02]`}>
 <div className="flex items-center gap-1.5 mb-1">
 <span className="text-xs">{icon}</span>
 <span className="text-[10px] text-current uppercase tracking-wider">{label}</span>
 </div>
 <div className={`text-lg font-bold ${textColor}`}>{value}</div>
 </div>
 );
}

function StatusBadge({ status }: { status: string }) {
 const info = STATUS_ICONS[status] || STATUS_ICONS.pending;
 return (
 <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${info.color} bg-transparent`}>
 {info.icon} {info.label}
 </span>
 );
}

function VariantSummaryBadge({ variants, color }: { variants: Array<{ name: string; value: string }>; color: string }) {
 if (variants.length === 0) return <span className="text-xs text-current">-</span>;
 const uniqueValues = [...new Set(variants.map(v => v.value))];
 return (
 <div className="flex flex-wrap gap-0.5">
 {uniqueValues.slice(0, 3).map((val, i) => (
 <span key={i} className={`inline-flex items-center rounded-full bg-${color}-500/10 px-1.5 py-0.5 text-[10px] text-${color}-400 border border-${color}-500/20`}>
 {val}
 </span>
 ))}
 {uniqueValues.length > 3 && (
 <span className="text-[10px] text-current">+{uniqueValues.length - 3}</span>
 )}
 </div>
 );
}

function ActionButton({ onClick, disabled, icon, label, color }: {
 onClick: () => void; disabled?: boolean; icon: string; label: string; color: string;
}) {
 const colorMap: Record<string, string> = {
 blue: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 purple: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 indigo: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 emerald: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 amber: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 slate: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 teal: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 green: 'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current',
 };
 return (
 <button
 onClick={onClick}
 disabled={disabled}
 className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${colorMap[color] || colorMap.slate}`}
 >
 {icon} {label}
 </button>
 );
}

function PagButton({ onClick, disabled, label }: {
 onClick: () => void; disabled: boolean; label: string;
}) {
 return (
 <button
 onClick={onClick}
 disabled={disabled}
 className="btn-ghost px-2.5 py-1.5 hover:text-current disabled:opacity-30 disabled:cursor-not-allowed transition-all"
 >
 {label}
 </button>
 );
}

function Modal({ children, onClose, title }: {
 children: React.ReactNode; onClose: () => void; title: string;
}) {
 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
 <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-base font-semibold text-current">{title}</h3>
 <button onClick={onClose} className="rounded-lg p-1.5 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
 <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 </div>
 {children}
 </div>
 </div>
 );
}
