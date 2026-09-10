// ==================== MARKA ESLESTIRME V4.0 — FLOW TABLE ====================
// DG STOK V5.0 - Sol'dan saga akan 4 sutunlu flow table:
// Gelen XML Markasi › Gonderim Stratejisi › Pazaryeri Markasi › Durum/Aksiyon
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useMarketplace } from '../../context/MarketplaceContext';
import { showToast } from '../../components/ui/Toast';

// ==================== TIPLER ====================

interface XmlBrandItem { name: string; sourceName: string; }
interface MappingItem {
 xmlBrandName: string; dgBrandId: string; dgBrandName: string;
 isAuto: boolean; confidence: number | null; productCount: number | null;
}
interface SystemBrand { id: string; name: string; productCount?: number; }
interface BrandProduct {
 id: string; brandMatch: boolean; matchedBy: string | null;
 brand?: { id: string; name: string } | null;
}
interface BrandStats { matchedProducts: number; unmatchedProducts: number; }

type RowStatus = 'matched' | 'ai' | 'suggested' | 'required' | 'none';

interface BrandGroup {
 xmlBrand: string; productCount: number; status: RowStatus;
 matchedBrandName?: string; matchedDgBrandId?: string; isAuto?: boolean;
 suggestedBrandId?: string; suggestedBrandName?: string;
}

type SendMode = 'xml' | 'own';

// ==================== YARDIMCILAR ====================

const STATUS_ORDER: Record<RowStatus, number> = { matched: 0, ai: 1, suggested: 2, required: 3, none: 4 };

