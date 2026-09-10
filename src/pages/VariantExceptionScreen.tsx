// ==================== VARYANT MOTORU V2.0 - İSTİSNA YÖNETİM EKRANI ====================
// DG STOK V5.0 - Akıllı Doğrulama ve İstisna Yönetimi
// Yalnızca gerçek pazaryeri sorunu oluşturacak ürünler gösterilir
// ======================================================================================
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';

// ==================== TYPES ====================

interface V2Stats {
 totalProducts: number;
 xmlVariant: number; // XML'den doğru gelen
 autoCreated: number; // DG STOK otomatik oluşturdu
 autoSuggest: number; // Otomatik onay bekleyen (80-94)
 manualReview: number; // Manuel inceleme (0-79)
 errors: number; // Kesin hatalı
}

interface ScreenProduct {
 id: string;
 sku: string | null;
 xmlKey: string;
 title: string | null;
 barcode: string | null;
 brandName: string | null;
 categoryName: string | null;
 xmlSourceName: string | null;
 confidence: number;
 status: string;
 reason: string | null;
 suggestedAction: string | null;
 hasColor: boolean;
 hasSize: boolean;
 hasNumber: boolean;
 parentSku: string | null;
 groupId: string | null;
}

interface AutoMatchPreview {
 productId: string;
 parentSku: string;
 groupId: string;
 confidence: number;
}

// ==================== CONSTANTS ====================

const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
 AUTO_ACCEPTED: { label: 'Otomatik Kabul', icon: '✅', color: 'text-current', bg: 'bg-transparent' },
 AUTO_SUGGEST: { label: 'Onay Bekliyor', icon: '🤖', color: 'text-current', bg: 'bg-transparent' },
 MANUAL_REVIEW: { label: 'Manuel İnceleme', icon: '🔍', color: 'text-current', bg: 'bg-transparent' },
 ERROR: { label: 'Kesin Hatalı', icon: '⛔', color: 'text-current', bg: 'bg-transparent' },
};

const REASON_ICONS: Record<string, string> = {
 'Parent Bilgisi Eksik': '🔗',
 'Aynı Ürün Ailesi Belirlenemedi': '👥',
 'Çakışan Barkod': '📋',
 'Çakışan SKU': '🔢',
 'Attribute Eksik': '⚙️',
 'Kategoriye Uygun Değil': '📂',
 'Pazaryeri Kuralı Eksik': '🛒',
};

// ==================== COMPONENT ====================

