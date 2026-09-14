// ==================== READY TO SEND ENGINE V2.0 ====================
// BULGU-1 FIX: Authoritative /ready-to-ship API kullanır.
// Eski /products API bağlantısı kaldırıldı.
import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface Product {
  id: string; title: string | null; xmlKey: string;
  sku: string | null; barcode: string | null; stock: number;
  salePrice: number | null; purchasePrice: number | null;
  categoryMatch: boolean; brandMatch: boolean; variantMatch: boolean;
  variantStatus: string | null; templateMatch: boolean;
  status: string; images: string | null;
  category?: { id: string; name: string } | null;
  brand?: { id: string; name: string } | null;
  xmlSource?: { id: string; name: string; vatRate: number | null; purchasePriceVatStatus: string | null } | null;
  isReady: boolean; hasPms: boolean;
  templateReady: boolean; templateName: string | null; templateScope: string | null;
  missingReasons: string[];
  trendyolListPrice: number | null;
  purchasePriceVatIncluded: number | null;
}
interface MpMeta { id: string; key: string; name: string; operational: boolean; }
interface ContextData { xmlSources: Array<{ id: string; name: string; company: string }>; marketplaces: MpMeta[]; }
interface StatsData {
  readyCount: number; waitingCount: number; blockedCount: number; productUniverseCount: number;
  missingCategory: number; missingBrand: number; missingVariant: number; missingTemplate: number;
}

