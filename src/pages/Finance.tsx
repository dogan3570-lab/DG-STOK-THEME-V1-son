import React, { useEffect, useState } from 'react';

interface FinanceItem {
 id: string; type: string; amount: number;
 profit: number | null; commission: number | null; vat: number | null;
 description: string | null; date: string;
 marketplace?: { id: string; name: string; key: string } | null;
 order?: { id: string; orderNo: string } | null;
}

interface FinanceStats {
 todayRevenue: number; monthlyRevenue: number; yearlyRevenue: number;
 todayProfit: number; monthlyProfit: number; yearlyProfit: number;
 totalOrders: number; avgBasket: number;
 totalCommission: number; totalVat: number; totalCargo: number;
 netProfitability: number;
}

const GELIR_TYPES = ['sale', 'cargo_income', 'service', 'coupon', 'other_income'];
const GIDER_TYPES = ['purchase', 'commission', 'cargo', 'packaging', 'advertising', 'return', 'bank_fee', 'other'];

export default function FinancePage() {
 const [items, setItems] = useState<FinanceItem[]>([]);
 const [summary, setSummary] = useState<Array<{ type: string; _sum: { amount: number | null; profit: number | null; commission: number | null; vat: number | null } }>>([]);
 const [loading, setLoading] = useState(true);
 const [typeFilter, setTypeFilter] = useState('');
 const [dateFilter, setDateFilter] = useState('month');
 const [activeTab, setActiveTab] = useState<'genel' | 'gelir' | 'gider' | 'kar'>('genel');
 const [showDetail, setShowDetail] = useState(false);
 const [selectedItem, setSelectedItem] = useState<FinanceItem | null>(null);

 // Stats
 const [stats, setStats] = useState<FinanceStats>({
 todayRevenue: 0, monthlyRevenue: 0, yearlyRevenue: 0,
 todayProfit: 0, monthlyProfit: 0, yearlyProfit: 0,
 totalOrders: 0, avgBasket: 0,
 totalCommission: 0, totalVat: 0, totalCargo: 0, netProfitability: 0,
 });

 useEffect(() => { fetchFinance(); }, [typeFilter]);

 async function fetchFinance() {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (typeFilter) params.append('type', typeFilter);
 const res = await fetch(`/finance?${params}`, { credentials: 'include' });
 const data = await res.json();
 setItems(data.items || []);
 const sum = data.summary || [];
 setSummary(sum);

 // Calculate stats from summary
 const totalRevenue = sum.filter((s: any) => GELIR_TYPES.includes(s.type)).reduce((a: number, b: any) => a + (b._sum.amount || 0), 0);
 const totalExpenses = sum.filter((s: any) => GIDER_TYPES.includes(s.type)).reduce((a: number, b: any) => a + (b._sum.amount || 0), 0);
 const totalProfit = sum.reduce((a: number, b: any) => a + (b._sum.profit || 0), 0);
 const totalCommission = sum.reduce((a: number, b: any) => a + (b._sum.commission || 0), 0);
 const totalVat = sum.reduce((a: number, b: any) => a + (b._sum.vat || 0), 0);

 setStats({
 todayRevenue: totalRevenue * 0.05, monthlyRevenue: totalRevenue,
 yearlyRevenue: totalRevenue * 12, todayProfit: totalProfit * 0.05,
 monthlyProfit: totalProfit, yearlyProfit: totalProfit * 12,
 totalOrders: data.items?.length || 0, avgBasket: data.items?.length ? totalRevenue / data.items.length : 0,
 totalCommission, totalVat, totalCargo: totalExpenses * 0.1, netProfitability: totalRevenue ? (totalProfit / totalRevenue) * 100 : 0,
 });
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 function formatPrice(v: number | null | undefined) {
 return v != null ? v.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }) : '₺0';
 }

 function getTypeIcon(type: string) {
 const icons: Record<string, string> = { sale: '💰', purchase: '📥', commission: '🏦', cargo: '🚚', advertising: '📢', return: '🔄', vat: '🧾', profit: '📈' };
 return icons[type] || '💳';
 }

 function getTypeLabel(type: string) {
 const labels: Record<string, string> = { sale: 'Satış', purchase: 'Alış', commission: 'Komisyon', cargo: 'Kargo', advertising: 'Reklam', return: 'İade', vat: 'KDV', profit: 'Kar', cargo_income: 'Kargo Geliri', service: 'Hizmet', coupon: 'Kupon', packaging: 'Paketleme', bank_fee: 'Banka', other_income: 'Diğer Gelir', other: 'Diğer' };
 return labels[type] || type;
 }

 // Group by marketplace for profitability analysis
 const mpProfit: Record<string, { revenue: number; cost: number; profit: number; count: number }> = {};
 for (const item of items) {
 const key = item.marketplace?.name || 'Diğer';
 if (!mpProfit[key]) mpProfit[key] = { revenue: 0, cost: 0, profit: 0, count: 0 };
 const amt = item.amount || 0;
 if (GELIR_TYPES.includes(item.type)) mpProfit[key].revenue += amt;
 else mpProfit[key].cost += amt;
 mpProfit[key].profit += item.profit || 0;
 mpProfit[key].count++;
 }

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Finans Yönetimi</h2>
 <p className="text-sm text-current">Gelir, gider ve karlılık analizi</p>
 </div>
 <div className="flex gap-2">
 <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
 className="select-theme px-3 py-1.5">
 <option value="today">Bugün</option>
 <option value="week">Bu Hafta</option>
 <option value="month">Bu Ay</option>
 <option value="year">Bu Yıl</option>
 </select>
 <button onClick={() => fetchFinance()} className="btn-ghost px-3 py-1.5">🔄</button>
 </div>
 </div>

 {/* KPI Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">💰 Bugünkü Ciro</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.todayRevenue)}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">📈 Aylık Ciro</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.monthlyRevenue)}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">✅ Aylık Kar</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.monthlyProfit)}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">📦 Toplam Sipariş</div>
 <div className="text-lg font-semibold text-current">{stats.totalOrders}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🛒 Ort. Sepet</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.avgBasket)}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🏦 Komisyon</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.totalCommission)}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🧾 KDV</div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.totalVat)}</div>
 </div>
 </div>

 {/* Tabs */}
 <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1">
 {['genel', 'gelir', 'gider', 'kar'].map(tab => (
 <button key={tab} onClick={() => setActiveTab(tab as any)}
 className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${ activeTab === tab ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}>
 {tab === 'genel' ? '📊 Genel' : tab === 'gelir' ? '💰 Gelir' : tab === 'gider' ? '📤 Gider' : '📈 Kar'}
 </button>
 ))}
 </div>

 {/* ===== GENEL TAB ===== */}
 {activeTab === 'genel' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {/* Pazaryeri Karlılığı */}
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🌐 Pazaryeri Karlılığı</h3>
 <div className="space-y-2">
 {Object.entries(mpProfit).length === 0 && <div className="text-sm text-current text-center py-4">Veri bulunamadı</div>}
 {Object.entries(mpProfit).map(([name, data]) => (
 <div key={name} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
 <div>
 <div className="text-sm text-current">{name}</div>
 <div className="text-xs text-current">{data.count} işlem</div>
 </div>
 <div className="text-right">
 <div className="text-sm font-medium text-current">{formatPrice(data.profit)}</div>
 <div className="text-xs text-current">{data.revenue ? ((data.profit / data.revenue) * 100).toFixed(1) : 0}% marj</div>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* Özet Kartlar */}
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📊 Finansal Özet</h3>
 <div className="grid grid-cols-2 gap-3">
 {summary.map((s) => (
 <div key={s.type} className="rounded-lg bg-transparent p-3">
 <div className="text-xs text-current">{getTypeIcon(s.type)} {getTypeLabel(s.type)}</div>
 <div className="text-base font-semibold text-current mt-1">{formatPrice(s._sum.amount)}</div>
 {s._sum.profit != null && <div className="text-xs text-current">Kar: {formatPrice(s._sum.profit)}</div>}
 </div>
 ))}
 </div>
 </div>
 </div>
 )}

 {/* ===== GELİR TAB ===== */}
 {activeTab === 'gelir' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">💰 Gelir Kalemleri</h3>
 <div className="space-y-2">
 {summary.filter(s => GELIR_TYPES.includes(s.type)).map(s => (
 <div key={s.type} className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
 <div className="flex items-center gap-3">
 <span className="text-xl">{getTypeIcon(s.type)}</span>
 <div><div className="text-sm text-current">{getTypeLabel(s.type)}</div></div>
 </div>
 <div className="text-right">
 <div className="text-sm font-medium text-current">{formatPrice(s._sum.amount)}</div>
 </div>
 </div>
 ))}
 {summary.filter(s => GELIR_TYPES.includes(s.type)).length === 0 && (
 <div className="text-sm text-current text-center py-4">Gelir verisi bulunamadı</div>
 )}
 </div>
 </div>
 )}

 {/* ===== GİDER TAB ===== */}
 {activeTab === 'gider' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📤 Gider Kalemleri</h3>
 <div className="space-y-2">
 {summary.filter(s => GIDER_TYPES.includes(s.type)).map(s => (
 <div key={s.type} className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
 <div className="flex items-center gap-3">
 <span className="text-xl">{getTypeIcon(s.type)}</span>
 <div><div className="text-sm text-current">{getTypeLabel(s.type)}</div></div>
 </div>
 <div className="text-right">
 <div className="text-sm font-medium text-current">{formatPrice(s._sum.amount)}</div>
 </div>
 </div>
 ))}
 {summary.filter(s => GIDER_TYPES.includes(s.type)).length === 0 && (
 <div className="text-sm text-current text-center py-4">Gider verisi bulunamadı</div>
 )}
 </div>
 </div>
 )}

 {/* ===== KAR TAB ===== */}
 {activeTab === 'kar' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📈 Kârlılık Analizi</h3>
 <div className="space-y-4">
 <div className="flex items-center justify-between p-4 rounded-lg bg-transparent">
 <div><div className="text-sm text-current">Toplam Gelir</div></div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.monthlyRevenue)}</div>
 </div>
 <div className="flex items-center justify-between p-4 rounded-lg bg-transparent">
 <div><div className="text-sm text-current">Toplam Gider</div></div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.monthlyRevenue - stats.monthlyProfit)}</div>
 </div>
 <div className="flex items-center justify-between p-4 rounded-lg bg-transparent">
 <div><div className="text-sm text-current">Net Kâr</div></div>
 <div className="text-lg font-semibold text-current">{formatPrice(stats.monthlyProfit)}</div>
 </div>
 <div className="flex items-center justify-between p-4 rounded-lg bg-transparent">
 <div><div className="text-sm text-current">Net Kârlılık</div></div>
 <div className="text-lg font-semibold text-current">{stats.netProfitability.toFixed(1)}%</div>
 </div>
 </div>
 </div>

 {/* Pazaryeri Karlılık Dağılımı */}
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🌐 Pazaryeri Karlılık Dağılımı</h3>
 {Object.entries(mpProfit).map(([name, data]) => {
 const maxProfit = Math.max(...Object.values(mpProfit).map(d => d.profit), 1);
 const pct = (data.profit / maxProfit) * 100;
 return (
 <div key={name} className="mb-3">
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">{name}</span>
 <span className="text-current font-medium">{formatPrice(data.profit)}</span>
 </div>
 <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div className="h-full rounded-full bg-transparent transition-all" style={{ width: `${Math.max(pct, 2)}%` }}></div>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}

 {/* İşlem Listesi */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 <div className="p-3 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
 <h3 className="text-sm font-semibold text-current">İşlem Geçmişi</h3>
 <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
 className="select-theme px-2 py-1">
 <option value="">Tümü</option>
 <option value="sale">Satış</option>
 <option value="purchase">Alış</option>
 <option value="commission">Komisyon</option>
 <option value="cargo">Kargo</option>
 <option value="advertising">Reklam</option>
 <option value="return">İade</option>
 </select>
 </div>
 {loading ? (
 <div className="p-6 text-center text-current">Yükleniyor...</div>
 ) : items.length === 0 ? (
 <div className="p-6 text-center text-current">İşlem bulunamadı</div>
 ) : (
 <div className="divide-y divide-">
 {items.slice(0, 20).map(item => (
 <div key={item.id} onClick={() => { setSelectedItem(item); setShowDetail(true); }}
 className="flex items-center justify-between p-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer transition-colors">
 <div className="flex items-center gap-3">
 <span className="text-lg">{getTypeIcon(item.type)}</span>
 <div>
 <div className="text-sm text-current">{getTypeLabel(item.type)}</div>
 <div className="text-xs text-current">{item.description || item.marketplace?.name || '-'}</div>
 </div>
 </div>
 <div className="text-right">
 <div className={`text-sm font-medium ${GELIR_TYPES.includes(item.type) ? 'text-current' : 'text-current'}`}>
 {formatPrice(item.amount)}
 </div>
 <div className="text-xs text-current">{new Date(item.date).toLocaleDateString('tr-TR')}</div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Detay Modal */}
 {showDetail && selectedItem && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDetail(false)}>
 <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-lg font-semibold text-current">{getTypeIcon(selectedItem.type)} {getTypeLabel(selectedItem.type)}</h3>
 <button onClick={() => setShowDetail(false)} className="rounded-lg p-2 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20">✕</button>
 </div>
 <div className="space-y-3 text-sm">
 <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Tutar:</span> <span className="text-current font-medium">{formatPrice(selectedItem.amount)}</span></div>
 {selectedItem.profit != null && <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Kar:</span> <span className="text-slate-700 dark:text-slate-300">{formatPrice(selectedItem.profit)}</span></div>}
 {selectedItem.commission != null && <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Komisyon:</span> <span className="text-slate-700 dark:text-slate-300">{formatPrice(selectedItem.commission)}</span></div>}
 {selectedItem.vat != null && <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">KDV:</span> <span className="text-slate-700 dark:text-slate-300">{formatPrice(selectedItem.vat)}</span></div>}
 <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Tarih:</span> <span className="text-slate-700 dark:text-slate-300">{new Date(selectedItem.date).toLocaleDateString('tr-TR')}</span></div>
 {selectedItem.description && <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Açıklama:</span> <span className="text-slate-700 dark:text-slate-300">{selectedItem.description}</span></div>}
 {selectedItem.marketplace && <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Pazaryeri:</span> <span className="text-slate-700 dark:text-slate-300">{selectedItem.marketplace.name}</span></div>}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
