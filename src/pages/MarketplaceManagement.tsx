// ==================== PAZARYERI YONETIMI V1.0 ====================
// Kullanici hangi XML, hangi urun, hangi pazaryeri sececegine kendisi karar verir
// API baglantisi olmayan pazaryerine gonderim yapilamaz
import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface Marketplace { id: string; key: string; name: string; apiStatus?: string | null; active?: boolean; }
interface XmlSource { id: string; name: string; active?: boolean; }

export default function MarketplaceManagement() {
 const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
 const [xmlSources, setXmlSources] = useState<XmlSource[]>([]);
 const [selectedMpId, setSelectedMpId] = useState('');
 const [selectedXmlSourceId, setSelectedXmlSourceId] = useState('');
 const [sending, setSending] = useState(false);
 const [showConfig, setShowConfig] = useState(false);
 const [configForm, setConfigForm] = useState({ apiKey: '', apiSecret: '', apiUrl: '' });
 const [mpProducts, setMpProducts] = useState<Array<{ id: string; title: string; xmlKey: string; status: string }>>([]);
 const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

 const selectedMp = marketplaces.find(m => m.id === selectedMpId);
 const isApiConnected = selectedMp?.apiStatus === 'connected' || selectedMp?.apiStatus === 'unknown';

 const fetchData = useCallback(async () => {
 const [mpRes, xmlRes] = await Promise.all([
 apiFetch<{ items: Marketplace[] }>('/marketplaces'),
 apiFetch<{ items: XmlSource[] }>('/xml-sources'),
 ]);
 if (mpRes.ok && mpRes.data) setMarketplaces(mpRes.data.items || []);
 if (xmlRes.ok && xmlRes.data) setXmlSources(xmlRes.data.items || []);
 }, []);

 const fetchMpProducts = useCallback(async () => {
 if (!selectedMpId) return;
 const params = new URLSearchParams({ limit: '50', status: 'READY' });
 if (selectedXmlSourceId) params.append('xmlSourceId', selectedXmlSourceId);
 const res = await apiFetch<{ items: Array<{ id: string; title: string; xmlKey: string; status: string }> }>(`/products?${params}`);
 if (res.ok && res.data) setMpProducts(res.data.items || []);
 }, [selectedMpId, selectedXmlSourceId]);

 useEffect(() => { fetchData(); }, []);
 useEffect(() => { fetchMpProducts(); }, [fetchMpProducts]);

 const handleApiConnect = async () => {
 if (!selectedMpId) return;
 const res = await apiFetch<any>(`/marketplaces/${selectedMpId}`, {
 method: 'PUT', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 apiKey: configForm.apiKey || undefined,
 apiSecret: configForm.apiSecret || undefined,
 apiUrl: configForm.apiUrl || undefined,
 apiStatus: configForm.apiKey ? 'connected' : 'unknown',
 }),
 });
 if (res.ok) { showToast('success', '✅ API bağlantısı güncellendi'); fetchData(); setShowConfig(false); }
 else showToast('error', res.error?.message || 'API bağlantısı başarısız');
 };

 const handleSendProducts = async () => {
 if (selectedProductIds.size === 0 || !selectedMpId) {
 showToast('warning', 'Ürün ve pazaryeri seçin');
 return;
 }
 if (!isApiConnected) {
 showToast('error', '❌ API bağlantısı olmayan pazaryerine gönderim yapılamaz');
 return;
 }
 setSending(true);
 try {
 // Once hazirla, sonra gonder
 const prepRes = await apiFetch<any>('/products/prepare', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ ids: Array.from(selectedProductIds), marketplaceId: selectedMpId }),
 });
 if (prepRes.ok) {
 showToast('success', `✅ ${prepRes.data?.readyCount || 0} ürün başarıyla gönderildi`);
 setSelectedProductIds(new Set());
 fetchMpProducts();
 } else showToast('error', prepRes.error?.message || 'Gönderim başarısız');
 } finally { setSending(false); }
 };

 const toggleProduct = (id: string) => {
 setSelectedProductIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
 };

 return (
 <div className="space-y-4">
 {/* Pazaryeri kartlari */}
 <div className="flex gap-2 flex-wrap">
 {marketplaces.map(mp => (
 <button key={mp.id} onClick={() => { setSelectedMpId(mp.id); setSelectedProductIds(new Set()); }}
 className={`rounded-xl border p-3 text-left transition-all min-w-[140px] ${ selectedMpId === mp.id ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 shadow-lg ' : 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 hover:border-current' }`}>
 <div className="flex items-center gap-2">
 <span className="text-lg">{getMpIcon(mp.key)}</span>
 <div>
 <div className="text-sm font-semibold text-current">{mp.name}</div>
 <div className="flex items-center gap-1 mt-0.5">
 <span className={`h-1.5 w-1.5 rounded-full ${ mp.apiStatus === 'connected' ? 'bg-transparent' : mp.apiStatus === 'error' ? 'bg-transparent' : 'bg-transparent' }`} />
 <span className="text-[10px] text-current">
 {mp.apiStatus === 'connected' ? 'Bağlı' : mp.apiStatus === 'error' ? 'Hata' : 'Bağlı Değil'}
 </span>
 </div>
 </div>
 </div>
 </button>
 ))}
 </div>

 {/* Secili pazaryeri detay */}
 {selectedMp && (
 <div className="panel-theme p-4 space-y-4">
 {/* Baslik */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-2xl">{getMpIcon(selectedMp.key)}</span>
 <div>
 <h3 className="text-base font-semibold text-current">{selectedMp.name}</h3>
 <p className="text-xs text-current">
 API Durum: {selectedMp.apiStatus || 'Bağlı Değil'}
 {isApiConnected ? ' 🟢' : ' 🔴'}
 </p>
 </div>
 </div>
 <button onClick={() => setShowConfig(!showConfig)}
 className="btn-ghost px-3 py-1.5">
 ⚙️ API Ayarları
 </button>
 </div>

 {/* API Ayarlari */}
 {showConfig && (
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 space-y-2">
 <input type="text" placeholder="API Key" value={configForm.apiKey}
 onChange={e => setConfigForm({ ...configForm, apiKey: e.target.value })}
 className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
 <input type="text" placeholder="API Secret" value={configForm.apiSecret}
 onChange={e => setConfigForm({ ...configForm, apiSecret: e.target.value })}
 className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
 <input type="text" placeholder="API URL" value={configForm.apiUrl}
 onChange={e => setConfigForm({ ...configForm, apiUrl: e.target.value })}
 className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
 <button onClick={handleApiConnect}
 className="btn-ghost px-3 py-1.5">Bağlantıyı Kaydet</button>
 </div>
 )}

 {/* XML Kaynak Secimi */}
 <div>
 <label className="block text-xs text-current mb-1">XML Kaynağı Filtrele</label>
 <select value={selectedXmlSourceId} onChange={e => setSelectedXmlSourceId(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tüm XML Kaynakları</option>
 {xmlSources.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
 </select>
 </div>

 {/* Urun listesi */}
 <div>
 <div className="flex items-center justify-between mb-2">
 <h4 className="text-sm font-semibold text-current">Hazır Ürünler ({mpProducts.length})</h4>
 <button onClick={handleSendProducts} disabled={selectedProductIds.size === 0 || sending || !isApiConnected}
 className="btn-ghost px-4 py-1.5 disabled:opacity-50">
 {sending ? '⏳' : `🚀 ${selectedProductIds.size > 0 ? `${selectedProductIds.size} Ürünü Gönder` : 'Gönder'}`}
 </button>
 </div>
 <div className="max-h-60 overflow-y-auto space-y-0.5">
 {mpProducts.map(p => (
 <label key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer text-xs">
 <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => toggleProduct(p.id)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 <span className="text-current flex-1 truncate">{p.title || p.xmlKey}</span>
 <span className="text-slate-700 dark:text-slate-300">{p.xmlKey}</span>
 </label>
 ))}
 {mpProducts.length === 0 && (
 <div className="text-xs text-current text-center py-4">Hazır ürün bulunamadı</div>
 )}
 </div>
 </div>
 </div>
 )}

 </div>
 );
}

function getMpIcon(key: string): string {
 const icons: Record<string, string> = {
 trendyol: '🛒', tt: '🛒', hepsiburada: '📦', he: '📦',
 n11: '🏪', amazon: '📦', pazarama: '🛍️', idefix: '📚',
 ciceksepeti: '🌸', pttavm: '📱', woocommerce: '🛒', shopify: '🛍️',
 };
 return icons[key] || '🌐';
}
