import React, { useEffect, useState } from 'react';

interface DashboardStats {
 totalProducts: number;
 totalOrders: number;
 totalMarketplaces: number;
 totalXmlSources: number;
 activeXmlSources: number;
 lowStockProducts: number;
 errorProducts: number;
 todayOrders: number;
 rangeOrders: number;
}

interface DashboardSummaryItem {
 marketplaceId: string;
 marketplaceName: string;
 ready: number;
 sent: number;
 passive: number;
 error: number;
 total: number;
}

interface FinanceSummary {
 type: string;
 _sum: { amount: number | null; profit: number | null; commission: number | null; vat: number | null };
}

interface FinanceItem {
 id: string;
 type: string;
 amount: number;
 profit: number | null;
 commission: number | null;
 vat: number | null;
 description: string | null;
 date: string;
}

const typeLabels: Record<string, string> = {
 sale: 'Satış',
 expense: 'Gider',
 refund: 'İade',
 commission: 'Komisyon',
 cargo: 'Kargo',
 other: 'Diğer',
};

const typeColors: Record<string, string> = {
 sale: 'text-current',
 expense: 'text-current',
 refund: 'text-current',
 commission: 'text-current',
 cargo: 'text-current',
 other: 'text-current',
};

export default function Reports({ onNavigate }: { onNavigate?: (page: string) => void }) {
 const [activeTab, setActiveTab] = useState<'ozet' | 'finans' | 'urun' | 'pazaryeri'>('ozet');
 const [stats, setStats] = useState<DashboardStats | null>(null);
 const [summary, setSummary] = useState<DashboardSummaryItem[]>([]);
 const [financeSummary, setFinanceSummary] = useState<FinanceSummary[]>([]);
 const [financeItems, setFinanceItems] = useState<FinanceItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [financeLoading, setFinanceLoading] = useState(false);
 const [dateRange, setDateRange] = useState<'7' | '30' | '90' | '365'>('30');
 const [financeType, setFinanceType] = useState('');

 useEffect(() => {
 fetchAllData();
 }, []);

 useEffect(() => {
 fetchAllData();
 }, [dateRange]);

 useEffect(() => {
 if (activeTab === 'finans') {
 fetchFinanceData();
 }
 }, [activeTab, financeType]);

 async function fetchAllData() {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 params.append('days', dateRange);

 const [statsRes, summaryRes] = await Promise.all([
 fetch(`/dashboard/stats?${params}`, { credentials: 'include' }),
 fetch(`/dashboard/summary?${params}`, { credentials: 'include' }),
 ]);

 if (statsRes.ok) setStats(await statsRes.json());
 if (summaryRes.ok) {
 const data = await summaryRes.json();
 setSummary(data.items || []);
 }
 } catch (error) {
 console.error('Error fetching report data:', error);
 } finally {
 setLoading(false);
 }
 }

 async function fetchFinanceData() {
 setFinanceLoading(true);
 try {
 const params = new URLSearchParams();
 if (financeType) params.append('type', financeType);
 params.append('days', dateRange);

 const response = await fetch(`/finance?${params}`, { credentials: 'include' });
 const data = await response.json();
 setFinanceItems(data.items || []);
 setFinanceSummary(data.summary || []);
 } catch (error) {
 console.error('Error fetching finance data:', error);
 } finally {
 setFinanceLoading(false);
 }
 }

 function formatCurrency(value: number): string {
 return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value);
 }

 function getStatusColor(value: number, type: 'good' | 'bad' = 'good'): string {
 if (value === 0) return 'text-current';
 return type === 'good' ? 'text-current' : 'text-current';
 }

 // Calculate totals from finance summary
 const totalRevenue = financeSummary
 .filter(s => s.type === 'sale')
 .reduce((sum, s) => sum + (s._sum.amount || 0), 0);

 const totalProfit = financeSummary
 .reduce((sum, s) => sum + (s._sum.profit || 0), 0);

 const totalCommission = financeSummary
 .reduce((sum, s) => sum + (s._sum.commission || 0), 0);

 const totalVat = financeSummary
 .reduce((sum, s) => sum + (s._sum.vat || 0), 0);

 return (
 <div className="space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Raporlar</h2>
 <p className="text-sm text-current">Kapsamlı raporlama ve analiz</p>
 </div>
 <div className="flex gap-2">
 <select
 value={dateRange}
 onChange={(e) => setDateRange(e.target.value as any)}
 className="select-theme px-3 py-2 focus:border-current focus:outline-none"
 >
 <option value="7">Son 7 Gün</option>
 <option value="30">Son 30 Gün</option>
 <option value="90">Son 90 Gün</option>
 <option value="365">Son 1 Yıl</option>
 </select>
 <button
 onClick={() => { fetchAllData(); fetchFinanceData(); }}
 className="btn-ghost px-4 py-2 transition-colors"
 >
 🔄 Yenile
 </button>
 </div>
 </div>

 {/* Tabs */}
 <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1 backdrop-blur-sm">
 {[
 { key: 'ozet', label: '📊 Genel Özet', desc: 'Temel KPI ve istatistikler' },
 { key: 'finans', label: '💰 Finansal Raporlar', desc: 'Gelir-gider ve kar analizi' },
 { key: 'urun', label: '📦 Ürün Raporları', desc: 'Ürün bazlı analizler' },
 { key: 'pazaryeri', label: '🛒 Pazaryeri Raporları', desc: 'Pazaryeri performansı' },
 ].map(tab => (
 <button
 key={tab.key}
 type="button"
 onClick={() => setActiveTab(tab.key as any)}
 className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${ activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}
 title={tab.desc}
 >
 {tab.label}
 </button>
 ))}
 </div>

 {/* ==================== GENEL ÖZET TAB ==================== */}
 {activeTab === 'ozet' && (
 <div className="space-y-6">
 {loading ? (
 <div className="flex items-center justify-center p-12 text-current">
 <div className="text-center">
 <div className="text-4xl mb-4 animate-pulse">📊</div>
 <div>Raporlar yükleniyor...</div>
 </div>
 </div>
 ) : (
 <>
 {/* KPI Cards */}
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="text-sm font-medium text-current">Toplam Ürün</div>
 <div className="text-2xl">📦</div>
 </div>
 <div className="text-3xl font-bold text-current">{stats?.totalProducts || 0}</div>
 <div className="text-xs text-current mt-1">Tüm kaynaklardan</div>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="text-sm font-medium text-current">Bugünkü Sipariş</div>
 <div className="text-2xl">📋</div>
 </div>
 <div className="text-3xl font-bold text-current">{stats?.todayOrders || 0}</div>
 <div className="text-xs text-current mt-1">Son 24 saat</div>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="text-sm font-medium text-current">Aktif XML</div>
 <div className="text-2xl">🔗</div>
 </div>
 <div className="text-3xl font-bold text-current">
 {stats?.activeXmlSources || 0}<span className="text-lg text-current">/{stats?.totalXmlSources || 0}</span>
 </div>
 <div className="text-xs text-current mt-1">Aktif / Toplam</div>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="text-sm font-medium text-current">Pazaryerleri</div>
 <div className="text-2xl">🛒</div>
 </div>
 <div className="text-3xl font-bold text-current">{stats?.totalMarketplaces || 0}</div>
 <div className="text-xs text-current mt-1">Entegre pazaryeri</div>
 </div>
 </div>

 {/* Status Cards */}
 <div className="grid gap-4 md:grid-cols-3">
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-2">
 <div className="text-sm font-medium text-current">Stokta Olmayan</div>
 <div className={`text-2xl font-bold ${getStatusColor(stats?.lowStockProducts || 0, 'bad')}`}>
 {stats?.lowStockProducts || 0}
 </div>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div
 className="bg-transparent h-2 rounded-full transition-all"
 style={{ width: `${stats ? Math.min(100, (stats.lowStockProducts / Math.max(stats.totalProducts, 1)) * 100) : 0}%` }}
 />
 </div>
 <div className="text-xs text-current mt-1">
 {stats ? ((stats.lowStockProducts / Math.max(stats.totalProducts, 1)) * 100).toFixed(1) : 0}% oranında
 </div>
 </div>

 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-2">
 <div className="text-sm font-medium text-current">Hatalı Ürün</div>
 <div className={`text-2xl font-bold ${getStatusColor(stats?.errorProducts || 0, 'bad')}`}>
 {stats?.errorProducts || 0}
 </div>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div
 className="bg-transparent h-2 rounded-full transition-all"
 style={{ width: `${stats ? Math.min(100, (stats.errorProducts / Math.max(stats.totalProducts, 1)) * 100) : 0}%` }}
 />
 </div>
 <div className="text-xs text-current mt-1">
 {stats ? ((stats.errorProducts / Math.max(stats.totalProducts, 1)) * 100).toFixed(1) : 0}% oranında
 </div>
 </div>

 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-2">
 <div className="text-sm font-medium text-current">Toplam Sipariş</div>
 <div className="text-2xl font-bold text-current">{stats?.totalOrders || 0}</div>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div
 className="bg-transparent h-2 rounded-full transition-all"
 style={{ width: '100%' }}
 />
 </div>
 <div className="text-xs text-current mt-1">Tüm zamanlar</div>
 </div>
 </div>

 {/* Marketplace Summary */}
 {summary.length > 0 && (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-base font-semibold text-current">Pazaryeri Durum Özeti</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Pazaryeri</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Hazır</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Gönderildi</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Pasif</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Hata</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Toplam</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {summary.map((item) => (
 <tr key={item.marketplaceId} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
 <td className="px-6 py-3 font-medium text-current">{item.marketplaceName}</td>
 <td className="px-6 py-3 text-center">
 <span className="text-current font-medium">{item.ready}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className="text-current font-medium">{item.sent}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className="text-slate-700 dark:text-slate-300">{item.passive}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className={`font-medium ${item.error > 0 ? 'text-current' : 'text-current'}`}>
 {item.error}
 </span>
 </td>
 <td className="px-6 py-3 text-center font-medium text-current">{item.total}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </>
 )}
 </div>
 )}

 {/* ==================== FİNANSAL RAPORLAR TAB ==================== */}
 {activeTab === 'finans' && (
 <div className="space-y-6">
 {/* Finance Summary Cards */}
 {financeSummary.length > 0 && (
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam Gelir</div>
 <div className="text-2xl font-bold text-current">{formatCurrency(totalRevenue)}</div>
 </div>
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam Kar</div>
 <div className="text-2xl font-bold text-current">{formatCurrency(totalProfit)}</div>
 </div>
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam Komisyon</div>
 <div className="text-2xl font-bold text-current">{formatCurrency(totalCommission)}</div>
 </div>
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-gradient-to-br from-transparent to-transparent p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam KDV</div>
 <div className="text-2xl font-bold text-current">{formatCurrency(totalVat)}</div>
 </div>
 </div>
 )}

 {/* Finance Summary by Type */}
 {financeSummary.length > 0 && (
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
 {financeSummary.map((s) => (
 <div key={s.type} className="panel-theme p-4 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-2">
 <div className={`text-sm font-medium ${typeColors[s.type] || 'text-current'}`}>
 {typeLabels[s.type] || s.type}
 </div>
 <div className={`text-lg font-bold ${typeColors[s.type] || 'text-current'}`}>
 {formatCurrency(s._sum.amount || 0)}
 </div>
 </div>
 {s._sum.profit !== null && (
 <div className="flex justify-between text-xs text-current">
 <span>Kar</span>
 <span className={s._sum.profit >= 0 ? 'text-current' : 'text-current'}>
 {formatCurrency(s._sum.profit)}
 </span>
 </div>
 )}
 {s._sum.commission !== null && (
 <div className="flex justify-between text-xs text-current">
 <span>Komisyon</span>
 <span>{formatCurrency(s._sum.commission)}</span>
 </div>
 )}
 {s._sum.vat !== null && (
 <div className="flex justify-between text-xs text-current">
 <span>KDV</span>
 <span>{formatCurrency(s._sum.vat)}</span>
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Filter */}
 <div className="flex flex-wrap gap-2">
 {['', 'sale', 'expense', 'refund', 'commission', 'cargo', 'other'].map((t) => (
 <button
 key={t}
 onClick={() => setFinanceType(t)}
 className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${ financeType === t ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 {t ? typeLabels[t] || t : 'Tümü'}
 </button>
 ))}
 </div>

 {/* Finance Table */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {financeLoading ? (
 <div className="flex items-center justify-center p-8 text-current">Yükleniyor...</div>
 ) : financeItems.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-8 text-current">
 <div className="text-4xl mb-2">💰</div>
 <div>Finans kaydı bulunamadı</div>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Tür</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Tutar</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Kar</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Komisyon</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">KDV</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Açıklama</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Tarih</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {financeItems.map((item) => (
 <tr key={item.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
 <td className="px-4 py-3">
 <span className={`font-medium ${typeColors[item.type] || 'text-current'}`}>
 {typeLabels[item.type] || item.type}
 </span>
 </td>
 <td className="px-4 py-3 font-medium text-current">{formatCurrency(item.amount)}</td>
 <td className="px-4 py-3 text-sm text-current">
 {item.profit !== null ? formatCurrency(item.profit) : '-'}
 </td>
 <td className="px-4 py-3 text-sm text-current">
 {item.commission !== null ? formatCurrency(item.commission) : '-'}
 </td>
 <td className="px-4 py-3 text-sm text-current">
 {item.vat !== null ? formatCurrency(item.vat) : '-'}
 </td>
 <td className="px-4 py-3 text-sm text-current">{item.description || '-'}</td>
 <td className="px-4 py-3 text-sm text-current">
 {new Date(item.date).toLocaleDateString('tr-TR')}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ==================== ÜRÜN RAPORLARI TAB ==================== */}
 {activeTab === 'urun' && (
 <div className="space-y-6">
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center gap-3 mb-4">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-transparent text-2xl">📦</div>
 <div>
 <div className="text-sm text-current">Toplam Ürün</div>
 <div className="text-2xl font-bold text-current">{stats?.totalProducts || 0}</div>
 </div>
 </div>
 <div className="space-y-2 text-sm">
 <div className="flex justify-between">
 <span className="text-slate-700 dark:text-slate-300">Stokta Olmayan</span>
 <span className="text-current font-medium">{stats?.lowStockProducts || 0}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-700 dark:text-slate-300">Hatalı</span>
 <span className="text-current font-medium">{stats?.errorProducts || 0}</span>
 </div>
 </div>
 </div>

 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center gap-3 mb-4">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-transparent text-2xl">✅</div>
 <div>
 <div className="text-sm text-current">Eşleşme Durumu</div>
 <div className="text-2xl font-bold text-current">Analiz</div>
 </div>
 </div>
 <div className="text-sm text-current">
 <p>Ürünlerin kategori, marka, varyant ve şablon eşleşme durumlarını görmek için Ürünler sayfasını ziyaret edin.</p>
 </div>
 </div>

 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="flex items-center gap-3 mb-4">
 <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-transparent text-2xl">🔗</div>
 <div>
 <div className="text-sm text-current">XML Kaynakları</div>
 <div className="text-2xl font-bold text-current">{stats?.totalXmlSources || 0}</div>
 </div>
 </div>
 <div className="space-y-2 text-sm">
 <div className="flex justify-between">
 <span className="text-slate-700 dark:text-slate-300">Aktif</span>
 <span className="text-current font-medium">{stats?.activeXmlSources || 0}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-slate-700 dark:text-slate-300">Pasif</span>
 <span className="text-current font-medium">{(stats?.totalXmlSources || 0) - (stats?.activeXmlSources || 0)}</span>
 </div>
 </div>
 </div>
 </div>

 <div className="panel-theme p-6 backdrop-blur-sm">
 <h3 className="text-base font-semibold text-current mb-4">Ürün Raporları</h3>
 <div className="grid gap-4 md:grid-cols-2">
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-medium text-current mb-2">📋 Kategori Bazlı Rapor</h4>
 <p className="text-sm text-current">Kategorilere göre ürün dağılımını görüntüleyin.</p>
 <button
  onClick={() => onNavigate?.('urunhazirlama-kategori')}
  className="mt-3 btn-ghost px-4 py-2 transition-colors"
 >
  Kategori Eşleştirme Sayfasına Git →
 </button>
 </div>
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <h4 className="text-sm font-medium text-current mb-2">🏷️ Marka Bazlı Rapor</h4>
 <p className="text-sm text-current">Markalara göre ürün dağılımını görüntüleyin.</p>
 <button
  onClick={() => onNavigate?.('urunhazirlama-marka')}
  className="mt-3 btn-ghost px-4 py-2 transition-colors"
 >
  Marka Eşleştirme Sayfasına Git →
 </button>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* ==================== PAZARYERİ RAPORLARI TAB ==================== */}
 {activeTab === 'pazaryeri' && (
 <div className="space-y-6">
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam Pazaryeri</div>
 <div className="text-2xl font-bold text-current">{stats?.totalMarketplaces || 0}</div>
 </div>
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Toplam Sipariş</div>
 <div className="text-2xl font-bold text-current">{stats?.totalOrders || 0}</div>
 </div>
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Bugünkü Sipariş</div>
 <div className="text-2xl font-bold text-current">{stats?.todayOrders || 0}</div>
 </div>
 <div className="panel-theme p-5 backdrop-blur-sm">
 <div className="text-sm text-current mb-1">Gönderim Bekleyen</div>
 <div className="text-2xl font-bold text-current">-</div>
 </div>
 </div>

 {/* Marketplace Details */}
 {summary.length > 0 && (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-base font-semibold text-current">Pazaryeri Performansı</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Pazaryeri</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Hazır</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Gönderildi</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Pasif</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Hata</th>
 <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-current">Başarı Oranı</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {summary.map((item) => {
 const successRate = item.total > 0
 ? (((item.ready + item.sent) / item.total) * 100).toFixed(1)
 : '0.0';
 return (
 <tr key={item.marketplaceId} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
 <td className="px-6 py-3 font-medium text-current">{item.marketplaceName}</td>
 <td className="px-6 py-3 text-center">
 <span className="text-current font-medium">{item.ready}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className="text-current font-medium">{item.sent}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className="text-slate-700 dark:text-slate-300">{item.passive}</span>
 </td>
 <td className="px-6 py-3 text-center">
 <span className={`font-medium ${item.error > 0 ? 'text-current' : 'text-current'}`}>
 {item.error}
 </span>
 </td>
 <td className="px-6 py-3 text-center">
 <div className="flex items-center justify-center gap-2">
 <div className="w-20 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div
 className="bg-transparent h-2 rounded-full"
 style={{ width: `${successRate}%` }}
 />
 </div>
 <span className="text-sm text-current">%{successRate}</span>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {summary.length === 0 && !loading && (
 <div className="flex flex-col items-center justify-center p-12 text-current">
 <div className="text-4xl mb-4">🛒</div>
 <div>Henüz pazaryeri verisi bulunmuyor</div>
 <p className="text-sm mt-2">Pazaryerlerine ürün göndermeye başladığınızda burada raporlar görünecek.</p>
 </div>
 )}
 </div>
 )}
 </div>
 );
}