const STATUS_CFG: Record<RowStatus, { icon: string; label: string; bg: string; text: string }> = {
  matched: { icon: '?', label: 'Eşleşti', bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  ai: { icon: '📋', label: 'AI Önerisi', bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400' },
  suggested: { icon: '📋', label: 'Öneri Var', bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400' },
  required: { icon: '📋', label: 'Bekliyor', bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  none: { icon: '?', label: 'Markasız', bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400' },
};

function normalizeBrand(name: string): string {
 return name.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]/g, '').trim();
}

function findSuggestion(xmlBrand: string, systemBrands: SystemBrand[]): SystemBrand | null {
 const norm = normalizeBrand(xmlBrand);
 if (!norm) return null;
 const exact = systemBrands.find((b) => normalizeBrand(b.name) === norm);
 if (exact) return exact;
 if (norm.length >= 3) {
 const containing = systemBrands.find((b) => {
 const bn = normalizeBrand(b.name);
 return bn.length >= 3 && (bn.includes(norm) || norm.includes(bn));
 });
 if (containing) return containing;
 }
 return null;
}

// ==================== ANA BILESEN ====================

export default function BrandMatchTab() {
 const { marketplaceId, marketplaces, selectMarketplace } = useMarketplace();
 const [xmlBrands, setXmlBrands] = useState<XmlBrandItem[]>([]);
 const [mappings, setMappings] = useState<MappingItem[]>([]);
 const [systemBrands, setSystemBrands] = useState<SystemBrand[]>([]);
 const [products, setProducts] = useState<BrandProduct[]>([]);
 const [stats, setStats] = useState<BrandStats | null>(null);
 const [loading, setLoading] = useState(true);
 const [aiRunning, setAiRunning] = useState(false);
 const [bulkRunning, setBulkRunning] = useState(false);

 const [sendMode, setSendMode] = useState<SendMode>('xml');
 const [search, setSearch] = useState('');
 const [openDropdown, setOpenDropdown] = useState<string | null>(null);
 const [pageSize, setPageSize] = useState(50);
 const [currentPage, setCurrentPage] = useState(1);

 const [brandInput, setBrandInput] = useState('DG STORE');
 const [savingDefault, setSavingDefault] = useState(false);

 const [manualOpen, setManualOpen] = useState(false);
 const [manualForBrand, setManualForBrand] = useState<string | null>(null);
 const [xmlSupplierId, setXmlSupplierId] = useState('');
 const [xmlSources, setXmlSources] = useState<Array<{ id: string; name: string }>>([]);

 // ==================== GUARD ====================
 const [showWarningModal, setShowWarningModal] = useState(false);
 const selectionsReady = !!(xmlSupplierId && marketplaceId);

 const requireMarketplace = useCallback((): boolean => {
 if (!xmlSupplierId || !marketplaceId) { setShowWarningModal(true); return false; }
 return true;
 }, [xmlSupplierId, marketplaceId]);

 useEffect(() => {
 apiFetch<{ items: Array<{ id: string; name: string }> }>('/xml-sources')
 .then(r => { if (r.ok && r.data) setXmlSources(r.data.items || []); }).catch(() => {});
 }, []);

 const fetchAll = useCallback(async () => {
 setLoading(true);
 try {
 const [xmlRes, mapRes, brandRes, prodRes, statsRes] = await Promise.all([
 apiFetch<{ items: XmlBrandItem[] }>('/brands/xml-brands'),
 apiFetch<{ items: MappingItem[] }>('/brands/mappings'),
 apiFetch<{ items: SystemBrand[] }>('/brands'),
 apiFetch<{ items: BrandProduct[] }>('/brands/products?page=1&limit=1000'),
 apiFetch<BrandStats>('/brands/stats'),
 ]);
 if (xmlRes.ok && xmlRes.data) setXmlBrands(xmlRes.data.items || []);
 if (mapRes.ok && mapRes.data) setMappings(mapRes.data.items || []);
 if (brandRes.ok && brandRes.data) setSystemBrands(brandRes.data.items || []);
 if (prodRes.ok && prodRes.data) setProducts(prodRes.data.items || []);
 if (statsRes.ok && statsRes.data) setStats(statsRes.data);
 } finally { setLoading(false); }
 }, []);

 const fetchDefaultBrand = useCallback(async () => {
 try {
 const r = await apiFetch<{ defaultBrand: string }>('/brands/default-brand');
 if (r.ok && r.data?.defaultBrand) setBrandInput(r.data.defaultBrand);
 } catch { /* sessiz */ }
 }, []);

 useEffect(() => { fetchAll(); fetchDefaultBrand(); }, [fetchAll, fetchDefaultBrand]);

 const groups = useMemo<BrandGroup[]>(() => {
 const mappingMap = new Map<string, MappingItem>();
 for (const m of mappings) mappingMap.set(m.xmlBrandName, m);

 const countMap = new Map<string, number>();
 let unbrandedCount = 0;
 for (const p of products) {
 const name = p.brand?.name;
 if (name) countMap.set(name, (countMap.get(name) || 0) + 1);
 else unbrandedCount++;
 }

 const result: BrandGroup[] = xmlBrands.map((xb) => {
 const productCount = countMap.get(xb.name) || 0;
 const mapping = mappingMap.get(xb.name);
 if (mapping) {
 return {
 xmlBrand: xb.name, productCount,
 status: mapping.isAuto ? 'ai' : 'matched',
 matchedBrandName: mapping.dgBrandName, matchedDgBrandId: mapping.dgBrandId,
 isAuto: mapping.isAuto,
 };
 }
 const suggestion = findSuggestion(xb.name, systemBrands);
 if (suggestion) {
 return {
 xmlBrand: xb.name, productCount, status: 'suggested',
 suggestedBrandId: suggestion.id, suggestedBrandName: suggestion.name,
 };
 }
 return { xmlBrand: xb.name, productCount, status: 'required' };
 });

 if (unbrandedCount > 0) {
 result.push({ xmlBrand: '(Markasız)', productCount: unbrandedCount, status: 'none' });
 }
 return result.sort((a, b) =>
 STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]
 ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
 : a.xmlBrand.localeCompare(b.xmlBrand, 'tr'),
 );
 }, [xmlBrands, mappings, systemBrands, products]);

 const visibleGroups = useMemo(() => {
 if (!search.trim()) return groups;
 const q = search.toLocaleLowerCase('tr-TR');
 return groups.filter((g) => g.xmlBrand.toLocaleLowerCase('tr-TR').includes(q));
 }, [groups, search]);

 // Pagination
 const totalPages = Math.max(1, Math.ceil(visibleGroups.length / pageSize));
 const safePage = Math.min(currentPage, totalPages);
 const paginatedGroups = useMemo(() => {
 const start = (safePage - 1) * pageSize;
 return visibleGroups.slice(start, start + pageSize);
 }, [visibleGroups, pageSize, safePage]);

 useEffect(() => { setCurrentPage(1); }, [pageSize, search]);

 const kpi = useMemo(() => {
 const manual = products.filter((p) => p.brandMatch && p.matchedBy !== 'ai').length;
 const ai = products.filter((p) => p.brandMatch && p.matchedBy === 'ai').length;
 const unmatched = stats?.unmatchedProducts ?? products.filter((p) => !p.brandMatch).length;
 return { manual, ai, unmatched };
 }, [products, stats]);

 const requiredCount = groups.filter((g) => g.status === 'required' || g.status === 'none').length;
 const aiPendingCount = groups.filter((g) => g.status === 'ai').length;
 const suggestedCount = groups.filter((g) => g.status === 'suggested').length;

 // ==================== AKSIYONLAR ====================

 const handleMatch = async (xmlBrandName: string, dgBrandId: string, dgBrandName?: string) => {
 if (!requireMarketplace()) return;
 const r = await apiFetch<{ matchedCount: number; message: string }>('/brands/match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ xmlBrandName, dgBrandId, marketplaceId }),
 });
 if (r.ok) {
 showToast('success', `? ${xmlBrandName} › ${dgBrandName || 'marka'} (${r.data?.matchedCount ?? 0} ürün)`);
 setOpenDropdown(null); fetchAll();
 } else { showToast('error', r.error?.message || 'Eşleştirme başarısız'); }
 };

 const handleAiMatch = async () => {
 if (!requireMarketplace()) return;
 setAiRunning(true);
 try {
 const r = await apiFetch<{ matchedCount: number; suggestedCount: number; message: string }>('/brands/ai-match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ marketplaceId }),
 });
 if (r.ok && r.data) {
 showToast('success', `?? ${r.data.message || `${r.data.matchedCount} ürün eşleştirildi`}`);
 fetchAll();
 } else { showToast('error', r.error?.message || 'AI eşleştirme başarısız'); }
 } finally { setAiRunning(false); }
 };

 const handleMatchAll = async () => {
 if (!requireMarketplace()) return;
 const matches = groups
 .filter((g) => (g.status === 'ai' && g.matchedDgBrandId) || (g.status === 'suggested' && g.suggestedBrandId))
 .map((g) => ({ xmlBrandName: g.xmlBrand, dgBrandId: (g.status === 'ai' ? g.matchedDgBrandId : g.suggestedBrandId) as string }));
 if (matches.length === 0) {
 showToast('warning', 'Otomatik eşleştirilebilecek öneri bulunamadı.');
 return;
 }
 setBulkRunning(true);
 try {
 const r = await apiFetch<{ matchedCount: number; message: string }>('/brands/bulk-match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ matches, marketplaceId }),
 });
 if (r.ok && r.data) {
 showToast('success', `? ${r.data.message || `${matches.length} marka eşleştirildi`}`);
 fetchAll();
 } else { showToast('error', r.error?.message || 'Toplu eşleştirme başarısız'); }
 } finally { setBulkRunning(false); }
 };

 const handleSaveDefaultBrand = async () => {
 if (!brandInput.trim()) return;
 setSavingDefault(true);
 try {
 const r = await apiFetch<{ defaultBrand: string }>('/brands/default-brand', {
 method: 'PUT', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ brand: brandInput.trim() }),
 });
 if (r.ok) showToast('success', `? Varsayılan marka: ${brandInput.trim()}`);
 else showToast('error', r.error?.message || 'Kaydedilemedi');
 } finally { setSavingDefault(false); }
 };

 const openManualAdd = (xmlBrand: string | null) => { setManualForBrand(xmlBrand); setManualOpen(true); };
 const handleManualDone = () => { setManualOpen(false); setManualForBrand(null); fetchAll(); };

 // ==================== RENDER ====================

 return (
 <div className="relative">
 <h1 className="mb-4 pt-1 text-center text-[26px] font-extrabold tracking-tight" >
 Marka Eşleştirme V4
 </h1>

 {/* Tedarikci + Pazaryeri Secimi */}
 <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
 <select value={xmlSupplierId} onChange={e => setXmlSupplierId(e.target.value)}
 className="rounded-xl border border-current bg-secondary/5 px-4 py-2 text-sm font-medium text-current min-w-[200px]">
 <option value="">?? Tedarikci / XML Seciniz...</option>
 {xmlSources.map(xs => <option key={xs.id} value={xs.id}>{xs.name}</option>)}
 </select>
 <select value={marketplaceId} onChange={e => selectMarketplace(e.target.value)}
 className="rounded-xl border border-current bg-secondary/5 px-4 py-2 text-sm font-medium text-current min-w-[200px]">
 <option value="">?? Pazaryeri Seciniz...</option>
 {marketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
 </select>
 </div>

 {/* ====== ANA KART ====== */}
 <div className="rounded-[28px] border p-5 shadow-card backdrop-blur-xl sm:p-7 bg-transparent border-current">

 {/* ====== TEDARIKCI + PAZARYERI SECIM GUARD ====== */}
 {!selectionsReady && (
 <div className="flex items-center gap-3 p-3 my-4 bg-transparent border border-current rounded-xl text-current text-sm">
 <span className="text-lg">??</span>
 <span className="font-medium">İşleme devam etmek için lütfen yukarıdan <b>Tedarikçi (XML)</b> ve <b>Pazaryeri</b> seçiniz.</span>
 </div>
 )}
 {selectionsReady && (
 <>
 {/* ====== MODE SELECTOR ====== */}
 <div className="mb-5 rounded-2xl border bg-transparent/80 px-5 py-3" >
 <div className="flex flex-wrap items-center gap-4">
 <span className="text-sm font-bold" >Gönderim Stratejisi:</span>
 <div className="flex items-center rounded-full p-1" style={{}}>
 {([
 { key: 'xml' as SendMode, label: '📦 XML Markasını Kullan' },
 { key: 'own' as SendMode, label: '🏷️ Kendi Markamla Gönder' },
 ]).map((opt) => {
 const active = sendMode === opt.key;
 return (
 <button key={opt.key} type="button" onClick={() => setSendMode(opt.key)}
 className="rounded-full px-5 py-2 text-sm font-bold transition-all duration-200"
 style={active ? { background: 'transparent', color: 'currentColor', boxShadow: '0 4px 14px -4px transparent' } : { color: 'currentColor' }}>
 {opt.label}
 </button>
 );
 })}
 </div>
 {sendMode === 'own' && (
 <div className="flex items-center gap-2">
 <input type="text" value={brandInput} onChange={(e) => setBrandInput(e.target.value)}
 placeholder="MARKA ADI" className="input-pastel w-44 !py-2 text-center text-sm font-bold uppercase" />
 <button type="button" onClick={handleSaveDefaultBrand} disabled={savingDefault}
 className="btn-purple !rounded-xl !px-4 !py-2 !text-xs">{savingDefault ? '...' : '💾 Kaydet'}</button>
 </div>
 )}
 {sendMode === 'xml' && (
 <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="?? Marka ara..."
 className="input-pastel ml-auto w-44 !rounded-full !py-2 text-xs" />
 )}
 </div>
 </div>

 {sendMode === 'own' ? (
 /* ====== KENDI MARKAM PANELI (INLINE) ====== */
 <div className="rounded-2xl border bg-transparent p-6 shadow-soft" >
 <div className="mx-auto max-w-xl text-center">
 <span className="text-3xl">???</span>
 <h3 className="mt-2 text-base font-bold" >Kendi Markanızı Kullanın</h3>
 <p className="mt-1 text-xs text-current">
 Pazaryerine gönderilen tüm ürün adlarının başına kendi markanız eklenir:{' '}
 <span className="font-semibold" style={{}}>{brandInput || 'MARKA'}® Ürün Adı</span>
 </p>
 <p className="mt-3 text-[11px] text-current">
 Not: Bu ayar varsayılan gönderim markasıdır. XML Marka modunda yaptığınız marka eşleştirmeleri bu ayardan bağımsız çalışır.
 </p>
 </div>
 </div>
 ) : (
 <>
 {/* ====== PAGINATION TOOLBAR ====== */}
 {!loading && visibleGroups.length > 0 && (
 <div className="mb-3 rounded-2xl border bg-transparent/80 px-5 py-3 shadow-soft" >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-1.5">
 <span className="text-[11px] font-semibold text-current">Sayfa:</span>
 <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
 className="rounded-md px-2 py-0.5 text-[11px] font-bold text-current hover:bg-transparent disabled:opacity-25 hover:bg-transparent">?</button>
 {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
 const start = Math.max(1, Math.min(safePage - 3, totalPages - 6));
 const page = start + i;
 if (page > totalPages) return null;
 return (
 <button key={page} type="button" onClick={() => setCurrentPage(page)}
 className={`min-w-[28px] rounded-md px-2 py-0.5 text-[12px] font-bold transition-colors ${page === safePage ? 'bg-transparent text-current shadow-sm' : 'text-current hover:bg-transparent hover:bg-transparent'}`}>{page}</button>
 );
 })}
 <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
 className="rounded-md px-2 py-0.5 text-[11px] font-bold text-current hover:bg-transparent disabled:opacity-25 hover:bg-transparent">?</button>
 </div>
 <div className="flex items-center gap-1.5">
 <span className="text-[10px] text-current">Göster:</span>
 {[50, 100, 200, 500, 1000].map(size => (
 <button key={size} type="button" onClick={() => setPageSize(size)}
 className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${pageSize === size ? 'bg-transparent text-current shadow-sm' : 'bg-transparent text-current hover:bg-transparent hover:bg-transparent'}`}>{size}</button>
 ))}
 </div>
 </div>
 <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-current">
 <span>Toplam: <b className="text-text">{visibleGroups.length.toLocaleString('tr-TR')}</b> marka</span>
 <span className="text-border/50">|</span>
 <span>Gösterilen: <b className="text-text">{Math.min((safePage - 1) * pageSize + 1, visibleGroups.length)}-{Math.min(safePage * pageSize, visibleGroups.length)}</b> / {visibleGroups.length}</span>
 {totalPages > 1 && (<><span className="text-border/50">|</span><span>Sayfa: <b className="text-text">{safePage}/{totalPages}</b></span></>)}
 </div>
 </div>
 )}

 {/* ====== FLOW TABLE (4 SUTUN) ====== */}
 <div className="relative overflow-hidden rounded-2xl border bg-transparent shadow-soft" >
 <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] px-5 py-3 bg-gradient-to-b from-[transparent] to-[transparent]">
 <div className="text-sm font-bold" style={{}}>?? Gelen XML Markası</div>
 <div className="text-sm font-bold" style={{}}>? Gönderim Stratejisi</div>
 <div className="text-sm font-bold" style={{}}>?? Pazaryeri Markası</div>
 <div className="text-sm font-bold" style={{}}>?? Durum / Aksiyon</div>
 </div>

 {loading ? (
 <div className="flex items-center justify-center gap-3 py-16 text-current">
 <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
 <span className="text-sm">Markalar yükleniyor...</span>
 </div>
 ) : paginatedGroups.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 text-center">
 <span className="mb-3 text-4xl">??</span>
 <p className="text-sm font-medium text-current">
 {search ? 'Aramayla eşleşen marka bulunamadı.' : 'XML markası bulunamadı.'}
 </p>
 </div>
 ) : (
 <div className="divide-y divide-border/50">
 {paginatedGroups.map((g) => (
 <BrandFlowRow key={g.xmlBrand} group={g} systemBrands={systemBrands}
 dropdownOpen={openDropdown === g.xmlBrand}
 onToggleDropdown={() => setOpenDropdown(openDropdown === g.xmlBrand ? null : g.xmlBrand)}
 onCloseDropdown={() => setOpenDropdown(null)} onMatch={handleMatch}
 onManualAdd={() => openManualAdd(g.xmlBrand === '(Markasız)' ? null : g.xmlBrand)} />
 ))}
 </div>
 )}

 {!loading && paginatedGroups.length > 0 && (
 <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-current" >
 <span>{paginatedGroups.length} marka gösteriliyor</span>
 <span>Toplam: {visibleGroups.length} marka</span>
 </div>
 )}
 </div>

 {/* ====== ALT AKSIYON BUTONLARI ====== */}
 <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
 <button type="button" onClick={handleMatchAll} disabled={!marketplaceId || bulkRunning}
 className="btn-green !rounded-2xl !px-8 !py-3 !text-[14px]">
 {bulkRunning ? <><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Eşleştiriliyor...</> : <>? Tümünü Eşleştir</>}
 </button>
 <button type="button" onClick={handleAiMatch} disabled={!marketplaceId || aiRunning}
 className="btn-purple !rounded-2xl !px-8 !py-3 !text-[14px]">
 {aiRunning ? <><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />AI Çalışıyor...</> : <>?? AI ile Eşleştir</>}
 </button>
 <button type="button" onClick={() => openManualAdd(null)} className="btn-neutral !rounded-2xl !px-8 !py-3 !text-[14px]">? Manuel Ekle</button>
 </div>
 </>
 )}
 </>
 )}
 </div>

 {/* ====== KPI KARTLARI + AI ONERILERI ====== */}
 <div className="mt-5 flex flex-col gap-4 lg:flex-row">
 <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
 <KpiCardMini icon="?" iconBg="transparent" cardBg="transparent" border="currentColor" title="Tam Eşleşen" value={kpi.manual} valueColor="currentColor" />
 <KpiCardMini icon="📊" iconBg="transparent" cardBg="transparent" border="currentColor" title="AI ile Eşleşti" value={kpi.ai} valueColor="currentColor" />
 <KpiCardMini icon="📊" iconBg="transparent" cardBg="transparent" border="currentColor" title="Eşleşmeyen" value={kpi.unmatched} valueColor="currentColor" />
 </div>

 <div className="w-full shrink-0 rounded-2xl border bg-transparent p-4 shadow-soft lg:w-80" >
 <h3 className="mb-2.5 text-sm font-bold" >?? AI Önerileri</h3>
 <ul className="space-y-2 text-xs" >
 {requiredCount > 0 && (
 <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />{requiredCount} marka eşleşme bekliyor — "AI ile Eşleştir" ile otomatik tamamlayın.</li>
 )}
 {aiPendingCount > 0 && (
 <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />{aiPendingCount} AI önerisi onayınızı bekliyor.</li>
 )}
 {suggestedCount > 0 && (
 <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />{suggestedCount} marka için benzer kayıt bulundu — "Tümünü Eşleştir" ile uygulayın.</li>
 )}
 {requiredCount === 0 && aiPendingCount === 0 && suggestedCount === 0 && (
 <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />Tüm markalar eşleşti. ??</li>
 )}
 <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />Sistemde olmayan markaları ? Manuel Ekle ile oluşturun.</li>
 </ul>
 </div>
 </div>

 {/* ====== UYARI MODALI ====== */}
 {showWarningModal && (
 <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-transparent/40 backdrop-blur-sm" onClick={() => setShowWarningModal(false)}>
 <div className="panel-theme p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
 <div className="flex items-start gap-3">
 <span className="text-2xl">??</span>
 <div>
 <h3 className="text-base font-bold text-current mb-1">Eksik Seçim</h3>
 <p className="text-sm text-current leading-relaxed">Lütfen eşleştirme yapabilmek için hem <b>Tedarikçi (XML)</b> hem de <b>Pazaryeri</b> seçiniz.</p>
 </div>
 </div>
 <button
 onClick={() => setShowWarningModal(false)}
 className="mt-4 w-full py-2.5 bg-transparent border border-current text-current font-semibold rounded-xl hover:bg-transparent hover:bg-transparent transition duration-150 text-sm"
 >
 Anladım
 </button>
 </div>
 </div>
 )}

 {manualOpen && <ManualAddModal xmlBrand={manualForBrand} onClose={() => setManualOpen(false)} onDone={handleManualDone} />}
 </div>
 );
}

// ==================== FLOW ROW (4 SUTUN) ====================

function BrandFlowRow({ group, systemBrands, dropdownOpen, onToggleDropdown, onCloseDropdown, onMatch, onManualAdd }: {
 group: BrandGroup; systemBrands: SystemBrand[]; dropdownOpen: boolean; onToggleDropdown: () => void; onCloseDropdown: () => void;
 onMatch: (xmlBrandName: string, dgBrandId: string, dgBrandName?: string) => void; onManualAdd: () => void;
}) {
 const cfg = STATUS_CFG[group.status];

 return (
 <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)] items-stretch transition-colors hover:bg-[transparent] hover:bg-transparent">
 {/* Sutun 1: Gelen XML Markasi */}
 <div className="flex min-w-0 items-center gap-2 px-4 py-3">
 <span className="shrink-0 text-[10px] text-current">?</span>
 <div className="min-w-0">
 <div className="truncate text-sm font-semibold" title={group.xmlBrand}>{group.xmlBrand}</div>
 <div className="text-[10px] text-current">{group.productCount.toLocaleString('tr-TR')} ürün</div>
 </div>
 </div>

 {/* Sutun 2: Gonderim Stratejisi */}
 <div className="flex items-center px-3">
 <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
 style={{}}>
 ? XML Markası
 </span>
 </div>

 {/* Sutun 3: Pazaryeri Markasi */}
 <div className="flex min-w-0 items-center px-3 py-3">
 {group.status === 'matched' && (
 <div className="flex min-w-0 items-start gap-1.5 text-sm" >
 <span className="mt-1 shrink-0 text-[8px] text-current">?</span>
 <span className="truncate font-medium" title={group.matchedBrandName}>{group.matchedBrandName}</span>
 </div>
 )}
 {group.status === 'ai' && (
 <div className="min-w-0 flex-1">
 <div className="flex items-start gap-1.5 text-sm" >
 <span className="mt-1 shrink-0 text-[8px] text-current">?</span>
 <span className="truncate font-medium" title={group.matchedBrandName}>{group.matchedBrandName}</span>
 </div>
 <div className="mt-0.5 text-[10px]" style={{}}>AI önerisi</div>
 </div>
 )}
 {(group.status === 'suggested' || group.status === 'required') && (
 <BrandSelectDropdown systemBrands={systemBrands} preselectedId={group.status === 'suggested' ? group.suggestedBrandId : undefined}
 placeholder="Marka Seç" open={dropdownOpen} onToggle={onToggleDropdown} onClose={onCloseDropdown}
 onSelect={(id, name) => onMatch(group.xmlBrand, id, name)} />
 )}
 {group.status === 'none' && (
 <span className="text-xs text-current italic">XML'de marka bilgisi yok</span>
 )}
 </div>

 {/* Sutun 4: Durum / Aksiyon */}
 <div className="flex items-center gap-2 px-3 py-3">
 <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold"
 style={{}}>
 {cfg.icon} {cfg.label}
 </span>

 {group.status === 'ai' && group.matchedDgBrandId && (
 <button type="button" onClick={() => onMatch(group.xmlBrand, group.matchedDgBrandId!, group.matchedBrandName)}
 className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold text-current shadow-sm transition-all hover:brightness-110"
 style={{}}>? Onayla</button>
 )}
 {(group.status === 'required' || group.status === 'none') && (
 <button type="button" onClick={onManualAdd}
 className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold text-current hover:bg-transparent hover:bg-transparent"
 >? Ekle</button>
 )}
 </div>
 </div>
 );
}

// ==================== MARKA SEC DROPDOWN ====================

function BrandSelectDropdown({ systemBrands, preselectedId, placeholder, open, onToggle, onClose, onSelect }: {
 systemBrands: SystemBrand[]; preselectedId?: string; placeholder: string; open: boolean; onToggle: () => void; onClose: () => void; onSelect: (id: string, name: string) => void;
}) {
 const [query, setQuery] = useState('');
 const [selected, setSelected] = useState<SystemBrand | null>(systemBrands.find((b) => b.id === preselectedId) || null);

 useEffect(() => { if (preselectedId) setSelected(systemBrands.find((b) => b.id === preselectedId) || null); }, [preselectedId, systemBrands]);

 const filtered = useMemo(() => {
 if (!query.trim()) return systemBrands;
 const q = query.toLocaleLowerCase('tr-TR');
 return systemBrands.filter((b) => b.name.toLocaleLowerCase('tr-TR').includes(q));
 }, [systemBrands, query]);

 return (
 <div className="relative w-full min-w-0">
 <button type="button" onClick={onToggle}
 className="inline-flex w-full min-w-[130px] items-center justify-between gap-2 rounded-xl bg-transparent px-3 py-2 text-xs font-semibold shadow-soft transition-all hover:shadow-hover"
 >
 <span className="truncate">{selected ? selected.name : placeholder}</span>
 <span className="text-[10px] text-current">?</span>
 </button>
 {open && (
 <>
 <div className="fixed inset-0 z-30" onClick={onClose} />
 <div className="absolute left-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border bg-transparent shadow-card" >
 <div className="border-b p-2" >
 <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Marka ara..." autoFocus
 className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" />
 </div>
 <div className="p-1.5" style={{ maxHeight: '220px', overflowY: 'auto' }}>
 {filtered.length === 0 ? (
 <div className="py-6 text-center text-xs text-current">Marka bulunamadı</div>
 ) : (
 filtered.map((b) => (
 <button key={b.id} type="button" onClick={() => { setSelected(b); onSelect(b.id, b.name); }}
 className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors"
 
 onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'currentColor'; }}
 onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = selected?.id === b.id ? 'currentColor' : 'transparent'; }}>
 <span className="flex-1 truncate">{b.name}</span>
 {b.productCount != null && b.productCount > 0 && <span className="text-[9px] text-current">({b.productCount})</span>}
 </button>
 ))
 )}
 </div>
 </div>
 </>
 )}
 </div>
 );
}

// ==================== MINI KPI KARTI ====================

function KpiCardMini({ icon, iconBg, cardBg, border, title, value, valueColor }: {
 icon: string; iconBg: string; cardBg: string; border: string; title: string; value: number; valueColor: string;
}) {
 return (
 <div className="rounded-2xl border p-4 shadow-soft bg-transparent" style={{}}>
 <div className="flex items-center gap-2">
 <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs text-text shadow-sm" style={{}}>{icon}</span>
 <span className="text-xs font-bold !text-current" style={{}}>{title}</span>
 </div>
 <div className="mt-2 text-3xl font-extrabold tracking-tight !text-current" style={{}}>{value.toLocaleString('tr-TR')}</div>
 </div>
 );
}

// ==================== MANUEL EKLE MODALI ====================

function ManualAddModal({ xmlBrand, onClose, onDone }: { xmlBrand: string | null; onClose: () => void; onDone: () => void; }) {
 const [name, setName] = useState(xmlBrand && xmlBrand !== '(Markasız)' ? xmlBrand : '');
 const [linkAfterCreate, setLinkAfterCreate] = useState(!!xmlBrand && xmlBrand !== '(Markasız)');
 const [saving, setSaving] = useState(false);

 const handleCreate = async () => {
 const trimmed = name.trim();
 if (!trimmed) { showToast('warning', 'Marka adı yazın'); return; }
 setSaving(true);
 try {
 const createRes = await apiFetch<{ item: { id: string; name: string } }>('/brands', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed }),
 });
 if (!createRes.ok || !createRes.data?.item) { showToast('error', createRes.error?.message || 'Marka oluşturulamadı'); return; }
 const newBrand = createRes.data.item;

 if (linkAfterCreate && xmlBrand && xmlBrand !== '(Markasız)') {
 const matchRes = await apiFetch<{ matchedCount: number }>('/brands/match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xmlBrandName: xmlBrand, dgBrandId: newBrand.id }),
 });
 if (matchRes.ok) {
 showToast('success', `? "${newBrand.name}" oluşturuldu ve "${xmlBrand}" ile eşleştirildi (${matchRes.data?.matchedCount ?? 0} ürün)`);
 } else {
 showToast('warning', `Marka oluşturuldu ancak eşleştirme başarısız: ${matchRes.error?.message || ''}`);
 }
 } else {
 showToast('success', `? "${newBrand.name}" markası oluşturuldu`);
 }
 onDone();
 } finally { setSaving(false); }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{}} onClick={onClose}>
 <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800/60 panel-theme shadow-card" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-start justify-between gap-3 border-b border-current px-5 py-4">
 <div>
 <h3 className="text-base font-bold" >? Manuel Marka Ekle</h3>
 <p className="mt-0.5 text-xs text-current">
 {xmlBrand && xmlBrand !== '(Markasız)' ? `"${xmlBrand}" XML markası için yeni pazaryeri markası oluşturun` : 'Sisteme yeni bir pazaryeri markası ekleyin'}
 </p>
 </div>
 <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-current transition-colors hover:bg-transparent-hover hover:text-text" aria-label="Kapat">?</button>
 </div>

 <div className="space-y-4 px-5 py-5">
 <div>
 <label className="mb-1.5 block text-xs font-semibold" >Marka Adı</label>
 <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: DG STORE" autoFocus
 className="input-pastel w-full !py-2.5 text-sm font-semibold" onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
 </div>
 {xmlBrand && xmlBrand !== '(Markasız)' && (
 <label className="flex cursor-pointer items-center gap-2.5 text-xs" >
 <input type="checkbox" checked={linkAfterCreate} onChange={(e) => setLinkAfterCreate(e.target.checked)} className="rounded border-current" />
 Oluşturduktan sonra <span className="font-bold" style={{}}>"{xmlBrand}"</span> XML markasıyla eşleştir
 </label>
 )}
 </div>

 <div className="flex items-center justify-end gap-2 border-t border-current px-5 py-3.5">
 <button type="button" onClick={onClose} className="btn-neutral !px-4 !py-2 text-xs">Vazgeç</button>
 <button type="button" onClick={handleCreate} disabled={saving || !name.trim()} className="btn-green !px-4 !py-2 text-xs disabled:opacity-50">
 {saving ? 'Oluşturuluyor...' : linkAfterCreate && xmlBrand ? '? Oluştur ve Eşleştir' : '? Oluştur'}
 </button>
 </div>
 </div>
 </div>
 );
}
