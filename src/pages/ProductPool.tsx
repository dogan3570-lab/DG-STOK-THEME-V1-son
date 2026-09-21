// ==================== URUN HAVUZU V2.0 ====================
// DG STOK V5.0 - Profesyonel Virtual DataGrid
// 100.000+ urun destegi, Server-side pagination, Sticky columns
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { formatPrice, getImageList, getStockStatus, cn, formatDateTime } from '../lib/utils';
import { STATUS_BADGE_COLORS, STATUS_BADGE_LABELS } from '../lib/constants';

// ==================== TYPES ====================
interface ProductItem {
 id: string; xmlKey: string; title: string | null;
 sku: string | null; barcode: string | null; stock: number; minStock: number;
 purchasePrice: number | null; salePrice: number | null; vatRate: number | null;
 profitMargin: number | null; images: string | null; status: string;
 errorMessage: string | null; aiScore: number | null;
  categoryMatch?: boolean; brandMatch?: boolean; variantMatch?: boolean; templateMatch?: boolean;
  marketplaceBlocked?: boolean;
 categoryId: string | null; brandId: string | null; xmlSourceId: string | null;
 supplierCategory: string | null;
 prefixEnabled?: boolean;
 computedTitle?: string | null;
 category?: { id: string; name: string } | null;
 brand?: { id: string; name: string } | null;
 xmlSource?: { id: string; name: string; company?: string | null } | null;
 variants?: Array<{ id: string; name: string; value: string }>;
 createdAt: string; updatedAt: string;
 // WorkflowState verileri
 readiness?: number;
 readinessColor?: string;
 readinessLabel?: string;
 workflowStatus?: string;
 stepCategory?: string;
 stepBrand?: string;
 stepVariant?: string;
 stepTitle?: string;
 // Marketplace durumları
 marketplaceStates?: Array<{ key: string; name: string; status: string }>;
}

interface Pagination { page: number; limit: number; total: number; totalPages: number; }

interface PoolStats {
 totalProducts: number; readyForListing: number; newProducts: number;
 marketplaceReady: number; marketplaceBlocked: number;
 pendingCategory: number; pendingBrand: number; pendingVariant: number;
 variantAnalysisPending: number; // Varyant Motoru V2 (manuel + hatalı)
 errorProducts: number;
}

const PAGE_SIZES = [50, 100, 200, 500, 1000];

