import React, { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface BrandStats {
 totalSystemBrands: number; matchedProducts: number; unmatchedProducts: number;
 totalMappings: number; totalLogs: number;
 xmlBrandUsage: number; dgBrandUsage: number; customBrandUsage: number;
 prefixEnabledCount: number;
}

interface BrandItem {
 id: string; name: string; externalId: string | null;
 logo: string | null; prefixEnabled: boolean; prefixFormat: string;
 isActive: boolean; productCount: number; mappingCount: number;
}

interface XmlBrand { name: string; sourceName: string; sourceId: string | null; }
interface MappingItem {
 id: string; xmlBrandName: string; dgBrandId: string; dgBrandName: string;
 dgBrandLogo: string | null; confidence: number | null;
 isAuto: boolean; productCount: number; createdAt: string;
}
interface BrandLogItem { id: string; action: string; xmlBrandName: string | null; dgBrandName: string | null; oldValue: string | null; newValue: string | null; prefixChanged: boolean; productCount: number; details: string | null; actorUserId: string | null; createdAt: string; }

type PageTab = 'brands' | 'mappings' | 'logs';

export default function BrandIntelligenceV6() {
 const [stats, setStats] = useState<BrandStats | null>(null);
 const [systemBrands, setSystemBrands] = useState<BrandItem[]>([]);
 const [xmlBrands, setXmlBrands] = useState<XmlBrand[]>([]);
 const [mappings, setMappings] = useState<MappingItem[]>([]);
 const [logs, setLogs] = useState<BrandLogItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState<PageTab>('brands');

 // Filters
 const [xmlSearch, setXmlSearch] = useState('');
 const [sysSearch, setSysSearch] = useState('');
 const [usageFilter, setUsageFilter] = useState('');

 // Selection
 const [selectedXmlBrand, setSelectedXmlBrand] = useState<string | null>(null);
 const [selectedSysId, setSelectedSysId] = useState<string | null>(null);
 const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

 // Modal
 const [showModal, setShowModal] = useState(false);
 const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
 const [formName, setFormName] = useState('');
 const [formLogo, setFormLogo] = useState('');
 const [formPrefix, setFormPrefix] = useState(false);
 const [formPrefixFormat, setFormPrefixFormat] = useState('MARKA\u00ae {title}');
 const [formExternalId, setFormExternalId] = useState('');

 // Prefix preview
 const [previewData, setPreviewData] = useState<{ originalTitle: string; computedTitle: string } | null>(null);

 // Detail panel
 const [detailInfo, setDetailInfo] = useState<{ type: string; data: any } | null>(null);

 // AI running
 const [aiRunning, setAiRunning] = useState(false);

 // ==================== FETCH ====================
 async function fetchAll() {
 setLoading(true);
 try {
 const [statsRes, sysRes, xmlRes, mapRes, logRes] = await Promise.all([
 apiFetch<BrandStats>('/brands/stats'),
 apiFetch<{ items: BrandItem[] }>('/brands'),
 apiFetch<{ items: XmlBrand[] }>('/brands/xml-brands'),
 apiFetch<{ items: MappingItem[] }>('/brands/mappings'),
 apiFetch<{ items: BrandLogItem[] }>('/brands/logs?limit=20'),
 ]);
 if (statsRes.ok && statsRes.data) setStats(statsRes.data);
 if (sysRes.ok && sysRes.data) setSystemBrands(sysRes.data.items || []);
 if (xmlRes.ok && xmlRes.data) setXmlBrands(xmlRes.data.items || []);
 if (mapRes.ok && mapRes.data) setMappings(mapRes.data.items || []);
 if (logRes.ok && logRes.data) setLogs(logRes.data.items || []);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 useEffect(() => { fetchAll(); }, []);

 // ==================== HANDLERS ====================

 async function handleCreateBrand(e: React.FormEvent) {
 e.preventDefault();
 try {
 const url = editingBrand ? `/brands/${editingBrand.id}` : '/brands';
 const method = editingBrand ? 'PUT' : 'POST';
 const res = await apiFetch(url, {
 method, headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ name: formName, externalId: formExternalId || undefined, logo: formLogo || undefined, prefixEnabled: formPrefix, prefixFormat: formPrefixFormat }),
 });
 if (res.ok) { setShowModal(false); setEditingBrand(null); resetForm(); fetchAll(); showToast('success', editingBrand ? 'Marka güncellendi' : 'Marka oluşturuldu'); }
 else showToast('error', res.error?.message || 'İşlem başarısız');
 } catch (err) { console.error(err); }
 }

 function resetForm() { setFormName(''); setFormLogo(''); setFormPrefix(false); setFormPrefixFormat('MARKA\u00ae {title}'); setFormExternalId(''); }

 async function handleDelete(id: string) {
 if (!confirm('Markayı silmek istediğinizden emin misiniz?')) return;
 try { await apiFetch(`/brands/${id}`, { method: 'DELETE' }); fetchAll(); showToast('success', 'Marka silindi'); }
 catch (err) { console.error(err); }
 }

 async function handleMatch(xmlBrandName: string, dgBrandId: string) {
 try {
 const res = await apiFetch<{ message: string }>('/brands/match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ xmlBrandName, dgBrandId, brandSource: 'CUSTOMER' }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 else showToast('error', res.error?.message || 'Eşleştirme başarısız');
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleUnmatch(xmlBrandName: string) {
 if (!confirm(`${xmlBrandName} eşleştirmesini kaldırmak istediğinizden emin misiniz?`)) return;
 try {
 const res = await apiFetch<{ message: string }>('/brands/unmatch', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ xmlBrandName }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 else showToast('error', res.error?.message || 'İşlem başarısız');
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleAiMatch() {
 setAiRunning(true);
 try {
 const res = await apiFetch<any>('/brands/ai-match', { method: 'POST', body: JSON.stringify({}) });
 if (res.ok && res.data) showToast('success', `AI: ${res.data.message}`);
 else showToast('error', res.error?.message || 'AI eşleştirme başarısız');
 fetchAll();
 } catch (err) { console.error(err); }
 finally { setAiRunning(false); }
 }

 async function handlePrefixApply() {
 try {
 const res = await apiFetch<any>('/brands/prefix/apply', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ allProducts: true }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 else showToast('error', res.error?.message || 'Ön ek uygulanamadı');
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handlePrefixRemove() {
 try {
 const res = await apiFetch<any>('/brands/prefix/remove', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ allProducts: true }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 else showToast('error', res.error?.message || 'Ön ek kaldırılamadı');
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleUseXmlBrand() {
 try {
 const res = await apiFetch<any>('/brands/use-xml-brand', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ allProducts: true }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleUseDgBrand() {
 try {
 const res = await apiFetch<any>('/brands/use-dg-brand', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ allProducts: true }),
 });
 if (res.ok && res.data) showToast('success', res.data.message);
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleUndo(logId: string) {
 if (!confirm('Bu işlemi geri almak istediğinizden emin misiniz?')) return;
 try {
 const res = await apiFetch<any>(`/brands/undo/${logId}`, { method: 'POST' });
 if (res.ok && res.data) showToast('success', res.data.message);
 else showToast('error', res.error?.message || 'Geri alma başarısız');
 fetchAll();
 } catch (err) { console.error(err); }
 }

 async function handleExport() {
 try {
 const res = await apiFetch<any>('/brands/export');
 if (res.ok && res.data) {
 const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a'); a.href = url; a.download = `brands-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
 URL.revokeObjectURL(url);
 showToast('success', 'Markalar dışa aktarıldı');
 }
 } catch (err) { console.error(err); }
 }

 // ==================== FILTERS ====================

 const filteredXmlBrands = xmlBrands.filter(b => !xmlSearch || b.name.toLowerCase().includes(xmlSearch.toLowerCase()));
 const filteredSysBrands = systemBrands.filter(b => !sysSearch || b.name.toLowerCase().includes(sysSearch.toLowerCase()));
 const unmatchedXmlBrands = filteredXmlBrands.filter(xb => !mappings.some(m => m.xmlBrandName === xb.name));
 const mappedXmlBrands = filteredXmlBrands.filter(xb => mappings.some(m => m.xmlBrandName === xb.name));

 // ==================== PREFIX PREVIEW ====================

 const getPrefixPreview = useMemo(() => {
 if (!selectedXmlBrand && !selectedSysId) return null;
 const brand = selectedSysId ? systemBrands.find(b => b.id === selectedSysId) : null;
 if (!brand) return null;
 return { format: brand.prefixFormat, brandName: brand.name, example: brand.prefixFormat.replace('{title}', 'Air Max 90').replace('MARKA', brand.name) };
 }, [selectedXmlBrand, selectedSysId, systemBrands]);

 // ==================== RENDER ====================
 return (
 <div className="space-y-4">
 {/* HEADER */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current flex items-center gap-2">
 <span>🏷️</span> Brand Intelligence Engine
 <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-normal">V6.0</span>
 </h2>
 <p className="text-sm text-current">XML Marka Yönetimi · DG STOK Marka Havuzu · Ön Ek Sistemi · AI Eşleştirme</p>
 </div>
 </div>

 {/* ACTION BAR */}
 <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-2.5 backdrop-blur-sm">
 <button onClick={() => { setEditingBrand(null); resetForm(); setShowModal(true); }} className="btn-ghost px-3 py-1.5">+ Yeni Marka</button>
 <button onClick={handleExport} className="btn-ghost px-3 py-1.5">📤 Dışa Aktar</button>
 <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
 <button onClick={handleAiMatch} disabled={aiRunning} className="btn-ghost px-3 py-1.5 disabled:opacity-50">
 {aiRunning ? '⏳' : '🤖'} AI Eşleştir
 </button>
 <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
 <button onClick={handleUseXmlBrand} className="btn-ghost px-3 py-1.5">📂 XML Markası Kullan</button>
 <button onClick={handleUseDgBrand} className="btn-ghost px-3 py-1.5">🏷️ DG Markası Kullan</button>
 <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
 <button onClick={handlePrefixApply} className="btn-ghost px-3 py-1.5">🔤 Ön Ek Uygula</button>
 <button onClick={handlePrefixRemove} className="btn-ghost px-3 py-1.5">🚫 Ön Ek Kaldır</button>
 <button onClick={() => fetchAll()} className="btn-ghost px-3 py-1.5">🔄</button>
 </div>

 {/* KPI CARDS */}
 {stats && (
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
 <KpiCard title="DG STOK Marka" value={stats.totalSystemBrands} color="blue" />
 <KpiCard title="Eşleşen Ürün" value={stats.matchedProducts} color="green" />
 <KpiCard title="Eşleşmeyen" value={stats.unmatchedProducts} color="yellow" />
 <KpiCard title="XML Kullanım" value={stats.xmlBrandUsage} color="blue" />
 <KpiCard title="DG Kullanım" value={stats.dgBrandUsage} color="green" />
 <KpiCard title="Ön Ek Aktif" value={stats.prefixEnabledCount} color="cyan" />
 <KpiCard title="Eşleştirme" value={stats.totalMappings} color="purple" />
 <KpiCard title="Log" value={stats.totalLogs} color="slate" />
 </div>
 )}

 {/* TABS */}
 <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1">
 {[
 { key: 'brands' as PageTab, label: '🏷️ Marka Yönetimi', desc: 'Marka eşleştirme ve ön ek' },
 { key: 'mappings' as PageTab, label: '🔗 Eşleştirmeler', desc: 'XML → DG STOK mapping' },
 { key: 'logs' as PageTab, label: '📝 İşlem Logları', desc: 'Tüm marka işlem geçmişi' },
 ].map(tab => (
 <button key={tab.key} onClick={() => setActiveTab(tab.key)}
 className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary'}`}
 title={tab.desc}>{tab.label}</button>
 ))}
 </div>

 {/* ==================== TAB 1: MARKA YÖNETİMİ ==================== */}
 {activeTab === 'brands' && (
 <div className="flex gap-4 h-[calc(100vh-420px)]">
 {/* SOL: XML Markaları */}
 <div className="w-72 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm flex flex-col">
 <div className="p-3 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-sm font-semibold text-current mb-2">📂 XML Markaları</h3>
 <input type="text" value={xmlSearch} onChange={(e) => setXmlSearch(e.target.value)}
 placeholder="XML marka ara..." className="w-full input-theme px-2.5 py-1.5" />
 <div className="flex gap-2 mt-2 text-[10px] text-current">
 <span>{unmatchedXmlBrands.length} eşleşmemiş</span>
 <span>{mappedXmlBrands.length} eşleşmiş</span>
 </div>
 </div>
 <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
 {unmatchedXmlBrands.length === 0 && mappedXmlBrands.length === 0 ? (
 <div className="text-sm text-current text-center p-4">XML markası bulunamadı</div>
 ) : (
 <>
 {unmatchedXmlBrands.length > 0 && <div className="text-[10px] text-current px-2 py-1 uppercase">Eşleşmemiş</div>}
 {unmatchedXmlBrands.map((b) => (
 <div key={b.name} onClick={() => { setSelectedXmlBrand(b.name); setDetailInfo({ type: 'xml_brand', data: b }); }}
 className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${selectedXmlBrand === b.name ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20 text-current'}`}>
 <span className="truncate flex-1">{b.name}</span>
 <span className="text-[10px] text-current ml-1">{b.sourceName}</span>
 </div>
 ))}
 {mappedXmlBrands.length > 0 && <div className="text-[10px] text-current px-2 py-1 uppercase mt-2">Eşleşmiş</div>}
 {mappedXmlBrands.map((b) => {
 const m = mappings.find(m => m.xmlBrandName === b.name);
 return (
 <div key={b.name} onClick={() => { setSelectedXmlBrand(b.name); setDetailInfo({ type: 'xml_brand', data: b }); }}
 className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${selectedXmlBrand === b.name ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20 text-current'}`}>
 <span className="truncate flex-1">{b.name}</span>
 <span className="text-[10px] text-current ml-1">→ {m?.dgBrandName || '?'}</span>
 </div>
 );
 })}
 </>
 )}
 </div>
 </div>

 {/* ORTA: DG STOK Markaları */}
 <div className="w-72 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm flex flex-col">
 <div className="p-3 border-b border-slate-100 dark:border-slate-800/60">
 <div className="flex items-center justify-between mb-2">
 <h3 className="text-sm font-semibold text-current">🏷️ DG STOK Markaları</h3>
 <button onClick={() => { setEditingBrand(null); resetForm(); setShowModal(true); }}
 className="btn-ghost px-2 py-1">+ Yeni</button>
 </div>
 <input type="text" value={sysSearch} onChange={(e) => setSysSearch(e.target.value)}
 placeholder="Marka ara..." className="w-full input-theme px-2.5 py-1.5" />
 </div>
 <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
 {filteredSysBrands.length === 0 ? (
 <div className="text-sm text-current text-center p-4">Henüz marka yok</div>
 ) : (
 filteredSysBrands.map((b) => (
 <div key={b.id} onClick={() => { setSelectedSysId(b.id); setDetailInfo({ type: 'system_brand', data: b }); }}
 className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors group ${selectedSysId === b.id ? 'bg-primary/10 text-primary' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20 text-current'}`}>
 <div className="flex items-center gap-2 min-w-0">
 <span className="truncate">{b.name}</span>
 <span className="text-[10px] text-current">({b.productCount})</span>
 </div>
 <div className="flex gap-1 opacity-0 group-hover:opacity-100">
 {b.prefixEnabled && <span className="text-[10px] text-current" title={`Ön ek: ${b.prefixFormat}`}>🔤</span>}
 <button onClick={(e) => { e.stopPropagation(); setEditingBrand(b); setFormName(b.name); setFormLogo(b.logo || ''); setFormExternalId(b.externalId || ''); setFormPrefix(b.prefixEnabled); setFormPrefixFormat(b.prefixFormat); setShowModal(true); }} className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">✏️</button>
 </div>
 </div>
 ))
 )}
 </div>
 </div>

 {/* SAĞ: Detay + Ön İzleme */}
 <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm p-4 overflow-y-auto">
 {detailInfo?.type === 'xml_brand' ? (
 <div className="space-y-4">
 <h4 className="text-base font-semibold text-current">📂 XML Marka: {detailInfo.data.name}</h4>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">XML Marka:</span> <span className="text-current ml-1">{detailInfo.data.name}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Kaynak:</span> <span className="text-current ml-1">{detailInfo.data.sourceName}</span></div>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">🏷️ DG STOK Markası Seç</label>
 <div className="flex gap-2">
 <select value={selectedSysId || ''} onChange={(e) => setSelectedSysId(e.target.value || null)}
 className="flex-1 select-theme px-2.5 py-1.5">
 <option value="">Marka seç...</option>
 {systemBrands.map(b => <option key={b.id} value={b.id}>{b.name} ({b.productCount})</option>)}
 </select>
 </div>
 </div>
 {selectedSysId && (
 <div className="flex gap-2">
 <button onClick={() => handleMatch(detailInfo.data.name, selectedSysId)}
 className="flex-1 btn-ghost px-3 py-1.5">🔗 Eşleştir</button>
 <button onClick={() => handleUnmatch(detailInfo.data.name)}
 className="btn-ghost px-3 py-1.5">Eşleştirmeyi Kaldır</button>
 </div>
 )}
 {/* Ön İzleme */}
 {getPrefixPreview && (
 <div className="rounded-lg bg-transparent p-3 border border-slate-200 dark:border-slate-800/60">
 <div className="text-xs text-current mb-2">🔤 Ön Ek Önizleme</div>
 <div className="text-xs text-current">Format: <code className="text-slate-700 dark:text-slate-300">{getPrefixPreview.format}</code></div>
 <div className="mt-2 p-2 rounded bg-transparent">
 <div className="text-xs text-current">XML: <span className="text-slate-700 dark:text-slate-300">Air Max 90</span></div>
 <div className="text-xs text-current mt-1">↓</div>
 <div className="text-xs text-current font-medium mt-1">{getPrefixPreview.example}</div>
 </div>
 </div>
 )}
 </div>
 ) : detailInfo?.type === 'system_brand' ? (
 <div className="space-y-4">
 <h4 className="text-base font-semibold text-current">🏷️ {detailInfo.data.name}</h4>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">Ürün:</span> <span className="text-current ml-1">{detailInfo.data.productCount}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Eşleştirme:</span> <span className="text-current ml-1">{detailInfo.data.mappingCount}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Ön Ek:</span> <span className={`ml-1 ${detailInfo.data.prefixEnabled ? 'text-current' : 'text-current'}`}>{detailInfo.data.prefixEnabled ? '✅ Aktif' : '❌ Pasif'}</span></div>
 {detailInfo.data.prefixEnabled && <div><span className="text-slate-700 dark:text-slate-300">Format:</span> <code className="text-current ml-1 text-[10px]">{detailInfo.data.prefixFormat}</code></div>}
 <div><span className="text-slate-700 dark:text-slate-300">Durum:</span> <span className={`ml-1 ${detailInfo.data.isActive ? 'text-current' : 'text-current'}`}>{detailInfo.data.isActive ? 'Aktif' : 'Pasif'}</span></div>
 </div>
 {/* Ön İzleme */}
 {detailInfo.data.prefixEnabled && (
 <div className="rounded-lg bg-transparent p-3 border border-slate-200 dark:border-slate-800/60">
 <div className="text-xs text-current mb-1">🔤 Ön Ek Önizleme</div>
 <div className="p-2 rounded bg-transparent">
 <div className="text-xs text-current">XML: <span className="text-slate-700 dark:text-slate-300">Air Max 90</span></div>
 <div className="text-xs text-current mt-1">↓</div>
 <div className="text-xs text-current font-medium mt-1">{detailInfo.data.prefixFormat.replace('{title}', 'Air Max 90').replace('MARKA', detailInfo.data.name)}</div>
 </div>
 </div>
 )}
 <div className="flex gap-2">
 <button onClick={() => { setEditingBrand(detailInfo.data); setFormName(detailInfo.data.name); setFormLogo(detailInfo.data.logo || ''); setFormExternalId(detailInfo.data.externalId || ''); setFormPrefix(detailInfo.data.prefixEnabled); setFormPrefixFormat(detailInfo.data.prefixFormat); setShowModal(true); }}
 className="btn-ghost px-3 py-1.5">✏️ Düzenle</button>
 <button onClick={() => handleDelete(detailInfo.data.id)}
 className="btn-ghost px-3 py-1.5">🗑️ Sil</button>
 </div>
 </div>
 ) : (
 <div className="text-sm text-current text-center py-8 flex flex-col items-center gap-2">
 <span className="text-3xl">🏷️</span>
 <span>Bir XML veya DG STOK markası seçin</span>
 <span className="text-xs text-current">Detaylar, ön izleme ve eşleştirme işlemleri burada görünecek</span>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ==================== TAB 2: EŞLEŞTİRMELER ==================== */}
 {activeTab === 'mappings' && (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {mappings.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-8 text-current">
 <div className="text-4xl mb-2">🔗</div>
 <div>Henüz eşleştirme yok</div>
 <p className="text-xs text-current mt-1">XML markalarını DG STOK markalarına eşleştirmek için "Marka Yönetimi" sekmesini kullanın</p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">XML Markası</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">DG STOK Markası</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Güven</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Tip</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Ürün</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Tarih</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {mappings.map(m => (
 <tr key={m.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-sm">
 <td className="px-4 py-3 text-current">{m.xmlBrandName}</td>
 <td className="px-4 py-3 text-current">{m.dgBrandName}</td>
 <td className="px-4 py-3">{m.confidence != null ? <span className="text-slate-700 dark:text-slate-300">%{Math.round(m.confidence)}</span> : <span className="text-slate-700 dark:text-slate-300">—</span>}</td>
 <td className="px-4 py-3">{m.isAuto ? <span className="text-slate-700 dark:text-slate-300">🤖 AI</span> : <span className="text-slate-700 dark:text-slate-300">👤 Manuel</span>}</td>
 <td className="px-4 py-3 text-current">{m.productCount}</td>
 <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{new Date(m.createdAt).toLocaleDateString('tr-TR')}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* ==================== TAB 3: LOGLAR ==================== */}
 {activeTab === 'logs' && (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {logs.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-8 text-current">
 <div className="text-4xl mb-2">📝</div>
 <div>Henüz işlem kaydı yok</div>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">İşlem</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">XML Marka</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">DG Marka</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Ürün</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Ön Ek</th>
 <th className="px-4 py-3 text-left text-xs font-semibold text-current">Tarih</th>
 <th className="px-4 py-3 text-right text-xs font-semibold text-current">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {logs.map(log => (
 <tr key={log.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-sm">
 <td className="px-4 py-3">
 <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ log.action === 'BRAND_MATCH' ? 'bg-primary/10 text-primary' : log.action === 'BRAND_UNMATCH' ? 'bg-primary/10 text-primary' : log.action === 'PREFIX_APPLY' ? 'bg-primary/10 text-primary' : log.action === 'PREFIX_REMOVE' ? 'bg-primary/10 text-primary' : log.action === 'AI_MATCH' ? 'bg-primary/10 text-primary' : log.action === 'UNDO' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>{log.action}</span>
 </td>
 <td className="px-4 py-3 text-current">{log.xmlBrandName || '-'}</td>
 <td className="px-4 py-3 text-current">{log.dgBrandName || '-'}</td>
 <td className="px-4 py-3 text-current">{log.productCount}</td>
 <td className="px-4 py-3">{log.prefixChanged ? <span className="text-slate-700 dark:text-slate-300">✅</span> : <span className="text-slate-700 dark:text-slate-300">—</span>}</td>
 <td className="px-4 py-3 text-xs text-current">{new Date(log.createdAt).toLocaleString('tr-TR')}</td>
 <td className="px-4 py-3 text-right">
 {log.action !== 'UNDO' && (
 <button onClick={() => handleUndo(log.id)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">↩ Geri Al</button>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* CREATE/EDIT MODAL */}
 {showModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
 <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <h3 className="text-lg font-semibold text-current mb-4">{editingBrand ? 'Marka Düzenle' : 'Yeni Marka Oluştur'}</h3>
 <form onSubmit={handleCreateBrand} className="space-y-4">
 <div>
 <label className="block text-sm font-medium text-current mb-1">Marka Adı *</label>
 <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current" required />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Logo URL</label>
 <input type="text" value={formLogo} onChange={(e) => setFormLogo(e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current" placeholder="https://..." />
 </div>
 <div className="flex items-center gap-3">
 <input type="checkbox" checked={formPrefix} onChange={(e) => setFormPrefix(e.target.checked)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" id="prefixToggle" />
 <label htmlFor="prefixToggle" className="text-sm text-current">Ön ek kullan</label>
 </div>
 {formPrefix && (
 <div>
 <label className="block text-sm font-medium text-current mb-1">Ön Ek Formatı</label>
 <select value={formPrefixFormat} onChange={(e) => setFormPrefixFormat(e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current">
 <option value="MARKA\u00ae {title}">MARKA® Ürün Adı</option>
 <option value="MARKA {title}">MARKA Ürün Adı</option>
 <option value="[MARKA] {title}">[MARKA] Ürün Adı</option>
 <option value="MARKA - {title}">MARKA - Ürün Adı</option>
 <option value="MARKA | {title}">MARKA | Ürün Adı</option>
 </select>
 {formName && (
 <div className="mt-2 p-2 rounded bg-transparent text-xs">
 <span className="text-slate-700 dark:text-slate-300">Önizleme: </span>
 <span className="text-slate-700 dark:text-slate-300">{formPrefixFormat.replace('{title}', 'Air Max 90').replace('MARKA', formName)}</span>
 </div>
 )}
 </div>
 )}
 <div>
 <label className="block text-sm font-medium text-current mb-1">Dış ID</label>
 <input type="text" value={formExternalId} onChange={(e) => setFormExternalId(e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current" />
 </div>
 <div className="flex justify-end gap-3">
 <button type="button" onClick={() => setShowModal(false)}
 className="btn-ghost px-4 py-2">İptal</button>
 <button type="submit"
 className="btn-ghost px-4 py-2">{editingBrand ? 'Güncelle' : 'Oluştur'}</button>
 </div>
 </form>
 </div>
 </div>
 )}
 </div>
 );
}

// ==================== KPI CARD ====================
function KpiCard({ title, value, color }: { title: string; value: number; color: string }) {
 const colorMap: Record<string, string> = {
 blue: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 green: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 yellow: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 purple: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 cyan: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 red: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 slate: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 teal: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 };
 return (
 <div className={`rounded-xl border p-3 backdrop-blur-sm ${colorMap[color] || colorMap.blue}`}>
 <div className="text-xs opacity-70">{title}</div>
 <div className="text-lg font-semibold">{value.toLocaleString('tr-TR')}</div>
 </div>
 );
}
