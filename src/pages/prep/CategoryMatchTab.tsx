// ==================== KATEGORI ESLESTIRME V5.0 ====================
// DG STOK V5.0 - 3 asamali wizard: Otomatik > AI > Manuel
// Yesil/Mor/Turuncu rozetler, dairesel ilerleme, alt aksiyon butonlari
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useMarketplace } from '../../context/MarketplaceContext';
import { showToast } from '../../components/ui/Toast';
// ==================== TYPES ====================

interface ProductItem {
 id: string; title: string | null; xmlKey: string;
 supplierCategory: string | null; categoryId: string | null;
 categoryMatch: boolean; aiSuggestedCategoryId: string | null;
 aiScore: number | null; category?: { id: string; name: string } | null;
}

interface FlatCategory {
 id: string; name: string; parentId: string | null;
}

interface TreeCategory extends FlatCategory {
 productCount?: number; children: TreeCategory[];
}

interface Marketplace { id: string; key: string; name: string; }

type MatchStatus = 'auto_matched' | 'ai_suggested' | 'manual_required';

interface CategoryGroup {
 xmlPath: string; total: number; matchedCount: number;
 productIds: string[]; aiProductIds: string[];
 status: MatchStatus; targetPath?: string;
 suggestionParentPath?: string; suggestionLeaf?: string;
 suggestionId?: string; aiScore?: number;
}

