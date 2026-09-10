import React, { useEffect, useState } from 'react';
import KpiCard from '../components/ui/KpiCard';

interface DashboardStats {
  totalProducts: number;
  totalOrders: number;
  totalMarketplaces: number;
  totalXmlSources: number;
  activeXmlSources: number;
  passiveXmlSources: number;
  xmlSourcesWithError: number;
  todayXmlUpdates: number;
  lowStockProducts: number;
  errorProducts: number;
  readyProducts: number;
  todayOrders: number;
  brandCount?: number;
  categoryCount?: number;
  variantCount?: number;
}

interface MarketplaceItem {
  id: string;
  key: string;
  name: string;
  apiStatus: string;
  createdAt: string;
  updatedAt: string;
}

interface XmlSourceItem {
  id: string;
  name: string;
  company: string | null;
  sourceType: string;
  url: string | null;
  active: boolean;
  connectionStatus: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [marketplaces, setMarketplaces] = useState<MarketplaceItem[]>([]);
  const [xmlSources, setXmlSources] = useState<XmlSourceItem[]>([]);
  const [brandCount, setBrandCount] = useState(0);
  const [categoryCount, setCategoryCount] = useState(0);
  const [variantCount, setVariantCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllData();
  }, []);

  async function fetchAllData() {
    try {
      const [statsRes, marketplacesRes, xmlRes] = await Promise.all([
        fetch('/dashboard/stats', { credentials: 'include' }),
        fetch('/marketplaces', { credentials: 'include' }),
        fetch('/xml-sources', { credentials: 'include' }),
      ]);

      if (statsRes.ok) {
        const d = await statsRes.json();
        setStats(d);
        setBrandCount(d.brandCount || 0);
        setCategoryCount(d.categoryCount || 0);
        setVariantCount(d.variantCount || 0);
      }
      if (marketplacesRes.ok) {
        const data = await marketplacesRes.json();
        setMarketplaces(data.items || []);
      }
      if (xmlRes.ok) {
        const data = await xmlRes.json();
        setXmlSources(data.items || []);
      }
    } catch (error) {
      console.error('Dashboard veri çekme hatası:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteXmlSource(id: string) {
    if (!confirm('Bu XML kaynağını silmek istediğinizden emin misiniz?')) return;
    try {
      await fetch(`/xml-sources/${id}`, { method: 'DELETE', credentials: 'include' });
      fetchAllData();
    } catch {
      alert('Silme hatası');
    }
  }

  function getMarketplaceIcon(key: string): string {
    const icons: Record<string, string> = {
      tt: '🛒',
      trendyol: '🛒',
      he: '📦',
      hepsiburada: '📦',
      n11: '🏪',
      amazon: '📦',
    };
    return icons[key.toLowerCase()] || '🛍️';
  }

  function getStatusDot(status: string) {
    if (status === 'ok' || status === 'connected') return <span className="status-dot-active" title="Aktif"></span>;
    if (status === 'error') return <span className="status-dot-error" title="Hata"></span>;
    return <span className="status-dot-idle" title="Bilinmiyor"></span>;
  }

  function getXmlStatusBadge(source: XmlSourceItem) {
    if (!source.active) return <span className="badge-info">Pasif</span>;
    if (source.connectionStatus === 'error' || source.lastError) return <span className="badge-danger">Hata</span>;
    if (source.lastSuccessAt) return <span className="badge-success">Aktif</span>;
    return <span className="badge-warning">Bekliyor</span>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary"></span>
          <span className="text-sm">Yükleniyor...</span>
        </div>
      </div>
    );
  }

  const totalProducts = stats?.totalProducts || 0;
  const errorProducts = stats?.errorProducts || 0;
  const lowStockProducts = stats?.lowStockProducts || 0;
  const activeXmlCount = stats?.activeXmlSources || 0;
  const passiveXmlCount = stats?.passiveXmlSources || 0;
  const xmlErrorCount = stats?.xmlSourcesWithError || 0;
  const todayXmlUpdates = stats?.todayXmlUpdates || 0;
  const readyCount = stats?.readyProducts || 0;

  return (
    <div className="space-y-6">
      {/* Page Greeting & Actions */}
      <div className="panel-theme p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Entegrasyon Performans Merkezi</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {activeXmlCount > 0
              ? `${activeXmlCount} aktif XML kaynağı ile ${totalProducts.toLocaleString('tr-TR')} ürün senkronize ediliyor.`
              : 'Henüz aktif XML kaynağı bulunmuyor.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchAllData}
            className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 text-slate-700 dark:text-slate-200"
          >
            🔄 Manuel Senkronize Et
          </button>
          <button className="btn-primary px-4 py-2.5 text-xs flex items-center gap-2">
            + Yeni Ürün Aktar
          </button>
        </div>
      </div>

      {/* Stats Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="panel-theme p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Toplam Stok Havuzu</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center text-sm">📦</div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{totalProducts.toLocaleString('tr-TR')}</span>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">Aktif</span>
          </div>
        </div>

        <div className="panel-theme p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Hazır Ürünler</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-sm">✅</div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{readyCount.toLocaleString('tr-TR')}</span>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">Eşleşti</span>
          </div>
        </div>

        <div className="panel-theme p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Pazaryeri Sağlığı</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-sm">🛒</div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{marketplaces.length}</span>
            <span className="text-[10px] font-bold text-slate-400">Bağlantı</span>
          </div>
        </div>

        <div className="panel-theme p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">XML Kaynakları</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center text-sm">🔗</div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{stats?.totalXmlSources || 0}</span>
            <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md">{activeXmlCount} Aktif</span>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard title="TOPLAM ÜRÜN" value={totalProducts.toLocaleString('tr-TR')} subtitle="Havuzdaki toplam ürün" icon="📦" color="blue" />
        <KpiCard title="EŞLEŞENLER" value={readyCount.toLocaleString('tr-TR')} subtitle="Başarılı ürünler" icon="✅" color="green" />
        <KpiCard title="EKSİK EŞLEŞME" value={errorProducts.toLocaleString('tr-TR')} subtitle="Hatalı ürünler" icon="⚠️" color="yellow" />
        <KpiCard title="STOKTA YOK" value={lowStockProducts.toLocaleString('tr-TR')} subtitle="Miktarı sıfır olanlar" icon="📉" color="red" />
        <KpiCard title="AKTİF XML KAYNAK" value={activeXmlCount} subtitle="Senkronizasyon aktif" icon="🔗" color="blue" />
        <KpiCard title="PASİF XML KAYNAK" value={passiveXmlCount} subtitle="Devre dışı kaynaklar" icon="🔌" color="yellow" />
        <KpiCard title="HATALI XML" value={xmlErrorCount} subtitle="Bağlantı sorunu olanlar" icon="⚠️" color="red" />
        <KpiCard title="BUGÜN XML GÜNCELLEME" value={todayXmlUpdates} subtitle="Bugün senkronize edilen" icon="🔄" color="green" />
        <KpiCard title="BUGÜNKÜ SİPARİŞ" value={stats?.todayOrders || 0} subtitle="Bugün gelen sipariş" icon="📑" color="purple" />
        <KpiCard title="TOPLAM SİPARİŞ" value={stats?.totalOrders || 0} subtitle="Tüm zamanlar" icon="📊" color="green" />
      </div>

      {/* PAZARYERİ API BAĞLANTILARI */}
      <div className="panel-theme p-6">
        <div className="section-header">
          <div>
            <h3 className="section-title">PAZARYERİ API BAĞLANTILARI</h3>
            <p className="section-subtitle">{marketplaces.length} pazaryeri</p>
          </div>
        </div>
        {marketplaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-slate-400">
            <div className="text-3xl mb-2">🛒</div>
            <div className="text-sm">Henüz pazaryeri bağlantısı yok</div>
            <p className="text-xs mt-1">Pazaryeri eklemek için Pazaryeri Paneli sayfasını kullanın</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {marketplaces.map((mp) => (
              <div key={mp.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-4 py-2">
                <span className="text-2xl">{getMarketplaceIcon(mp.key)}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{mp.name}</span>
                    {getStatusDot(mp.apiStatus)}
                  </div>
                  <div className="text-xs text-slate-400">{mp.key}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detaylı İstatistikler */}
      <div className="panel-theme p-6">
        <h3 className="section-title mb-4">DETAYLI İSTATİSTİKLER</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'TOPLAM ÜRÜN', value: totalProducts.toLocaleString('tr-TR') },
            { label: 'AKTİF ÜRÜNLER', value: readyCount.toLocaleString('tr-TR') },
            { label: 'STOKTA OLMAYAN', value: lowStockProducts.toLocaleString('tr-TR') },
            { label: 'HATALI ÜRÜNLER', value: errorProducts.toLocaleString('tr-TR') },
            { label: 'TOPLAM MARKA', value: brandCount },
            { label: 'TOPLAM KATEGORİ', value: categoryCount },
            { label: 'TOPLAM VARYANT', value: variantCount.toLocaleString('tr-TR') },
            { label: 'PAZARYERİ SAYISI', value: marketplaces.length },
            { label: 'TOPLAM XML KAYNAK', value: stats?.totalXmlSources || 0 },
            { label: 'AKTİF XML', value: activeXmlCount },
            { label: 'PASİF XML', value: passiveXmlCount },
            { label: 'HATALI XML', value: xmlErrorCount },
            { label: 'BUGÜN XML GÜNCELLEME', value: todayXmlUpdates },
          ].map((item, i) => (
            <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
              <div className="mt-2 text-xl font-semibold text-slate-800 dark:text-slate-100">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* XML ENTEGRASYON HUB */}
      <div className="panel-theme p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">XML ENTEGRASYON HUB</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">XML Ürün Bilgileri ve Kaynak Yönetimi</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {xmlSources.length > 0
                ? `${xmlSources.length} XML kaynağı, toplam ${totalProducts.toLocaleString('tr-TR')} ürün`
                : 'Henüz XML kaynağı eklenmemiş'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.href = '/xml'}
            className="btn-primary px-4 py-2 text-sm"
          >
            + Yeni XML Kaynağı Ekle
          </button>
        </div>

        {xmlSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400">
            <div className="text-4xl mb-2">🔗</div>
            <div className="text-sm">Henüz XML kaynağı eklenmemiş</div>
            <button
              type="button"
              onClick={() => window.location.href = '/xml'}
              className="mt-4 btn-primary px-4 py-2 text-sm"
            >
              + İlk XML Kaynağını Ekle
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800/60">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left">Kaynak Adı</th>
                  <th className="px-4 py-3 text-left">URL</th>
                  <th className="px-4 py-3 text-left">Ürün Sayısı</th>
                  <th className="px-4 py-3 text-left">Son Güncelleme</th>
                  <th className="px-4 py-3 text-left">Durum</th>
                  <th className="px-4 py-3 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {xmlSources.map((source) => (
                  <tr key={source.id} className="table-row">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{source.name}</div>
                      {source.company && <div className="text-xs text-slate-400">{source.company}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400 max-w-[200px] truncate">{source.url || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">{source.productCount}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                      {source.lastSuccessAt
                        ? new Date(source.lastSuccessAt).toLocaleString('tr-TR')
                        : 'Henüz çalışmadı'}
                    </td>
                    <td className="px-4 py-3">{getXmlStatusBadge(source)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => window.location.href = `/xml?source=${source.id}`}
                          className="text-sm text-primary hover:text-primary-hover font-medium transition-colors"
                        >
                          Ürün Listesini Aç
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteXmlSource(source.id)}
                          className="rounded p-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="XML Kaynağını Kaldır"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