// ==================== DRAWER COMPONENT ====================
function ProductDrawer({ product, onClose }: { product: ProductItem | null; onClose: () => void }) {
 const [activeTab, setActiveTab] = useState('genel');
 const [fullProduct, setFullProduct] = useState<ProductItem | null>(null);

 useEffect(() => {
 if (product?.id) {
 apiFetch<ProductItem>(`/products/${product.id}`).then(res => {
 if (res.ok && res.data) setFullProduct(res.data);
 });
 }
 }, [product?.id]);

 if (!product) return null;

 const p = fullProduct || product;
 const tabs = [
 { key: 'genel', label: 'Genel', icon: '📋' },
 { key: 'fiyat', label: 'Fiyat', icon: '💰' },
 { key: 'kategori', label: 'Kategori', icon: '🗂️' },
 { key: 'marka', label: 'Marka', icon: '🏷️' },
 { key: 'varyant', label: 'Varyant', icon: '🧬' },
 { key: 'attributes', label: 'Attributes', icon: '🏷️' },
 { key: 'resimler', label: 'Resimler', icon: '🖼️' },
 { key: 'pazaryerleri', label: 'Pazaryerleri', icon: '🛒' },
 { key: 'log', label: 'Log', icon: '📝' },
 ];

 // Readiness score
 const readinessScore = p.aiScore ?? 0;
 const readinessColor = readinessScore >= 100 ? 'bg-transparent' : readinessScore >= 70 ? 'bg-transparent' : 'bg-transparent';
 const readinessLabel = readinessScore >= 100 ? 'Hazır' : readinessScore >= 70 ? 'Bekliyor' : 'Eksik';

 return (
 <div className="fixed inset-0 z-50 flex justify-end bg-transparent/40 backdrop-blur-sm" onClick={onClose}>
 <div className="w-full max-w-2xl bg-transparent border-l border-current h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
 {/* Header */}
 <div className="sticky top-0 z-10 bg-transparent border-b border-slate-100 dark:border-slate-800/60 p-4 flex items-center justify-between">
 <div className="min-w-0 flex-1">
 <h3 className="text-base font-semibold text-current truncate">{p.title || p.xmlKey}</h3>
 <p className="text-xs text-current font-mono truncate">{p.xmlKey} · {p.sku || '-'}</p>
 </div>
 <button onClick={onClose} className="rounded-lg p-2 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current ml-3 shrink-0">
 ✕
 </button>
 </div>

 {/* Readiness Bar */}
 <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/60">
 <div className="flex items-center justify-between mb-1">
 <span className="text-xs text-current">Hazırlık Skoru</span>
 <span className={`text-xs font-bold ${readinessScore >= 100 ? 'text-current' : readinessScore >= 70 ? 'text-current' : 'text-current'}`}>
 {readinessScore}% - {readinessLabel}
 </span>
 </div>
 <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div className={`h-full rounded-full transition-all ${readinessColor}`} style={{ width: `${Math.min(100, readinessScore)}%` }} />
 </div>
 </div>

 {/* Tabs */}
 <div className="flex gap-1 p-3 border-b border-slate-100 dark:border-slate-800/60 overflow-x-auto">
 {tabs.map(tab => (
 <button key={tab.key} onClick={() => setActiveTab(tab.key)}
 className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${ activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50/50 dark:hover:bg-slate-800/20' }`}>
 {tab.icon} {tab.label}
 </button>
 ))}
 </div>

 {/* Content */}
 <div className="p-4 space-y-4">
 {activeTab === 'genel' && (
 <div className="grid grid-cols-2 gap-3">
 <InfoRow label="SKU" value={p.sku || '-'} />
 <InfoRow label="Barkod" value={p.barcode || '-'} />
 <InfoRow label="Stok" value={String(p.stock)} />
 <InfoRow label="Min Stok" value={String(p.minStock)} />
 <InfoRow label="XML Kaynak" value={p.xmlSource?.name || '-'} />
 <InfoRow label="Durum" value={p.status} />
 <InfoRow label="Kategori" value={p.category?.name || (p.categoryMatch ? '✅' : '❌')} />
 <InfoRow label="Marka" value={p.brand?.name || (p.brandMatch ? '✅' : '❌')} />
 <InfoRow label="Varyant" value={p.variantMatch ? '✅' : '❌'} />
 <InfoRow label="Şablon" value={p.templateMatch ? '✅' : '❌'} />
 <InfoRow label="Oluşturma" value={formatDateTime(p.createdAt)} />
 <InfoRow label="Güncelleme" value={formatDateTime(p.updatedAt)} />
 </div>
 )}
 {activeTab === 'fiyat' && (
 <div className="grid grid-cols-2 gap-3">
 <InfoRow label="Alış Fiyatı (KDV Dahil)" value={formatPrice(p.purchasePrice)} />
 <InfoRow label="Satış Fiyatı" value={formatPrice(p.salePrice)} />
 <InfoRow label="KDV Oranı" value={p.vatRate ? `%${p.vatRate}` : '-'} />
 <InfoRow label="Kar Marjı" value={p.profitMargin ? `%${p.profitMargin}` : '-'} />
 </div>
 )}
 {activeTab === 'kategori' && (
 <div>
 <InfoRow label="XML Kategorisi" value={p.supplierCategory || '-'} />
 <InfoRow label="Sistem Kategorisi" value={p.category?.name || '-'} />
 <InfoRow label="AI Skoru" value={p.aiScore != null ? `%${Math.round(p.aiScore * 100)}` : '-'} />
 </div>
 )}
 {activeTab === 'marka' && (
 <div>
 <InfoRow label="XML Markası" value={p.xmlSource?.name || '-'} />
 <InfoRow label="DG Markası" value={p.brand?.name || '-'} />
 <InfoRow label="Ön Ek" value={p.prefixEnabled ? '✅ Aktif' : '❌ Pasif'} />
 <InfoRow label="Başlık" value={p.computedTitle || p.title || '-'} />
 </div>
 )}
 {activeTab === 'varyant' && p.variants && (
 <div className="flex flex-wrap gap-2">
 {p.variants.map(v => (
 <span key={v.id} className="rounded-lg bg-transparent px-2.5 py-1.5 text-xs text-current">
 {v.name}: <span className="text-current font-medium">{v.value}</span>
 </span>
 ))}
 {(!p.variants || p.variants.length === 0) && (
 <span className="text-sm text-current">Varyant bulunmuyor</span>
 )}
 </div>
 )}
 {activeTab === 'resimler' && (
 <div className="grid grid-cols-3 gap-2">
 {getImageList(p.images).map((img, i) => (
 <img key={i} src={img} alt={`Görsel ${i + 1}`}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 object-cover h-32 w-full bg-transparent"
 onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
 ))}
 {getImageList(p.images).length === 0 && (
 <span className="text-sm text-current col-span-3 text-center py-8">Resim bulunmuyor</span>
 )}
 </div>
 )}
 {activeTab === 'attributes' && (
 <div className="text-sm text-current">Teknik özellikler burada görüntülenecek</div>
 )}
 {activeTab === 'pazaryerleri' && (
 <div className="text-sm text-current">Pazaryeri durumları burada görüntülenecek</div>
 )}
 {activeTab === 'log' && (
 <div className="text-sm text-current">Değişiklik geçmişi burada görüntülenecek</div>
 )}
 </div>
 </div>
 </div>
 );
}

function InfoRow({ label, value }: { label: string; value: string }) {
 return (
 <div className="rounded-lg bg-transparent p-3">
 <div className="text-[10px] text-current uppercase tracking-wider">{label}</div>
 <div className="text-sm text-current font-medium mt-0.5 break-all">{value}</div>
 </div>
 );
}

// ==================== MAIN COMPONENT ====================
export default function ProductPool() {
 const [stats, setStats] = useState<PoolStats | null>(null);
 const [products, setProducts] = useState<ProductItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState('');
 const [statusFilter, setStatusFilter] = useState('');
 const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
 const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
 const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
 const [showDrawer, setShowDrawer] = useState(false);
 const searchTimer = useRef<ReturnType<typeof setTimeout>>();

 // Reference data for filters
 const [xmlSources, setXmlSources] = useState<Array<{ id: string; name: string }>>([]);
 const [xmlSourceFilter, setXmlSourceFilter] = useState('');

 const fetchStats = useCallback(async () => {
 const res = await apiFetch<PoolStats>('/products/stats');
 if (res.ok && res.data) setStats(res.data);
 }, []);

 const fetchXmlSources = useCallback(async () => {
 const res = await apiFetch<{ items: Array<{ id: string; name: string }> }>('/xml-sources');
 if (res.ok && res.data) setXmlSources(res.data.items || []);
 }, []);

 const fetchProducts = useCallback(async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams({
 page: String(pagination.page),
 limit: String(pagination.limit),
 });
 if (search) params.append('search', search);
 if (statusFilter) params.append('status', statusFilter);
 if (xmlSourceFilter) params.append('xmlSourceId', xmlSourceFilter);

 const res = await apiFetch<{ items: ProductItem[]; pagination: Pagination }>(`/products?${params}`);
 if (res.ok && res.data) {
 setProducts(res.data.items || []);
 setPagination(res.data.pagination);
 }
 } catch {
 showToast('error', 'Ürünler yüklenemedi');
 } finally {
 setLoading(false);
 }
 }, [pagination.page, pagination.limit, search, statusFilter, xmlSourceFilter]);

 useEffect(() => { fetchStats(); fetchXmlSources(); }, []);
 useEffect(() => { fetchProducts(); }, [fetchProducts]);

 const handleSearch = (value: string) => {
 setSearch(value);
 clearTimeout(searchTimer.current);
 searchTimer.current = setTimeout(() => {
 setPagination(prev => ({ ...prev, page: 1 }));
 }, 300);
 };

 const handlePageSizeChange = (size: number) => {
 setPagination(prev => ({ ...prev, limit: size, page: 1 }));
 setSelectedIds(new Set());
 };

 const toggleSelect = (id: string) => {
 setSelectedIds(prev => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id); else next.add(id);
 return next;
 });
 };

 const toggleSelectAll = () => {
 setSelectedIds(prev => prev.size === products.length ? new Set() : new Set(products.map(p => p.id)));
 };

 const openDrawer = (product: ProductItem) => {
 setSelectedProduct(product);
 setShowDrawer(true);
 };

 const allSelected = products.length > 0 && selectedIds.size === products.length;

 return (
 <div className="space-y-4">
 {/* ========== KPI KARTLARI ========== */}
 {stats && (
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-8 gap-3">
 <KpiCard title="Toplam Ürün" value={(stats.totalProducts ?? 0).toLocaleString('tr-TR')} color="blue" />
 <KpiCard title="4/4 Hazırlık" value={(stats.readyForListing ?? 0).toLocaleString('tr-TR')} color="yellow" />
 <KpiCard title="Pazaryeri Gönderilebilir" value={(stats.marketplaceReady ?? 0).toLocaleString('tr-TR')} color="green" />
 <KpiCard title="Kategori Bekleyen" value={(stats.pendingCategory ?? 0).toLocaleString('tr-TR')} color="yellow" />
 <KpiCard title="Marka Bekleyen" value={(stats.pendingBrand ?? 0).toLocaleString('tr-TR')} color="orange" />
 <KpiCard title="Varyant Bekleyen" value={(stats.pendingVariant ?? 0).toLocaleString('tr-TR')} color="purple" />
 <KpiCard title="Varyant V2 ⚠️" value={(stats.variantAnalysisPending ?? 0).toLocaleString('tr-TR')} color="pink" />
 <KpiCard title="Hatalı" value={(stats.errorProducts ?? 0).toLocaleString('tr-TR')} color="red" />
 </div>
 )}

 {/* ========== FILTRELER ========== */}
 <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <div className="relative flex-1">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-400">🔍</span>
 <input type="text" defaultValue={search}
 onChange={e => handleSearch(e.target.value)}
 placeholder="Ürün adı, SKU, barkod ara..."
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 pl-8 pr-3 py-2 text-sm text-current placeholder-current focus:border-current focus:outline-none" />
 </div>
 <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
 className="select-theme px-3 py-2">
 <option value="">Tüm Durum</option>
 <option value="XML">Yeni</option>
 <option value="READY">Hazır</option>
 <option value="DRAFT">Eksik</option>
 <option value="ERROR">Hatalı</option>
 <option value="SENT">Gönderildi</option>
 </select>
 <select value={xmlSourceFilter} onChange={e => { setXmlSourceFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
 className="select-theme px-3 py-2">
 <option value="">Tüm XML</option>
 {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
 </select>
 <div className="flex gap-1">
 {PAGE_SIZES.map(size => (
 <button key={size} onClick={() => handlePageSizeChange(size)}
 className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${ pagination.limit === size ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}>{size}</button>
 ))}
 </div>
 <span className="text-xs text-current whitespace-nowrap">{(pagination.total ?? 0).toLocaleString('tr-TR')} ürün</span>
 </div>

 {/* ========== SEÇIM TOOLBAR ========== */}
 {selectedIds.size > 0 && (
 <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-transparent border border-slate-200 dark:border-slate-800/60">
 <span className="text-sm text-current font-medium">{selectedIds.size} ürün seçili</span>
 <button onClick={() => setSelectedIds(new Set())}
 className="btn-ghost px-3 py-1.5">✕ Seçimi Temizle</button>
 </div>
 )}

 {/* ========== DATA GRID ========== */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm overflow-hidden">
 <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
 <table className="w-full min-w-[1400px]">
 {/* HEADER */}
 <thead className="bg-transparent sticky top-0 z-20">
 <tr>
 <THFixed style={{ width: 40, minWidth: 40 }}>
 <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 </THFixed>
 <THFixed style={{ width: 44, minWidth: 44 }}>Resim</THFixed>
 <THFixed style={{ width: 200, minWidth: 180 }}>Ürün Adı</THFixed>
 <THFixed style={{ width: 100, minWidth: 90 }}>XML Kaynağı</THFixed>
 <THFixed style={{ width: 100, minWidth: 80 }}>Marka</THFixed>
 <THFixed style={{ width: 60, minWidth: 55 }}>Stok</THFixed>
 <THFixed style={{ width: 110, minWidth: 100 }}>Alış Fiyatı (KDV Dahil)</THFixed>
 <THFixed style={{ width: 70, minWidth: 60 }}>Durum</THFixed>

 {/* Scrollable columns */}
 <TH style={{ width: 100, minWidth: 90 }}>SKU</TH>
 <TH style={{ width: 100, minWidth: 90 }}>Barkod</TH>
 <TH style={{ width: 140, minWidth: 120 }}>Kategori</TH>
 <TH style={{ width: 100, minWidth: 80 }}>Varyant</TH>
 <TH style={{ width: 80, minWidth: 70 }}>Renk</TH>
 <TH style={{ width: 80, minWidth: 70 }}>Beden</TH>
 <TH style={{ width: 80, minWidth: 70 }}>Numara</TH>
 <TH style={{ width: 100, minWidth: 90 }}>Son Güncelleme</TH>
 <TH style={{ width: 100, minWidth: 90 }}>Gönderim Durumu</TH>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {loading ? (
 <tr><td colSpan={17} className="text-center py-16">
 <div className="flex items-center justify-center gap-2 text-current">
 <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
 <span>Yükleniyor...</span>
 </div>
 </td></tr>
 ) : products.length === 0 ? (
 <tr><td colSpan={17} className="text-center py-16 text-current">
 <div className="text-4xl mb-2">📦</div>
 <div className="text-lg font-medium text-current">Ürün bulunamadı</div>
 <p className="text-sm text-current mt-1">
 {search || statusFilter ? 'Filtrelere uygun ürün yok' : 'Henüz XML kaynağından ürün yüklenmemiş'}
 </p>
 </td></tr>
 ) : (
 products.map(p => (
 <tr key={p.id}
 className={`transition-colors cursor-pointer ${selectedIds.has(p.id) ? 'bg-transparent' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}
 onClick={() => openDrawer(p)}
 tabIndex={0}
 onKeyDown={e => e.key === 'Enter' && openDrawer(p)}>
 {/* Fixed columns */}
 <TDFixed onClick={e => e.stopPropagation()}>
 <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 </TDFixed>
 <TDFixed>
 {p.images ? (
 <img src={p.images.split(',')[0]} alt=""
 className="w-9 h-9 rounded object-cover bg-transparent"
 onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23334155" width="100" height="100"/><text fill="%2394a3b8" font-size="12" x="50" y="55" text-anchor="middle">📦</text></svg>'; }} />
 ) : (
 <div className="w-9 h-9 rounded bg-transparent flex items-center justify-center text-xs">📦</div>
 )}
 </TDFixed>
 <TDFixed>
 <div className="text-sm font-medium text-current truncate max-w-[180px]" title={p.title || p.xmlKey}>
 {p.title || p.xmlKey}
 </div>
 <div className="text-[10px] text-current font-mono truncate">{p.xmlKey}</div>
 </TDFixed>
 <TDFixed><span className="text-xs text-current">{p.xmlSource?.name || '-'}</span></TDFixed>
 <TDFixed><span className={`text-xs ${p.brandMatch ? 'text-current' : 'text-current'}`}>{p.brand?.name || (p.brandMatch ? '✅' : '❌')}</span></TDFixed>
 <TDFixed><span className={`text-sm font-medium ${p.stock > 0 ? 'text-current' : 'text-current'}`}>{p.stock}</span></TDFixed>
 <TDFixed><span className="text-xs text-current">{formatPrice(p.purchasePrice)}</span></TDFixed>
 <TDFixed>
 <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE_COLORS[p.status] || 'bg-primary/10 text-primary'}`}>
 {STATUS_BADGE_LABELS[p.status] || p.status}
 </span>
 </TDFixed>

 {/* Scrollable columns */}
 <TD><span className="text-xs text-current font-mono">{p.sku || '-'}</span></TD>
 <TD><span className="text-xs text-current">{p.barcode || '-'}</span></TD>
 <TD><span className="text-xs text-current truncate max-w-[120px] inline-block">{p.category?.name || (p.categoryMatch ? '✅' : '❌')}</span></TD>
 <TD><span className={`text-xs ${p.variantMatch ? 'text-current' : 'text-current'}`}>{p.variantMatch ? '✅' : '❌'}</span></TD>
 <TD><span className="text-xs text-current">{p.variants?.find(v => v.name === 'Renk')?.value || '-'}</span></TD>
 <TD><span className="text-xs text-current">{p.variants?.find(v => v.name === 'Beden')?.value || '-'}</span></TD>
 <TD><span className="text-xs text-current">{p.variants?.find(v => v.name === 'Numara')?.value || '-'}</span></TD>
  <TD><span className="text-xs text-current">{new Date(p.updatedAt).toLocaleDateString('tr-TR')}</span></TD>
  <TD>
  {p.marketplaceBlocked ? (
  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Trendyol gönderim: eksik zorunlu alan — Kategori → Pazaryeri Zorunlu Alanlar kuyruğundan çözün">Trendyol: Eksik Alan</span>
  ) : p.status === 'READY' ? (
  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Gönderilebilir</span>
  ) : (
  <span className="text-xs text-current">-</span>
  )}
  </TD>
  </tr>
 ))
 )}
 </tbody>
 </table>
 </div>

 {/* Pagination */}
 {pagination.totalPages > 1 && (
 <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
 <span className="text-xs text-current">
 Sayfa {pagination.page}/{pagination.totalPages} · {(pagination.total ?? 0).toLocaleString('tr-TR')} ürün
 </span>
 <nav className="flex gap-1">
 <button onClick={() => setPagination(prev => ({ ...prev, page: 1 }))} disabled={pagination.page <= 1}
 className="rounded px-2 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">««</button>
 <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))} disabled={pagination.page <= 1}
 className="rounded px-2 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">«</button>
 <span className="px-3 py-1 text-xs text-current">{pagination.page}</span>
 <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))} disabled={pagination.page >= pagination.totalPages}
 className="rounded px-2 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">»</button>
 <button onClick={() => setPagination(prev => ({ ...prev, page: pagination.totalPages }))} disabled={pagination.page >= pagination.totalPages}
 className="rounded px-2 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">»»</button>
 </nav>
 </div>
 )}
 </div>

 {/* ========== DRAWER ========== */}
 {showDrawer && <ProductDrawer product={selectedProduct} onClose={() => { setShowDrawer(false); setSelectedProduct(null); }} />}
 </div>
 );
}

// ==================== SUB-COMPONENTS ====================
function KpiCard({ title, value, color }: { title: string; value: string; color: string }) {
 const colorMap: Record<string, string> = {
 blue: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 green: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 yellow: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 orange: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 purple: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 pink: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 red: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 };
 return (
 <div className={`rounded-xl border p-3 backdrop-blur-sm ${colorMap[color] || colorMap.blue}`}>
 <div className="text-[10px] uppercase tracking-wider opacity-70">{title}</div>
 <div className="text-xl font-bold mt-0.5">{value}</div>
 </div>
 );
}

function TH({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent border-b border-slate-100 dark:border-slate-800/60" style={style}>{children}</th>;
}

function THFixed({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return <th className="sticky left-0 z-20 whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-current bg-transparent border-b border-slate-100 dark:border-slate-800/60 border-r border-current" style={style}>{children}</th>;
}

function TD({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
 return <td className="whitespace-nowrap px-3 py-2.5 text-sm" style={style}>{children}</td>;
}

function TDFixed({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
 return <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2.5 text-sm bg-transparent border-r border-current`} style={style} onClick={onClick}>{children}</td>;
}