const STATUS_CFG: Record<MatchStatus, { icon: string; label: string; bg: string; text: string }> = {
  auto_matched: { icon:'🟢', label:'Tam Eslesti', bg:'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  ai_suggested: { icon:'🤖', label:'AI Eslesti', bg:'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400' },
  manual_required: { icon:'🟠', label:'Manuel Bekliyor', bg:'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
};

function resolvePath(id: string|null|undefined, map: Map<string,FlatCategory>): string {
 if (!id) return '';
 const parts: string[] = []; let cur = map.get(id); let g = 0;
 while (cur && g < 6) { parts.unshift(cur.name); cur = cur.parentId ? map.get(cur.parentId) : undefined; g++; }
 return parts.join(' > ');
}

// ==================== ANA BILESEN ====================

export default function CategoryMatchTab() {
 const { marketplaceId, marketplaces: ctxMarketplaces, selectMarketplace } = useMarketplace();
 const [products, setProducts] = useState<ProductItem[]>([]);
 const [flatCats, setFlatCats] = useState<FlatCategory[]>([]);
 const [totalProducts, setTotalProducts] = useState(0);
 const [loading, setLoading] = useState(true);
 const [aiRunning, setAiRunning] = useState(false);
 const [step, setStep] = useState<0|1|2|3>(1);
 const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
 const [modalOpen, setModalOpen] = useState(false);
 const [modalGroup, setModalGroup] = useState<CategoryGroup | null>(null);
 const [modalBulk, setModalBulk] = useState(false);
 const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
 const [pageSize, setPageSize] = useState(50);
 const [currentPage, setCurrentPage] = useState(1);
 const [xmlSupplierId, setXmlSupplierId] = useState<string>(() => {
 try { return localStorage.getItem('dg_active_supplier_id') || ''; } catch { return ''; }
 });
 const [xmlSources, setXmlSources] = useState<Array<{ id: string; name: string }>>([]);

 useEffect(() => {
 apiFetch<{ items: Marketplace[] }>('/marketplaces')
 .then(r => { if (r.ok && r.data) setMarketplaces(r.data.items || []); }).catch(() => {});
 apiFetch<{ items: Array<{ id: string; name: string }> }>('/xml-sources')
 .then(r => { if (r.ok && r.data) setXmlSources(r.data.items || []); }).catch(() => {});
 }, []);

 // localStorage'a kaydet
 useEffect(() => {
 try { localStorage.setItem('dg_active_supplier_id', xmlSupplierId); } catch {}
 }, [xmlSupplierId]);

 const flatMap = useMemo(() => { const m = new Map<string,FlatCategory>(); for (const c of flatCats) m.set(c.id,c); return m; }, [flatCats]);

 const fetchAll = useCallback(async () => {
 setLoading(true);
 try {
 // TÜM ürünleri çek (max 1000), pagination client-side kategoriler üzerinde
 const params = new URLSearchParams({ limit: '1000' });
 if (xmlSupplierId) params.append('xmlSourceId', xmlSupplierId);
 const [pr, tr] = await Promise.all([
 apiFetch<{ items: ProductItem[]; pagination: { total:number; page:number; limit:number; totalPages:number } }>(`/categories/products?${params}`),
 apiFetch<{ items: TreeCategory[]; flat: FlatCategory[] }>('/categories/tree'),
 ]);
 if (pr.ok && pr.data) {
 setProducts(pr.data.items || []);
 if (pr.data.pagination) setTotalProducts(pr.data.pagination.total);
 }
 if (tr.ok && tr.data) setFlatCats(tr.data.flat || []);
 } finally { setLoading(false); }
 }, [xmlSupplierId]);

 useEffect(() => { fetchAll(); }, [fetchAll]);

 // ==================== GRUPLAMA ====================
 const groups = useMemo<CategoryGroup[]>(() => {
 const byCat = new Map<string, ProductItem[]>();
 for (const p of products) {
 const key = (p.supplierCategory || 'Kategorisiz').trim();
 const arr = byCat.get(key); if (arr) arr.push(p); else byCat.set(key, [p]);
 }
 const result: CategoryGroup[] = [];
 for (const [xmlPath, items] of byCat) {
 const pids = items.map(p => p.id);
 const matched = items.filter(p => p.categoryMatch && p.categoryId);
 if (matched.length === items.length && items.length > 0) {
 result.push({ xmlPath, total: items.length, matchedCount: matched.length, productIds: pids, aiProductIds: [], status: 'auto_matched', targetPath: resolvePath(matched[0].categoryId, flatMap) || matched[0].category?.name || 'Eslesti' });
 continue;
 }
 const aiOnes = items.filter(p => !p.categoryMatch && p.aiSuggestedCategoryId);
 if (aiOnes.length > 0) {
 const freq = new Map<string,number>(); for (const p of aiOnes) { const id = p.aiSuggestedCategoryId as string; freq.set(id, (freq.get(id)||0)+1); }
 const topId = [...freq.entries()].sort((a,b) => b[1]-a[1])[0][0];
 const full = resolvePath(topId, flatMap); const segs = full ? full.split(' > ') : [];
 const scores = aiOnes.map(p => p.aiScore||0); const avg = scores.reduce((s,v)=>s+v,0)/(scores.length||1);
 result.push({ xmlPath, total: items.length, matchedCount: matched.length, productIds: pids, aiProductIds: aiOnes.filter(p=>p.aiSuggestedCategoryId===topId).map(p=>p.id), status:'ai_suggested', suggestionId:topId, suggestionParentPath: segs.slice(0,-1).join(' > '), suggestionLeaf: segs[segs.length-1]||flatMap.get(topId)?.name||'Onerilen', aiScore:avg, targetPath: matched.length>0 ? resolvePath(matched[0].categoryId,flatMap) : undefined });
 continue;
 }
 result.push({ xmlPath, total: items.length, matchedCount: matched.length, productIds: pids, aiProductIds: [], status: matched.length>0?'manual_required':'manual_required', targetPath: matched.length>0 ? resolvePath(matched[0].categoryId,flatMap) : undefined });
 }
 const order: Record<MatchStatus,number> = { auto_matched:0, ai_suggested:1, manual_required:2 };
 return result.sort((a,b) => order[a.status]!==order[b.status] ? order[a.status]-order[b.status] : a.xmlPath.localeCompare(b.xmlPath,'tr'));
 }, [products, flatMap]);

 const filteredGroups = useMemo(() => {
 if (step === 0) return groups; // Ürün Hazırlamaya Geç - tümünü göster
 if (step === 2) return groups.filter(g => g.status === 'ai_suggested');
 if (step === 3) return groups.filter(g => g.status === 'manual_required');
 return groups; // step 1 = Otomatik (tümü)
 }, [groups, step]);

 // Sayfalama
 const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
 const safePage = Math.min(currentPage, totalPages);
 const paginatedGroups = useMemo(() => {
 const start = (safePage - 1) * pageSize;
 return filteredGroups.slice(start, start + pageSize);
 }, [filteredGroups, pageSize, safePage]);

 // step/filter degisince sayfa 1'e don
 useEffect(() => { setCurrentPage(1); }, [step]);
 useEffect(() => { setCurrentPage(1); }, [pageSize]);

 const autoCount = groups.filter(g=>g.status==='auto_matched').length;
 const aiCount = groups.filter(g=>g.status==='ai_suggested').length;
 const manualCount = groups.filter(g=>g.status==='manual_required').length;
 const matchedProductCount = products.filter(p=>p.categoryMatch&&p.categoryId).length;
 const percent = products.length>0 ? Math.round((matchedProductCount/products.length)*100) : 0;

 // ==================== TEDARIKCI + PAZARYERI GUARD ====================
 const [showWarningModal, setShowWarningModal] = useState(false);

 const requireMarketplace = useCallback((): boolean => {
 if (!xmlSupplierId || !marketplaceId) {
 setShowWarningModal(true);
 return false;
 }
 return true;
 }, [xmlSupplierId, marketplaceId]);

 // ==================== AKSIYONLAR ====================
 const [autoMatchRunning, setAutoMatchRunning] = useState(false);
 const [autoMatchLive, setAutoMatchLive] = useState<{processed:number; total:number; matched:number}|null>(null);
 const pollRef = React.useRef<ReturnType<typeof setInterval>|null>(null);

 // Auto-match progress polling temizligi (unmount)
 useEffect(() => {
 return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
 }, []);

 /** Otomatik Eslestirme: batch auto-match baslat ve canli ilerlemeyi goster */
 const handleAutoMatchDbl = useCallback(async () => {
 if (!requireMarketplace()) return;
 setAutoMatchRunning(true);
 setAutoMatchLive(null);
 showToast('info', '🔄 Otomatik eşleştirme başlatılıyor...');
 try {
 const res = await apiFetch<{ ok:boolean; message:string; progress:any }>('/categories/auto-match-all/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ marketplaceId }) });
 if (res.ok && res.data) {
 showToast('success', `✅ ${res.data.message}`);
 const total = res.data.progress?.totalProducts || 0;
 setAutoMatchLive({ processed: 0, total, matched: 0 });
 if (pollRef.current) clearInterval(pollRef.current);
 pollRef.current = setInterval(async () => {
 try {
 const pr = await apiFetch<{ status:string; processedProducts:number; totalProducts:number; matchedCount:number }>('/categories/auto-match-all/progress');
 if (pr.ok && pr.data) {
 setAutoMatchLive({ processed: pr.data.processedProducts, total: pr.data.totalProducts, matched: pr.data.matchedCount });
 if (pr.data.status === 'completed' || pr.data.status === 'error') {
 if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
 setAutoMatchRunning(false);
 fetchAll();
 showToast('success', `✅ ${pr.data.matchedCount} kategori başarıyla eşleştirildi!`);
 setTimeout(() => setAutoMatchLive(null), 5000);
 }
 }
 } catch { /* polling hatası - sessiz */ }
 }, 3000);
 } else {
 showToast('error', res.error?.message || 'Otomatik eşleştirme başarısız');
 setAutoMatchRunning(false);
 }
 } catch { showToast('error', 'Otomatik eşleştirme başlatılamadı'); setAutoMatchRunning(false); }
 }, [requireMarketplace, fetchAll]);

 /** AI Eslestirme - Cift Tiklama: AI matching baslat */
 /** AI Eşleştirme - Seçili ürünleri AI motoruna gönder */
 const handleAiMatch = useCallback(async () => {
 setAiRunning(true);
 showToast('info', '🔄 AI eşleştirme başlatılıyor...');
 try {
 if (!xmlSupplierId || !marketplaceId) throw new Error('Lütfen önce XML kaynağı ve pazaryeri seçin');
 if (selectedGroups.size === 0) throw new Error('Lütfen listeden en az bir ürün grubu seçin');

 // Seçili gruplardaki eşleşmemiş ürün ID'lerini products state'inden topla
 const selectedXmlPaths = new Set(selectedGroups);
 const productIds: string[] = [];
 for (const p of products) {
 const key = (p.supplierCategory || 'Kategorisiz').trim();
 if (selectedXmlPaths.has(key) && !p.categoryMatch) {
 productIds.push(p.id);
 }
 }
 if (productIds.length === 0) throw new Error('Seçili gruplarda eşleşmemiş ürün bulunamadı');

 console.log('AI MATCH FINAL REQUEST', { productIds, productCount: productIds.length, marketplaceId, xmlSupplierId });

 const res = await apiFetch<{ matchedCount:number; message:string }>('/categories/ai-match', {
 method:'POST',
 headers:{'Content-Type':'application/json'},
 body:JSON.stringify({ productIds, marketplaceId, xmlSupplierId }),
 });

 console.log('AI MATCH RESPONSE', { ok: res.ok, status: res.status, data: res.data, error: res.error });

 if (res.ok && res.data) {
 showToast('success', `🤖 ${res.data.message}`);
 setStep(2);
 fetchAll();
 } else {
 // HTTP status + backend error detayini hataya ekle
 const errCode = res.error?.code || `HTTP_${res.status}`;
 const errMsg = res.error?.message || 'AI eslestirme basarisiz';
 throw new Error(`[${res.status}] ${errCode}: ${errMsg}`);
 }
 } catch (error: any) {
 console.error('AI MATCH ERROR DETAIL', {
 message: error?.message || String(error),
 stack: error?.stack || 'no stack',
 raw: error,
 });
 showToast('error', `AI Match Hatası: ${error?.message || String(error)}`);
 } finally {
 setAiRunning(false);
 }
 }, [xmlSupplierId, marketplaceId, selectedGroups, products, fetchAll]);

 /** Manuel Eslestirme - Cift Tiklama: toplu eslestirme modali ac */
 const handleManualMatchDbl = useCallback(() => {
 if (!requireMarketplace()) return;
 // Tum manuel kategorileri sec ve toplu modal ac
 const manualGroups = groups.filter(g => g.status === 'manual_required');
 if (manualGroups.length === 0) {
 showToast('info', 'Manuel eslestirme gereken kategori yok.');
 return;
 }
 setSelectedGroups(new Set(manualGroups.map(g => g.xmlPath)));
 setModalGroup(null);
 setModalBulk(true);
 setModalOpen(true);
 }, [requireMarketplace, groups]);

 const handleApproveSuggestion = async (group: CategoryGroup) => {
 if (!requireMarketplace()) return;
 if (!group.suggestionId || group.aiProductIds.length===0) return;
 const res = await apiFetch<{ matchedCount:number }>('/categories/match', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ categoryId:group.suggestionId, productIds:group.aiProductIds, marketplaceId }) });
 if (res.ok) { showToast('success',`✅ "${group.suggestionLeaf}" onaylandi (${group.aiProductIds.length} urun)`); fetchAll(); }
 else showToast('error', res.error?.message||'Onaylama basarisiz');
 };

 const toggleSelect = (xmlPath: string) => setSelectedGroups(prev => { const n = new Set(prev); if (n.has(xmlPath)) n.delete(xmlPath); else n.add(xmlPath); return n; });
 const selectAll = () => setSelectedGroups(new Set(filteredGroups.map(g=>g.xmlPath)));
 const deselectAll = () => setSelectedGroups(new Set());

 const openSingleMatch = (group: CategoryGroup) => { setModalGroup(group); setModalBulk(false); setModalOpen(true); };
 const openBulkMatch = () => {
 if (selectedGroups.size===0) { showToast('error','Once listeden en az bir XML kategorisi secin'); return; }
 setModalGroup(null); setModalBulk(true); setModalOpen(true);
 };
 const handleMatchDone = () => { setModalOpen(false); setModalGroup(null); setSelectedGroups(new Set()); fetchAll(); };

 const handleGoPreparation = useCallback(() => {
 window.dispatchEvent(new CustomEvent<string>('dgstok:navigate', { detail:'urunhazirlama-marka' }));
 window.dispatchEvent(new CustomEvent<string>('dgstok:prep-tab', { detail:'marka' }));
 }, []);

 // ==================== RENDER ====================
 const steps: Array<{ key:0|1|2|3; label:string; count:number; tone:'green'|'purple'|'orange'|'blue'; action?: () => void }> = [
 { key:0, label:'1. ✓ Urun Hazirlamaya Gec', count:0, tone:'blue', action: handleGoPreparation },
 { key:1, label:'2. Otomatik Eslestirme', count:autoCount, tone:'green', action: handleAutoMatchDbl },
 { key:2, label:'3. AI Eslestirme', count:aiCount, tone:'purple', action: handleAiMatch },
 { key:3, label:'4. Manuel Eslestirme', count:manualCount, tone:'orange', action: handleManualMatchDbl },
 ];

 return (
 <div className="relative">
 <h1 className="mb-4 pt-1 text-center text-[26px] font-extrabold tracking-tight" >Kategori Eslestirme Motoru V5</h1>

 {/* Tedarikci XML + Pazaryeri Secimi */}
 <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
 <select value={xmlSupplierId} onChange={e => setXmlSupplierId(e.target.value)}
 className="select-theme min-w-[200px]">
 <option value="">📦 Tedarikci / XML Seciniz...</option>
 {xmlSources.map(xs => <option key={xs.id} value={xs.id}>{xs.name}</option>)}
 </select>
 <select value={marketplaceId} onChange={e => selectMarketplace(e.target.value)}
 className="select-theme min-w-[200px]">
 <option value="">🛒 Pazaryeri Seciniz...</option>
 {ctxMarketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
 </select>
 </div>

 {/* ====== 4 ADIMLI CHEVRON STEPPER ====== */}
 <div className="mb-5 flex items-stretch justify-center">
 {steps.map((s, i) => {
 const active = step === s.key;
 const handleClick = (e: React.MouseEvent) => { e.stopPropagation(); (s.action ? s.action : () => setStep(s.key))(); };
 return (
 <button key={s.key} type="button" onClick={handleClick}
 style={{
 pointerEvents: 'auto', position: 'relative', zIndex: 9999, cursor: 'pointer',
 minWidth:'165px',
 clipPath: i===0 ? 'polygon(12px 0,calc(100% - 16px) 0,100% 50%,calc(100% - 16px) 100%,12px 100%,0 100%,0 0)' : 'polygon(16px 0,calc(100% - 16px) 0,100% 50%,calc(100% - 16px) 100%,16px 100%,0 50%)',
 boxShadow: active
 ? (s.tone==='green'?'0 4px 20px -2px transparent, 0 2px 8px transparent'
 :s.tone==='purple'?'0 6px 24px -4px transparent, 0 2px 10px transparent'
 :s.tone==='orange'?'0 6px 24px -4px transparent, 0 2px 10px transparent'
 :'0 6px 24px -4px transparent, 0 2px 10px transparent')
 : '0 1px 3px transparent, 0 1px 2px transparent',
 marginLeft: i===0?0:'-10px'}}
 className={`relative px-7 py-3 text-sm font-bold transition-all duration-150 hover:brightness-110 active:scale-95 ${ active ? s.tone==='green' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white ring-2 ring-emerald-500/30 z-30' : s.tone==='purple' ? 'bg-gradient-to-br from-purple-500 to-purple-600 text-white ring-2 ring-purple-500/30 z-30' : s.tone==='orange' ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white ring-2 ring-amber-500/30 z-30' : 'bg-gradient-to-br from-blue-500 to-blue-600 text-white ring-2 ring-blue-500/30 z-30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700' }`}>
 {s.label}
 {s.count > 0 && s.key !== 0 && <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{}}>{s.count}</span>}
 </button>
 );
 })}
 </div>

 {/* ====== ANA DIS KART ====== */}
 <div className="panel-theme p-5 sm:p-7">

 {/* ====== TEDARIKCI + PAZARYERI SECIM GUARD ====== */}
 {(!xmlSupplierId || !marketplaceId) && (
 <div className="flex items-center gap-3 p-3 my-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-400 text-sm">
 <span className="text-lg">🚨</span>
 <span className="font-medium">İşleme devam etmek için lütfen yukarıdan <b>Tedarikçi (XML)</b> ve <b>Pazaryeri</b> seçiniz.</span>
 </div>
 )}

 {/* --- ILERLEME CUBUGU --- */}
 <div className="mb-4 flex items-center gap-4">
 <div className="flex-1">
 <div className="mb-1 flex items-center justify-between text-xs">
 <span className="font-semibold" >
 Kategori Eslestirme Ilerlemesi
 {autoMatchLive && autoMatchLive.total > 0 && autoMatchLive.processed < autoMatchLive.total && (
 <span className="ml-2 inline-flex items-center gap-1 text-current">
 <span className="h-2 w-2 animate-pulse rounded-full bg-transparent" />
 Çalışıyor
 </span>
 )}
 </span>
 <span className="font-bold" style={{}}>
 {autoMatchLive && autoMatchLive.total > 0
 ? `%${Math.round((autoMatchLive.processed/autoMatchLive.total)*100)} (${autoMatchLive.processed}/${autoMatchLive.total})`
 : `%${percent} (${matchedProductCount}/${products.length})`
 }
 </span>
 </div>
 <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
 <div className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-primary via-primary to-primary-hover" style={{ width:`${autoMatchLive && autoMatchLive.total>0 ? Math.round((autoMatchLive.processed/autoMatchLive.total)*100) : percent}%` }} />
 </div>
 {autoMatchLive && autoMatchLive.total > 0 && autoMatchLive.processed < autoMatchLive.total && (
 <div className="mt-1 text-[10px] text-current">
 ⏳ Arka planda işlem devam ediyor, sayfayı kapatmayın...
 </div>
 )}
 {autoMatchLive && autoMatchLive.matched > 0 && (
 <div className="mt-0.5 text-[10px] text-current">
 ✅ {autoMatchLive.matched} ürün eşleşti
 </div>
 )}
 </div>
 <div className="shrink-0"><ProgressRing percent={autoMatchLive && autoMatchLive.total>0 ? Math.round((autoMatchLive.processed/autoMatchLive.total)*100) : percent} size={64} /></div>
 </div>

 {/* ====== PAGINATION TOOLBAR (TABLO USTU) ====== */}
 {!loading && filteredGroups.length > 0 && (
 <div className="mb-3 panel-theme px-5 py-3">
 {/* Row 1: Tümünü Seç */}
 <div className="mb-2 flex items-center gap-2">
 <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold" >
 <input
 type="checkbox"
 checked={filteredGroups.length > 0 && filteredGroups.every(g => selectedGroups.has(g.xmlPath))}
 onChange={() => {
 if (filteredGroups.every(g => selectedGroups.has(g.xmlPath))) deselectAll();
 else setSelectedGroups(new Set(filteredGroups.map(g => g.xmlPath)));
 }}
 className="h-4 w-4 cursor-pointer"
 />
 ☑ Tümünü Seç ({filteredGroups.length} kategori)
 </label>
 {selectedGroups.size > 0 && (
 <button type="button" onClick={openBulkMatch}
 className="ml-3 rounded-lg bg-transparent px-3 py-1 text-[11px] font-bold text-current hover:bg-transparent"
 >🗂️ Seçilenlere Kategori Ata ({selectedGroups.size})</button>
 )}
 </div>

 {/* Row 2: Sayfa numaraları + Göster seçimi */}
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-1.5">
 <span className="text-[11px] font-semibold text-current">Sayfa:</span>
 <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
 className="rounded-md px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-25"
 >◀</button>
 {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
 const start = Math.max(1, Math.min(safePage - 3, totalPages - 6));
 const page = start + i;
 if (page > totalPages) return null;
 return (
 <button key={page} type="button" onClick={() => setCurrentPage(page)}
 className={`min-w-[28px] rounded-md px-2 py-0.5 text-[12px] font-bold transition-colors ${ page === safePage ? 'bg-primary text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800' }`}
 >{page}</button>
 );
 })}
 {totalPages > 7 && safePage < totalPages - 3 && (
 <span className="px-1 text-[11px] text-current">…</span>
 )}
 <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
 className="rounded-md px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-25"
 >▶</button>
 </div>

 <div className="flex items-center gap-1.5">
 <span className="text-[10px] text-current">Göster:</span>
 {[50, 100, 200, 500, 1000].map(size => (
 <button key={size} type="button" onClick={() => setPageSize(size)}
 className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${ pageSize === size ? 'bg-primary text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >{size}</button>
 ))}
 </div>
 </div>

 {/* Row 3: Toplam / Gösterilen / Seçili özeti */}
 <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-current">
 <span>Toplam: <b className="text-text">{totalProducts.toLocaleString('tr-TR')}</b> ürün</span>
 <span className="text-border/50">|</span>
 <span>Gösterilen: <b className="text-text">{Math.min((safePage - 1) * pageSize + 1, filteredGroups.length)}-{Math.min(safePage * pageSize, filteredGroups.length)}</b> / {filteredGroups.length} kategori</span>
 {totalPages > 1 && (
 <>
 <span className="text-border/50">|</span>
 <span>Sayfa: <b className="text-text">{safePage}/{totalPages}</b></span>
 </>
 )}
 {selectedGroups.size > 0 && (
 <>
 <span className="text-border/50">|</span>
 <span>Seçili: <b className="text-current">{selectedGroups.size}</b> kategori</span>
 </>
 )}
 </div>
 </div>
 )}

 {/* --- TABLO + SAG PANEL --- */}
 <div className="flex flex-col gap-4 xl:flex-row">
 {/* TABLO */}
 <div className="min-w-0 flex-1 overflow-hidden rounded-2xl panel-theme">
 <div className="grid grid-cols-[40px_minmax(0,4fr)_minmax(0,3fr)_minmax(0,5fr)] rounded-t-2xl px-4 py-3 bg-slate-50 dark:bg-slate-800/30">
 <div className="flex items-center justify-center">
 <input type="checkbox" checked={paginatedGroups.length>0 && paginatedGroups.every(g=>selectedGroups.has(g.xmlPath))} onChange={() => { if (paginatedGroups.every(g=>selectedGroups.has(g.xmlPath))) { const pg = new Set(paginatedGroups.map(g=>g.xmlPath)); setSelectedGroups(prev => { const n = new Set(prev); for (const p of pg) n.delete(p); return n; }); } else { setSelectedGroups(prev => { const n = new Set(prev); for (const g of paginatedGroups) n.add(g.xmlPath); return n; }); } }} className="h-4 w-4 cursor-pointer" title="Bu sayfadakileri seç" />
 </div>
 <div className="text-sm font-bold" style={{}}>XML Kategori</div>
 <div className="text-sm font-bold" style={{}}>Eslesme Durumu</div>
 <div className="text-sm font-bold" style={{}}>Pazaryeri Kategorisi</div>
 </div>
 {loading ? (
 <div className="flex items-center justify-center gap-3 py-16 text-current"><span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"/><span className="text-sm">Kategoriler yukleniyor...</span></div>
 ) : paginatedGroups.length===0 ? (
 <div className="flex flex-col items-center justify-center py-16 text-center"><span className="mb-3 text-4xl">🎉</span><p className="text-sm font-medium text-current">{step===1?'Tum kategoriler eslestirildi!':step===2?'AI onerisi bekleyen kategori yok.':'Manuel eslestirme gereken kategori kalmadi.'}</p></div>
 ) : (
 <div className="divide-y divide-border/50">
 {paginatedGroups.map(g => <GroupRow key={g.xmlPath} group={g} selected={selectedGroups.has(g.xmlPath)} onToggle={()=>toggleSelect(g.xmlPath)} onChoose={()=>openSingleMatch(g)} onApprove={()=>handleApproveSuggestion(g)} />)}
 </div>
 )}
 {/* Alt footer - sadece bilgi */}
 {!loading && paginatedGroups.length > 0 && (
 <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-current" >
 <span>{paginatedGroups.length} kategori gösteriliyor</span>
 {selectedGroups.size > 0 && (
 <span>Seçili: <b className="text-current">{selectedGroups.size}</b></span>
 )}
 </div>
 )}
 </div>

 {/* SAG: DAIRESEL + OZET */}
 <div className="flex w-full shrink-0 flex-col items-center gap-4 xl:w-56">
 <div className="rounded-full panel-theme p-1.5"><ProgressRing percent={percent} /></div>
 <div className="w-full overflow-hidden rounded-2xl panel-theme">
 <SummaryRow icon="✅" bg="currentColor" label="Tam Eslesti" value={autoCount} color="currentColor" />
 <SummaryRow icon="🤖" bg="currentColor" label="AI Eslesti" value={aiCount} color="currentColor" borderTop />
 <SummaryRow icon="🔧" bg="currentColor" label="Manuel" value={manualCount} color="currentColor" borderTop />
 </div>
 </div>
 </div>
 </div>

 {/* ====== MERKEZI PAZARYERI UYARISI ====== */}
 {showWarningModal && (
 <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWarningModal(false)}>
 <div className="panel-theme p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
 <div className="flex items-start gap-3">
 <span className="text-2xl">🚨</span>
 <div>
 <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Eksik Seçim</h3>
 <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Lütfen eşleştirme yapabilmek için hem <b>Tedarikçi (XML)</b> hem de <b>Pazaryeri</b> seçiniz.</p>
 </div>
 </div>
 <button
 onClick={() => setShowWarningModal(false)}
 className="mt-4 w-full py-2.5 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl transition duration-150 text-sm"
 >
 Anladım
 </button>
 </div>
 </div>
 )}

 {/* ====== KATEGORI SECIM MODALI ====== */}
 {modalOpen && <CategoryPickerModal group={modalGroup} bulkGroups={modalBulk ? groups.filter(g=>selectedGroups.has(g.xmlPath)) : []} marketplaces={marketplaces} onClose={()=>setModalOpen(false)} onDone={handleMatchDone} />}
 </div>
 );
}

