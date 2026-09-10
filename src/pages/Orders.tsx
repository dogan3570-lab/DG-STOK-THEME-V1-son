import React, { useEffect, useState } from 'react';

interface OrderItem {
 id: string; orderNo: string; channel: string;
 marketplaceId?: string | null; marketplace?: { id: string; name: string; key: string } | null;
 customerName: string; customerEmail: string | null; customerPhone: string | null;
 city: string | null; district: string | null;
 total: number; cargoPrice: number | null; commission: number | null; vat: number | null;
 status: string; cargoCompany: string | null; trackingNo: string | null;
 items: string | null; notes: string | null;
 createdAt: string; updatedAt: string;
}

const STATUS_OPTIONS = [
 { value: 'new', label: '🆕 Yeni', color: 'bg-primary/10 text-primary' },
 { value: 'approved', label: '✅ Onaylandı', color: 'bg-primary/10 text-primary' },
 { value: 'preparing', label: '📦 Hazırlanıyor', color: 'bg-primary/10 text-primary' },
 { value: 'packing', label: '📦 Paketleniyor', color: 'bg-primary/10 text-primary' },
 { value: 'invoiced', label: '🧾 Fatura Kesildi', color: 'bg-primary/10 text-primary' },
 { value: 'shipped', label: '🚚 Kargoya Verildi', color: 'bg-primary/10 text-primary' },
 { value: 'delivering', label: '🚚 Dağıtımda', color: 'bg-primary/10 text-primary' },
 { value: 'delivered', label: '✅ Teslim Edildi', color: 'bg-primary/10 text-primary' },
 { value: 'cancelled', label: '❌ İptal', color: 'bg-primary/10 text-primary' },
 { value: 'returned', label: '🔄 İade', color: 'bg-primary/10 text-primary' },
 { value: 'partial_return', label: '🔄 Kısmi İade', color: 'bg-primary/10 text-primary' },
 { value: 'problem', label: '⚠️ Sorunlu', color: 'bg-primary/10 text-primary' },
 { value: 'archived', label: '📦 Arşiv', color: 'bg-primary/10 text-primary' },
];

