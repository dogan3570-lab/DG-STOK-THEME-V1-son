import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useMarketplace } from '../../context/MarketplaceContext';
import { showToast } from '../../components/ui/Toast';

// ÖNEMLİ: Bu panelde global apiFetch KULLANILMAZ.
// Global apiFetch 401'de localStorage auth'unu siler + window.location.reload() yapar
// (→ App !loggedIn → SaasLogin). Bu panelden login/reload zinciri TETİKLENMEMELİ.
// mfFetch, 401'de yalnız unauthorized döner; navigasyon/reload/localStorage DEĞİŞTİRMEZ.
async function mfFetch<T = any>(path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; unauthorized: boolean; data?: T; error?: string }> {
  try {
    const token = localStorage.getItem('dgstok_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers, credentials: 'include' });
    const json = await res.json().catch(() => null);
    if (res.status === 401) {
      return { ok: false, status: 401, unauthorized: true, error: 'Oturum geçersiz' };
    }
    if (!res.ok) return { ok: false, status: res.status, unauthorized: false, error: json?.error || `HTTP ${res.status}` };
    return { ok: true, status: res.status, unauthorized: false, data: json };
  } catch (e: any) {
    return { ok: false, status: 0, unauthorized: false, error: e?.message || 'Network error' };
  }
}

interface MissingAttr {
  attributeId: number;
  attributeName: string;
  currentValueId: number | null;
  currentValue: string | null;
  reason: string;
}

interface MissingItem {
  productId: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  brandName: string | null;
  xmlSourceId: string | null;
  marketplaceId: string;
  marketplaceKey: string;
  missingAttributes: MissingAttr[];
  autoResolvedCount: number;
  unresolvedCount: number;
  status: string;
}

interface Stats {
  totalMissing: number;
  autoResolved: number;
  needsUser: number;
  byField: Record<string, number>;
  distinctAttributes?: number;
}

interface AttrValue { attributeValueId: number; attributeValue: string; }

function fold(s: string): string {
  return String(s || '').toLowerCase();
}

const FIELD_FILTERS: Array<{ key: string; label: string; match: (n: string) => boolean }> = [
  { key: 'all', label: 'Tümü', match: () => true },
  { key: 'model', label: 'Model', match: (n) => n.includes('model') },
  { key: 'beden', label: 'Beden', match: (n) => n.includes('beden') || n.includes('size') },
  { key: 'boyut', label: 'Boyut/Ebat', match: (n) => n.includes('boyut') || n.includes('ebat') || n.includes('ölçü') || n.includes('olcu') },
  { key: 'duy', label: 'Duy Tipi', match: (n) => n.includes('duy') },
  { key: 'calisma', label: 'Çalışma Tipi', match: (n) => n.includes('çalış') || n.includes('calis') },
  { key: 'kamera', label: 'Kamera', match: (n) => n.includes('kamera') },
  { key: 'uyari', label: 'Uyarı', match: (n) => n.includes('uyarı') || n.includes('uyari') },
  { key: 'hacim', label: 'Hacim', match: (n) => n.includes('hacim') || n.includes('hacı') },
  { key: 'voltaj', label: 'Voltaj', match: (n) => n.includes('voltaj') || n.includes('volt') },
  { key: 'frekans', label: 'Frekans', match: (n) => n.includes('frekans') },
];

const PAGE_SIZE = 20;

export default function MissingFieldsPanel({ openSignal }: { openSignal?: number } = {}) {
  const { selectedMarketplace } = useMarketplace();
  const [stats, setStats] = useState<Stats | null>(null);
  const [allItems, setAllItems] = useState<MissingItem[]>([]);
  const [catExtMap, setCatExtMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [resolve, setResolve] = useState<{
    productId: string; attributeId: number; attributeName: string; catExt: number;
    values: AttrValue[]; selected: number | null; sku: string | null; mpId: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [authIssue, setAuthIssue] = useState(false);

  const loadStats = useCallback(async () => {
    const s = await mfFetch<any>('/missing-fields/stats');
    if (s.unauthorized) { setAuthIssue(true); return; }
    if (s.ok && s.data?.data) setStats(s.data.data);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const first = await mfFetch<any>('/missing-fields?page=1');
      if (first.unauthorized) { setAuthIssue(true); setError(null); setLoading(false); return; }
      if (!first.ok || !first.data?.data) {
        setError(first.error || 'Liste alınamadı');
        setLoading(false);
        return;
      }
      const d = first.data.data;
      const totalPages = Number(d.totalPages || 1);
      const all: MissingItem[] = [...(d.items || [])];
      const pages: number[] = [];
      for (let p = 2; p <= totalPages; p++) pages.push(p);
      const BATCH = 8;
      for (let i = 0; i < pages.length; i += BATCH) {
        const chunk = pages.slice(i, i + BATCH);
        const res = await Promise.all(chunk.map((p) => mfFetch<any>(`/missing-fields?page=${p}`)));
        for (const r of res) {
          if (r.unauthorized) { setAuthIssue(true); continue; }
          if (r.ok && r.data?.data?.items) all.push(...r.data.data.items);
        }
      }
      setAllItems(all);

      const mpId = selectedMarketplace?.id || all[0]?.marketplaceId;
      const ids = [...new Set(all.map((x) => x.productId))];
      const map = new Map<string, number>();
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const q = `/categories/attributes?productIds=${chunk.join(',')}${mpId ? `&marketplaceId=${mpId}` : ''}`;
        const r = await mfFetch<any>(q);
        if (r.unauthorized) { setAuthIssue(true); continue; }
        const items = (r.ok && (r.data?.items || r.data?.data?.items)) || [];
        for (const it of items) if (!map.has(it.productId)) map.set(it.productId, it.categoryExternalId);
      }
      setCatExtMap(map);
    } catch (e: any) {
      setError(e?.message || 'Hata');
    } finally {
      setLoading(false);
    }
    // Liste çağrısı route'un stats cache'ini temizler → stats taze hesaplanır.
    await loadStats();
  }, [selectedMarketplace?.id, loadStats]);

  useEffect(() => { loadStats(); }, [loadStats]);
  // Dış buton ("🟡 Pazaryeri Zorunlu") sinyali → kuyruğu aç.
  useEffect(() => { if (openSignal && openSignal > 0) setExpanded(true); }, [openSignal]);
  useEffect(() => {
    if (expanded && !authIssue && allItems.length === 0 && !loading) loadAll();
  }, [expanded, authIssue, allItems.length, loading, loadAll]);

  const resolveMarketplaceId = useCallback((item?: MissingItem) => {
    return selectedMarketplace?.id || item?.marketplaceId || '';
  }, [selectedMarketplace?.id]);

  const openResolve = useCallback(async (item: MissingItem, attr: MissingAttr) => {
    const mpId = resolveMarketplaceId(item);
    const catExt = catExtMap.get(item.productId) || null;
    if (!catExt) { showToast('error', 'Bu ürün için kategori eşleşmesi bulunamadı'); return; }
    try {
      const r = await mfFetch<any>(`/missing-fields/attribute-values?attributeId=${attr.attributeId}&categoryExternalId=${catExt}`);
      if (r.unauthorized) { setAuthIssue(true); showToast('error', 'Oturum geçersiz'); return; }
      const values: AttrValue[] = (r.ok && r.data?.data) || [];
      setResolve({ productId: item.productId, attributeId: attr.attributeId, attributeName: attr.attributeName, catExt, values, selected: null, sku: item.sku, mpId });
    } catch {
      showToast('error', 'Değerler alınamadı');
    }
  }, [catExtMap, resolveMarketplaceId]);

  const saveResolve = useCallback(async () => {
    if (!resolve || !resolve.selected) { showToast('error', 'Lütfen bir değer seçin'); return; }
    setSaving(true);
    const val = resolve.values.find((v) => v.attributeValueId === resolve.selected);
    try {
      const r = await mfFetch<any>('/categories/attributes/manual', {
        method: 'POST',
        body: JSON.stringify({
          productId: resolve.productId,
          marketplaceId: resolve.mpId,
          attributeId: resolve.attributeId,
          attributeValueId: resolve.selected,
          sourceName: 'missing-fields-ui',
          sourceValue: val?.attributeValue ?? '',
        }),
      });
      if (r.unauthorized) {
        setAuthIssue(true);
        showToast('error', 'Oturum geçersiz');
      } else if (r.ok && r.data?.ok) {
        showToast('success', `${resolve.attributeName} eşleştirildi`);
        setResolve(null);
        await loadAll();
      } else {
        showToast('error', (r.data?.error?.message) || r.error || 'Eşleştirme başarısız');
      }
    } catch {
      showToast('error', 'Eşleştirme hatası');
    }
    setSaving(false);
  }, [resolve, loadAll]);

  const filtered = useMemo(() => {
    const f = FIELD_FILTERS.find((x) => x.key === activeFilter) || FIELD_FILTERS[0];
    if (activeFilter === 'all') return allItems;
    const known = FIELD_FILTERS.filter((x) => x.key !== 'all' && x.key !== 'diger');
    return allItems.filter((it) => {
      const names = it.missingAttributes.map((m) => fold(m.attributeName));
      if (activeFilter === 'diger') {
        return names.some((n) => !known.some((k) => k.match(n)));
      }
      return names.some((n) => f.match(n));
    });
  }, [allItems, activeFilter]);

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allItems.length };
    const known = FIELD_FILTERS.filter((x) => x.key !== 'all' && x.key !== 'diger');
    for (const f of FIELD_FILTERS) {
      if (f.key === 'all') continue;
      counts[f.key] = allItems.filter((it) => {
        const names = it.missingAttributes.map((m) => fold(m.attributeName));
        if (f.key === 'diger') return names.some((n) => !known.some((k) => k.match(n)));
        return names.some((n) => f.match(n));
      }).length;
    }
    return counts;
  }, [allItems]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const statCards = [
    { label: 'Gönderime engel ürün', value: stats?.needsUser ?? 0, tone: 'text-red-600 dark:text-red-400' },
    { label: 'Toplam eksik zorunlu alan', value: stats?.totalMissing ?? 0, tone: 'text-amber-600 dark:text-amber-400' },
    { label: 'Eksik farklı alan', value: stats?.distinctAttributes ?? 0, tone: 'text-purple-600 dark:text-purple-400' },
    { label: 'Otomatik çözülen', value: stats?.autoResolved ?? 0, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Kullanıcı müdahalesi gereken', value: stats?.needsUser ?? 0, tone: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="mb-4 space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
              <span className="text-lg">!</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">Pazaryeri Zorunlu Alanlar</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Gönderime engel zorunlu Trendyol alanları (gerçek gate)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {expanded ? 'Kapat' : 'Eksik Zorunlu Alanları Gör'}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {statCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <div className={`text-xl font-extrabold ${c.tone}`}>{c.value}</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">{c.label}</div>
            </div>
          ))}
        </div>
        {authIssue && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            Oturum geçersiz. Bu listeyi görüntülemek için yeniden giriş yapmanız gerekir (sayfadan çıkış yapılmadı).
          </div>
        )}
      </div>

      {expanded && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700">
            {FIELD_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => { setActiveFilter(f.key); setPage(1); }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activeFilter === f.key
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {filterCounts[f.key] ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                Yükleniyor...
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</div>
            ) : pageItems.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">Kullanıcı müdahalesi gereken kayıt bulunmuyor</div>
            ) : (
              <div className="space-y-3">
                {pageItems.map((item) => (
                  <div key={item.productId} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">{item.title || 'Adsız'}</span>
                      {item.sku && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:bg-slate-700 dark:text-slate-300">{item.sku}</span>}
                      {item.brandName && <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">{item.brandName}</span>}
                      <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                        {item.marketplaceKey === 'tt' ? 'Trendyol' : (selectedMarketplace?.name || item.marketplaceKey)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.missingAttributes.map((m, i) => (
                        <button
                          key={`${m.attributeId}-${i}`}
                          type="button"
                          onClick={() => openResolve(item, m)}
                          title={m.reason}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          {m.attributeName}
                          {m.currentValue && <span className="text-amber-500">({m.currentValue})</span>}
                          <span className="text-[9px] text-amber-500">Eşleştir</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">{item.missingAttributes[0]?.reason}</div>

                    {resolve && resolve.productId === item.productId && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700 dark:bg-amber-900/10">
                        <div className="mb-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                          {resolve.attributeName} — değer seç (gerçek katalog)
                        </div>
                        {resolve.values.length === 0 ? (
                          <div className="text-xs text-slate-500">Katalogda değer bulunamadı</div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className="select-theme min-w-[240px]"
                              value={resolve.selected ?? ''}
                              onChange={(e) => setResolve((r) => (r ? { ...r, selected: Number(e.target.value) } : r))}
                            >
                              <option value="">Değer seçin...</option>
                              {resolve.values.map((v) => (
                                <option key={v.attributeValueId} value={v.attributeValueId}>{v.attributeValue}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={saving || !resolve.selected}
                              onClick={saveResolve}
                              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              {saving ? 'Kaydediliyor...' : 'Eşleştir'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setResolve(null)}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300"
                            >
                              İptal
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loading && !error && filtered.length > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-slate-600"
                >
                  Önceki
                </button>
                <span className="text-xs text-slate-500">Sayfa {safePage} / {totalPages} — {filtered.length} kayıt</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-slate-600"
                >
                  Sonraki
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