// ==================== GRUP SATIRI ====================
function GroupRow({ group, selected, onToggle, onChoose, onApprove }: { group:CategoryGroup; selected:boolean; onToggle:()=>void; onChoose:()=>void; onApprove:()=>void }) {
 const cfg = STATUS_CFG[group.status];
 return (
 <div className={`grid cursor-pointer grid-cols-[40px_minmax(0,4fr)_minmax(0,3fr)_minmax(0,5fr)] items-stretch transition-colors ${selected?'bg-primary/5 dark:bg-primary/10':'hover:bg-slate-50 dark:hover:bg-slate-800/30'}`} onClick={onToggle}>
 <div className="flex items-center justify-center" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 cursor-pointer" /></div>
 <div className="flex min-w-0 items-center gap-2 px-4 py-3"><span className="shrink-0 text-[10px] text-slate-400">▸</span><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={group.xmlPath}>{group.xmlPath}</div><div className="text-[10px] text-slate-500 dark:text-slate-400">{group.total} urun</div></div></div>
 <div className="flex items-center gap-2 px-4"><span className="text-base">{cfg.icon}</span><div><div className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</div>{group.status==='ai_suggested' && group.aiScore!=null && <div className="text-[10px] text-purple-600 dark:text-purple-400">%{Math.round(group.aiScore*100)} guven</div>}{group.status==='manual_required' && group.matchedCount>0 && <div className="text-[10px] text-amber-600 dark:text-amber-400">{group.matchedCount}/{group.total} eslesti</div>}</div></div>
 <div className="flex min-w-0 items-center px-4 py-3" onClick={e=>e.stopPropagation()}>
 {group.status==='auto_matched' && <div className="flex min-w-0 items-start gap-1.5 text-sm" ><span className="mt-1 shrink-0 text-[8px] text-emerald-500">▸</span><span className="truncate text-slate-700 dark:text-slate-300" title={group.targetPath}>{group.targetPath}</span></div>}
 {group.status==='ai_suggested' && <div className="min-w-0">{group.suggestionParentPath && <div className="flex items-start gap-1.5 text-sm" ><span className="mt-1 shrink-0 text-[8px] text-purple-500">▸</span><span className="truncate text-slate-700 dark:text-slate-300" title={group.suggestionParentPath}>{group.suggestionParentPath}</span></div>}<div className="mt-0.5 flex flex-wrap items-center gap-2"><span className="text-sm"><span className="font-bold text-slate-600 dark:text-slate-400">Onerilen: </span><span className="font-bold text-purple-600 dark:text-purple-400">{group.suggestionLeaf}</span></span><button type="button" onClick={onApprove} className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm transition-all hover:brightness-110" title="AI onerisini onayla">✓ Onayla</button></div></div>}
 {(group.status==='manual_required') && <button type="button" onClick={onChoose} className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-white px-4 py-2.5 text-sm font-semibold shadow-lg shadow-primary/25 transition-all" ><span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]">🔍</span>Kategori Sec</button>}
 </div>
 </div>
 );
}

// ==================== OZET SATIRI ====================
function SummaryRow({ icon, bg, label, value, color, borderTop }: { icon:string; bg:string; label:string; value:number; color:string; borderTop?:boolean }) {
  return <div className="flex items-center justify-between px-4 py-3" style={borderTop?{ borderTop:'1px solid rgba(0,0,0,0.08)' }:undefined}><div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px]" style={{color: color}}>{icon}</span><span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span></div><span className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{value.toLocaleString('tr-TR')}</span></div>;
}