export default function VariantExceptionScreen() {
 // State
 const [stats, setStats] = useState<V2Stats | null>(null);
 const [products, setProducts] = useState<ScreenProduct[]>([]);
 const [total, setTotal] = useState(0);
 const [page, setPage] = useState(1);
 const [limit] = useState(50);
 const [search, setSearch] = useState('');
 const [statusFilter, setStatusFilter] = useState('all');
 const [loading, setLoading] = useState(true);
 const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
 const [selectAll, setSelectAll] = useState(false);

 // Modal states
 const [showAutoMatchPreview, setShowAutoMatchPreview] = useState(false);
 const [autoMatchPreview, setAutoMatchPreview] = useState<AutoMatchPreview[]>([]);
 const [autoMatchLoading, setAutoMatchLoading] = useState(false);
 const [showManualMatch, setShowManualMatch] = useState(false);
 const [manualGroupId, setManualGroupId] = useState('');
 const [manualParentSku, setManualParentSku] = useState('');

 // ==================== API ====================

 const fetchStats = useCallback(async () => {
 const res = await apiFetch<{ stats: V2Stats }>('/variants/stats');
 if (res.ok && res.data) setStats(res.data.stats);
 }, []);

 const fetchProducts = useCallback(async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams({
 page: String(page),
 limit: String(limit),
 status: statusFilter,
 ...(search ? { search } : {}),
 });
 const res = await apiFetch<{ items: ScreenProduct[]; total: number }>(
 `/variants/screen?${params}`
 );
 if (res.ok && res.data) {
 setProducts(res.data.items);
 setTotal(res.data.total);
 }
 } catch (err) {
 console.error('[VariantExceptionScreen] fetch error:', err);
 } finally {
 setLoading(false);
 }
 }, [page, limit, search, statusFilter]);

 useEffect(() => { fetchStats(); }, []);
 useEffect(() => { fetchProducts(); }, [page, search, statusFilter]);

 // ==================== HANDLERS ====================

 const toggleSelect = (id: string) => {
 const next = new Set(selectedIds);
 if (next.has(id)) next.delete(id);
 else next.add(id);
 setSelectAll(false);
 setSelectedIds(next);
 };

 const toggleSelectAll = () => {
 if (selectAll) {
 setSelectedIds(new Set());
 setSelectAll(false);
 } else {
 setSelectedIds(new Set(products.map(p => p.id)));
 setSelectAll(true);
 }
 };

 const getSelectedProductIds = (): string[] => {
 if (selectAll) return products.map(p => p.id);
 return Array.from(selectedIds);
 };

 // ==================== AUTO MATCH ====================

 const handleAutoMatch = async () => {
 const ids = getSelectedProductIds();
 if (ids.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }

 setAutoMatchLoading(true);
 try {
 const res = await apiFetch<{ matched: number; failed: number; preview: AutoMatchPreview[] }>(
 '/variants/auto-match',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: ids }),
 }
 );
 if (res.ok && res.data) {
 setAutoMatchPreview(res.data.preview);
 setShowAutoMatchPreview(true);
 if (res.data.matched > 0) {
 showToast('success', `${res.data.matched} ürün eşleştirildi, önizleme gösteriliyor`);
 } else {
 showToast('warning', 'Hiçbir ürün otomatik eşleştirilemedi');
 }
 }
 } catch (err) {
 showToast('error', 'Otomatik eşleştirme başarısız');
 } finally {
 setAutoMatchLoading(false);
 }
 };

 const handleConfirmAutoMatch = async () => {
 try {
 const res = await apiFetch<{ ok: boolean; totalUpdated: number }>(
 '/variants/confirm-match',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ matches: autoMatchPreview }),
 }
 );
 if (res.ok && res.data) {
 showToast('success', `${res.data.totalUpdated} ürün onaylandı`);
 setShowAutoMatchPreview(false);
 setAutoMatchPreview([]);
 setSelectedIds(new Set());
 fetchProducts();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Onaylama başarısız');
 }
 };

 // ==================== MANUAL MATCH ====================

 const handleManualMatch = async () => {
 const ids = getSelectedProductIds();
 if (ids.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }
 setManualGroupId(`DG_GRP_${Date.now()}`);
 setManualParentSku(products.find(p => ids.includes(p.id))?.sku || '');
 setShowManualMatch(true);
 };

 const handleConfirmManualMatch = async () => {
 const ids = getSelectedProductIds();
 if (!manualParentSku.trim()) {
 showToast('warning', 'Parent SKU gerekli');
 return;
 }

 try {
 const res = await apiFetch<{ ok: boolean; totalUpdated: number }>(
 '/variants/manual-match',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 matches: [{ productIds: ids, parentSku: manualParentSku.trim(), groupId: manualGroupId }],
 }),
 }
 );
 if (res.ok && res.data) {
 showToast('success', `${res.data.totalUpdated} ürün manuel eşleştirildi`);
 setShowManualMatch(false);
 setSelectedIds(new Set());
 fetchProducts();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Manuel eşleştirme başarısız');
 }
 };

 // ==================== APPROVE SELECTED ====================

 const handleApproveSelected = async () => {
 const ids = getSelectedProductIds();
 if (ids.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }

 try {
 const res = await apiFetch<{ ok: boolean; updated: number }>(
 '/variants/approve',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: ids }),
 }
 );
 if (res.ok && res.data) {
 showToast('success', `${res.data.updated} ürün onaylandı`);
 setSelectedIds(new Set());
 fetchProducts();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Onaylama başarısız');
 }
 };

 // ==================== REANALYZE ====================

 const handleReanalyze = async () => {
 const ids = getSelectedProductIds();
 if (ids.length === 0) {
 showToast('warning', 'Lütfen en az bir ürün seçin');
 return;
 }

 try {
 const res = await apiFetch<{ ok: boolean; stats: V2Stats }>(
 '/variants/reanalyze',
 {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productIds: ids }),
 }
 );
 if (res.ok) {
 showToast('success', `${ids.length} ürün yeniden analiz edildi`);
 setSelectedIds(new Set());
 fetchProducts();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Yeniden analiz başarısız');
 }
 };

 // ==================== SCAN ALL ====================

 const handleScanAll = async () => {
 showToast('info', '🔍 Tüm ürünler taranıyor...');
 try {
 const res = await apiFetch<{ ok: boolean; stats: V2Stats }>(
 '/variants/scan',
 { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
 );
 if (res.ok) {
 showToast('success', `Tarama tamamlandı`);
 fetchProducts();
 fetchStats();
 }
 } catch (err) {
 showToast('error', 'Tarama başarısız');
 }
 };

 // ==================== HELPERS ====================

 function getStatusInfo(status: string) {
 return STATUS_CONFIG[status] || STATUS_CONFIG.MANUAL_REVIEW;
 }

 function getConfidenceColor(confidence: number) {
 if (confidence >= 95) return 'text-current';
 if (confidence >= 80) return 'text-current';
 if (confidence >= 50) return 'text-current';
 return 'text-current';
 }

 function getConfidenceBar(confidence: number) {
 const color = confidence >= 95 ? 'bg-transparent'
 : confidence >= 80 ? 'bg-transparent'
 : confidence >= 50 ? 'bg-transparent'
 : 'bg-transparent';
 return (
 <div className="flex items-center gap-2">
 <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${confidence}%` }} />
 </div>
 <span className={`text-xs font-mono font-medium ${getConfidenceColor(confidence)}`}>
 %{confidence}
 </span>
 </div>
 );
 }

 function getReasonIcon(reason: string | null): string {
 if (!reason) return 'ℹ️';
 for (const [key, icon] of Object.entries(REASON_ICONS)) {
 if (reason.includes(key) || reason.toLowerCase().includes(key.toLowerCase())) return icon;
 }
 return '⚠️';
 }

 // ==================== RENDER ====================

 return (
 <div className="space-y-4">
 {/* ========== ÜST KPI PANELİ ========== */}
 {stats && (
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
 <KpiCard
 label="Toplam Ürün"
 value={(stats.totalProducts ?? 0).toLocaleString()}
 icon="📦"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <KpiCard
 label="XML'den Doğru Gelen"
 value={(stats.xmlVariant ?? 0).toLocaleString()}
 icon="✅"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <KpiCard
 label="DG Otomatik Oluşturdu"
 value={(stats.autoCreated ?? 0).toLocaleString()}
 icon="🤖"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <KpiCard
 label="Otomatik Onay Bekleyen"
 value={(stats.autoSuggest ?? 0).toLocaleString()}
 icon="⏳"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <KpiCard
 label="Manuel İnceleme"
 value={(stats.manualReview ?? 0).toLocaleString()}
 icon="🔍"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 <KpiCard
 label="Kesin Hatalı"
 value={(stats.errors ?? 0).toLocaleString()}
 icon="⛔"
 color="border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40"
 textColor="text-current"
 />
 </div>
 )}

 {/* ========== ARAÇ ÇUBUĞU ========== */}
 <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <div className="flex items-center gap-2">
 <label className="flex items-center gap-1.5 text-xs text-current cursor-pointer hover:text-current">
 <input
 type="checkbox"
 checked={selectAll}
 onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 Tümünü Seç ({products.length})
 </label>
 {selectedIds.size > 0 && (
 <span className="text-xs text-current font-medium">{selectedIds.size} seçili</span>
 )}
 </div>

 <div className="flex flex-wrap items-center gap-1.5">
 <button
 onClick={handleScanAll}
 className="btn-ghost px-2.5 py-1.5 transition-all"
 >
 🔄 Tarama Başlat
 </button>
 <button
 onClick={handleAutoMatch}
 disabled={autoMatchLoading || selectedIds.size === 0 && !selectAll}
 className="btn-ghost px-2.5 py-1.5 disabled:opacity-40 transition-all"
 >
 {autoMatchLoading ? '⏳ Eşleştiriliyor...' : '🤖 Otomatik Eşleştir'}
 </button>
 <button
 onClick={handleManualMatch}
 disabled={selectedIds.size === 0 && !selectAll}
 className="btn-ghost px-2.5 py-1.5 disabled:opacity-40 transition-all"
 >
 👤 Manuel Eşleştir
 </button>
 <button
 onClick={handleApproveSelected}
 disabled={selectedIds.size === 0 && !selectAll}
 className="btn-ghost px-2.5 py-1.5 disabled:opacity-40 transition-all"
 >
 ✅ Seçilenleri Onayla
 </button>
 <button
 onClick={handleReanalyze}
 disabled={selectedIds.size === 0 && !selectAll}
 className="btn-ghost px-2.5 py-1.5 disabled:opacity-40 transition-all"
 >
 🔄 Tekrar Analiz Et
 </button>
 </div>

 {/* Arama ve filtre */}
 <div className="flex items-center gap-2">
 <input
 type="text"
 value={search}
 onChange={(e) => { setSearch(e.target.value); setPage(1); }}
 placeholder="Ürün, SKU, barkod ara..."
 className="w-48 input-theme px-3 py-1.5 focus:border-current focus:outline-none"
 />
 <select
 value={statusFilter}
 onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
 className="select-theme px-3 py-1.5"
 >
 <option value="all">Tümü (Hatalı + İnceleme)</option>
 <option value="ERROR">Kesin Hatalı</option>
 <option value="MANUAL_REVIEW">Manuel İnceleme</option>
 <option value="AUTO_SUGGEST">Onay Bekleyen</option>
 <option value="AUTO_ACCEPTED">Otomatik Kabul</option>
 </select>
 </div>
 </div>

 {/* ========== GRID ========== */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm overflow-hidden">
 <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 380px)' }}>
 <table className="w-full min-w-[1100px]">
 {/* HEADER */}
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
 <th className="sticky top-0 z-10 w-10 px-3 py-2.5 bg-transparent border-r border-current">
 <input
 type="checkbox"
 checked={selectAll}
 onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 </th>
 <th className="sticky top-0 z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent border-r border-current min-w-[200px]">
 Ürün
 </th>
 <TH>XML Kaynağı</TH>
 <TH>Kategori</TH>
 <TH>Marka</TH>
 <TH>Renk</TH>
 <TH>Beden</TH>
 <TH>Numara</TH>
 <TH>DG Güven Skoru</TH>
 <TH>Sorun Nedeni</TH>
 <TH>Önerilen İşlem</TH>
 <TH>Durum</TH>
 <TH className="min-w-[180px]">İşlem</TH>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td colSpan={13} className="text-center py-12">
 <div className="flex items-center justify-center gap-2 text-current">
 <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
 <span className="text-sm">Yükleniyor...</span>
 </div>
 </td>
 </tr>
 ) : products.length === 0 ? (
 <tr>
 <td colSpan={13} className="text-center py-12 text-sm text-slate-600 dark:text-slate-400">
 {search ? 'Aramanızla eşleşen ürün bulunamadı' : 'İstisna bulunamadı. Tüm ürünler başarıyla analiz edildi.'}
 </td>
 </tr>
 ) : (
 products.map((product) => {
 const statusInfo = getStatusInfo(product.status);
 return (
 <tr
 key={product.id}
 className={`border-b border-slate-100 dark:border-slate-800/60 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20 ${ selectedIds.has(product.id) ? 'bg-transparent' : '' }`}
 >
 <td className="px-3 py-2 border-r border-current">
 <input
 type="checkbox"
 checked={selectedIds.has(product.id)}
 onChange={() => toggleSelect(product.id)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 </td>
 <td className="px-3 py-2 border-r border-current">
 <div className="flex flex-col">
 <span className="text-sm text-current font-medium truncate max-w-[190px]" title={product.title || ''}>
 {product.title || product.xmlKey}
 </span>
 <code className="text-[10px] font-mono text-current mt-0.5">
 {product.sku || product.xmlKey}
 </code>
 </div>
 </td>
 <td className="px-3 py-2">
 <span className="text-xs text-current">{product.xmlSourceName || '-'}</span>
 </td>
 <td className="px-3 py-2">
 <span className="text-xs text-current">{product.categoryName || '-'}</span>
 </td>
 <td className="px-3 py-2">
 <span className="text-xs text-current">{product.brandName || '-'}</span>
 </td>
 <td className="px-3 py-2">
 {product.hasColor ? (
 <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] text-current">✓</span>
 ) : (
 <span className="text-xs text-current">-</span>
 )}
 </td>
 <td className="px-3 py-2">
 {product.hasSize ? (
 <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] text-current">✓</span>
 ) : (
 <span className="text-xs text-current">-</span>
 )}
 </td>
 <td className="px-3 py-2">
 {product.hasNumber ? (
 <span className="inline-flex items-center rounded-full bg-transparent px-2 py-0.5 text-[11px] text-current">✓</span>
 ) : (
 <span className="text-xs text-current">-</span>
 )}
 </td>
 <td className="px-3 py-2">
 {getConfidenceBar(product.confidence)}
 </td>
 <td className="px-3 py-2">
 <div className="flex items-center gap-1.5">
 <span>{getReasonIcon(product.reason)}</span>
 <span className="text-xs text-current max-w-[140px] truncate" title={product.reason || ''}>
 {product.reason || 'Belirlenmedi'}
 </span>
 </div>
 </td>
 <td className="px-3 py-2">
 <span className="text-[11px] text-current">{product.suggestedAction || '-'}</span>
 </td>
 <td className="px-3 py-2">
 <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusInfo.color} ${statusInfo.bg}`}>
 {statusInfo.icon} {statusInfo.label}
 </span>
 </td>
 <td className="px-3 py-2">
 <div className="flex gap-1">
 <button
 onClick={() => {
 setSelectedIds(new Set([product.id]));
 handleAutoMatch();
 }}
 className="rounded bg-transparent px-2 py-1 text-[10px] font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all"
 >
 🔗 Otomatik Eşleştir
 </button>
 <button
 onClick={() => {
 setSelectedIds(new Set([product.id]));
 handleManualMatch();
 }}
 className="rounded bg-transparent px-2 py-1 text-[10px] font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all"
 >
 ✏️ Manuel Eşleştir
 </button>
 </div>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>

 {/* Pagination */}
 {total > 0 && (
 <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-4 py-2.5">
 <div className="text-xs text-current">
 Toplam {total} ürün · Sayfa {page}/{Math.ceil(total / limit)}
 </div>
 <div className="flex items-center gap-1">
 <PagButton onClick={() => setPage(1)} disabled={page === 1} label="««" />
 <PagButton onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} label="«" />
 <span className="px-3 py-1 text-xs text-current">{page} / {Math.ceil(total / limit)}</span>
 <PagButton onClick={() => setPage(p => Math.min(Math.ceil(total / limit), p + 1))} disabled={page >= Math.ceil(total / limit)} label="»" />
 <PagButton onClick={() => setPage(Math.ceil(total / limit))} disabled={page >= Math.ceil(total / limit)} label="»»" />
 </div>
 </div>
 )}
 </div>

 {/* ========== AUTO MATCH PREVIEW MODAL ========== */}
 {showAutoMatchPreview && (
 <Modal onClose={() => setShowAutoMatchPreview(false)} title="🤖 Otomatik Eşleştirme Önizleme">
 <div className="space-y-3">
 <p className="text-sm text-current">
 {autoMatchPreview.length} ürün için eşleştirme önerisi bulundu.
 Onaylarsanız aşağıdaki gruplar oluşturulacak:
 </p>
 <div className="max-h-64 overflow-y-auto space-y-2">
 {autoMatchPreview.map((preview, i) => (
 <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="flex items-center justify-between">
 <div>
 <code className="text-xs font-mono text-current">ID: {preview.productId.substring(0, 8)}...</code>
 <div className="mt-1">
 <span className="text-[11px] text-current">Parent SKU: </span>
 <code className="text-xs font-mono text-current">{preview.parentSku}</code>
 </div>
 </div>
 <span className={`text-xs font-mono font-medium ${getConfidenceColor(preview.confidence)}`}>
 %{preview.confidence}
 </span>
 </div>
 </div>
 ))}
 </div>
 </div>
 <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <button
 onClick={() => setShowAutoMatchPreview(false)}
 className="btn-ghost px-4 py-2"
 >
 İptal
 </button>
 <button
 onClick={handleConfirmAutoMatch}
 className="btn-ghost px-4 py-2"
 >
 ✅ Onayla ve Kaydet
 </button>
 </div>
 </Modal>
 )}

 {/* ========== MANUAL MATCH MODAL ========== */}
 {showManualMatch && (
 <Modal onClose={() => setShowManualMatch(false)} title="✏️ Manuel Eşleştirme">
 <div className="space-y-4">
 <p className="text-sm text-current">
 Seçilen {selectedIds.size || products.length} ürünü aynı varyant grubuna ekleyin.
 </p>
 <div>
 <label className="block text-xs text-current mb-1">Parent SKU</label>
 <input
 type="text"
 value={manualParentSku}
 onChange={(e) => setManualParentSku(e.target.value)}
 placeholder="Örn: AIRMAX-2000"
 className="w-full input-theme px-3 py-2"
 />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Grup ID</label>
 <code className="text-xs font-mono text-current bg-transparent px-2 py-1 rounded">
 {manualGroupId}
 </code>
 </div>
 </div>
 <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <button
 onClick={() => setShowManualMatch(false)}
 className="btn-ghost px-4 py-2"
 >
 İptal
 </button>
 <button
 onClick={handleConfirmManualMatch}
 disabled={!manualParentSku.trim()}
 className="btn-ghost px-4 py-2 disabled:opacity-50"
 >
 💾 Kaydet
 </button>
 </div>
 </Modal>
 )}
 </div>
 );
}

// ==================== SUB-COMPONENTS ====================

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
 return (
 <th className={`sticky top-0 z-10 whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent backdrop-blur-sm border-b border-slate-100 dark:border-slate-800/60 ${className || ''}`}>
 {children}
 </th>
 );
}

function KpiCard({ label, value, icon, color, textColor }: {
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
 <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
