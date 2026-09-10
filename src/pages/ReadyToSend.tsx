// ==================== READY TO SEND ENGINE V1.0 ====================
// Core Business Rule: No product sent without full validation
import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface Product {
 id: string; title: string | null; xmlKey: string;
 sku: string | null; barcode: string | null; stock: number;
 salePrice: number | null; purchasePrice: number | null;
 vatRate: number | null; profitMargin: number | null;
 calculatedPrice?: number | null;
 categoryMatch: boolean; brandMatch: boolean; variantMatch: boolean; templateMatch: boolean;
 category?: { id: string; name: string } | null;
 brand?: { id: string; name: string } | null;
 xmlSource?: { id: string; name: string } | null;
 status: string; updatedAt: string;
}
interface Marketplace { id: string; key: string; name: string; }
interface XmlSource { id: string; name: string; }

export default function ReadyToSend() {
 const [products, setProducts] = useState<Product[]>([]);
 const [loading, setLoading] = useState(true);
 const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
 const [xmlSources, setXmlSources] = useState<XmlSource[]>([]);
 const [selectedMpId, setSelectedMpId] = useState('');
 const [selectedMpKey, setSelectedMpKey] = useState('');
 const [selectedXmlId, setSelectedXmlId] = useState('');
 const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
 const [sending, setSending] = useState(false);
 const [total, setTotal] = useState(0);
 const [page, setPage] = useState(1);
 const [pageSize, setPageSize] = useState(50);
 const [templatesExist, setTemplatesExist] = useState<Record<string, boolean>>({});
 const [blockReason, setBlockReason] = useState('');

 // Ready products: categoryMatch + brandMatch + variantMatch tamam olanlar
 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const p = new URLSearchParams({ page: String(page), limit: String(pageSize), categoryMatch: 'true', brandMatch: 'true' });
 if (selectedXmlId) p.append('xmlSourceId', selectedXmlId);
 const r = await apiFetch<any>(`/products?${p}`);
 if (r.ok && r.data) { setProducts(r.data.items || []); setTotal(r.data.pagination?.total || 0); }
 } finally { setLoading(false); }
 }, [page, pageSize, selectedXmlId]);

 useEffect(() => {
 const init = async () => {
 const [mpRes, xmlRes, tmplRes] = await Promise.all([
 apiFetch<any>('/marketplaces'),
 apiFetch<any>('/xml-sources'),
 apiFetch<any>('/templates'),
 ]);
 if (mpRes.ok && mpRes.data) setMarketplaces(mpRes.data.items || []);
 if (xmlRes.ok && xmlRes.data) setXmlSources(xmlRes.data.items || []);
 // Hangi pazaryerleri icin template var?
 if (tmplRes.ok && tmplRes.data?.items) {
 const map: Record<string, boolean> = {};
 for (const t of tmplRes.data.items) {
 if (t.marketplaceId) map[t.marketplaceId] = true;
 }
 setTemplatesExist(map);
 }
 };
 init();
 }, []);
 useEffect(() => { fetchData(); }, [fetchData]);

 const toggleSelect = (id: string) => { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
 const toggleSelectAll = () => { setSelectedIds(prev => prev.size === products.length ? new Set() : new Set(products.map(p => p.id))); };
 const allSelected = products.length > 0 && selectedIds.size === products.length;

 // Validate before send - her urun icin ayri kontrol
 const validateSend = (ids: string[]): string | null => {
 if (!selectedMpId) return 'Lütfen bir pazaryeri seçin';
 if (ids.length === 0) return 'Lütfen en az 1 ürün seçin';
 
 const noTemplate = products.filter(p => ids.includes(p.id) && !p.templateMatch);
 if (noTemplate.length > 0) {
 return `❌ ${noTemplate.length} ürün için listing şablonu bulunamadı.\nLütfen önce Listeleme sekmesinden şablon oluşturun.`;
 }

 const noVariant = products.filter(p => ids.includes(p.id) && !p.variantMatch);
 if (noVariant.length > 0) {
 return `⚠️ ${noVariant.length} ürünün varyant eşleştirmesi tamamlanmamış`;
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
 const r = await apiFetch<any>('/products/prepare', { method: 'POST', body: JSON.stringify({ ids: targetIds, marketplaceId: selectedMpId }) });
 if (r.ok) {
 showToast('success', `✅ ${r.data?.readyCount || 0} ürün gönderildi`);
 setSelectedIds(new Set()); fetchData();
 }
 } finally { setSending(false); }
 };

 const handleSendAll = async () => {
 const allIds = products.map(p => p.id);
 await handleSend(allIds);
 };

 // Kacinci asamada oldugunu goster
 const getStage = (p: Product): { label: string; color: string } => {
 if (!p.categoryMatch) return { label: 'Kategori Bekliyor', color: 'text-current' };
 if (!p.brandMatch) return { label: 'Marka Bekliyor', color: 'text-current' };
 if (!p.variantMatch) return { label: 'Varyant Bekliyor', color: 'text-current' };
 if (!p.templateMatch) return { label: 'Şablon Bekliyor', color: 'text-current' };
 return { label: '✅ Gönderime Hazır', color: 'text-current' };
 };

 return (
 <div className="space-y-4">
 {/* KPI */}
 <div className="grid grid-cols-4 gap-3">
 <Kpi title="Gönderime Hazır" val={products.filter(p => p.categoryMatch && p.brandMatch).length} c="green" />
 <Kpi title="Seçili" val={selectedIds.size} c="purple" />
 <Kpi title="Pazaryeri" val={marketplaces.length} c="slate" />
 <Kpi title="XML Kaynak" val={xmlSources.length} c="blue" />
 </div>

 {/* Block Reason */}
 {blockReason && (
 <div className="panel-theme p-4">
 <div className="text-sm font-bold text-current whitespace-pre-line">{blockReason}</div>
 </div>
 )}

 {/* Ust Panel */}
 <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="flex gap-1 flex-wrap">
 {marketplaces.map(mp => {
 const hasTemplate = templatesExist[mp.id];
 return (
 <button key={mp.id} onClick={() => { setSelectedMpId(mp.id); setSelectedMpKey(mp.key); setBlockReason(''); }}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium ${selectedMpId === mp.id ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}
 title={hasTemplate ? '✅ Şablon var' : '❌ Şablon yok'}>
 {mp.name} {hasTemplate ? '🟢' : '⚪'}
 </button>
 );
 })}
 </div>
 <select value={selectedXmlId} onChange={e => { setSelectedXmlId(e.target.value); setPage(1); }}
 className="select-theme px-2 py-1.5">
 <option value="">Tüm Kaynaklar</option>
 {xmlSources.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
 </select>
 <div className="flex gap-1 ml-auto">
 <button onClick={handleSendAll} disabled={!selectedMpId || sending || products.length === 0}
 className="rounded-lg bg-transparent px-4 py-2 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">
 {sending ? '⏳' : '📤 Tümünü Gönder'}
 </button>
 <button onClick={() => handleSend()} disabled={selectedIds.size === 0 || !selectedMpId || sending}
 className="rounded-lg bg-transparent px-4 py-2 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">
 🚀 {selectedIds.size > 0 ? `${selectedIds.size} Ürün Gönder` : 'Seç ve Gönder'}
 </button>
 </div>
 </div>

 {/* Sayfalama */}
 <div className="flex items-center gap-2">
 <span className="text-sm text-current">{total} ürün · {products.filter(p => p.categoryMatch && p.brandMatch && p.variantMatch).length} tam hazır</span>
 <div className="flex gap-1 ml-auto">
 {[50,100,200,500].map(s => (
 <button key={s} onClick={() => { setPageSize(s); setPage(1); }}
 className={`rounded px-2.5 py-1.5 text-xs font-medium ${pageSize === s ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>{s}</button>
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
 <th className="px-3 py-3 text-right text-xs font-semibold text-current">XML Alış (KDV Dahil)</th>
 <th className="px-3 py-3 text-right text-xs font-semibold text-current">Kullanıcı Liste Fiyatı</th>
 <th className="px-3 py-3 text-right text-xs font-semibold text-current">Hesaplanan Liste Fiyatı</th>
 <th className="px-3 py-3 text-right text-xs font-semibold text-current">Stok</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Kategori</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Marka</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Varyant</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Şablon</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Durum</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {loading ? (
 <tr><td colSpan={12} className="text-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto" /></td></tr>
 ) : products.length === 0 ? (
 <tr><td colSpan={12} className="text-center py-12 text-sm text-current">✅ Tüm ürünler gönderilmiş veya henüz hazır değil</td></tr>
 ) : products.map(p => {
 const stage = getStage(p);
 const kdv = p.salePrice && p.purchasePrice ? ((p.salePrice - p.purchasePrice) / p.purchasePrice * 100).toFixed(1) : null;
 return (
 <tr key={p.id} className={`transition-colors ${selectedIds.has(p.id) ? 'bg-transparent' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'}`}>
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
 <div className="text-sm font-semibold text-current">{p.purchasePrice ? `₺${p.purchasePrice.toFixed(2)}` : '-'}</div>
 {p.purchasePrice && <div className="text-[10px] text-current">KDV: %{p.vatRate || 20}</div>}
 </td>
 <td className="px-3 py-2.5 text-right">
 <div className="text-sm font-semibold text-current">{p.salePrice ? `₺${p.salePrice.toFixed(2)}` : '-'}</div>
 {p.salePrice && !p.purchasePrice && <div className="text-[10px] text-current">Baz alınacak</div>}
 </td>
 <td className="px-3 py-2.5 text-right">
 <div className="text-sm font-semibold text-current">{p.calculatedPrice ? `₺${p.calculatedPrice.toFixed(2)}` : '-'}</div>
 {p.calculatedPrice && p.purchasePrice && <div className="text-[10px] text-current">%{(((p.calculatedPrice - p.purchasePrice) / p.purchasePrice) * 100).toFixed(1)} kar</div>}
 {!p.purchasePrice && p.salePrice && <div className="text-[10px] text-current">Kullanıcı fiyatı baz</div>}
 </td>
 <td className="px-3 py-2.5 text-right">
 <span className={`text-sm font-bold ${(p.stock ?? 0) <= 0 ? 'text-current' : (p.stock ?? 0) < 10 ? 'text-current' : 'text-current'}`}>{p.stock ?? 0}</span>
 </td>
 <td className="px-3 py-2.5 text-xs">{p.categoryMatch ? '✅' : '❌'}</td>
 <td className="px-3 py-2.5 text-xs">{p.brandMatch ? '✅' : '❌'}</td>
 <td className="px-3 py-2.5 text-xs">{p.variantMatch ? '✅' : '⏳'}</td>
 <td className="px-3 py-2.5 text-xs">{p.templateMatch ? '✅' : '⏳'}</td>
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
 const m: Record<string, string> = { green: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current', purple: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current', blue: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current', slate: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current' };
 return <div className={`rounded-xl border p-3 ${m[c] || m.blue}`}><div className="text-xs uppercase font-semibold opacity-80">{title}</div><div className="text-lg font-black mt-1">{typeof val === 'number' ? val.toLocaleString('tr-TR') : val}</div></div>;
}