export default function OrdersPage() {
 const [orders, setOrders] = useState<OrderItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState('');
 const [statusFilter, setStatusFilter] = useState('');
 const [channelFilter, setChannelFilter] = useState('');
 const [cityFilter, setCityFilter] = useState('');
 const [sortBy, setSortBy] = useState('createdAt');
 const [sortOrder, setSortOrder] = useState('desc');
 const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
 const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
 const [showDetail, setShowDetail] = useState(false);
 const [showFilterPanel, setShowFilterPanel] = useState(false);

 // Stats from dashboard
 const [stats, setStats] = useState({
 newOrders: 0, preparing: 0, invoiced: 0, shipped: 0,
 delivered: 0, cancelled: 0, returned: 0, problem: 0,
 });

 useEffect(() => { fetchOrders(); }, [pagination.page, statusFilter, channelFilter, search, sortBy, sortOrder]);
 useEffect(() => { fetchStats(); }, []);

 async function fetchStats() {
 try {
 const [newO, preparing, invoiced, shipped, delivered, cancelled, returned, problem] = await Promise.all([
 fetch('/orders?status=new&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=preparing&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=invoiced&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=shipped&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=delivered&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=cancelled&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=returned&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 fetch('/orders?status=problem&limit=1').then(r => r.json()).then(d => d.pagination?.total || 0),
 ]);
 setStats({ newOrders: newO, preparing, invoiced, shipped, delivered, cancelled, returned, problem });
 } catch (err) { console.error(err); }
 }

 async function fetchOrders() {
 setLoading(true);
 try {
 const params = new URLSearchParams({
 page: String(pagination.page), limit: String(pagination.limit),
 });
 if (statusFilter) params.append('status', statusFilter);
 if (channelFilter) params.append('channel', channelFilter);
 if (search) params.append('search', search);

 const res = await fetch(`/orders?${params}`, { credentials: 'include' });
 const data = await res.json();
 setOrders(data.items || []);
 setPagination(data.pagination || pagination);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 async function handleUpdateStatus(id: string, newStatus: string) {
 try {
 await fetch(`/orders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: newStatus }) });
 fetchOrders(); fetchStats();
 if (selectedOrder?.id === id) setSelectedOrder({ ...selectedOrder, status: newStatus });
 } catch (err) { console.error(err); }
 }

 function formatPrice(v: number | null | undefined) {
 return v != null ? v.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }) : '-';
 }

 function getStatusBadge(status: string) {
 const s = STATUS_OPTIONS.find(o => o.value === status);
 if (!s) return <span className="rounded-full bg-transparent px-2 py-0.5 text-xs text-current">{status}</span>;
 return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>{s.label}</span>;
 }

 function getChannelIcon(channel: string) {
 const icons: Record<string, string> = { trendyol: '🛒', hepsiburada: '📦', n11: '🏪', amazon: '📦', pazarama: '🛍️' };
 return icons[channel.toLowerCase()] || '🌐';
 }

 const orderItems = selectedOrder?.items ? (() => { try { return JSON.parse(selectedOrder.items); } catch { return []; } })() : [];

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Sipariş Yönetimi (OMS)</h2>
 <p className="text-sm text-current">Tüm pazaryerlerinden gelen siparişler</p>
 </div>
 <div className="flex gap-2">
 <button onClick={() => setShowFilterPanel(!showFilterPanel)}
 className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${showFilterPanel ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current' : 'border-current text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>
 🔍 Filtreler
 </button>
 <button onClick={() => fetchOrders()} className="btn-ghost px-3 py-1.5">🔄</button>
 </div>
 </div>

 {/* KPI Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🆕 Yeni</div>
 <div className="text-lg font-semibold text-current">{stats.newOrders}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">📦 Hazırlanıyor</div>
 <div className="text-lg font-semibold text-current">{stats.preparing}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🧾 Fatura Bekliyor</div>
 <div className="text-lg font-semibold text-current">{stats.invoiced}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🚚 Kargoya Hazır</div>
 <div className="text-lg font-semibold text-current">{stats.shipped}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">✅ Teslim Edildi</div>
 <div className="text-lg font-semibold text-current">{stats.delivered}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">❌ İptal</div>
 <div className="text-lg font-semibold text-current">{stats.cancelled}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🔄 İade</div>
 <div className="text-lg font-semibold text-current">{stats.returned}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">⚠️ Sorunlu</div>
 <div className="text-lg font-semibold text-current">{stats.problem}</div>
 </div>
 </div>

 {/* Filters */}
 <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
 placeholder="Sipariş No, müşteri, telefon..." className="flex-1 min-w-[200px] input-theme px-3 py-2" />
 <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tüm Durumlar</option>
 {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
 </select>
 <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tüm Kanallar</option>
 <option value="trendyol">Trendyol</option>
 <option value="hepsiburada">Hepsiburada</option>
 <option value="n11">N11</option>
 <option value="amazon">Amazon</option>
 </select>
 <span className="text-sm text-current">{pagination.total} sipariş</span>
 </div>

 {/* Table */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="p-8 text-center text-current">Yükleniyor...</div>
 ) : orders.length === 0 ? (
 <div className="p-8 text-center text-current">
 <div className="text-4xl mb-2">📦</div>
 <div>Sipariş bulunamadı</div>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full min-w-[1000px]">
 <thead className="bg-transparent">
 <tr>
 {[{ key: 'orderNo', label: 'Sipariş No' }, { key: 'channel', label: 'Kanal' }, { key: 'customerName', label: 'Müşteri' },
 { key: 'city', label: 'Şehir' }, { key: 'total', label: 'Tutar' }, { key: 'status', label: 'Durum' },
 { key: 'cargoCompany', label: 'Kargo' }, { key: 'createdAt', label: 'Tarih' }].map(col => (
 <th key={col.key} onClick={() => { setSortBy(col.key); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}
 className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current cursor-pointer hover:text-current">
 {col.label} {sortBy === col.key ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
 </th>
 ))}
 <th className="px-3 py-3 text-right text-xs font-semibold text-current">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {orders.map(order => (
 <tr key={order.id} onClick={() => { setSelectedOrder(order); setShowDetail(true); }}
 className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
 <td className="px-3 py-3">
 <div className="text-sm font-medium text-current">{order.orderNo}</div>
 <div className="text-xs text-current">{order.channel}</div>
 </td>
 <td className="px-3 py-3 text-sm">{getChannelIcon(order.channel)} {order.marketplace?.name || order.channel}</td>
 <td className="px-3 py-3">
 <div className="text-sm text-current">{order.customerName}</div>
 {order.customerPhone && <div className="text-xs text-current">{order.customerPhone}</div>}
 </td>
 <td className="px-3 py-3 text-sm text-current">{order.city || '-'}</td>
 <td className="px-3 py-3 text-sm font-medium text-current">{formatPrice(order.total)}</td>
 <td className="px-3 py-3">{getStatusBadge(order.status)}</td>
 <td className="px-3 py-3 text-sm text-current">{order.cargoCompany || '-'}</td>
 <td className="px-3 py-3 text-xs text-current">{new Date(order.createdAt).toLocaleDateString('tr-TR')}</td>
 <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
 <select value={order.status} onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
 className="select-theme px-2 py-1">
 {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
 </select>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Pagination */}
 {pagination.totalPages > 1 && (
 <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <span className="text-sm text-current">Sayfa {pagination.page}/{pagination.totalPages}</span>
 <div className="flex gap-2">
 <button onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))} disabled={pagination.page <= 1}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">◀ Önceki</button>
 <button onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))} disabled={pagination.page >= pagination.totalPages}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">Sonraki ▶</button>
 </div>
 </div>
 )}

 {/* ========== SİPARİŞ DETAY PANELİ ========== */}
 {showDetail && selectedOrder && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDetail(false)}>
 <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <div>
 <h3 className="text-lg font-semibold text-current">Sipariş #{selectedOrder.orderNo}</h3>
 <div className="flex items-center gap-2 mt-1">
 {getStatusBadge(selectedOrder.status)}
 <span className="text-xs text-current">{selectedOrder.channel}</span>
 </div>
 </div>
 <button onClick={() => setShowDetail(false)} className="rounded-lg p-2 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20">✕</button>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {/* Müşteri Bilgileri */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">👤 Müşteri Bilgileri</h4>
 <div className="space-y-1.5 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">Ad:</span> <span className="text-current ml-1">{selectedOrder.customerName}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Tel:</span> <span className="text-current ml-1">{selectedOrder.customerPhone || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">E-posta:</span> <span className="text-current ml-1">{selectedOrder.customerEmail || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Şehir:</span> <span className="text-current ml-1">{selectedOrder.city || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">İlçe:</span> <span className="text-current ml-1">{selectedOrder.district || '-'}</span></div>
 </div>
 </div>

 {/* Fiyat Bilgileri */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">💰 Fiyat Bilgileri</h4>
 <div className="space-y-1.5 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">Toplam:</span> <span className="text-current ml-1 font-medium">{formatPrice(selectedOrder.total)}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Kargo:</span> <span className="text-current ml-1">{formatPrice(selectedOrder.cargoPrice)}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Komisyon:</span> <span className="text-current ml-1">{formatPrice(selectedOrder.commission)}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">KDV:</span> <span className="text-current ml-1">{formatPrice(selectedOrder.vat)}</span></div>
 </div>
 </div>

 {/* Kargo Bilgileri */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">🚚 Kargo Bilgileri</h4>
 <div className="space-y-1.5 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">Firma:</span> <span className="text-current ml-1">{selectedOrder.cargoCompany || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Takip No:</span> <span className="text-current ml-1">{selectedOrder.trackingNo || '-'}</span></div>
 </div>
 <div className="flex gap-2 mt-3">
 <button onClick={() => handleUpdateStatus(selectedOrder.id, 'shipped')}
 className="btn-ghost px-3 py-1.5">🚚 Kargoya Ver</button>
 <button onClick={() => handleUpdateStatus(selectedOrder.id, 'delivered')}
 className="btn-ghost px-3 py-1.5">✅ Teslim Et</button>
 </div>
 </div>

 {/* Notlar */}
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">📝 Notlar</h4>
 <div className="text-sm text-current">{selectedOrder.notes || '-'}</div>
 </div>
 </div>

 {/* Ürün Listesi */}
 {orderItems.length > 0 && (
 <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-semibold text-current mb-2">📦 Ürünler</h4>
 <div className="divide-y divide-current">
 {orderItems.map((item: any, i: number) => (
 <div key={i} className="flex items-center justify-between py-2 text-sm">
 <span className="text-slate-700 dark:text-slate-300">{item.name || item.title || 'Ürün'}</span>
 <div className="flex items-center gap-4 text-current">
 <span>x{item.quantity || 1}</span>
 <span className="text-slate-700 dark:text-slate-300">{formatPrice(item.price || 0)}</span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Durum Değiştirme */}
 <div className="mt-4 flex flex-wrap gap-2">
 {['new', 'approved', 'preparing', 'packing', 'invoiced', 'shipped', 'delivered', 'cancelled'].map(st => (
 <button key={st} onClick={() => handleUpdateStatus(selectedOrder.id, st)}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${ selectedOrder.status === st ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}>{STATUS_OPTIONS.find(s => s.value === st)?.label || st}</button>
 ))}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
