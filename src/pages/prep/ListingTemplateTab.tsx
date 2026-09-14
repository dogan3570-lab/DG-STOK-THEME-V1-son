// ==================== LISTELEME SABLONU V5.1 ====================
// DG STOK V5.0 - Gorsel birebir tasarim:
// 3 adimli stepper (Genel / Urun Bazli / Kategori Bazli), kural tablosu
// (Fiyat Araligi | Yuzde Carpani | Ek Tutar), dairesel AI skoru,
// Sil/Duzenle/Kaydet aksiyonlari + alt Pazaryeri secici.
// NOT: Kural hesaplama mantigi ve /listings API akisi korunmustur.
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useMarketplace } from '../../context/MarketplaceContext';
import { showToast } from '../../components/ui/Toast';
import { formatPrice } from '../../lib/utils';
import { apiFetch } from '../../lib/api';

// ==================== TIPLER ====================

interface Marketplace { id: string; key: string; name: string; }
interface SystemCategory { id: string; name: string; parentId: string | null; children: SystemCategory[]; }

interface PriceRule { id: string; minPrice: string; maxPrice: string; profitMargin: string; fixedAmount: string; rounding: string; }

interface SavedTemplate {
 id: string; name: string; marketplaceId: string | null; productId: string | null; categoryId: string | null;
 active: boolean; priceRangeRules: string | null; createdAt: string;
}

type StepKey = 'genel' | 'urun' | 'kategori';

// ==================== YARDIMCILAR ====================

function toNum(s: string): number { const n = Number(s.replace(',', '.')); return isNaN(n) ? 0 : n; }

const ROUNDING_OPTIONS = [
 { value: '', label: 'Yok' }, { value: '0.90', label: '0,90' }, { value: '9.90', label: '9,90' },
 { value: '49.90', label: '49,90' }, { value: '99.90', label: '99,90' }, { value: 'nearest', label: 'En Yakın Tam Sayı' },
];

let ruleIdCounter = 0;
function newRuleId() { return `rule_${++ruleIdCounter}_${Date.now()}`; }
function createEmptyRule(): PriceRule { return { id: newRuleId(), minPrice: '', maxPrice: '', profitMargin: '', fixedAmount: '', rounding: '' }; }

function rangeLabel(rule: PriceRule): string {
 const min = toNum(rule.minPrice), max = toNum(rule.maxPrice);
 if (min <= 0 && max <= 0) return 'Tüm Fiyatlar';
 if (max <= 0) return `₺${rule.minPrice} ve üzeri`;
 return `₺${rule.minPrice} – ₺${rule.maxPrice}`;
}

// ==================== ANA BILESEN ====================

