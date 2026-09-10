import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../lib/api';

// ==================== TİPLER ====================

interface TemplateItem {
 id: string; name: string; marketplaceId: string | null;
 titleFormat: string | null; description: string | null;
 priceFormula: string | null; commissionRate: number | null;
 vatRate: number | null; cargoSettings: string | null;
 imageSettings: string | null; variantSettings: string | null;
 categoryId: string | null; brandId: string | null;
 active: boolean; createdAt: string; updatedAt: string;
 marketplace?: { id: string; name: string; key: string } | null;
 // V3 fields
 priceSource: string; vatMode: string;
 priceMultiplier: number; priceFixedAmount: number;
 priceRangeRules: string | null; excludeRules: string | null;
 titleVariables: string | null; titleMaxLength: number | null;
 titleSeoMaxLength: number | null;
 descriptionBlocks: string | null; descriptionMaxLength: number | null;
 imageMinCount: number | null; imageMaxCount: number | null;
 imageOrder: string | null; imageWatermark: string | null;
 imageBackground: string | null; imageMinSize: number | null;
 imageFormat: string | null;
 stockMultiplier: number | null; stockMinValue: number | null;
 stockMaxValue: number | null; stockHide: boolean; stockAutoDeactivate: boolean;
 barcodePrefix: string | null; barcodeSuffix: string | null;
 barcodeAutoGenerate: boolean; validationRules: string | null;
}

interface MarketplaceConfig {
 id: string; key: string; name: string; logo: string | null;
 maxLength: number; seoMaxLength: number;
}

interface ForbiddenWord {
 id: string; word: string; marketplaces: string | null;
 createdAt: string;
}

interface PriceSimResult {
 productId: string; productTitle: string;
 purchasePrice: number | null; salePrice: number | null;
 oldPrice: number | null; newPrice: number;
 profit: number; profitMargin: number;
 commission: number; commissionRate: number;
 vat: number; vatRate: number; netPrice: number;
 currency: string;
}

interface ValidationCheck {
 field: string; label: string; passed: boolean;
 message: string; severity: 'error' | 'warning' | 'info';
}

interface ValidationResult {
 passed: boolean; score: number; checks: ValidationCheck[];
}

const MARKETPLACES = [
 { key: 'tt', name: 'Trendyol' }, { key: 'he', name: 'Hepsiburada' },
 { key: 'n11', name: 'N11' }, { key: 'amazon', name: 'Amazon' },
 { key: 'pazarama', name: 'Pazarama' }, { key: 'idefix', name: 'İdefix' },
 { key: 'ciceksepeti', name: 'ÇiçekSepeti' }, { key: 'pttavm', name: 'PTTAVM' },
 { key: 'woocommerce', name: 'WooCommerce' }, { key: 'shopify', name: 'Shopify' },
];

const VAR_PLACEHOLDERS = [
 '{{Marka}}', '{{ÜrünAdı}}', '{{Renk}}', '{{Beden}}', '{{Numara}}',
 '{{Model}}', '{{Kategori}}', '{{SKU}}', '{{Barkod}}', '{{Stok}}',
 '{{Fiyat}}', '{{KDV}}', '{{Komisyon}}', '{{KarMarjı}}', '{{Cinsiyet}}',
 '{{Materyal}}', '{{OrijinalBaşlık}}',
];

const PRICE_SOURCES = [
 { value: 'XML_PURCHASE', label: 'XML Alış Fiyatı' },
 { value: 'XML_SALE', label: 'XML Satış Fiyatı' },
 { value: 'FIXED', label: 'Sabit Fiyat' },
 { value: 'AI_CALCULATE', label: 'AI Hesaplasın' },
];

const VAT_MODES = [
 { value: 'INCLUDED', label: 'KDV Dahil' },
 { value: 'EXCLUDED', label: 'KDV Hariç' },
 { value: 'BY_CATEGORY', label: 'Kategoriye Göre' },
 { value: 'AUTO', label: 'Otomatik' },
];

const IMAGE_ORDERS = [
 { value: 'SEQUENTIAL', label: 'Sıralı' },
 { value: 'RANDOM', label: 'Rastgele' },
 { value: 'MANUAL', label: 'Manuel' },
];

const IMAGE_BGS = [
 { value: 'WHITE', label: 'Beyaz' },
 { value: 'TRANSPARENT', label: 'Transparan' },
 { value: 'COLOR', label: 'Renkli' },
];

const IMAGE_FORMATS = [
 { value: 'JPEG', label: 'JPEG' },
 { value: 'PNG', label: 'PNG' },
 { value: 'WEBP', label: 'WebP' },
];

const EXCLUDED_FIELDS = ['id', 'createdAt', 'updatedAt', 'marketplace'];
const NUMERIC_FIELDS = ['commissionRate', 'vatRate', 'priceMultiplier', 'priceFixedAmount',
 'titleMaxLength', 'titleSeoMaxLength', 'descriptionMaxLength',
 'imageMinCount', 'imageMaxCount', 'imageMinSize',
 'stockMultiplier', 'stockMinValue', 'stockMaxValue'];

function getMarketplaceIcon(key: string | null) {
 const icons: Record<string, string> = {
 tt: '🛒', he: '📦', n11: '🏪', amazon: '📦', pazarama: '🛍️',
 idefix: '📚', ciceksepeti: '🌸', pttavm: '📱', woocommerce: '🛒', shopify: '🛍️',
 };
 return icons[key || ''] || '🌐';
}

const marketplaceNames: Record<string, string> = {
 tt: 'Trendyol', he: 'Hepsiburada', n11: 'N11', amazon: 'Amazon',
 pazarama: 'Pazarama', idefix: 'İdefix', ciceksepeti: 'ÇiçekSepeti',
 pttavm: 'PTTAVM', woocommerce: 'WooCommerce', shopify: 'Shopify',
};