export default function ReadyToSend() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<ContextData>({ xmlSources: [], marketplaces: [] });
  const [stats, setStats] = useState<StatsData | null>(null);
  const [selectedMpIds, setSelectedMpIds] = useState<string[]>([]);
  const [selectedXmlId, setSelectedXmlId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filter, setFilter] = useState<'all' | 'ready' | 'waiting' | 'blocked'>('all');
  const [blockReason, setBlockReason] = useState('');

  // Context + Stats yükle
  useEffect(() => {
    const init = async () => {
      const [ctxRes, statsRes] = await Promise.all([
        apiFetch<ContextData>('/ready-to-ship/context'),
        apiFetch<StatsData>('/ready-to-ship/stats'),
      ]);
      if (ctxRes.ok && ctxRes.data) setContext(ctxRes.data);
      if (statsRes.ok && statsRes.data) setStats(statsRes.data);
    };
    init();
  }, []);

  // Ürün listesini çek — /ready-to-ship/ authoritative API
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (filter !== 'all') p.append('filter', filter);
      if (selectedXmlId) p.append('xmlSourceIds', selectedXmlId);
      if (selectedMpIds.length > 0) p.append('marketplaceIds', selectedMpIds.join(','));
      const r = await apiFetch<any>(`/ready-to-ship?${p}`);
      if (r.ok && r.data) {
        setProducts(r.data.items || []);
        setTotal(r.data.pagination?.total || 0);
      }
    } finally { setLoading(false); }
  }, [page, pageSize, filter, selectedXmlId, selectedMpIds]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // İstatistikleri yenile
  const refreshStats = useCallback(async () => {
    const p = new URLSearchParams();
    if (selectedXmlId) p.append('xmlSourceIds', selectedXmlId);
    if (selectedMpIds.length > 0) p.append('marketplaceIds', selectedMpIds.join(','));
    const r = await apiFetch<StatsData>(`/ready-to-ship/stats?${p}`);
    if (r.ok && r.data) setStats(r.data);
  }, [selectedXmlId, selectedMpIds]);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  const toggleSelect = (id: string) => { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const toggleSelectAll = () => { setSelectedIds(prev => prev.size === products.length ? new Set() : new Set(products.map(p => p.id))); };
  const allSelected = products.length > 0 && selectedIds.size === products.length;

  // Gönderim validate — backend /ready-to-ship/send gate'leriyle birebir
  const validateSend = (ids: string[]): string | null => {
    if (selectedMpIds.length === 0) return 'Lütfen bir pazaryeri seçin';
    if (ids.length === 0) return 'Lütfen en az 1 ürün seçin';
    const notReady = products.filter(p => ids.includes(p.id) && !p.isReady);
    if (notReady.length > 0) {
      const reasons = notReady.slice(0, 3).map(p => `"${(p.title || p.xmlKey || '').substring(0, 30)}": ${p.missingReasons.join(', ') || 'hazır değil'}`);
      return `❌ ${notReady.length} ürün gönderime hazır değil:\n${reasons.join('\n')}${notReady.length > 3 ? `\n...ve ${notReady.length - 3} ürün daha` : ''}`;
    }
    return null;
  };

  const handleSend = async (ids?: string[]) => {
    const targetIds = ids || Array.from(selectedIds);
    const reason = validateSend(targetIds);
    if (reason) { setBlockReason(reason); showToast('error', reason); return; }
    setBlockReason('');
    setSending(true);
    try {
      const xmlSourceIds = selectedXmlId ? [selectedXmlId] : context.xmlSources.map(x => x.id);
      const r = await apiFetch<any>('/ready-to-ship/send', {
        method: 'POST',
        body: JSON.stringify({
          productIds: targetIds,
          xmlSourceIds,
          marketplaceIds: selectedMpIds,
        }),
      });
      if (r.ok && r.data?.ok) {
        showToast('success', `✅ ${r.data.totalCount || targetIds.length} ürün gönderim işlendi`);
        setSelectedIds(new Set()); fetchData(); refreshStats();
      } else if (r.ok && !r.data?.ok) {
        const err = r.data?.error;
        showToast('error', err?.message || 'Gönderim başarısız');
        if (err?.blockedProducts) setBlockReason(`${err.blockedProducts.length} ürün bloklu`);
      }
    } finally { setSending(false); }
  };

  const handleSendAll = async () => {
    const allIds = products.filter(p => p.isReady).map(p => p.id);
    await handleSend(allIds);
  };

  // Durum etiketi — missingReasons'tan türetilir (backend authoritative)
  const getStage = (p: Product): { label: string; color: string } => {
    if (p.isReady) return { label: '✅ Gönderime Hazır', color: 'text-green-600 dark:text-green-400' };
    if (p.missingReasons.length > 0) {
      const first = p.missingReasons[0];
      if (first === 'Kategori' || first === 'Kategori eşlemesi') return { label: 'Kategori Bekliyor', color: 'text-current' };
      if (first === 'Marka') return { label: 'Marka Bekliyor', color: 'text-current' };
      if (first === 'Varyant') return { label: 'Varyant Bekliyor', color: 'text-current' };
      if (first === 'Şablon') return { label: 'Şablon Bekliyor', color: 'text-current' };
      if (first === 'Pazaryeri') return { label: 'Pazaryeri Bekliyor', color: 'text-current' };
    }
    return { label: 'Beklemede', color: 'text-current' };
  };

  const readyCount = stats?.readyCount ?? 0;
  const waitingCount = stats?.waitingCount ?? 0;
  const blockedCount = stats?.blockedCount ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI — backend stats'tan */}
      <div className="grid grid-cols-4 gap-3">
        <Kpi title="Gönderime Hazır" val={readyCount} c="green" />
        <Kpi title="Beklemede" val={waitingCount} c="yellow" />
        <Kpi title="Seçili" val={selectedIds.size} c="purple" />
        <Kpi title="Toplam" val={stats?.productUniverseCount ?? 0} c="slate" />
      </div>

      {/* Block Reason */}
      {blockReason && (
        <div className="panel-theme p-4">
          <div className="text-sm font-bold text-current whitespace-pre-line">{blockReason}</div>
        </div>
      )}

      {/* Üst Panel — Pazaryeri + XML + Filtre */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
        <div className="flex gap-1 flex-wrap">
          {context.marketplaces.filter(mp => mp.operational).map(mp => (
            <button key={mp.id} onClick={() => {
              setSelectedMpIds(prev => prev.includes(mp.id) ? prev.filter(id => id !== mp.id) : [...prev, mp.id]);
              setBlockReason(''); setPage(1);
            }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${selectedMpIds.includes(mp.id) ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-current border-transparent hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>
              {mp.name}
            </button>
          ))}
        </div>
        <select value={selectedXmlId} onChange={e => { setSelectedXmlId(e.target.value); setPage(1); }}
          className="select-theme px-2 py-1.5">
          <option value="">Tüm Kaynaklar</option>
          {context.xmlSources.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          {(['all', 'ready', 'waiting', 'blocked'] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }}
              className={`rounded px-2.5 py-1.5 text-xs font-medium ${filter === f ? 'bg-primary/10 text-primary' : 'text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>
              {f === 'all' ? 'Tümü' : f === 'ready' ? 'Hazır' : f === 'waiting' ? 'Bekleyen' : 'Bloklu'}
              {f === 'ready' && readyCount > 0 ? ` (${readyCount})` : ''}
              {f === 'waiting' && waitingCount > 0 ? ` (${waitingCount})` : ''}
              {f === 'blocked' && blockedCount > 0 ? ` (${blockedCount})` : ''}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-2">
          <button onClick={handleSendAll} disabled={selectedMpIds.length === 0 || sending || readyCount === 0}
            className="rounded-lg bg-transparent px-4 py-2 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">
            {sending ? '⏳' : '📤 Tümünü Gönder'}
          </button>
          <button onClick={() => handleSend()} disabled={selectedIds.size === 0 || selectedMpIds.length === 0 || sending}
            className="rounded-lg bg-transparent px-4 py-2 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">
            🚀 {selectedIds.size > 0 ? `${selectedIds.size} Ürün Gönder` : 'Seç ve Gönder'}
          </button>
        </div>
      </div>

      {/* Sayfalama */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-current">{total} ürün · {readyCount} hazır</span>
        <div className="flex gap-1 ml-auto">
          {[50, 100, 200, 500].map(s => (
            <button key={s} onClick={() => { setPageSize(s); setPage(1); }}
              className={`rounded px-2.5 py-1.5 text-xs font-medium ${pageSize === s ? 'bg-primary/10 text-primary' : 'text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>{s}</button>
          ))}
        </div>
      </div>

      {/* Tablo */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          <table className="w-full min-w-[1200px]">
            <thead className="bg-slate-50 dark:bg-slate-800/30 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Ürün</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">SKU/Barkod</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-current">Alış (KDV Dahil)</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-current">Liste Fiyatı</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-current">Stok</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Kategori</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Marka</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Varyant</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Şablon</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-current">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
              {loading ? (
                <tr><td colSpan={11} className="text-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto" /></td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-sm text-current">✅ Uygun ürün bulunamadı</td></tr>
              ) : products.map(p => {
                const stage = getStage(p);
                return (
                  <tr key={p.id} className={`transition-colors ${selectedIds.has(p.id) ? 'bg-primary/5' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>
                    <td className="px-3 py-2.5"><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" /></td>
                    <td className="px-3 py-2.5">
                      <div className="text-sm font-medium text-current truncate max-w-[180px]" title={p.title || p.xmlKey}>{p.title || p.xmlKey}</div>
                      <div className="text-[10px] text-current">{p.xmlSource?.name || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-current">{p.sku || '-'}</div>
                      <div className="text-[10px] text-current">{p.barcode || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="text-sm font-semibold text-current">{p.purchasePriceVatIncluded ? `₺${p.purchasePriceVatIncluded.toFixed(2)}` : '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="text-sm font-semibold text-current">{p.salePrice ? `₺${p.salePrice.toFixed(2)}` : '-'}</div>
                      {p.trendyolListPrice && <div className="text-[10px] text-current">TT: ₺{p.trendyolListPrice.toFixed(2)}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-sm font-bold ${(p.stock ?? 0) <= 0 ? 'text-red-500' : (p.stock ?? 0) < 10 ? 'text-yellow-500' : 'text-current'}`}>{p.stock ?? 0}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{p.categoryMatch ? '✅' : '❌'}</td>
                    <td className="px-3 py-2.5 text-xs">{p.brandMatch ? '✅' : '❌'}</td>
                    <td className="px-3 py-2.5 text-xs">{(p.variantMatch || p.variantStatus === 'NOT_REQUIRED') ? '✅' : '⏳'}</td>
                    <td className="px-3 py-2.5 text-xs">{p.templateReady ? '✅' : '⏳'}</td>
                    <td className="px-3 py-2.5"><span className={`text-xs font-medium ${stage.color}`}>{stage.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
            <span className="text-xs text-current">{page}/{Math.ceil(total / pageSize)}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="rounded px-3 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">◀</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= total} className="rounded px-3 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">▶</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ title, val, c }: { title: string; val: string | number; c: string }) {
  const m: Record<string, string> = { green: 'border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-900/20 text-green-700 dark:text-green-300', yellow: 'border-yellow-200 dark:border-yellow-800/40 bg-yellow-50/50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300', purple: 'border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300', slate: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current' };
  return <div className={`rounded-xl border p-3 ${m[c] || m.slate}`}><div className="text-xs uppercase font-semibold opacity-80">{title}</div><div className="text-lg font-black mt-1">{typeof val === 'number' ? val.toLocaleString('tr-TR') : val}</div></div>;
}