export default function ListingTemplateTab() {
 const { marketplaceId, marketplaces: ctxMarketplaces, selectMarketplace } = useMarketplace();
 const [step, setStep] = useState<StepKey>('genel');
 const [editMode, setEditMode] = useState(false);


 const [productSearch, setProductSearch] = useState('');
 const [productResults, setProductResults] = useState<Array<{ id: string; title: string; xmlKey: string; barcode: string | null; sku: string | null; purchasePrice: number | null }>>([]);
 const [selectedProduct, setSelectedProduct] = useState<{ id: string; title: string; xmlKey: string; purchasePrice: number | null } | null>(null);
 const [searchingProduct, setSearchingProduct] = useState(false);

 const [systemTree, setSystemTree] = useState<SystemCategory[]>([]);
 const [selectedCatId, setSelectedCatId] = useState('');
 const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
 const [catSearch, setCatSearch] = useState('');

 const [rules, setRules] = useState<PriceRule[]>([createEmptyRule()]);
 const [errors, setErrors] = useState<string[]>([]);
 const [saving, setSaving] = useState(false);
 const [deleting, setDeleting] = useState(false);

 const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
 const [selectedTemplateId, setSelectedTemplateId] = useState('');
 const [showTemplates, setShowTemplates] = useState(false);

 const [xmlSupplierId, setXmlSupplierId] = useState('');
 const [xmlSources, setXmlSources] = useState<Array<{ id: string; name: string }>>([]);

 // ==================== TEDARIKCI + PAZARYERI GUARD ====================
 const [showWarningModal, setShowWarningModal] = useState(false);

 useEffect(() => {
 apiFetch<{ items: Array<{ id: string; name: string }> }>('/xml-sources')
 .then(r => { if (r.ok && r.data) setXmlSources(r.data.items || []); }).catch(() => {});
 }, []);

 const requireMarketplace = useCallback((): boolean => {
 if (!xmlSupplierId || !marketplaceId) {
 setShowWarningModal(true);
 return false;
 }
 return true;
 }, [xmlSupplierId, marketplaceId]);

 const getToken = (): string | null => { if (typeof window === 'undefined') return null; return localStorage.getItem('dgstok_token'); };
 const authHeaders = (): Record<string, string> => { const t = getToken(); const h: Record<string, string> = {}; if (t) h['x-auth-token'] = t; return h; };

 const loadTemplates = useCallback(async () => {
  try { const r = await apiFetch<{ items: SavedTemplate[] }>('/listings'); if (r.ok && r.data?.items) setSavedTemplates(r.data.items); } catch { /* sessiz */ }
  }, []);

 useEffect(() => {
  apiFetch<{ items: SystemCategory[] }>('/categories/tree').then((r) => { if (r.ok && r.data?.items) setSystemTree(r.data.items); }).catch(() => {});
  loadTemplates();
  }, []);

 useEffect(() => {
 if (!productSearch || productSearch.length < 2) { setProductResults([]); return; }
 const timer = setTimeout(async () => {
 setSearchingProduct(true);
  try {
  const params = new URLSearchParams({ search: productSearch, limit: '20' });
  const res = await apiFetch<{ items: Array<{ id: string; title: string; xmlKey: string; barcode: string | null; sku: string | null; purchasePrice: number | null }> }>(`/categories/products?${params}`);
  if (res.ok && res.data?.items) setProductResults(res.data.items.map((p) => ({ id: p.id, title: p.title || p.xmlKey, xmlKey: p.xmlKey, barcode: p.barcode, sku: p.sku, purchasePrice: p.purchasePrice })));
  } catch { /* sessiz */ }
 setSearchingProduct(false);
 }, 300);
 return () => clearTimeout(timer);
 }, [productSearch]);

 const filteredTree = useMemo(() => {
 if (!catSearch) return systemTree;
 const filter = (nodes: SystemCategory[]): SystemCategory[] => nodes.filter((c) => { const match = c.name.toLowerCase().includes(catSearch.toLowerCase()); const children = filter(c.children || []); return match || children.length > 0; }).map((c) => ({ ...c, children: filter(c.children || []) }));
 return filter(systemTree);
 }, [systemTree, catSearch]);

 const toggleCatExpand = (id: string) => { setExpandedCats((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

 const renderTree = (nodes: SystemCategory[], depth = 0): React.ReactNode => nodes.map((cat) => {
 const hasChildren = cat.children?.length > 0;
 const expanded = expandedCats.has(cat.id) || catSearch.trim().length > 0;
 return (
 <div key={cat.id}>
 <button type="button" onClick={() => setSelectedCatId(cat.id)}
 className="flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs transition-colors"
 style={{ paddingLeft: `${8 + depth * 14}px`, fontWeight: selectedCatId === cat.id ? 600 : 400 }}>
 {hasChildren ? <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); toggleCatExpand(cat.id); }} className="w-3.5 shrink-0 text-center text-[9px] text-current">{expanded ? '▼' : '▶'}</span> : <span className="w-3.5 shrink-0 text-current">•</span>}
 <span className="flex-1 truncate">{cat.name}</span>
 </button>
 {hasChildren && expanded && renderTree(cat.children, depth + 1)}
 </div>
 );
 });

 const validateRules = useCallback((): string[] => {
 const errs: string[] = [];
 const sorted = [...rules].sort((a, b) => toNum(a.minPrice) - toNum(b.minPrice));
 for (let i = 0; i < sorted.length; i++) {
 const r = sorted[i]; const minP = toNum(r.minPrice), maxP = toNum(r.maxPrice);
 if (minP >= maxP && maxP !== 0) errs.push(`Kural ${i + 1}: Minimum fiyat, maksimum fiyattan büyük olamaz`);
 if (minP < 0 || maxP < 0 || toNum(r.profitMargin) < 0 || toNum(r.fixedAmount) < 0) errs.push(`Kural ${i + 1}: Negatif değer girilemez`);
 if (i > 0) { const prev = sorted[i - 1]; if (toNum(prev.maxPrice) > minP && toNum(prev.maxPrice) !== 0) errs.push(`Kural ${i + 1}: Barem çakışması var`); }
 }
 return errs;
 }, [rules]);

 useEffect(() => { setErrors(validateRules()); }, [rules, validateRules]);

 const addRule = () => { setRules((prev) => [...prev, createEmptyRule()]); setEditMode(true); };
 const removeRule = (id: string) => { if (rules.length <= 1) return; setRules((prev) => prev.filter((r) => r.id !== id)); };
 const updateRule = (id: string, field: keyof PriceRule, value: string) => {
 let newValue = value;
 if (field !== 'rounding') {
 newValue = value.replace(/[^0-9,\-.]/g, '');
 const parts = newValue.split(/[,.]/);
 if (parts.length > 2) newValue = parts[0] + '.' + parts.slice(1).join('');
 }
 setRules((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: newValue } : r)));
 };

 const score = useMemo(() => {
 let s = 0;
 if (marketplaceId) s += 15;
 if (errors.length === 0) s += 25;
 const filled = rules.filter((r) => toNum(r.profitMargin) > 0 || toNum(r.fixedAmount) > 0).length;
 s += Math.round((filled / Math.max(1, rules.length)) * 40);
 if (rules.some((r) => r.rounding)) s += 10;
 if (selectedTemplateId) s += 10;
 return Math.min(100, s);
 }, [marketplaceId, errors, rules, selectedTemplateId]);

 const aiTips = useMemo(() => {
 const tips: Array<{ color: string; text: string }> = [];
 const margins = rules.map((r) => toNum(r.profitMargin)).filter((m) => m > 0);
 const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
 if (avgMargin > 0 && avgMargin < 15) tips.push({ color: 'currentColor', text: 'Karlılık oranınızı artırın.' });
 const emptyRules = rules.filter((r) => toNum(r.profitMargin) <= 0 && toNum(r.fixedAmount) <= 0).length;
 if (emptyRules > 0) tips.push({ color: 'currentColor', text: `${emptyRules} kural eksik — kâr marjı veya ek tutar girin.` });
 if (step === 'genel') tips.push({ color: 'currentColor', text: 'Özel ürünlerinize farklı kurallar tanımlayın.' });
 if (!savedTemplates.some((t) => t.categoryId)) tips.push({ color: 'currentColor', text: 'Kategori bazlı fiyatlandırmaları optimize edin.' });
 if (!rules.some((r) => r.rounding)) tips.push({ color: 'currentColor', text: 'Psikolojik fiyat için ,90 yuvarlama önerilir.' });
 if (tips.length === 0) tips.push({ color: 'currentColor', text: 'Şablon yapılandırması optimum görünüyor.' });
 return tips.slice(0, 4);
 }, [rules, step, savedTemplates]);

 const getCatName = (id: string): string => {
 const find = (nodes: SystemCategory[]): string => { for (const n of nodes) { if (n.id === id) return n.name; if (n.children) { const r = find(n.children); if (r) return r; } } return ''; };
 return find(systemTree) || id;
 };

 const handleSave = async () => {
 if (!requireMarketplace()) return;
 const errs = validateRules();
 if (errs.length > 0) { showToast('error', 'Kuralları düzeltin'); setEditMode(true); return; }

 setSaving(true);
 try {
 const priceRangeRules = JSON.stringify(rules.map((r) => ({ minPrice: toNum(r.minPrice), maxPrice: toNum(r.maxPrice), profitMargin: toNum(r.profitMargin), fixedAmount: toNum(r.fixedAmount), rounding: r.rounding })));
 let name = 'Fiyat Şablonu';
 if (step === 'urun' && selectedProduct) name = `Ürün: ${selectedProduct.title}`;
 else if (step === 'kategori' && selectedCatId) name = `Kategori: ${getCatName(selectedCatId)}`;

 const body = { name, marketplaceId, xmlSupplierId, productId: step === 'urun' && selectedProduct ? selectedProduct.id : null, categoryId: step === 'kategori' && selectedCatId ? selectedCatId : null, priceRangeRules, priceSource: 'XML_PURCHASE', vatMode: 'INCLUDED', active: true };
  const url = selectedTemplateId ? `/listings/${selectedTemplateId}` : '/listings';
  const method = selectedTemplateId ? 'PUT' : 'POST';
  const response = await apiFetch<{ item?: { id: string } }>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (response.ok) {
  const savedId = response.data?.item?.id || selectedTemplateId;
 setSelectedTemplateId(savedId);
 showToast('success', '✅ Şablon başarıyla kaydedildi!');
 setEditMode(false);
 loadTemplates();
 } else {
  showToast('error', `❌ ${response.error || 'Kaydetme başarısız'}`);
  }
 } catch (e: any) {
 showToast('error', `❌ Hata: ${e?.message || 'Bilinmeyen hata'}`);
 } finally { setSaving(false); }
 };

 const handleDelete = async () => {
 if (!requireMarketplace()) return;
 if (!selectedTemplateId) { showToast('warning', 'Silmek için önce kayıtlı bir şablon seçin (📂 Kayıtlı)'); return; }
 if (!window.confirm('Seçili şablon silinsin mi? Bu işlem geri alınamaz.')) return;
 setDeleting(true);
 try {
  const r = await apiFetch(`/listings/${selectedTemplateId}`, { method: 'DELETE' });
  if (r.ok) { showToast('success', '🗑️ Şablon silindi'); newTemplate(); loadTemplates(); }
  else { showToast('error', `❌ ${r.error || 'Silme başarısız'}`); }
  } finally { setDeleting(false); }
 };

 const loadTemplate = (tpl: SavedTemplate) => {
 setSelectedTemplateId(tpl.id); selectMarketplace(tpl.marketplaceId || '');
 if (tpl.productId) { setStep('urun'); setSelectedProduct({ id: tpl.productId, title: '', xmlKey: '', purchasePrice: null }); }
 else if (tpl.categoryId) { setStep('kategori'); setSelectedCatId(tpl.categoryId); }
 else setStep('genel');
 if (tpl.priceRangeRules) {
 try {
 const parsedRules = JSON.parse(tpl.priceRangeRules);
 setRules(parsedRules.map((r: any) => ({ id: newRuleId(), minPrice: String(r.minPrice ?? ''), maxPrice: String(r.maxPrice ?? ''), profitMargin: String(r.profitMargin ?? ''), fixedAmount: String(r.fixedAmount ?? ''), rounding: r.rounding || '' })));
 } catch { setRules([createEmptyRule()]); }
 }
 setShowTemplates(false); setEditMode(false);
 };

 const newTemplate = () => { setSelectedTemplateId(''); setSelectedProduct(null); setSelectedCatId(''); setStep('genel'); setRules([createEmptyRule()]); setEditMode(false); };

 const steps: Array<{ key: StepKey; label: string }> = [
 { key: 'genel', label: 'Genel Kurallar' },
 { key: 'urun', label: 'Ürün Bazlı' },
 { key: 'kategori', label: 'Kategori Bazlı' },
 ];

 return (
 <div className="relative space-y-5">

 {/* ====== ÜST AKIŞ GÖSTERİMİ ====== */}
 <div className="flex items-center justify-center gap-1.5 flex-wrap">
  {['Tedarikçi / XML', 'Pazaryeri', 'Fiyat Kuralları', 'Kaydet'].map((stepLabel, i) => (
   <React.Fragment key={stepLabel}>
    <div className="flex items-center gap-1.5">
     <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${ i < 2 ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' }`}>{i + 1}</div>
     <span className={`text-xs font-medium hidden sm:inline ${ i < 2 ? 'text-current' : 'text-slate-400 dark:text-slate-500' }`}>{stepLabel}</span>
    </div>
    {i < 3 && <div className="text-slate-300 dark:text-slate-600">→</div>}
   </React.Fragment>
  ))}
 </div>

 {/* ====== TEDARIKCI XML + PAZARYERI SECIM BAR ====== */}
 <div className="flex flex-wrap items-center justify-center gap-3">
  <select value={xmlSupplierId} onChange={e => setXmlSupplierId(e.target.value)}
   className="rounded-xl border border-current bg-secondary/5 px-4 py-2.5 text-sm font-medium text-current min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/30">
   <option value="">📦 Tedarikçi / XML Kaynağı Seçin</option>
   {xmlSources.map(xs => <option key={xs.id} value={xs.id}>{xs.name}</option>)}
  </select>
  <div className="text-slate-300 dark:text-slate-600">→</div>
  <select value={marketplaceId} onChange={e => selectMarketplace(e.target.value)}
   className="rounded-xl border border-current bg-secondary/5 px-4 py-2.5 text-sm font-medium text-current min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/30">
   <option value="">🛒 Pazaryeri Seçin</option>
   {ctxMarketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
  </select>
 </div>

 {/* ====== KAYITLI ŞABLONLAR KART GRİD ====== */}
 <div className="rounded-[28px] border p-5 shadow-card backdrop-blur-xl sm:p-7 bg-transparent border-current">
 {(!xmlSupplierId || !marketplaceId) && (
 <div className="flex items-center gap-3 p-3 my-4 bg-transparent border border-current rounded-xl text-current text-sm">
 <span className="text-lg">🚨</span>
 <span className="font-medium">İşleme devam etmek için lütfen yukarıdan <b>Tedarikçi (XML)</b> ve <b>Pazaryeri</b> seçiniz.</span>
 </div>
 )}

 {/* ŞABLON SEKMELERİ + BUTONLAR */}
 <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
  <div className="flex gap-1 rounded-xl border border-current bg-secondary/3 p-1">
   {steps.map((s) => {
    const active = step === s.key;
    return (
     <button key={s.key} type="button" onClick={() => setStep(s.key)}
      className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${ active ? 'bg-primary text-white shadow-lg shadow-primary/25' : 'text-current hover:text-primary' }`}>
      {s.key === 'genel' ? '📋' : s.key === 'urun' ? '📦' : '🗂️'} {s.label}
     </button>
    );
   })}
  </div>
  <div className="flex items-center gap-2">
   <button type="button" onClick={newTemplate} className="rounded-lg bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary transition-all hover:bg-primary/20">+ Yeni Şablon</button>
   <button type="button" onClick={() => setShowTemplates(!showTemplates)}
    className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition-all ${ showTemplates ? 'bg-primary/10 text-primary' : 'bg-secondary/5 text-current hover:bg-secondary/10' }`}>
    📂 Kayıtlı ({savedTemplates.length})
   </button>
  </div>
 </div>

 {/* KAYITLI ŞABLONLAR GRID */}
 {showTemplates && (
  <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
   <div className="fixed inset-0 z-30" onClick={() => setShowTemplates(false)} />
   {savedTemplates.length === 0 ? (
    <div className="col-span-full p-6 text-center text-xs text-current border border-dashed border-current/20 rounded-xl">Henüz şablon yok</div>
   ) : savedTemplates.map((t) => (
    <button key={t.id} type="button" onClick={() => { loadTemplate(t); setShowTemplates(false); }}
     className={`relative z-40 flex items-center gap-3 rounded-xl border p-3 text-left text-xs font-medium transition-all hover:shadow-md ${ selectedTemplateId === t.id ? 'border-primary bg-primary/5' : 'border-current/20 bg-transparent hover:border-primary/30' }`}>
     <span className="text-lg">{t.productId ? '📦' : t.categoryId ? '🗂️' : '📋'}</span>
     <div className="flex-1 min-w-0">
      <div className="font-semibold text-current truncate">{t.name}</div>
      <div className="text-[10px] text-slate-400">{t.marketplaceId ? 'Pazaryeri' : 'Genel'}</div>
     </div>
     {selectedTemplateId === t.id && <span className="text-primary text-xs">✓</span>}
    </button>
   ))}
  </div>
 )}

 {step === 'urun' && (
 <div className="mb-5 rounded-2xl border bg-transparent p-4 shadow-inner" >
 <input type="text" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Ürün adı, barkod veya SKU ile ara..." className="input-pastel w-full !py-2.5 text-sm" />
 {searchingProduct && <div className="mt-1.5 text-[11px] text-current">Aranıyor...</div>}
 {productResults.length > 0 && (
 <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border" >
 {productResults.map((p) => (
 <button key={p.id} type="button" onClick={() => { setSelectedProduct(p); setProductResults([]); setProductSearch(p.title); }}
 className="w-full border-b px-3 py-2 text-left text-xs transition-colors hover:bg-[transparent]" >
 <span className="font-medium">{p.title}</span><span className="ml-2 text-[10px] text-current">SKU: {p.sku || '-'}</span>{p.barcode && <span className="ml-2 text-[10px] text-current">Barkod: {p.barcode}</span>}
 </button>
 ))}
 </div>
 )}
 {selectedProduct && (
 <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{}}>
 <span className="text-xs font-semibold" style={{}}>✅ {selectedProduct.title}</span>
 {selectedProduct.purchasePrice != null && <span className="text-[11px] text-current">Alış: {formatPrice(selectedProduct.purchasePrice)}</span>}
 <button type="button" onClick={() => { setSelectedProduct(null); setProductSearch(''); }} className="ml-auto text-xs text-current hover:text-text">✕</button>
 </div>
 )}
 </div>
 )}

 {step === 'kategori' && (
 <div className="mb-5 rounded-2xl border bg-transparent shadow-inner" >
 <div className="border-b p-2.5" >
 <input type="text" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="Kategori ara..." className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" />
 </div>
 <div className="max-h-40 space-y-0.5 overflow-y-auto p-2">{renderTree(filteredTree)}{filteredTree.length === 0 && <div className="py-3 text-center text-[11px] text-current">Kategori bulunamadı</div>}</div>
 {selectedCatId && (
 <div className="border-t px-3 py-2" >
 <span className="text-[11px] font-semibold" style={{}}>✅ Seçili: {getCatName(selectedCatId)}</span>
 </div>
 )}
 </div>
 )}

              <div className="flex flex-col gap-4 xl:flex-row">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border bg-transparent shadow-soft" >

 {/* FİYAT KURALI BAŞLIĞI */}
 <div className="px-6 pt-5 pb-3">
  <div className="flex items-center gap-2 mb-1">
   <span className="text-sm font-bold text-current">Fiyat Kuralları</span>
   <span className="text-[10px] rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">{rules.length} kural</span>
  </div>
  {xmlSupplierId && marketplaceId && (
   <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
    <span className="inline-flex items-center gap-1">
     <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
     Tedarikçi: {xmlSources.find(x => x.id === xmlSupplierId)?.name || '-'}
    </span>
    <span>→</span>
    <span className="inline-flex items-center gap-1">
     <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
     Pazaryeri: {ctxMarketplaces.find(m => m.id === marketplaceId)?.name || '-'}
    </span>
   </div>
  )}
 </div>

 {/* TABLO BAŞLIKLARI */}
 <div className="grid grid-cols-12 gap-2 px-6 py-3 border-b border-current/10">
  <div className="col-span-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Fiyat Aralığı</div>
  <div className="col-span-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Kâr Oranı</div>
  <div className="col-span-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Sabit Ek</div>
  <div className="col-span-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Sonuç (Örnek)</div>
 </div>

 {/* KURAL SATIRLARI */}
 <div className="divide-y divide-border/50">
  {rules.map((rule) => {
   const margin = toNum(rule.profitMargin);
   const fixed = toNum(rule.fixedAmount);
   const examplePrice = 100 * (1 + margin / 100) + fixed;
   const minP = toNum(rule.minPrice);
   const maxP = toNum(rule.maxPrice);
   return (
    <div key={rule.id} className="grid grid-cols-12 gap-2 items-center px-6 py-3 hover:bg-secondary/3 transition-colors">
     {/* Fiyat Aralığı */}
     <div className="col-span-4">
      {editMode ? (
       <div className="flex items-center gap-1">
        <input type="text" inputMode="decimal" value={rule.minPrice}
         onChange={(e) => updateRule(rule.id, 'minPrice', e.target.value)} onFocus={(e) => e.target.select()}
         className="w-16 rounded-lg border border-current/20 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-primary/30" placeholder="₺0" />
        <span className="text-xs text-current">–</span>
        <input type="text" inputMode="decimal" value={rule.maxPrice}
         onChange={(e) => updateRule(rule.id, 'maxPrice', e.target.value)} onFocus={(e) => e.target.select()}
         className="w-16 rounded-lg border border-current/20 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-primary/30" placeholder="∞" />
       </div>
      ) : (
       <div className="text-sm font-medium text-current">
        {minP <= 0 && maxP <= 0 ? 'Tüm Fiyatlar' : maxP <= 0 ? `₺${rule.minPrice}+` : `₺${rule.minPrice} – ₺${rule.maxPrice}`}
       </div>
      )}
     </div>

     {/* Kâr Oranı */}
     <div className="col-span-3">
      {editMode ? (
       <div className="flex items-center gap-1">
        <input type="text" inputMode="decimal" value={rule.profitMargin}
         onChange={(e) => updateRule(rule.id, 'profitMargin', e.target.value)} onFocus={(e) => e.target.select()}
         className="w-14 rounded-lg border border-current/20 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-primary/30" placeholder="%" />
        <span className="text-xs text-current">%</span>
       </div>
      ) : margin > 0 ? (
       <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 dark:bg-green-900/20 px-2.5 py-1 text-xs font-bold text-green-700 dark:text-green-400">
        %{rule.profitMargin}
       </span>
      ) : (
       <span className="text-xs text-slate-400">—</span>
      )}
     </div>

     {/* Sabit Ek */}
     <div className="col-span-3">
      {editMode ? (
       <div className="flex items-center gap-1">
        <input type="text" inputMode="decimal" value={rule.fixedAmount}
         onChange={(e) => updateRule(rule.id, 'fixedAmount', e.target.value)} onFocus={(e) => e.target.select()}
         className="w-14 rounded-lg border border-current/20 bg-transparent px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-primary/30" placeholder="₺0" />
        <span className="text-xs text-current">₺</span>
        <select value={rule.rounding} onChange={(e) => updateRule(rule.id, 'rounding', e.target.value)}
         className="rounded-lg border border-current/20 bg-transparent px-1.5 py-1 text-[10px] outline-none">
         {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
       </div>
      ) : fixed > 0 ? (
       <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-400">
        +{fixed.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
       </span>
      ) : (
       <span className="text-xs text-slate-400">—</span>
      )}
     </div>

     {/* Sonuç */}
     <div className="col-span-2">
      <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
       {examplePrice.toFixed(0)} ₺
      </span>
     </div>

     {/* Sil butonu (sadece editMode) */}
     {editMode && (
      <div className="col-span-12 flex justify-end pt-1">
       <button type="button" onClick={() => removeRule(rule.id)} disabled={rules.length <= 1}
        className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-30 transition-colors">Kuralı Sil</button>
      </div>
     )}
    </div>
   );
  })}
 </div>

 {/* KURAL EKLE */}
 <div className="flex justify-center border-t px-6 py-3.5">
  <button type="button" onClick={addRule}
   className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary transition-all hover:bg-primary/20">
   + Kural Ekle
  </button>
 </div>

 {/* CANLI FORMÜL */}
 <div className="mx-6 mb-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 p-3 border border-current/10">
  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Örnek Hesaplama (100₺ alış için)</div>
  <div className="text-xs text-current">
   {rules.filter(r => toNum(r.profitMargin) > 0 || toNum(r.fixedAmount) > 0).length > 0 ? (
    rules.filter(r => toNum(r.profitMargin) > 0 || toNum(r.fixedAmount) > 0).map((r, i) => {
     const m = toNum(r.profitMargin);
     const f = toNum(r.fixedAmount);
     const result = 100 * (1 + m / 100) + f;
     const range = toNum(r.minPrice) > 0 || toNum(r.maxPrice) > 0
      ? `(${toNum(r.minPrice)}–${toNum(r.maxPrice) > 999999 ? '∞' : toNum(r.maxPrice)}₺ bandı): `
      : '';
     return <div key={i}>{range}100₺ × (1 + %{m}) + {f}₺ = <span className="font-bold text-primary">{result.toFixed(0)}₺</span></div>;
    })
   ) : (
    <span className="text-slate-400">Kural tanımlayın, sonuç burada görünecek</span>
   )}
  </div>
 </div>

 {/* HATALAR */}
 {errors.length > 0 && (
  <div className="space-y-1 border-t px-6 py-3">
   {errors.map((err, i) => <div key={i} className="text-xs font-medium text-red-500">⚠️ {err}</div>)}
  </div>
 )}

 {/* İŞLEMLER */}
 <div className="flex flex-wrap items-center justify-center gap-3 border-t px-6 py-5">
  <button type="button" onClick={handleDelete} disabled={!marketplaceId || deleting}
   className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-6 py-2.5 text-sm font-semibold transition-all disabled:opacity-50">
   {deleting ? 'Siliniyor...' : '🗑️ Sil'}
  </button>
  <button type="button" onClick={() => setEditMode(!editMode)}
   className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold transition-all ${ editMode ? 'bg-secondary/10 text-current' : 'bg-primary/10 text-primary hover:bg-primary/20' }`}>
   {editMode ? '👁️ Görünüm' : '✏️ Düzenle'}
  </button>
  <button type="button" onClick={handleSave} disabled={!marketplaceId || saving}
   className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white px-6 py-2.5 text-sm font-semibold transition-all hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-50">
   {saving ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Kaydediliyor...</> : '💾 Kaydet'}
  </button>
 </div>
 </div>

 {/* YAN PANEL: SKOR + ÖNERİLER */}
 <div className="flex w-full shrink-0 flex-col items-center gap-4 xl:w-64">
  <div className="rounded-full bg-transparent p-1.5 shadow-card" ><ScoreRing score={score} /></div>
  <div className="w-full rounded-2xl border bg-transparent p-4 shadow-soft" >
   <h3 className="mb-2.5 text-sm font-bold" >💡 AI Önerileri</h3>
   <ul className="space-y-2 text-xs" >
    {aiTips.map((tip, i) => <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{tip.text}</li>)}
   </ul>
  </div>
 </div>
</div>
 </div>

 {/* ====== MERKEZI TEDARIKCI + PAZARYERI UYARISI ====== */}
 {showWarningModal && (
 <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-transparent/40 backdrop-blur-sm" onClick={() => setShowWarningModal(false)}>
 <div className="panel-theme p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
 <div className="flex items-start gap-3">
 <span className="text-2xl">🚨</span>
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
 </div>
 );
}

// ==================== DAIRESEL SKOR ====================

function ScoreRing({ score }: { score: number }) {
 const size = 128; const stroke = 12; const r = (size - stroke) / 2 - 2; const c = 2 * Math.PI * r;
 const offset = c * (1 - Math.min(100, Math.max(0, score)) / 100);

 return (
 <div className="relative" style={{ width: size, height: size }}>
 <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
 <defs>
 <linearGradient id="ringGradLst" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="currentColor" /><stop offset="100%" stopColor="currentColor" />
 </linearGradient>
 </defs>
 <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} />
 <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={score > 0 ? 'url(#ringGradLst)' : 'transparent'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className="text-[28px] font-extrabold leading-none tracking-tight" style={{}}>%{score}</span>
 <span className="mt-1.5 text-center text-[11px] font-semibold leading-tight" style={{}}>AI Optimizasyon<br />Skoru</span>
 </div>
 </div>
 );
}