export default function TemplatesPage() {
 const [templates, setTemplates] = useState<TemplateItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState('liste');
 const [editing, setEditing] = useState<TemplateItem | null>(null);
 const [showEditor, setShowEditor] = useState(false);
 const [editorSubTab, setEditorSubTab] = useState('temel');
 const [saveError, setSaveError] = useState('');

 // Form
 const initialForm: any = {
 name: '', marketplaceId: '', titleFormat: '{{Marka}} {{ÜrünAdı}}', description: '',
 priceFormula: '', commissionRate: 20, vatRate: 20,
 cargoSettings: '', imageSettings: '', variantSettings: '',
 categoryId: '', brandId: '', active: true,
 priceSource: 'XML_PURCHASE', vatMode: 'INCLUDED',
 priceMultiplier: 1.0, priceFixedAmount: 0, priceRangeRules: '',
 excludeRules: '',
 titleMaxLength: 150, titleSeoMaxLength: 70,
 descriptionBlocks: '', descriptionMaxLength: 2000,
 imageMinCount: 1, imageMaxCount: 10,
 imageOrder: 'SEQUENTIAL', imageWatermark: '', imageBackground: 'WHITE',
 imageMinSize: 800, imageFormat: 'JPEG',
 stockMultiplier: 1, stockMinValue: 0, stockMaxValue: 99999,
 stockHide: false, stockAutoDeactivate: false,
 barcodePrefix: '', barcodeSuffix: '', barcodeAutoGenerate: false,
 validationRules: '',
 };
 const [form, setForm] = useState<any>({ ...initialForm });

 // Preview
 const [previewTitle, setPreviewTitle] = useState('');
 const [previewPrice, setPreviewPrice] = useState<any>(null);
 const [previewValidation, setPreviewValidation] = useState<ValidationResult | null>(null);
 const [previewJson, setPreviewJson] = useState('');

 // Test
 const [products, setProducts] = useState<Array<{ id: string; title: string; xmlKey: string }>>([]);
 const [testProduct, setTestProduct] = useState<any>(null);
 const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
 const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);

 // Simülasyon
 const [simProductIds, setSimProductIds] = useState('');
 const [simResults, setSimResults] = useState<PriceSimResult[]>([]);
 const [simLoading, setSimLoading] = useState(false);

 // Yasaklı kelimeler
 const [forbiddenWords, setForbiddenWords] = useState<ForbiddenWord[]>([]);
 const [newWord, setNewWord] = useState('');
 const [newWordMarketplaces, setNewWordMarketplaces] = useState('');

 // Pazaryeri konfig
 const [mpConfigs, setMpConfigs] = useState<MarketplaceConfig[]>([]);

 // Doğrulama
 const [validateProductId, setValidateProductId] = useState('');
 const [validateResult, setValidateResult] = useState<ValidationResult | null>(null);

 // Fiyat önizleme
 const [pricePreviewInput, setPricePreviewInput] = useState({ purchasePrice: 100, salePrice: 150, vatRate: 20, commissionRate: 15 });
 const [pricePreviewResult, setPricePreviewResult] = useState<any>(null);

 const fetchAllTemplates = useCallback(async () => {
 setLoading(true);
 try {
 const res = await fetch('/listings', { credentials: 'include' });
 const data = await res.json();
 setTemplates(data.items || []);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }, []);

 const fetchRefData = useCallback(async () => {
 try {
 const [catRes, brandRes, prodRes, fwRes, mpRes] = await Promise.all([
 fetch('/categories', { credentials: 'include' }),
 fetch('/brands', { credentials: 'include' }),
 fetch('/products?limit=20', { credentials: 'include' }),
 fetch('/listings/forbidden-words/list', { credentials: 'include' }),
 fetch('/listings/marketplace-configs', { credentials: 'include' }),
 ]);
 if (catRes.ok) { const d = await catRes.json(); setCategories(d?.items || []); }
 if (brandRes.ok) { const d = await brandRes.json(); setBrands(d?.items || []); }
 if (prodRes.ok) { const d = await prodRes.json(); setProducts(d?.items || []); }
 if (fwRes.ok) { const d = await fwRes.json(); setForbiddenWords(d?.items || []); }
 if (mpRes.ok) { const d = await mpRes.json(); setMpConfigs(d?.items || []); }
 } catch { /* ignore */ }
 }, []);

 useEffect(() => {
 fetchAllTemplates();
 fetchRefData();
 }, [fetchAllTemplates, fetchRefData]);

 function openEditor(tpl: TemplateItem | null) {
 setEditing(tpl);
 setSaveError('');
 if (tpl) {
 const f: any = { ...initialForm };
 for (const key of Object.keys(initialForm)) {
 if ((tpl as any)[key] !== undefined) {
 f[key] = (tpl as any)[key] ?? initialForm[key];
 }
 }
 f.priceRangeRules = tpl.priceRangeRules ? JSON.stringify(JSON.parse(tpl.priceRangeRules), null, 2) : '';
 f.descriptionBlocks = tpl.descriptionBlocks || '';
 f.excludeRules = tpl.excludeRules || '';
 f.validationRules = tpl.validationRules || '';
 setForm(f);
 } else {
 setForm({ ...initialForm });
 }
 setShowEditor(true);
 setActiveTab('editor');
 setEditorSubTab('temel');
 resetPreviews();
 }

 function resetPreviews() {
 setPreviewTitle('');
 setPreviewPrice(null);
 setPreviewValidation(null);
 setPreviewJson('');
 }

 function insertPlaceholder(field: string, placeholder: string) {
 setForm((prev: any) => ({ ...prev, [field]: (prev[field] || '') + ' ' + placeholder }));
 }

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 setSaveError('');
 try {
 const body: any = {};
 for (const key of Object.keys(initialForm)) {
 let val = form[key];
 if (NUMERIC_FIELDS.includes(key)) {
 val = val !== '' && val !== null ? Number(val) : null;
 }
 body[key] = val;
 }
 // JSON string'leri parse et
 if (body.priceRangeRules && typeof body.priceRangeRules === 'string') {
 try { body.priceRangeRules = JSON.stringify(JSON.parse(body.priceRangeRules)); }
 catch { body.priceRangeRules = null; }
 } else body.priceRangeRules = null;
 if (!body.priceRangeRules) body.priceRangeRules = null;

 const url = editing ? `/listings/${editing.id}` : '/listings';
 const method = editing ? 'PUT' : 'POST';
 const res = await fetch(url, {
 method,
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify(body),
 });
 if (res.ok) {
 setShowEditor(false);
 setEditing(null);
 fetchAllTemplates();
 } else {
 const err = await res.json();
 setSaveError(err.error || 'Kaydetme başarısız');
 }
 } catch (err: any) { setSaveError(err.message || 'Hata'); }
 }

 async function handleDelete(id: string) {
 if (!confirm('Bu şablonu silmek istediğinizden emin misiniz?')) return;
 await fetch(`/listings/${id}`, { method: 'DELETE', credentials: 'include' });
 fetchAllTemplates();
 }

 async function handleDuplicate(id: string) {
 await fetch(`/listings/${id}/duplicate`, { method: 'POST', credentials: 'include' });
 fetchAllTemplates();
 }

 async function handleToggleActive(id: string, active: boolean) {
 await fetch(`/listings/${id}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ active: !active }),
 });
 fetchAllTemplates();
 }

 // ========== ÖNİZLEME ==========

 async function updatePricePreview() {
 const tpl = editing || form;
 try {
 const res = await fetch(`/listings/${tpl.id || 'preview'}/price-preview`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify(pricePreviewInput),
 });
 if (res.ok) setPricePreviewResult(await res.json());
 } catch { /* ignore */ }
 }

 async function updateTitlePreview() {
 const product = testProduct || {
 title: 'Örnek Ürün Air Max 270',
 originalTitle: 'Örnek Ürün Air Max 270',
 brand: { name: 'Nike' },
 category: { name: 'Spor Ayakkabı' },
 variants: [
 { name: 'Renk', value: 'Siyah' },
 { name: 'Beden', value: '42' },
 ],
 sku: 'AM270-001', barcode: '123456789', stock: 100,
 salePrice: 1299, vatRate: 20, commissionRate: 15,
 };
 try {
 const res = await fetch('/listings/title-preview', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({
 titleFormat: form.titleFormat,
 titleMaxLength: form.titleMaxLength,
 product,
 }),
 });
 // Local fallback
 let title = form.titleFormat || '';
 const vals: Record<string, string> = {
 '{{Marka}}': 'Nike', '{{ÜrünAdı}}': 'Air Max 270', '{{Renk}}': 'Siyah',
 '{{Beden}}': '42', '{{Numara}}': '42', '{{Model}}': 'Air Max',
 '{{Kategori}}': 'Spor Ayakkabı', '{{SKU}}': 'AM270-001',
 '{{Barkod}}': '123456789', '{{Stok}}': '100',
 '{{Fiyat}}': '1.299 TL', '{{KDV}}': '%20', '{{Komisyon}}': '%15', '{{KarMarjı}}': '%35',
 '{{Cinsiyet}}': 'Unisex', '{{Materyal}}': 'Deri', '{{OrijinalBaşlık}}': 'Örnek Ürün Air Max 270',
 };
 for (const [key, val] of Object.entries(vals)) {
 title = title.replaceAll(key, val);
 }
 if (form.titleMaxLength && title.length > form.titleMaxLength) {
 title = title.substring(0, form.titleMaxLength - 3) + '...';
 }
 setPreviewTitle(title || 'Nike Air Max 270 Siyah');
 } catch { /* ignore */ }
 }

 async function runValidation() {
 const tpl = editing;
 if (!tpl || !validateProductId) return;
 try {
 const res = await fetch(`/listings/${tpl.id}/validate/${validateProductId}`, {
 credentials: 'include',
 });
 if (res.ok) setValidateResult(await res.json());
 } catch { /* ignore */ }
 }

 async function runSimulation() {
 const tpl = editing;
 if (!tpl) return;
 const ids = simProductIds.split(',').map(s => s.trim()).filter(Boolean);
 if (ids.length === 0) return;
 setSimLoading(true);
 try {
 const res = await fetch(`/listings/${tpl.id}/simulate`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ productIds: ids }),
 });
 if (res.ok) {
 const data = await res.json();
 setSimResults(data.results || []);
 }
 } catch { /* ignore */ }
 finally { setSimLoading(false); }
 }

 async function addForbiddenWord() {
 if (!newWord.trim()) return;
 try {
 const mps = newWordMarketplaces ? newWordMarketplaces.split(',').map(s => s.trim()).filter(Boolean) : [];
 const res = await fetch('/listings/forbidden-words', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ word: newWord.trim(), marketplaces: mps.length > 0 ? mps : null }),
 });
 if (res.ok) {
 setNewWord('');
 setNewWordMarketplaces('');
 const fwRes = await fetch('/listings/forbidden-words/list', { credentials: 'include' });
 if (fwRes.ok) { const d = await fwRes.json(); setForbiddenWords(d?.items || []); }
 }
 } catch { /* ignore */ }
 }

 async function deleteForbiddenWord(id: string) {
 await fetch(`/listings/forbidden-words/${id}`, { method: 'DELETE', credentials: 'include' });
 setForbiddenWords(prev => prev.filter(w => w.id !== id));
 }

 async function updateMpConfig(key: string, field: string, value: number) {
 await fetch(`/listings/marketplace-configs/${key}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({ [field]: value }),
 });
 fetchRefData();
 }

 // ========== HESAPLAMALAR ==========

 const activeCount = useMemo(() => templates.filter(t => t.active).length, [templates]);
 const mpCounts = useMemo(() => {
 const counts: Record<string, number> = {};
 for (const t of templates) { const k = t.marketplaceId || 'genel'; counts[k] = (counts[k] || 0) + 1; }
 return counts;
 }, [templates]);

 const editorTabs = [
 { key: 'temel', label: '📋 Temel' },
 { key: 'fiyat', label: '💰 Fiyat' },
 { key: 'baslik', label: '📝 Başlık' },
 { key: 'aciklama', label: '📄 Açıklama' },
 { key: 'gorse', label: '🖼️ Görsel' },
 { key: 'stok', label: '📦 Stok & Barkod' },
 { key: 'kisit', label: '🚫 Kısıtlamalar' },
 { key: 'dogrulama', label: '✅ Doğrulama' },
 ];

 return (
 <div className="space-y-4">
 {/* HEADER */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Listeleme Şablonları V3</h2>
 <p className="text-sm text-current">Enterprise listeleme şablon motoru — Fiyat, başlık, görsel, stok ve daha fazlası</p>
 </div>
 <button onClick={() => openEditor(null)}
 className="btn-ghost px-4 py-2">+ Yeni V3 Şablon</button>
 </div>

 {/* ANA SEKMELER */}
 <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1 overflow-x-auto">
 {[
 { key: 'liste', label: '📋 Şablon Listesi' },
 { key: 'editor', label: '⚙️ Düzenleme' },
 { key: 'test', label: '🧪 Test & Önizleme' },
 { key: 'simulasyon', label: '📊 Fiyat Sim.' },
 { key: 'dogrulama', label: '✅ Doğrulama' },
 { key: 'yasakli', label: '🚫 Yasaklı Kelimeler' },
 { key: 'mpconfig', label: '📐 Pazar Konfig' },
 ].map(tab => (
 <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
 className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${ activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}>{tab.label}</button>
 ))}
 </div>

 {/* ========== SEKMELER ========== */}

 {/* SEKMEE 1: LİSTE */}
 {activeTab === 'liste' && (
 <div className="space-y-4">
 {/* KPI Kartları */}
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Toplam Şablon</div>
 <div className="text-lg font-semibold text-current">{templates.length}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Aktif</div>
 <div className="text-lg font-semibold text-current">{activeCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Pasif</div>
 <div className="text-lg font-semibold text-current">{templates.length - activeCount}</div>
 </div>
 {MARKETPLACES.slice(0, 7).map(mp => (
 <div key={mp.key} className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">{getMarketplaceIcon(mp.key)} {mp.name}</div>
 <div className="text-lg font-semibold text-current">{mpCounts[mp.key] || 0}</div>
 </div>
 ))}
 </div>

 {/* Tablo */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="flex items-center justify-center p-8 text-current">Yükleniyor...</div>
 ) : templates.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-8 text-current">
 <div className="text-4xl mb-2">📋</div>
 <div>Henüz şablon oluşturulmamış</div>
 <button onClick={() => openEditor(null)} className="mt-4 btn-ghost px-4 py-2">+ İlk V3 Şablonu Oluştur</button>
 </div>
 ) : (
 <div className="divide-y divide-">
 {templates.map(tpl => (
 <div key={tpl.id} className="flex items-center gap-4 p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
 <div className="text-2xl">{getMarketplaceIcon(tpl.marketplace?.key || null)}</div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="font-medium text-current">{tpl.name}</span>
 <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ tpl.active ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>{tpl.active ? 'Aktif' : 'Pasif'}</span>
 <span className="rounded bg-transparent px-1.5 py-0.5 text-xs text-current">V3</span>
 </div>
 <div className="text-xs text-current mt-0.5">
 {marketplaceNames[tpl.marketplaceId || ''] || 'Genel'} · Fiyat: {PRICE_SOURCES.find(p => p.value === tpl.priceSource)?.label || tpl.priceSource} · KDV: {VAT_MODES.find(v => v.value === tpl.vatMode)?.label || tpl.vatMode}
 </div>
 </div>
 <div className="flex gap-1 shrink-0">
 <button onClick={() => openEditor(tpl)} className="btn-ghost px-2.5 py-1.5" title="Düzenle">✏️</button>
 <button onClick={() => handleDuplicate(tpl.id)} className="btn-ghost px-2.5 py-1.5" title="Kopyala">📋</button>
 <button onClick={() => handleToggleActive(tpl.id, tpl.active)} className="btn-ghost px-2.5 py-1.5" title={tpl.active ? 'Pasif Yap' : 'Aktif Yap'}>
 {tpl.active ? '⏸️' : '▶️'}
 </button>
 <button onClick={() => handleDelete(tpl.id)} className="btn-ghost px-2.5 py-1.5" title="Sil">🗑️</button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 )}

 {/* SEKMEE 2: DÜZENLEME */}
 {activeTab === 'editor' && showEditor && (
 <form onSubmit={handleSubmit} className="space-y-4">
 {/* Editor alt sekmeler */}
 <div className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1 overflow-x-auto">
 {editorTabs.map(tab => (
 <button key={tab.key} type="button" onClick={() => setEditorSubTab(tab.key)}
 className={`rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${ editorSubTab === tab.key ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}>{tab.label}</button>
 ))}
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
 {/* SOL: Editor */}
 <div className="lg:col-span-2 space-y-4">
 {/* TEMEL BİLGİLER */}
 {editorSubTab === 'temel' && (
 <>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📋 Temel Bilgiler</h3>
 <div className="grid grid-cols-2 gap-3">
 <div className="col-span-2">
 <label className="block text-xs text-current mb-1">Şablon Adı</label>
 <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
 className="w-full select-theme px-3 py-2" required />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Pazaryeri</label>
 <select value={form.marketplaceId} onChange={(e) => setForm({ ...form, marketplaceId: e.target.value })}
 className="w-full select-theme px-3 py-2">
 <option value="">Genel (Tümü)</option>
 {MARKETPLACES.map(mp => <option key={mp.key} value={mp.key}>{mp.name}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Kategori (opsiyonel)</label>
 <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
 className="w-full select-theme px-3 py-2">
 <option value="">Tüm Kategoriler</option>
 {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Marka (opsiyonel)</label>
 <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}
 className="w-full select-theme px-3 py-2">
 <option value="">Tüm Markalar</option>
 {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Komisyon (%)</label>
 <input type="number" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">KDV Oranı (%)</label>
 <input type="number" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="col-span-2">
 <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
 <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Aktif
 </label>
 </div>
 </div>
 </div>
 </>
 )}

 {/* FİYAT MOTORU */}
 {editorSubTab === 'fiyat' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">💰 Fiyat Motoru</h3>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Fiyat Kaynağı</label>
 <select value={form.priceSource} onChange={(e) => setForm({ ...form, priceSource: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {PRICE_SOURCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">KDV Modu</label>
 <select value={form.vatMode} onChange={(e) => setForm({ ...form, vatMode: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {VAT_MODES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Çarpan (x1.0 = %100)</label>
 <input type="number" step="0.01" value={form.priceMultiplier}
 onChange={(e) => setForm({ ...form, priceMultiplier: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Sabit Eklenen (TL)</label>
 <input type="number" step="0.01" value={form.priceFixedAmount}
 onChange={(e) => setForm({ ...form, priceFixedAmount: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="col-span-2">
 <label className="block text-xs text-current mb-1">
 Fiyat Aralığı Kuralları (JSON) — Örn: [&currentColor;"min":0,"max":100,"multiplier":2.2,"fixedAmount":20&currentColor;]
 </label>
 <textarea value={form.priceRangeRules}
 onChange={(e) => setForm({ ...form, priceRangeRules: e.target.value })}
 rows={4}
 className="w-full select-theme px-3 py-2 font-mono"
 placeholder='[{"min":0,"max":100,"multiplier":2.2,"fixedAmount":20},{"min":100,"max":250,"multiplier":1.8,"fixedAmount":15}]' />
 </div>
 <div className="col-span-2">
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-xs text-current mb-2">🧪 Fiyat Hesaplama Testi</div>
 <div className="grid grid-cols-4 gap-2 mb-2">
 <input type="number" placeholder="Alış Fiyatı" value={pricePreviewInput.purchasePrice}
 onChange={(e) => setPricePreviewInput({ ...pricePreviewInput, purchasePrice: Number(e.target.value) })}
 className="rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-xs text-current" />
 <input type="number" placeholder="Satış Fiyatı" value={pricePreviewInput.salePrice}
 onChange={(e) => setPricePreviewInput({ ...pricePreviewInput, salePrice: Number(e.target.value) })}
 className="rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-xs text-current" />
 <input type="number" placeholder="KDV %" value={pricePreviewInput.vatRate}
 onChange={(e) => setPricePreviewInput({ ...pricePreviewInput, vatRate: Number(e.target.value) })}
 className="rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-xs text-current" />
 <input type="number" placeholder="Komisyon %" value={pricePreviewInput.commissionRate}
 onChange={(e) => setPricePreviewInput({ ...pricePreviewInput, commissionRate: Number(e.target.value) })}
 className="rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-xs text-current" />
 </div>
 <button type="button" onClick={updatePricePreview}
 className="rounded bg-transparent px-3 py-1 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20">Hesapla</button>
 {pricePreviewResult && (
 <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
 <div className="rounded bg-transparent p-2">
 <span className="text-slate-700 dark:text-slate-300">Fiyat:</span>{' '}
 <span className="text-current font-semibold">{pricePreviewResult.price} TL</span>
 </div>
 <div className="rounded bg-transparent p-2">
 <span className="text-slate-700 dark:text-slate-300">KDV:</span>{' '}
 <span className="text-slate-700 dark:text-slate-300">{pricePreviewResult.vat} TL</span>
 </div>
 <div className="rounded bg-transparent p-2">
 <span className="text-slate-700 dark:text-slate-300">Komisyon:</span>{' '}
 <span className="text-slate-700 dark:text-slate-300">{pricePreviewResult.commission} TL</span>
 </div>
 <div className="rounded bg-transparent p-2">
 <span className="text-slate-700 dark:text-slate-300">Kar:</span>{' '}
 <span className="text-slate-700 dark:text-slate-300">{pricePreviewResult.profit} TL</span>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 )}

 {/* BAŞLIK ŞABLONU */}
 {editorSubTab === 'baslik' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📝 Başlık Şablonu</h3>
 <div className="space-y-3">
 <div>
 <div className="flex flex-wrap gap-1 mb-2">
 {VAR_PLACEHOLDERS.map(p => (
 <button key={p} type="button" onClick={() => insertPlaceholder('titleFormat', p)}
 className="rounded bg-transparent px-1.5 py-0.5 text-xs text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20">{p}</button>
 ))}
 </div>
 <input type="text" value={form.titleFormat}
 onChange={(e) => setForm({ ...form, titleFormat: e.target.value })}
 className="w-full select-theme px-3 py-2 font-mono" />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Maks. Karakter</label>
 <input type="number" value={form.titleMaxLength}
 onChange={(e) => setForm({ ...form, titleMaxLength: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">SEO Maks. Karakter</label>
 <input type="number" value={form.titleSeoMaxLength}
 onChange={(e) => setForm({ ...form, titleSeoMaxLength: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 <div>
 <button type="button" onClick={updateTitlePreview}
 className="btn-ghost px-3 py-1.5">
 🔄 Başlık Önizle</button>
 {previewTitle && (
 <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-xs text-current mb-1">Önizleme ({previewTitle.length} karakter):</div>
 <div className="text-sm text-current font-medium">{previewTitle}</div>
 </div>
 )}
 </div>
 </div>
 </div>
 )}

 {/* AÇIKLAMA BLOKLARI */}
 {editorSubTab === 'aciklama' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📄 Açıklama Blokları</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Açıklama Blokları (JSON)</label>
 <textarea value={form.descriptionBlocks}
 onChange={(e) => setForm({ ...form, descriptionBlocks: e.target.value })}
 rows={8}
 className="w-full select-theme px-3 py-2 font-mono"
 placeholder='[{"type":"text","title":"Ürün Açıklaması","content":"{{Marka}} {{ÜrünAdı}} kaliteli malzemeden üretilmiştir.","order":1},{"type":"table","title":"Teknik Özellikler","content":"Renk | Siyah\nBeden | 42\nMateryal | Deri","order":2},{"type":"list","title":"Öne Çıkanlar","content":"Su geçirmez\nNefes alabilir\nHafif tasarım","order":3}]' />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Maks. Karakter</label>
 <input type="number" value={form.descriptionMaxLength}
 onChange={(e) => setForm({ ...form, descriptionMaxLength: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-xs text-current mb-2">Blok Tipleri:</div>
 <div className="grid grid-cols-3 gap-2 text-xs">
 <div className="rounded bg-transparent p-2"><strong>text</strong>: Düz metin</div>
 <div className="rounded bg-transparent p-2"><strong>table</strong>: Tablo</div>
 <div className="rounded bg-transparent p-2"><strong>list</strong>: Liste</div>
 <div className="rounded bg-transparent p-2"><strong>techspecs</strong>: Teknik özellikler</div>
 <div className="rounded bg-transparent p-2"><strong>ai</strong>: AI açıklaması</div>
 <div className="rounded bg-transparent p-2"><strong>block</strong>: Ham HTML</div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* GÖRSEL KURALLARI */}
 {editorSubTab === 'gorse' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🖼️ Görsel Kuralları</h3>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Min. Görsel</label>
 <input type="number" value={form.imageMinCount}
 onChange={(e) => setForm({ ...form, imageMinCount: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Maks. Görsel</label>
 <input type="number" value={form.imageMaxCount}
 onChange={(e) => setForm({ ...form, imageMaxCount: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Sıralama</label>
 <select value={form.imageOrder} onChange={(e) => setForm({ ...form, imageOrder: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {IMAGE_ORDERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Arkaplan</label>
 <select value={form.imageBackground} onChange={(e) => setForm({ ...form, imageBackground: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {IMAGE_BGS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Format</label>
 <select value={form.imageFormat} onChange={(e) => setForm({ ...form, imageFormat: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {IMAGE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Min. Boyut (px)</label>
 <input type="number" value={form.imageMinSize}
 onChange={(e) => setForm({ ...form, imageMinSize: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="col-span-2">
 <label className="block text-xs text-current mb-1">Filigran (metin veya URL)</label>
 <input type="text" value={form.imageWatermark}
 onChange={(e) => setForm({ ...form, imageWatermark: e.target.value })}
 className="w-full select-theme px-3 py-2"
 placeholder="DG STOK V5.0" />
 </div>
 </div>
 </div>
 )}

 {/* STOK & BARKOT */}
 {editorSubTab === 'stok' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📦 Stok & Barkod Kuralları</h3>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Stok Çarpanı</label>
 <input type="number" value={form.stockMultiplier}
 onChange={(e) => setForm({ ...form, stockMultiplier: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Min. Stok</label>
 <input type="number" value={form.stockMinValue}
 onChange={(e) => setForm({ ...form, stockMinValue: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Maks. Stok</label>
 <input type="number" value={form.stockMaxValue}
 onChange={(e) => setForm({ ...form, stockMaxValue: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="flex items-end gap-2">
 <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
 <input type="checkbox" checked={form.stockHide}
 onChange={(e) => setForm({ ...form, stockHide: e.target.checked })}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Stok 0'sa Gizle
 </label>
 <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
 <input type="checkbox" checked={form.stockAutoDeactivate}
 onChange={(e) => setForm({ ...form, stockAutoDeactivate: e.target.checked })}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Otomatik Pasife Al
 </label>
 </div>
 <div className="col-span-2 border-t border-slate-100 dark:border-slate-800/60 pt-3">
 <h4 className="text-xs font-semibold text-current mb-2">🔖 Barkod Ayarları</h4>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Ön Ek</label>
 <input type="text" value={form.barcodePrefix}
 onChange={(e) => setForm({ ...form, barcodePrefix: e.target.value })}
 className="w-full select-theme px-3 py-2 font-mono" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Son Ek</label>
 <input type="text" value={form.barcodeSuffix}
 onChange={(e) => setForm({ ...form, barcodeSuffix: e.target.value })}
 className="w-full select-theme px-3 py-2 font-mono" />
 </div>
 <div className="col-span-2">
 <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
 <input type="checkbox" checked={form.barcodeAutoGenerate}
 onChange={(e) => setForm({ ...form, barcodeAutoGenerate: e.target.checked })}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Barkod Yoksa Otomatik Üret
 </label>
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* KISITLAMALAR */}
 {editorSubTab === 'kisit' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🚫 Kısıtlama & Dışlama Kuralları</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Dışlama Kuralları (JSON)</label>
 <textarea value={form.excludeRules}
 onChange={(e) => setForm({ ...form, excludeRules: e.target.value })}
 rows={6}
 className="w-full select-theme px-3 py-2 font-mono"
 placeholder='{"categories":["Elektronik"],"brands":["Apple"],"suppliers":[],"products":[],"skus":[],"barcodes":[]}' />
 </div>
 </div>
 </div>
 )}

 {/* DOĞRULAMA */}
 {editorSubTab === 'dogrulama' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">✅ Doğrulama Kuralları</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Doğrulama Kuralları (JSON)</label>
 <textarea value={form.validationRules}
 onChange={(e) => setForm({ ...form, validationRules: e.target.value })}
 rows={10}
 className="w-full select-theme px-3 py-2 font-mono"
 placeholder='{"checkTitleEmpty":true,"checkTitleLength":true,"checkTitleForbiddenWords":true,"checkImagesEmpty":true,"checkPriceValid":true,"checkStockValid":true,"checkBarcodeValid":true,"checkCategoryMatch":true,"checkBrandMatch":true}' />
 </div>
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="text-xs text-current mb-2">Kullanılabilir Doğrulama Anahtarları:</div>
 <div className="grid grid-cols-2 gap-1 text-xs text-current">
 <div>checkTitleEmpty, checkTitleLength, checkTitleForbiddenWords</div>
 <div>checkTitleDuplicateBrand, checkDescriptionEmpty</div>
 <div>checkDescriptionLength, checkImagesEmpty, checkImagesCount</div>
 <div>checkImagesSize, checkPriceValid, checkPriceRange</div>
 <div>checkStockValid, checkBarcodeValid, checkBarcodeLength</div>
 <div>checkCategoryMatch, checkBrandMatch, checkVariantMatch</div>
 <div>checkCommissionRate</div>
 </div>
 </div>
 </div>
 </div>
 )}
 </div>

 {/* SAĞ: Canlı Önizleme + Kaydet */}
 <div className="space-y-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold text-current">📱 Canlı Önizleme</h3>
 <span className="text-xs text-current">{marketplaceNames[form.marketplaceId] || 'Genel'}</span>
 </div>
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 min-h-[250px]">
 <h2 className="text-lg font-bold text-current">{previewTitle || 'Başlık burada görünecek'}</h2>
 <div className="mt-2 text-sm text-current">
 {form.description?.substring(0, 200) || 'Açıklama burada görünecek...'}
 </div>
 <div className="mt-3 flex flex-wrap gap-2">
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 {form.vatRate}% KDV ({VAT_MODES.find(v => v.value === form.vatMode)?.label || form.vatMode})
 </span>
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 {form.commissionRate}% Komisyon
 </span>
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 {PRICE_SOURCES.find(p => p.value === form.priceSource)?.label || form.priceSource}
 </span>
 </div>
 <div className="mt-3 text-sm font-bold text-current">
 {form.priceMultiplier}x + {form.priceFixedAmount} TL
 </div>
 <div className="mt-2 text-xs text-current">
 Görsel: {form.imageMinCount}-{form.imageMaxCount} · Stok: x{form.stockMultiplier}
 {form.stockHide ? ' · Gizle' : ''}
 </div>
 </div>
 </div>

 {saveError && (
 <div className="rounded-lg bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-sm text-current">
 {saveError}
 </div>
 )}

 <div className="flex gap-2">
 <button type="button" onClick={() => { setShowEditor(false); setEditing(null); }}
 className="flex-1 btn-ghost px-4 py-2">İptal</button>
 <button type="submit"
 className="flex-1 btn-ghost px-6 py-2">
 💾 {editing ? 'Güncelle' : 'Kaydet'}
 </button>
 </div>
 </div>
 </div>
 </form>
 )}
 {activeTab === 'editor' && !showEditor && (
 <div className="flex flex-col items-center justify-center p-12 text-current">
 <div className="text-5xl mb-3">📋</div>
 <div className="text-lg">Düzenlemek için listeden bir şablon seçin veya yeni şablon oluşturun</div>
 </div>
 )}

 {/* SEKMEE 3: TEST & ÖNİZLEME */}
 {activeTab === 'test' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🧪 Test Ürünü Seç</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Ürün</label>
 <select value={testProduct?.id || ''} onChange={(e) => {
 const p = products.find(pr => pr.id === e.target.value);
 setTestProduct(p || null);
 }} className="w-full select-theme px-3 py-2">
 <option value="">Ürün seç...</option>
 {products.map(p => <option key={p.id} value={p.id}>{p.title || p.xmlKey}</option>)}
 </select>
 </div>
 <label className="block text-xs text-current mb-1">Şablon</label>
 <select value={editing?.id || ''} onChange={(e) => {
 const tpl = templates.find(t => t.id === e.target.value);
 if (tpl) openEditor(tpl);
 }} className="w-full select-theme px-3 py-2">
 <option value="">Şablon seç...</option>
 {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 <button type="button" onClick={updateTitlePreview} disabled={!editing}
 className="w-full btn-ghost px-3 py-2 disabled:opacity-50">
 🔄 Şablonu Uygula & Önizle
 </button>
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold text-current">📱 Canlı Önizleme</h3>
 <span className="text-xs text-current">
 {editing ? marketplaceNames[editing.marketplaceId || ''] || 'Genel' : 'Şablon seçili değil'}
 </span>
 </div>
 <div className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 min-h-[200px]">
 <h2 className="text-lg font-bold text-current">{previewTitle || 'Başlık burada görünecek'}</h2>
 <div className="mt-2 text-sm text-current" dangerouslySetInnerHTML={{
 __html: editing?.description?.substring(0, 300) || 'Açıklama burada görünecek...'
 }} />
 <div className="mt-3 flex flex-wrap gap-2">
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 {editing?.vatRate || 0}% KDV
 </span>
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 {editing?.commissionRate || 0}% Komisyon
 </span>
 {editing?.stockHide && (
 <span className="rounded bg-transparent px-2 py-1 text-xs text-current">
 Stok Gizleme Aktif
 </span>
 )}
 </div>
 {editing?.barcodeAutoGenerate && (
 <div className="mt-2 text-xs text-current">🔖 Barkod otomatik üretilecek</div>
 )}
 </div>
 </div>
 </div>
 )}

 {/* SEKMEE 4: FİYAT SİMÜLASYONU */}
 {activeTab === 'simulasyon' && (
 <div className="space-y-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📊 Fiyat Simülasyonu</h3>
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-xs text-current mb-1">Şablon</label>
 <select value={editing?.id || ''} onChange={(e) => {
 const tpl = templates.find(t => t.id === e.target.value);
 if (tpl) openEditor(tpl);
 }} className="w-full select-theme px-3 py-2">
 <option value="">Şablon seç...</option>
 {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Ürün ID'leri (virgülle ayır)</label>
 <input type="text" value={simProductIds}
 onChange={(e) => setSimProductIds(e.target.value)}
 className="w-full select-theme px-3 py-2 font-mono"
 placeholder="id1, id2, id3, ... (en fazla 10.000)" />
 </div>
 </div>
 <button type="button" onClick={runSimulation} disabled={!editing || simLoading}
 className="btn-ghost px-4 py-2 disabled:opacity-50">
 {simLoading ? '💫 Hesaplanıyor...' : '📊 Simülasyonu Başlat'}
 </button>
 </div>
 </div>

 {simResults.length > 0 && (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm overflow-x-auto">
 <table className="w-full text-xs">
 <thead className="bg-transparent">
 <tr>
 <th className="px-3 py-2 text-left text-current">Ürün</th>
 <th className="px-3 py-2 text-right text-current">Alış</th>
 <th className="px-3 py-2 text-right text-current">Eski Fiyat</th>
 <th className="px-3 py-2 text-right text-current">Yeni Fiyat</th>
 <th className="px-3 py-2 text-right text-current">KDV</th>
 <th className="px-3 py-2 text-right text-current">Komisyon</th>
 <th className="px-3 py-2 text-right text-current">Kar</th>
 <th className="px-3 py-2 text-right text-current">Marj</th>
 <th className="px-3 py-2 text-right text-current">Net</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {simResults.map(r => (
 <tr key={r.productId} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700">
 <td className="px-3 py-2 text-current max-w-[200px] truncate">{r.productTitle}</td>
 <td className="px-3 py-2 text-right text-current">{r.purchasePrice?.toFixed(2) || '-'}</td>
 <td className="px-3 py-2 text-right text-current">{r.oldPrice?.toFixed(2) || '-'}</td>
 <td className="px-3 py-2 text-right text-current font-semibold">{r.newPrice.toFixed(2)}</td>
 <td className="px-3 py-2 text-right text-current">{r.vat.toFixed(2)}</td>
 <td className="px-3 py-2 text-right text-current">{r.commission.toFixed(2)}</td>
 <td className="px-3 py-2 text-right text-current">{r.profit.toFixed(2)}</td>
 <td className="px-3 py-2 text-right text-current">%{r.profitMargin}</td>
 <td className="px-3 py-2 text-right text-current">{r.netPrice.toFixed(2)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 <div className="px-3 py-2 text-xs text-current border-t border-slate-100 dark:border-slate-800/60">
 Toplam {simResults.length} ürün · Para birimi: {simResults[0]?.currency || 'TRY'}
 </div>
 </div>
 )}
 </div>
 )}

 {/* SEKMEE 5: DOĞRULAMA */}
 {activeTab === 'dogrulama' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">✅ Ürün Doğrulama</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Şablon</label>
 <select value={editing?.id || ''} onChange={(e) => {
 const tpl = templates.find(t => t.id === e.target.value);
 if (tpl) openEditor(tpl);
 }} className="w-full select-theme px-3 py-2">
 <option value="">Şablon seç...</option>
 {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Ürün ID</label>
 <input type="text" value={validateProductId}
 onChange={(e) => setValidateProductId(e.target.value)}
 className="w-full select-theme px-3 py-2 font-mono" />
 </div>
 <button type="button" onClick={runValidation} disabled={!editing || !validateProductId}
 className="w-full btn-ghost px-3 py-2 disabled:opacity-50">
 🔍 Doğrula
 </button>
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">
 📊 Doğrulama Sonucu
 {validateResult && (
 <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${ validateResult.passed ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>
 {validateResult.passed ? '✅ GEÇTİ' : '❌ KALDI'} · %{validateResult.score}
 </span>
 )}
 </h3>
 {validateResult ? (
 <div className="space-y-1 max-h-[400px] overflow-y-auto">
 {validateResult.checks.map((check, i) => (
 <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${ check.passed ? 'bg-primary/10 text-primary' : check.severity === 'error' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>
 <div className="flex items-center gap-2">
 <span>{check.passed ? '✅' : check.severity === 'error' ? '❌' : '⚠️'}</span>
 <span>{check.label}</span>
 </div>
 <span>{check.message}</span>
 </div>
 ))}
 </div>
 ) : (
 <div className="flex items-center justify-center h-[200px] text-sm text-slate-600 dark:text-slate-400">
 Doğrulama yapılmadı
 </div>
 )}
 </div>
 </div>
 )}

 {/* SEKMEE 6: YASAKLI KELİMELER */}
 {activeTab === 'yasakli' && (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🚫 Yasaklı Kelime Ekle</h3>
 <div className="space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Kelime</label>
 <input type="text" value={newWord}
 onChange={(e) => setNewWord(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && addForbiddenWord()}
 className="w-full select-theme px-3 py-2"
 placeholder="ör: en kaliteli, en uygun, birinci sınıf" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Pazaryerleri (virgülle ayır, boş = tümü)</label>
 <input type="text" value={newWordMarketplaces}
 onChange={(e) => setNewWordMarketplaces(e.target.value)}
 className="w-full select-theme px-3 py-2"
 placeholder="tt, he, n11" />
 </div>
 <button type="button" onClick={addForbiddenWord} disabled={!newWord.trim()}
 className="w-full btn-ghost px-3 py-2 disabled:opacity-50">
 🚫 Ekle
 </button>
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📋 Yasaklı Kelimeler ({forbiddenWords.length})</h3>
 {forbiddenWords.length === 0 ? (
 <div className="flex items-center justify-center h-[200px] text-sm text-slate-600 dark:text-slate-400">
 Henüz yasaklı kelime yok
 </div>
 ) : (
 <div className="space-y-1 max-h-[400px] overflow-y-auto">
 {forbiddenWords.map(w => (
 <div key={w.id} className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2">
 <div>
 <span className="text-sm text-current font-mono">{w.word}</span>
 {w.marketplaces && (
 <span className="ml-2 text-xs text-current">
 ({JSON.parse(w.marketplaces).join(', ')})
 </span>
 )}
 </div>
 <button onClick={() => deleteForbiddenWord(w.id)}
 className="text-current hover:text-xs text-slate-500 dark:text-slate-400">🗑️</button>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 )}

 {/* SEKMEE 7: PAZARYERİ KONFİG */}
 {activeTab === 'mpconfig' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">📐 Pazaryeri Başlık Konfigürasyonları</h3>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-2 text-left text-current">Pazaryeri</th>
 <th className="px-4 py-2 text-center text-current">Maks. Karakter</th>
 <th className="px-4 py-2 text-center text-current">SEO Maks.</th>
 <th className="px-4 py-2 text-center text-current">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {mpConfigs.map(cfg => (
 <tr key={cfg.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700">
 <td className="px-4 py-3 text-current font-medium">
 {getMarketplaceIcon(cfg.key)} {cfg.name}
 </td>
 <td className="px-4 py-3 text-center">
 <input type="number" defaultValue={cfg.maxLength}
 onBlur={(e) => updateMpConfig(cfg.key, 'maxLength', Number(e.target.value))}
 className="w-20 rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-sm text-current text-center" />
 </td>
 <td className="px-4 py-3 text-center">
 <input type="number" defaultValue={cfg.seoMaxLength}
 onBlur={(e) => updateMpConfig(cfg.key, 'seoMaxLength', Number(e.target.value))}
 className="w-20 rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2 py-1 text-sm text-current text-center" />
 </td>
 <td className="px-4 py-3 text-center text-xs text-current">✅ Kaydedildi</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 );
}