// ==================== DAIRESEL ILERLEME ====================
function ProgressRing({ percent, size=118 }: { percent:number; size?:number }) {
 const stroke = size<80?6:11; const r = (size-stroke)/2-2; const c = 2*Math.PI*r; const offset = c*(1-Math.min(100,Math.max(0,percent))/100);
 return (
 <div className="relative" style={{ width:size, height:size }}>
 <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#4f46e5"/></linearGradient></defs><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={percent>0?'url(#rg)':'transparent'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition:'stroke-dashoffset 0.8s ease' }}/></svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[26px] font-extrabold leading-none tracking-tight" style={{}}>%{percent}</span>{size>=100 && <span className="mt-0.5 text-[9px] font-semibold" style={{}}>Eslesti</span>}</div>
 </div>
 );
}

// ==================== KATEGORI SECIM MODALI ====================
function CategoryPickerModal({ group, bulkGroups, marketplaces, onClose, onDone }: { group:CategoryGroup|null; bulkGroups:CategoryGroup[]; marketplaces:Marketplace[]; onClose:()=>void; onDone:()=>void }) {
 const isBulk = !group; const targetGroups = isBulk ? bulkGroups : group ? [group] : [];
 const [activeMpId, setActiveMpId] = useState('');
 const [tree, setTree] = useState<TreeCategory[]>([]);
 const [treeLoading, setTreeLoading] = useState(true);
 const [selectedCatId, setSelectedCatId] = useState('');
 const [selectedCatName, setSelectedCatName] = useState('');
 const [expanded, setExpanded] = useState<Set<string>>(new Set());
 const [search, setSearch] = useState('');
 const [saving, setSaving] = useState(false);

 useEffect(() => { if (marketplaces.length>0 && !activeMpId) setActiveMpId(marketplaces[0].id); }, [marketplaces, activeMpId]);
 useEffect(() => {
 setTreeLoading(true);
 const params = new URLSearchParams(); if (activeMpId) params.append('marketplaceId', activeMpId);
 apiFetch<{ items:TreeCategory[] }>(`/categories/tree?${params}`).then(r => { if (r.ok&&r.data) setTree(r.data.items||[]); }).finally(()=>setTreeLoading(false));
 }, [activeMpId]);

 const filteredTree = useMemo(() => {
 if (!search.trim()) return tree;
 const q = search.toLowerCase();
 const filter = (nodes:TreeCategory[]):TreeCategory[] => nodes.map(n=>({...n,children:filter(n.children||[])})).filter(n=>n.name.toLowerCase().includes(q)||n.children.length>0);
 return filter(tree);
 }, [tree, search]);

 const toggleExpand = (id:string) => setExpanded(prev => { const n=new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
 const pick = (id:string, name:string) => { setSelectedCatId(id); setSelectedCatName(name); };

 const renderTree = (nodes:TreeCategory[], depth=0):React.ReactNode => nodes.map(cat => {
 const hasChildren = (cat.children?.length||0)>0; const isOpen = expanded.has(cat.id)||search.trim().length>0; const isSel = selectedCatId===cat.id;
 return <div key={cat.id}>
 <div role="button" tabIndex={0} onClick={()=>pick(cat.id,cat.name)} onKeyDown={e=>e.key==='Enter'&&pick(cat.id,cat.name)} className="flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors" style={{ paddingLeft:`${8+depth*14}px`, fontWeight:isSel?600:400 }}>
 {hasChildren ? <span role="button" tabIndex={-1} onClick={e=>{e.stopPropagation();toggleExpand(cat.id);}} className="w-4 shrink-0 text-center text-[9px] text-current">{isOpen?'▼':'▶'}</span> : <span className="w-4 shrink-0 text-center text-current">•</span>}
 <span className="flex-1 truncate">{cat.name}</span>{cat.productCount!=null && cat.productCount>0 && <span className="text-[9px] text-current">({cat.productCount})</span>}
 </div>
 {hasChildren && isOpen && renderTree(cat.children, depth+1)}
 </div>;
 });

 const handleConfirm = async () => {
 if (!selectedCatId || targetGroups.length===0) return;
 setSaving(true);
 try {
 if (isBulk) {
 const res = await apiFetch<{ matchedCount:number; message:string }>('/categories/bulk-match', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ matches: targetGroups.map(g=>({ xmlCategoryPath:g.xmlPath, systemCategoryId:selectedCatId })), marketplaceId: activeMpId }) });
 if (res.ok&&res.data) { showToast('success',`✅ ${res.data.message||`${res.data.matchedCount} urun eslestirildi`}`); onDone(); return; }
 showToast('error', res.error?.message||'Toplu eslestirme basarisiz');
 } else {
 const res = await apiFetch<{ matchedCount:number }>('/categories/match', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ categoryId:selectedCatId, productIds:targetGroups[0].productIds, marketplaceId: activeMpId }) });
 if (res.ok) { showToast('success',`✅ "${selectedCatName}" kategorisine ${targetGroups[0].total} urun eslestirildi`); onDone(); return; }
 showToast('error', res.error?.message||'Eslestirme basarisiz');
 }
 } finally { setSaving(false); }
 };

 const activeMpName = marketplaces.find(m=>m.id===activeMpId)?.name||'Pazaryeri';
 return (
 <div className="modal-overlay p-4" onClick={onClose}>
 <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl panel-theme" onClick={e=>e.stopPropagation()}>
 <div className="border-b border-slate-100 dark:border-slate-800/60 px-5 py-4">
 <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-base font-bold text-slate-900 dark:text-white" >{isBulk?`Toplu Eslestirme (${targetGroups.length} kategori)`:'Pazaryeri Kategorisi Sec'}</h3><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={targetGroups.map(g=>g.xmlPath).join(' | ')}>{isBulk?`${targetGroups.reduce((s,g)=>s+g.total,0)} urun tek kategoriye eslestirilecek`:group?.xmlPath}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Kapat">✕</button></div>
 {marketplaces.length>0 && <div className="mt-3 flex flex-wrap gap-1">{marketplaces.map(mp=><button key={mp.id} type="button" onClick={()=>setActiveMpId(mp.id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${activeMpId===mp.id ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>{mp.name}</button>)}</div>}
 <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder={`${activeMpName} kategorilerinde ara...`} className="input-theme mt-3 w-full py-2 text-xs" />
 </div>
 <div className="flex-1 space-y-0.5 overflow-y-auto p-3">{treeLoading?<div className="flex items-center justify-center gap-2 py-10 text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary"/><span className="text-xs">Kategoriler yukleniyor...</span></div>:filteredTree.length===0?<div className="py-10 text-center text-xs text-slate-500">Kategori bulunamadi</div>:renderTree(filteredTree)}</div>
 <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800/60 px-5 py-3.5"><div className="min-w-0 text-xs text-slate-600 dark:text-slate-400">{selectedCatId?<>Secili: <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedCatName}</span></>:'Agactan bir kategori secin'}</div><div className="flex shrink-0 gap-2"><button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-xs">Vazgec</button><button type="button" onClick={handleConfirm} disabled={!selectedCatId||saving} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">{saving?'Eslestiriliyor...':`✓ Eslestir${isBulk?` (${targetGroups.length})`:''}`}</button></div></div>
 </div>
 </div>
 );
}
