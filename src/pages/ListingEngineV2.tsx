// ==================== LİSTELEME MOTORU V2.0 ====================
// Fiyat kuralları yönetimi, fiyat hesaplama, toplu listeleme ve log izleme
import React, { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface Marketplace { id: string; key: string; name: string; }
interface XmlSource { id: string; name: string; }
interface PriceRule {
 id: string;
 marketplaceId: string;
 xmlSourceId: string | null;
 productId: string | null;
 categoryId: string | null;
 minPrice: number;
 maxPrice: number;
 fixedAmount: number;
 applyVat: boolean;
 profitMargin: number;
 rounding: string;
 active: boolean;
 priority: number;
 createdAt?: string;
 updatedAt?: string;
}
interface ListingLog {
 id: string;
 productId: string;
 marketplaceId: string;
 ruleId: string | null;
 ruleType: string;
 purchasePrice: number;
 vatIncludedPrice: number;
 profitMargin: number;
 rounding: string;
 calculatedPrice: number;
 status: string;
 errorMessage?: string | null;
 createdAt: string;
}
interface PricePreview {
 vatIncluded: number;
 beforeRounding: number;
 finalPrice: number;
}

const ROUNDING_OPTIONS = [
 { value: '0.90', label: '0,90' },
 { value: '0.95', label: '0,95' },
 { value: '0.99', label: '0,99' },
 { value: '9.90', label: '9,90' },
 { value: '49.90', label: '49,90' },
 { value: '99.90', label: '99,90' },
 { value: 'nearest', label: 'En Yakın Tam' },
 { value: 'ceil', label: 'Yukarı Yuvarla' },
 { value: 'floor', label: 'Aşağı Yuvarla' },
 { value: 'none', label: 'Yuvarlama Yok' },
];

const RULE_TYPE_LABELS: Record<string, string> = {
 PRODUCT: '📦 Ürün',
 CATEGORY: '📁 Kategori',
 GENERAL: '🌐 Genel',
 NONE: '❌ Kural Yok',
};

const STATUS_LABELS: Record<string, string> = {
 SUCCESS: '✅ Başarılı',
 ERROR: '❌ Hata',
};

function toNum(s: string): number {
 const n = Number(s.replace(',', '.'));
 return isNaN(n) ? 0 : n;
}

function getMpIcon(key: string): string {
 const icons: Record<string, string> = {
 trendyol: '🛒', tt: '🛒', hepsiburada: '📦', he: '📦',
 n11: '🏪', amazon: '📦', pazarama: '🛍️', idefix: '📚',
 ciceksepeti: '🌸', pttavm: '📱', woocommerce: '🛒', shopify: '🛍️',
 };
 return icons[key] || '🌐';
}

type TabKey = 'rules' | 'calculator' | 'bulk' | 'logs' | 'test';

export default function ListingEngineV2() {
 const [activeTab, setActiveTab] = useState<TabKey>('rules');
 const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
 const [xmlSources, setXmlSources] = useState<XmlSource[]>([]);
 const [rules, setRules] = useState<PriceRule[]>([]);
 const [logs, setLogs] = useState<ListingLog[]>([]);
 const [loading, setLoading] = useState(false);
 const [selectedMpId, setSelectedMpId] = useState('');
 const [selectedXmlSourceId, setSelectedXmlSourceId] = useState('');

 // Rule form
 const [showRuleForm, setShowRuleForm] = useState(false);
 const [editingRule, setEditingRule] = useState<PriceRule | null>(null);
 const [ruleForm, setRuleForm] = useState({
  marketplaceId: '', xmlSourceId: '', productId: '', categoryId: '',
  minPrice: '0', maxPrice: '999999', fixedAmount: '0',
  applyVat: true, profitMargin: '75', rounding: '0.90',
  active: true, priority: '3',
 });

 // Calculator
 const [calcForm, setCalcForm] = useState({
  purchasePrice: '100',
  profitMargin: '75', rounding: '0.90',
 });
 const [calcResult, setCalcResult] = useState<PricePreview | null>(null);

 // Bulk
 const [bulkMpId, setBulkMpId] = useState('');
 const [bulkResult, setBulkResult] = useState<{
 successCount: number; errorCount: number; results: any[];
 } | null>(null);
 const [bulkSending, setBulkSending] = useState(false);
 const [bulkProducts, setBulkProducts] = useState<any[]>([]);
 const [bulkProductsLoading, setBulkProductsLoading] = useState(false);
 const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(new Set());
 const [bulkBlockReason, setBulkBlockReason] = useState('');

 // Stok Yönetimi
 const [showStockMgmt, setShowStockMgmt] = useState(false);
 const [stockScanning, setStockScanning] = useState(false);
 const [stockAlerts, setStockAlerts] = useState<any[]>([]);
 const [stockAlertsLoading, setStockAlertsLoading] = useState(false);
 const [stockProdId, setStockProdId] = useState('');
 const [stockAutoMgmt, setStockAutoMgmt] = useState(false);
 const [stockCriticalLevel, setStockCriticalLevel] = useState('');
 const [stockSaving, setStockSaving] = useState(false);

 // Data loading
 const fetchMarketplaces = useCallback(async () => {
  const res = await apiFetch<{ items: Marketplace[] }>('/marketplaces');
  if (res.ok && res.data) setMarketplaces(res.data.items || []);
  }, []);

 const fetchXmlSources = useCallback(async () => {
  const res = await apiFetch<{ items: XmlSource[] }>('/xml-sources');
  if (res.ok && res.data) setXmlSources(res.data.items || []);
  }, []);

 const fetchRules = useCallback(async (marketplaceId?: string, xmlSourceId?: string) => {
  setLoading(true);
  const params = new URLSearchParams();
  if (marketplaceId) params.set('marketplaceId', marketplaceId);
  if (xmlSourceId) params.set('xmlSourceId', xmlSourceId);
  const qs = params.toString();
  const res = await apiFetch<{ items: PriceRule[] }>(`/listing-v2/rules${qs ? `?${qs}` : ''}`);
  if (res.ok && res.data) setRules(res.data.items || []);
  setLoading(false);
  }, []);

 const fetchLogs = useCallback(async (marketplaceId?: string) => {
 setLoading(true);
 const params = marketplaceId ? `?marketplaceId=${marketplaceId}` : '';
 const res = await apiFetch<{ items: ListingLog[] }>(`/listing-v2/logs${params}`);
 if (res.ok && res.data) setLogs(res.data.items || []);
 setLoading(false);
 }, []);

 useEffect(() => { fetchMarketplaces(); fetchXmlSources(); }, []);

 // Tab switching
 useEffect(() => {
  if (activeTab === 'rules') fetchRules(selectedMpId, selectedXmlSourceId);
  else if (activeTab === 'logs') fetchLogs(selectedMpId);
  }, [activeTab, selectedMpId, selectedXmlSourceId]);

 // ============ RULE CRUD ============
 const resetRuleForm = () => {
  setRuleForm({
   marketplaceId: selectedMpId || '', xmlSourceId: '', productId: '', categoryId: '',
   minPrice: '0', maxPrice: '999999', fixedAmount: '0',
   applyVat: true, profitMargin: '75', rounding: '0.90',
   active: true, priority: '3',
  });
  setEditingRule(null);
 };

 const openEditRule = (rule: PriceRule) => {
  setRuleForm({
   marketplaceId: rule.marketplaceId,
   xmlSourceId: rule.xmlSourceId || '',
   productId: rule.productId || '',
   categoryId: rule.categoryId || '',
   minPrice: String(rule.minPrice),
   maxPrice: String(rule.maxPrice),
   fixedAmount: String(rule.fixedAmount ?? 0),
   applyVat: rule.applyVat,
   profitMargin: String(rule.profitMargin),
   rounding: rule.rounding,
   active: rule.active,
   priority: String(rule.priority),
  });
  setEditingRule(rule);
  setShowRuleForm(true);
 };

 const handleSaveRule = async () => {
  const body = {
   marketplaceId: ruleForm.marketplaceId || selectedMpId,
   xmlSourceId: ruleForm.xmlSourceId || null,
   productId: ruleForm.productId || null,
   categoryId: ruleForm.categoryId || null,
   minPrice: toNum(ruleForm.minPrice),
   maxPrice: toNum(ruleForm.maxPrice),
   fixedAmount: toNum(ruleForm.fixedAmount),
   applyVat: ruleForm.applyVat,
   profitMargin: toNum(ruleForm.profitMargin),
   rounding: ruleForm.rounding,
   active: ruleForm.active,
   priority: Number(ruleForm.priority),
  };

 if (!body.marketplaceId) {
 showToast('warning', 'Pazaryeri seçin');
 return;
 }

 const url = editingRule
 ? `/listing-v2/rules/${editingRule.id}`
 : '/listing-v2/rules';
 const method = editingRule ? 'PUT' : 'POST';

 const res = await apiFetch(url, {
 method,
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });

 if (res.ok) {
  showToast('success', editingRule ? '✅ Kural güncellendi' : '✅ Kural oluşturuldu');
  setShowRuleForm(false);
  resetRuleForm();
  fetchRules(selectedMpId, selectedXmlSourceId);
 } else {
 showToast('error', res.error?.message || 'Kural kaydedilemedi');
 }
 };

 const handleDeleteRule = async (id: string) => {
 const res = await apiFetch(`/listing-v2/rules/${id}`, { method: 'DELETE' });
 if (res.ok) {
 showToast('success', '🗑️ Kural silindi');
 fetchRules(selectedMpId);
 } else {
 showToast('error', res.error?.message || 'Silme başarısız');
 }
 };

 // ============ CALCULATOR ============
 const handleCalculate = async () => {
  const res = await apiFetch<any>('/listing-v2/calculate', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({
    vatIncludedPurchase: toNum(calcForm.purchasePrice),
    profitMargin: toNum(calcForm.profitMargin),
    fixedAmount: 0,
    rounding: calcForm.rounding,
   }),
  });
  if (res.ok && res.data) {
   setCalcResult({
    vatIncluded: res.data.vatIncludedPurchase,
    beforeRounding: res.data.vatIncludedPurchase * (1 + toNum(calcForm.profitMargin) / 100),
    finalPrice: res.data.finalPrice,
   });
  } else {
   showToast('error', res.error?.message || 'Hesaplama başarısız');
  }
 };

 // ============ BULK LIST ============
 const handleBulkList = async () => {
 if (!bulkMpId) { showToast('warning', 'Pazaryeri seçin'); return; }
 setBulkSending(true);
 setBulkResult(null);
 try {
 const productRes = await apiFetch<{ items: Array<{ id: string; title: string }> }>(
 '/products?limit=100&status=READY&templateMatch=true'
 );
 if (!productRes.ok || !productRes.data?.items?.length) {
 showToast('warning', 'Gönderilecek ürün bulunamadı');
 return;
 }
 const productIds = productRes.data.items.map(p => p.id);
 const res = await apiFetch<any>('/listing-v2/bulk-list', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ marketplaceId: bulkMpId, productIds }),
 });
 if (res.ok && res.data) {
 setBulkResult(res.data);
 showToast('success', `✅ ${res.data.successCount} ürün hesaplandı, ${res.data.errorCount} hata`);
 fetchLogs(bulkMpId);
 } else {
 showToast('error', res.error?.message || 'Toplu listeleme başarısız');
 }
 } finally {
 setBulkSending(false);
 }
 };

 // ============ BULK PRODUCT TABLE ============
 const fetchBulkProducts = useCallback(async () => {
 setBulkProductsLoading(true);
 try {
 const res = await apiFetch<{ items: any[] }>('/products?limit=100&status=READY&templateMatch=true');
 if (res.ok && res.data) {
 setBulkProducts(res.data.items || []);
 }
 } finally {
 setBulkProductsLoading(false);
 }
 }, []);

 const handleBulkToggleSelect = (id: string) => {
 setSelectedBulkIds(prev => {
 const n = new Set(prev);
 if (n.has(id)) n.delete(id); else n.add(id);
 return n;
 });
 };

 const handleBulkToggleSelectAll = () => {
 setSelectedBulkIds(prev =>
 prev.size === bulkProducts.length
 ? new Set()
 : new Set(bulkProducts.map(p => p.id))
 );
 };

 const handleSendSelectedProducts = async () => {
 if (!bulkMpId) { showToast('warning', 'Pazaryeri seçin'); return; }
 if (selectedBulkIds.size === 0) { showToast('warning', 'Ürün seçin'); return; }
 setBulkSending(true);
 setBulkBlockReason('');
 try {
 const res = await apiFetch<any>('/products/prepare', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ids: Array.from(selectedBulkIds),
 marketplaceId: bulkMpId,
 }),
 });
 if (res.ok && res.data) {
 showToast('success', `✅ ${res.data.readyCount} ürün hazırlandı`);
 setSelectedBulkIds(new Set());
 fetchBulkProducts();
 } else {
 setBulkBlockReason(res.error?.message || 'İşlem başarısız');
 }
 } finally {
 setBulkSending(false);
 }
 };

 // ============ STOK YÖNETİMİ ============
 const handleStockScan = async () => {
 setStockScanning(true);
 try {
 const res = await apiFetch<any>('/products/stock-scan', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 });
 if (res.ok && res.data) {
 showToast('success', `✅ Tarama tamamlandı: ${res.data.scanned} ürün, ${res.data.closed} kapatıldı, ${res.data.opened} açıldı`);
 fetchStockAlerts();
 } else {
 showToast('error', res.error?.message || 'Tarama başarısız');
 }
 } finally {
 setStockScanning(false);
 }
 };

 const handleStockConfigSave = async () => {
 if (!stockProdId) { showToast('warning', 'Ürün ID girin'); return; }
 setStockSaving(true);
 try {
 const res = await apiFetch<any>(`/products/${stockProdId}/stock-config`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 autoStockManagement: stockAutoMgmt,
 criticalStockLevel: stockCriticalLevel ? Number(stockCriticalLevel) : null,
 }),
 });
 if (res.ok) {
 showToast('success', '✅ Stok yapılandırması güncellendi');
 fetchStockAlerts();
 } else {
 showToast('error', res.error?.message || 'Güncelleme başarısız');
 }
 } finally {
 setStockSaving(false);
 }
 };

 const fetchStockAlerts = useCallback(async () => {
 setStockAlertsLoading(true);
 try {
 const res = await apiFetch<{ items: any[] }>('/products/stock-alerts?limit=20');
 if (res.ok && res.data) {
 setStockAlerts(res.data.items || []);
 }
 } finally {
 setStockAlertsLoading(false);
 }
 }, []);

 // Bulk tab açıldığında ürünleri getir
 useEffect(() => {
 if (activeTab === 'bulk') {
 fetchBulkProducts();
 fetchStockAlerts();
 }
 }, [activeTab, fetchBulkProducts, fetchStockAlerts]);

 // ============ API TEST ============
 const [testResults, setTestResults] = useState<Array<{name: string; ok: boolean; message: string}>>([]);
 const [testRunning, setTestRunning] = useState(false);

 const runApiTest = async () => {
 setTestRunning(true);
 setTestResults([]);
 const results: Array<{name: string; ok: boolean; message: string}> = [];

 const addResult = (name: string, ok: boolean, message: string) => {
 results.push({name, ok, message});
 setTestResults([...results]);
 };

 try {
 // Test 1: GET rules
 try {
 const r1 = await apiFetch<any>('/listing-v2/rules');
 if (r1.ok && r1.data?.items !== undefined) {
 addResult('GET /listing-v2/rules', true, `${r1.data.items.length} kural`);
 } else {
 addResult('GET /listing-v2/rules', false, `Status ${r1.status}: ${r1.error?.message}`);
 }
 } catch (e: any) { addResult('GET /listing-v2/rules', false, e.message); }

 // Test 2: POST create rule
 let ruleId: string | null = null;
 try {
 const r2 = await apiFetch<any>('/listing-v2/rules', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ marketplaceId: 'test-mp', minPrice: 0, maxPrice: 999999, applyVat: true, profitMargin: 75, rounding: '0.90', active: true, priority: 3 }),
 });
 if (r2.ok && r2.data?.item?.id) {
 ruleId = r2.data.item.id;
 addResult('POST /listing-v2/rules', true, `Rule ID: ${ruleId!.slice(0,8)}...`);
 } else {
 addResult('POST /listing-v2/rules', false, `Status ${r2.status}: ${r2.error?.message}`);
 }
 } catch (e: any) { addResult('POST /listing-v2/rules', false, e.message); }

 // Test 3: PUT update rule
 if (ruleId) {
 try {
 const r3 = await apiFetch<any>(`/listing-v2/rules/${ruleId}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ profitMargin: 80 }),
 });
 if (r3.ok) {
 addResult('PUT /listing-v2/rules/:id', true, 'profitMargin → 80%');
 } else {
 addResult('PUT /listing-v2/rules/:id', false, `Status ${r3.status}: ${r3.error?.message}`);
 }
 } catch (e: any) { addResult('PUT /listing-v2/rules/:id', false, e.message); }
 }

 // Test 4: POST calculate
 try {
 const r4 = await apiFetch<any>('/listing-v2/calculate', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ purchasePrice: 100, vatRate: 20, profitMargin: 75, rounding: '0.90', applyVat: true }),
 });
 if (r4.ok && r4.data?.finalPrice) {
 addResult('POST /listing-v2/calculate', true, `100TL -> ${r4.data.finalPrice.toFixed(2)}TL`);
 } else {
 addResult('POST /listing-v2/calculate', false, `Status ${r4.status}: ${r4.error?.message}`);
 }
 } catch (e: any) { addResult('POST /listing-v2/calculate', false, e.message); }

 // Test 5: GET price (her zaman 200 donmeli)
 try {
 const r5 = await apiFetch<any>('/listing-v2/price/test-id/test-mp');
 if (r5.ok && r5.data?.roundedPrice !== undefined) {
 addResult('GET /listing-v2/price/:id/:mp', true, `${r5.data.roundedPrice.toFixed(2)}TL (ruleType: ${r5.data.ruleType})`);
 } else {
 addResult('GET /listing-v2/price/:id/:mp', false, `Status ${r5.status} (200 bekleniyor)`);
 }
 } catch (e: any) { addResult('GET /listing-v2/price/:id/:mp', false, e.message); }

 // Test 6: GET logs
 try {
 const r6 = await apiFetch<any>('/listing-v2/logs');
 if (r6.ok && r6.data?.items !== undefined) {
 addResult('GET /listing-v2/logs', true, `${r6.data.items.length} kayit`);
 } else {
 addResult('GET /listing-v2/logs', false, `Status ${r6.status}: ${r6.error?.message}`);
 }
 } catch (e: any) { addResult('GET /listing-v2/logs', false, e.message); }

 // Test 7: DELETE rule
 if (ruleId) {
 try {
 const r7 = await apiFetch<any>(`/listing-v2/rules/${ruleId}`, { method: 'DELETE' });
 if (r7.ok) {
 addResult('DELETE /listing-v2/rules/:id', true, 'Silindi');
 } else {
 addResult('DELETE /listing-v2/rules/:id', false, `Status ${r7.status}: ${r7.error?.message}`);
 }
 } catch (e: any) { addResult('DELETE /listing-v2/rules/:id', false, e.message); }
 }

 // Test 8: GET rules no auth (401 beklenir)
 try {
 const r8 = await fetch('/listing-v2/rules');
 if (r8.status === 401) {
 addResult('GET /listing-v2/rules (no auth)', true, '401 Unauthorized');
 } else {
 addResult('GET /listing-v2/rules (no auth)', false, `Status: ${r8.status} (401 bekleniyor)`);
 }
 } catch (e: any) { addResult('GET /listing-v2/rules (no auth)', false, e.message); }

 } finally {
 setTestRunning(false);
 }
 };

 // ============ RENDER TABS ============
 const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
 { key: 'rules', label: 'Fiyat Kuralları', icon: '📋' },
 { key: 'calculator', label: 'Fiyat Hesaplama', icon: '🧮' },
 { key: 'bulk', label: 'Toplu Listeleme', icon: '🚀' },
 { key: 'logs', label: 'İşlem Geçmişi', icon: '📜' },
 { key: 'test', label: 'API Test', icon: '🧪' },
 ];

 const mpSelect = (value: string, onChange: (v: string) => void, includeAll = false) => (
 <select value={value} onChange={e => onChange(e.target.value)}
 className="select-theme px-3 py-2">
 {includeAll && <option value="">Tüm Pazaryerleri</option>}
 {!includeAll && <option value="">Pazaryeri Seçin</option>}
 {marketplaces.map(mp => (
 <option key={mp.id} value={mp.id}>{getMpIcon(mp.key)} {mp.name}</option>
 ))}
 </select>
 );

 return (
 <div className="space-y-4">
 {/* Tabs */}
 <div className="flex gap-1 flex-wrap rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1">
 {tabs.map(tab => (
 <button key={tab.key} onClick={() => setActiveTab(tab.key)}
 className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all ${ activeTab === tab.key ? 'bg-primary text-white shadow-lg shadow-primary/25 ' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50/50 dark:hover:bg-slate-800/20' }`}>
 <span>{tab.icon}</span>
 <span>{tab.label}</span>
 </button>
 ))}
 </div>

 {/* ======== FİYAT KURALLARI ======== */}
 {activeTab === 'rules' && (
 <div className="space-y-4">

  {/* AKIŞ GÖSTERİMİ */}
  <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
   {['Pazaryeri','XML Kaynağı','Fiyat Kuralı','Sonuç'].map((step, i) => (
    <React.Fragment key={step}>
     <div className="flex items-center gap-1.5 shrink-0">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${ i < 2 ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' }`}>{i + 1}</div>
      <span className={`text-xs font-medium ${ i < 2 ? 'text-current' : 'text-slate-400 dark:text-slate-500' }`}>{step}</span>
     </div>
     {i < 3 && <div className="text-slate-300 dark:text-slate-600 shrink-0">→</div>}
    </React.Fragment>
   ))}
  </div>

  {/* FİLTRE + BUTON */}
  <div className="flex items-center justify-between flex-wrap gap-2">
   <div className="flex items-center gap-2">
    {mpSelect(selectedMpId, (v) => { setSelectedMpId(v); }, true)}
    <select value={selectedXmlSourceId} onChange={e => setSelectedXmlSourceId(e.target.value)}
     className="select-theme px-3 py-2">
     <option value="">Tüm XML Kaynakları</option>
     {xmlSources.map(xs => (
      <option key={xs.id} value={xs.id}>{xs.name}</option>
     ))}
    </select>
    <span className="text-xs text-current">{rules.length} kural</span>
   </div>
   <button onClick={() => { resetRuleForm(); setShowRuleForm(true); }}
    className="btn-ghost px-4 py-2">
    ➕ Yeni Kural
   </button>
  </div>

 {/* YENİ KURAL FORMU */}
 {showRuleForm && (
  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 space-y-4">

   <div className="flex items-center justify-between">
    <h4 className="text-sm font-semibold text-current">
     {editingRule ? 'Kuralı Düzenle' : 'Yeni Fiyat Kuralı'}
    </h4>
   </div>

   {/* 1. KURALIN KAYNAĞI */}
   <div className="space-y-2">
    <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
     <div className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">1</div>
     Kuralın Kaynağı
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
     <div>
      <label className="block text-xs text-current mb-1">Pazaryeri</label>
      {mpSelect(ruleForm.marketplaceId || selectedMpId, (v) => setRuleForm({ ...ruleForm, marketplaceId: v }))}
     </div>
     <div>
      <label className="block text-xs text-current mb-1">XML Kaynağı</label>
      <select value={ruleForm.xmlSourceId}
       onChange={e => setRuleForm({ ...ruleForm, xmlSourceId: e.target.value })}
       className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">
       <option value="">Tüm XML Kaynakları</option>
       {xmlSources.map(xs => (
        <option key={xs.id} value={xs.id}>{xs.name}</option>
       ))}
      </select>
     </div>
    </div>
   </div>

   {/* 2. FİYAT HESABI */}
   <div className="space-y-2">
    <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
     <div className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">2</div>
     Fiyat Hesabı
    </div>
    <div className="pl-7 space-y-3">
     <div className="grid grid-cols-2 gap-3">
      <div>
       <label className="block text-xs text-current mb-1">Min. Fiyat (₺)</label>
       <input type="text" value={ruleForm.minPrice}
        onChange={e => setRuleForm({ ...ruleForm, minPrice: e.target.value })}
        placeholder="0"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
      <div>
       <label className="block text-xs text-current mb-1">Maks. Fiyat (₺)</label>
       <input type="text" value={ruleForm.maxPrice}
        onChange={e => setRuleForm({ ...ruleForm, maxPrice: e.target.value })}
        placeholder="999999"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
     </div>
     <div className="grid grid-cols-3 gap-3">
      <div>
       <label className="block text-xs text-current mb-1">Kâr Oranı (%)</label>
       <input type="text" value={ruleForm.profitMargin}
        onChange={e => setRuleForm({ ...ruleForm, profitMargin: e.target.value })}
        placeholder="0"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
      <div>
       <label className="block text-xs text-current mb-1">Sabit Ek Tutar (₺)</label>
       <input type="text" value={ruleForm.fixedAmount}
        onChange={e => setRuleForm({ ...ruleForm, fixedAmount: e.target.value })}
        placeholder="0"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
      <div>
       <label className="block text-xs text-current mb-1">Yuvarlama</label>
       <select value={ruleForm.rounding}
        onChange={e => setRuleForm({ ...ruleForm, rounding: e.target.value })}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">
        {ROUNDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
       </select>
      </div>
     </div>
     <div className="grid grid-cols-3 gap-3">
      <div>
       <label className="block text-xs text-current mb-1">Öncelik</label>
       <select value={ruleForm.priority}
        onChange={e => setRuleForm({ ...ruleForm, priority: e.target.value })}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">
        <option value="1">1 - Ürün Bazında</option>
        <option value="2">2 - Kategori Bazında</option>
        <option value="3">3 - Genel</option>
       </select>
      </div>
      <div>
       <label className="block text-xs text-current mb-1">Ürün ID</label>
       <input type="text" value={ruleForm.productId}
        onChange={e => setRuleForm({ ...ruleForm, productId: e.target.value })}
        placeholder="Boş = tümü"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
      <div>
       <label className="block text-xs text-current mb-1">Kategori ID</label>
       <input type="text" value={ruleForm.categoryId}
        onChange={e => setRuleForm({ ...ruleForm, categoryId: e.target.value })}
        placeholder="Boş = tümü"
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-3 py-2 text-sm text-current focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
      </div>
     </div>
     <div className="flex items-center gap-6">
      <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
       <input type="checkbox" checked={ruleForm.applyVat}
        onChange={e => setRuleForm({ ...ruleForm, applyVat: e.target.checked })}
        className="rounded border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-primary" />
       KDV Ekle
      </label>
      <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
       <input type="checkbox" checked={ruleForm.active}
        onChange={e => setRuleForm({ ...ruleForm, active: e.target.checked })}
        className="rounded border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-primary" />
       Aktif
      </label>
     </div>
    </div>
   </div>

   {/* 3. SONUÇ ÖNİZLEMESİ */}
   <div className="space-y-2">
    <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
     <div className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">3</div>
     Sonuç
    </div>
    <div className="pl-7 rounded-lg bg-slate-50 dark:bg-slate-800/30 p-3 space-y-2">
     <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Formül</div>
     <div className="text-sm text-current">
      KDV Dahil Alış × (1 + %{ruleForm.profitMargin || 0}/100) + {toNum(ruleForm.fixedAmount).toFixed(2)}₺
      {ruleForm.rounding !== 'none' ? ` → ${ROUNDING_OPTIONS.find(o => o.value === ruleForm.rounding)?.label || ruleForm.rounding} ile yuvarla` : ''}
     </div>
     <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium">Örnek:</span>
      <span>100₺ → {(() => {
       const price = 100 * (1 + toNum(ruleForm.profitMargin) / 100) + toNum(ruleForm.fixedAmount);
       const rnd = ruleForm.rounding;
       let final = price;
       if (rnd === '0.90') final = Math.round(price / 0.90) * 0.90;
       else if (rnd === '0.95') final = Math.round(price / 0.95) * 0.95;
       else if (rnd === '0.99') final = Math.round(price / 0.99) * 0.99;
       else if (rnd === 'nearest') final = Math.round(price);
       else if (rnd === 'ceil') final = Math.ceil(price);
       else if (rnd === 'floor') final = Math.floor(price);
       return final.toFixed(2);
      })()}₺</span>
     </div>
    </div>
   </div>

   {/* BUTONLAR */}
   <div className="flex gap-2 pt-1">
    <button onClick={handleSaveRule}
     className="btn-ghost px-5 py-2.5 font-medium">
     {editingRule ? 'Güncelle' : 'Kaydet'}
    </button>
    <button onClick={() => { setShowRuleForm(false); resetRuleForm(); }}
     className="btn-ghost px-4 py-2.5">
     İptal
    </button>
   </div>
  </div>
 )}

 {/* KURAL KARTLARI */}
 {loading ? (
 <div className="text-center py-8 text-current">Yükleniyor...</div>
 ) : rules.length === 0 ? (
 <div className="text-center py-16 text-current">
 <div className="text-4xl mb-2">📋</div>
 <div className="font-medium">Henüz fiyat kuralı bulunmuyor</div>
 <div className="text-xs mt-1 text-slate-500 dark:text-slate-400">Yeni kural eklemek için "➕ Yeni Kural" butonuna tıklayın</div>
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
  {rules.map(rule => {
   const mp = marketplaces.find(m => m.id === rule.marketplaceId);
   const xs = xmlSources.find(x => x.id === rule.xmlSourceId);
   const examplePrice = 100 * (1 + rule.profitMargin / 100) + rule.fixedAmount;
   return (
    <div key={rule.id} className={`rounded-xl border p-4 transition-all hover:shadow-md ${ rule.active ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50' : 'border-slate-200/50 dark:border-slate-800/30 bg-slate-50/50 dark:bg-slate-900/30 opacity-60' }`}>

     {/* ÜST SATIR: Pazaryeri + XML + Durum */}
     <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-2">
       <span className="text-lg">{mp ? getMpIcon(mp.key) : '🌐'}</span>
       <div>
        <div className="text-sm font-semibold text-current">{mp ? mp.name : 'Tanımsız'}</div>
        {xs ? (
         <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{xs.name}</span>
        ) : (
         <span className="text-xs text-slate-400 dark:text-slate-500">Tüm XML Kaynakları</span>
        )}
       </div>
      </div>
      {rule.active
       ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Aktif</span>
       : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">Pasif</span>
      }
     </div>

     {/* AKIŞ: Min–Max → Kâr → Sonuç */}
     <div className="space-y-2 mb-3">
      <div className="flex items-center gap-2 text-xs">
       <span className="text-slate-500 dark:text-slate-400 w-12 shrink-0">Aralık</span>
       <span className="text-current font-medium">{rule.minPrice}–{rule.maxPrice >= 999999 ? '∞' : rule.maxPrice}₺</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
       <span className="text-slate-500 dark:text-slate-400 w-12 shrink-0">Kâr</span>
       <span className="text-current font-medium">%{rule.profitMargin}{rule.fixedAmount > 0 ? ` + ${rule.fixedAmount}₺` : ''}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
       <span className="text-slate-500 dark:text-slate-400 w-12 shrink-0">Sonuç</span>
       <span className="text-primary font-bold">100₺ → {examplePrice.toFixed(2)}₺</span>
      </div>
     </div>

     {/* TEKNİK DETAYLAR (İkincil) */}
     <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800/50 pt-2 mb-3">
      {rule.productId && <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">Ürün</span>}
      {rule.categoryId && <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">Kategori</span>}
      {!rule.productId && !rule.categoryId && <span>Genel kural</span>}
      <span>·</span>
      <span>{ROUNDING_OPTIONS.find(o => o.value === rule.rounding)?.label || rule.rounding}</span>
      {rule.applyVat && <><span>·</span><span>KDV</span></>}
      <span>·</span>
      <span>Öncelik: {rule.priority}</span>
     </div>

     {/* İŞLEMLER */}
     <div className="flex gap-1">
      <button onClick={() => openEditRule(rule)}
       className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-current hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Düzenle</button>
      <button onClick={() => handleDeleteRule(rule.id)}
       className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">Sil</button>
     </div>
    </div>
   );
  })}
 </div>
 )}
 </div>
 )}

 {/* ======== FİYAT HESAPLAMA ======== */}
 {activeTab === 'calculator' && (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
   <div className="panel-theme p-4 space-y-3">
    <h3 className="text-sm font-semibold text-current">🧮 Fiyat Hesaplama</h3>
    <div className="grid grid-cols-2 gap-3">
     <div>
      <label className="block text-xs text-current mb-1">KDV Dahil Alış Fiyatı (₺)</label>
      <input type="text" value={calcForm.purchasePrice}
       onChange={e => setCalcForm({ ...calcForm, purchasePrice: e.target.value })}
       className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
     </div>
     <div>
      <label className="block text-xs text-current mb-1">Kar Oranı (%)</label>
      <input type="text" value={calcForm.profitMargin}
       onChange={e => setCalcForm({ ...calcForm, profitMargin: e.target.value })}
       className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
     </div>
    </div>
    <div>
     <label className="block text-xs text-current mb-1">Yuvarlama</label>
     <select value={calcForm.rounding}
      onChange={e => setCalcForm({ ...calcForm, rounding: e.target.value })}
      className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current">
      {ROUNDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
     </select>
    </div>
    <button onClick={handleCalculate}
     className="w-full btn-ghost px-4 py-2">
     🧮 Hesapla
    </button>
   </div>

 <div className="panel-theme p-4">
 <h3 className="text-sm font-semibold text-current mb-3">📊 Hesaplama Sonucu</h3>
 {calcResult ? (
 <div className="space-y-3">
 <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/60">
 <span className="text-sm text-current">KDV Dahil Fiyat</span>
 <span className="text-lg font-semibold text-current">{calcResult.vatIncluded.toFixed(2)} ₺</span>
 </div>
 <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/60">
 <span className="text-sm text-current">Yuvarlama Öncesi</span>
 <span className="text-lg font-semibold text-current">{calcResult.beforeRounding.toFixed(2)} ₺</span>
 </div>
 <div className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/60">
 <span className="text-sm text-current">Yuvarlama Sonrası</span>
 <span className="text-lg font-semibold text-current">{calcResult.finalPrice.toFixed(2)} ₺</span>
 </div>
 <div className="pt-2">
 <div className="text-xs text-current">
 Alış: {toNum(calcForm.purchasePrice).toFixed(2)} ₺ → 
 Satış: {calcResult.finalPrice.toFixed(2)} ₺
 (Kar: %{calcForm.profitMargin})
 </div>
 </div>
 </div>
 ) : (
 <div className="text-center py-12 text-current">
 <div className="text-4xl mb-2">🧮</div>
 <div className="text-sm">Fiyat hesaplamak için</div>
 <div className="text-xs mt-1">değerleri girip "Hesapla" butonuna tıklayın</div>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ======== TOPLU LİSTELEME (İyileştirilmiş) ======== */}
 {activeTab === 'bulk' && (
 <div className="space-y-4">
 {/* 3a. Pazaryeri Butonları (Kart Olarak) */}
 <div className="panel-theme p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-sm font-semibold text-current">🏪 Pazaryeri Seçimi</h3>
 <div className="flex gap-2">
 <button onClick={() => {
 const name = prompt('Pazaryeri adı (key):');
 if (name) showToast('info', `Pazaryeri ekleme: ${name} (manuel)`);
 }}
 className="btn-ghost px-3 py-1.5">
 ➕ Pazaryeri Ekle
 </button>
 {bulkMpId && (
 <button onClick={() => { setBulkMpId(''); setSelectedBulkIds(new Set()); }}
 className="btn-ghost px-3 py-1.5">
 🗑 Pazaryerini Kaldır
 </button>
 )}
 </div>
 </div>
 <div className="flex gap-2 flex-wrap">
 {marketplaces.length === 0 ? (
 <div className="text-xs text-current">Pazaryeri bulunamadı</div>
 ) : (
 marketplaces.map(mp => (
 <button key={mp.id} onClick={() => setBulkMpId(mp.id)}
 className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${ bulkMpId === mp.id ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current shadow-lg ' : 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current hover:border-current hover:text-current' }`}>
 <span className="text-lg">{getMpIcon(mp.key)}</span>
 <span>{mp.name}</span>
 {bulkMpId === mp.id && <span className="text-slate-700 dark:text-slate-300 text-xs">✓ Seçili</span>}
 </button>
 ))
 )}
 </div>
 </div>

 {/* 3b. Hazır Ürünler Tablosu */}
 <div className="panel-theme p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-sm font-semibold text-current">📦 Hazır Ürünler</h3>
 <div className="flex items-center gap-2">
 <span className="text-xs text-current">{bulkProducts.length} ürün</span>
 {selectedBulkIds.size > 0 && (
 <span className="text-xs text-current">{selectedBulkIds.size} seçili</span>
 )}
 <button onClick={handleSendSelectedProducts}
 disabled={selectedBulkIds.size === 0 || !bulkMpId || bulkSending}
 className="btn-ghost px-4 py-1.5 disabled:opacity-50">
 {bulkSending ? '⏳' : '🚀 Seçili Ürünleri Gönder'}
 </button>
 </div>
 </div>

 {bulkBlockReason && (
 <div className="rounded-lg bg-transparent border border-slate-200 dark:border-slate-800/60 p-3">
 <div className="text-xs text-current">{bulkBlockReason}</div>
 </div>
 )}

 {bulkProductsLoading ? (
 <div className="text-center py-8 text-current">Yükleniyor...</div>
 ) : bulkProducts.length === 0 ? (
 <div className="text-center py-8 text-current">
 <div className="text-3xl mb-1">📦</div>
 <div className="text-sm">Gönderime hazır ürün bulunamadı</div>
 <div className="text-xs mt-1">Kategori, marka ve şablon eşleşmesi tamamlanmış ürünler listelenir</div>
 </div>
 ) : (
 <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800/60">
 <table className="w-full text-sm">
 <thead className="bg-transparent sticky top-0">
 <tr>
 <th className="px-3 py-2.5 text-left w-10">
 <input type="checkbox"
 checked={bulkProducts.length > 0 && selectedBulkIds.size === bulkProducts.length}
 onChange={handleBulkToggleSelectAll}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 </th>
 <th className="px-3 py-2.5 text-left text-xs font-medium text-current">Ürün</th>
 <th className="px-3 py-2.5 text-left text-xs font-medium text-current">SKU</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">Stok</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">Fiyat</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {bulkProducts.map((p: any) => (
 <tr key={p.id}
 className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer ${selectedBulkIds.has(p.id) ? 'bg-transparent' : ''}`}
 onClick={() => handleBulkToggleSelect(p.id)}>
 <td className="px-3 py-2">
 <input type="checkbox"
 checked={selectedBulkIds.has(p.id)}
 onChange={() => handleBulkToggleSelect(p.id)}
 onClick={e => e.stopPropagation()}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 </td>
 <td className="px-3 py-2 text-current max-w-[250px] truncate">{p.title || p.xmlKey}</td>
 <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{p.sku || '-'}</td>
 <td className="px-3 py-2 text-right">
 <span className={`text-xs font-medium ${p.stock > 0 ? 'text-current' : 'text-current'}`}>
 {p.stock}
 </span>
 </td>
 <td className="px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">
 {p.salePrice ? `${Number(p.salePrice).toFixed(2)} ₺` : '-'}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* 3c. Stok Yönetim UI */}
 <div className="panel-theme p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-sm font-semibold text-current">📊 Stok Yönetimi</h3>
 <button onClick={() => setShowStockMgmt(!showStockMgmt)}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${ showStockMgmt ? 'bg-primary/10 text-primary' : 'bg-transparent text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}>
 {showStockMgmt ? '🟢 Stok Yönetimi Açık' : '⚪ Stok Yönetimi'}
 </button>
 </div>

 {showStockMgmt && (
 <div className="space-y-4 pt-2">
 {/* Stok Yapılandırma */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 rounded-lg bg-transparent">
 <div>
 <label className="block text-xs text-current mb-1">Ürün ID</label>
 <input type="text" value={stockProdId}
 onChange={e => setStockProdId(e.target.value)}
 placeholder="Ürün ID girin"
 className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
 </div>
 <div className="flex items-end pb-1.5">
 <label className="flex items-center gap-2 text-sm text-current cursor-pointer">
 <input type="checkbox" checked={stockAutoMgmt}
 onChange={e => setStockAutoMgmt(e.target.checked)}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current" />
 Otomatik Stok Yönetimi
 </label>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Kritik Stok Seviyesi</label>
 <input type="number" value={stockCriticalLevel}
 onChange={e => setStockCriticalLevel(e.target.value)}
 placeholder="Örn: 5"
 className="w-full rounded border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-2.5 py-1.5 text-sm text-current" />
 </div>
 <div className="flex items-end">
 <button onClick={handleStockConfigSave} disabled={stockSaving}
 className="w-full btn-ghost px-3 py-1.5 disabled:opacity-50">
 {stockSaving ? '⏳' : '💾 Yapılandırmayı Kaydet'}
 </button>
 </div>
 </div>

 {/* Stok Tara Butonu */}
 <div className="flex items-center gap-3">
 <button onClick={handleStockScan} disabled={stockScanning}
 className="btn-ghost px-4 py-2 disabled:opacity-50">
 {stockScanning ? '⏳ Taranıyor...' : '🔍 Stok Tara'}
 </button>
 <span className="text-xs text-current">
 Tüm ürünleri tara, kritik stoktakileri PASSIVE yap
 </span>
 </div>

 {/* Stok Alarm Listesi */}
 <div>
 <h4 className="text-sm font-medium text-current mb-2">🚨 Stok Alarmları</h4>
 {stockAlertsLoading ? (
 <div className="text-center py-4 text-xs text-slate-500 dark:text-slate-400">Yükleniyor...</div>
 ) : stockAlerts.length === 0 ? (
 <div className="text-center py-6 text-current">
 <div className="text-2xl mb-1">✅</div>
 <div className="text-xs">Kritik stokta ürün bulunmuyor</div>
 </div>
 ) : (
 <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800/60">
 <table className="w-full text-xs">
 <thead className="bg-transparent sticky top-0">
 <tr>
 <th className="px-2 py-1.5 text-left text-current">Ürün</th>
 <th className="px-2 py-1.5 text-left text-current">SKU</th>
 <th className="px-2 py-1.5 text-right text-current">Stok</th>
 <th className="px-2 py-1.5 text-right text-current">Min Stok</th>
 <th className="px-2 py-1.5 text-center text-current">Durum</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {stockAlerts.map((a: any, i: number) => (
 <tr key={a.id || i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
 <td className="px-2 py-1.5 text-current max-w-[200px] truncate">
 {a.title || a.xmlKey || a.id?.slice(0, 8)}
 </td>
 <td className="px-2 py-1.5 text-current">{a.sku || '-'}</td>
 <td className="px-2 py-1.5 text-right font-medium text-current">{a.stock}</td>
 <td className="px-2 py-1.5 text-right text-current">{a.minStock || 0}</td>
 <td className="px-2 py-1.5 text-center">
 <span className="px-1.5 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
 KRİTİK
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 )}
 </div>

 {/* Mevcut Listeleme Sonucu (Korundu) */}
 {bulkResult && (
 <div className="panel-theme p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h4 className="text-sm font-semibold text-current">📊 Listeleme Sonucu</h4>
 <div className="flex gap-3 text-sm">
 <span className="text-slate-700 dark:text-slate-300">✅ {bulkResult.successCount}</span>
 <span className="text-slate-700 dark:text-slate-300">❌ {bulkResult.errorCount}</span>
 </div>
 </div>
 {bulkResult.results.length > 0 && (
 <div className="max-h-60 overflow-y-auto">
 <table className="w-full text-xs">
 <thead className="bg-transparent">
 <tr>
 <th className="px-2 py-1.5 text-left text-current">Ürün</th>
 <th className="px-2 py-1.5 text-right text-current">Fiyat</th>
 <th className="px-2 py-1.5 text-center text-current">Durum</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {bulkResult.results.slice(0, 50).map((r: any, i: number) => (
 <tr key={r.productId || i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
 <td className="px-2 py-1.5 text-current truncate max-w-[200px]">
 {r.productTitle || r.productId?.slice(0, 8)}
 </td>
 <td className="px-2 py-1.5 text-right text-current">
 {r.calculation?.roundedPrice?.toFixed(2)} ₺
 </td>
 <td className="px-2 py-1.5 text-center">
 {r.status === 'SUCCESS'
 ? <span className="text-slate-700 dark:text-slate-300">✅</span>
 : <span className="text-slate-700 dark:text-slate-300" title={r.errorMessage}>❌</span>
 }
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}
 </div>
 )}

 {/* ======== İŞLEM GEÇMİŞİ ======== */}
 {activeTab === 'logs' && (
 <div className="space-y-3">
 <div className="flex items-center gap-2">
 {mpSelect(selectedMpId, (v) => { setSelectedMpId(v); }, true)}
 <span className="text-xs text-current">{logs.length} kayıt</span>
 </div>

 {loading ? (
 <div className="text-center py-8 text-current">Yükleniyor...</div>
 ) : logs.length === 0 ? (
 <div className="text-center py-12 text-current">
 <div className="text-4xl mb-2">📜</div>
 <div>Henüz işlem kaydı bulunmuyor</div>
 <div className="text-xs mt-1">Toplu listeleme yaptığınızda kayıtlar burada görünecek</div>
 </div>
 ) : (
 <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/60">
 <table className="w-full text-sm">
 <thead className="bg-transparent">
 <tr>
 <th className="px-3 py-2.5 text-left text-xs font-medium text-current">Tarih</th>
 <th className="px-3 py-2.5 text-left text-xs font-medium text-current">Pazaryeri</th>
 <th className="px-3 py-2.5 text-left text-xs font-medium text-current">Kural Tipi</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">Alış</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">KDV Dahil</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">Kar %</th>
 <th className="px-3 py-2.5 text-right text-xs font-medium text-current">Satış</th>
 <th className="px-3 py-2.5 text-center text-xs font-medium text-current">Durum</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {logs.map(log => {
 const mp = marketplaces.find(m => m.id === log.marketplaceId);
 return (
 <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
 <td className="px-3 py-2 text-xs text-current whitespace-nowrap">
 {new Date(log.createdAt).toLocaleString('tr-TR')}
 </td>
 <td className="px-3 py-2 text-current whitespace-nowrap">
 {mp ? `${getMpIcon(mp.key)} ${mp.name}` : log.marketplaceId.slice(0, 8)}
 </td>
 <td className="px-3 py-2 text-current">
 {RULE_TYPE_LABELS[log.ruleType] || log.ruleType}
 </td>
 <td className="px-3 py-2 text-right text-current">{log.purchasePrice.toFixed(2)} ₺</td>
 <td className="px-3 py-2 text-right text-current">{log.vatIncludedPrice.toFixed(2)} ₺</td>
 <td className="px-3 py-2 text-right text-current">{log.profitMargin}%</td>
 <td className="px-3 py-2 text-right text-current font-medium">
 {log.calculatedPrice.toFixed(2)} ₺
 </td>
 <td className="px-3 py-2 text-center">
 {log.status === 'SUCCESS'
 ? <span className="text-slate-700 dark:text-slate-300 text-lg">✅</span>
 : <span className="text-slate-700 dark:text-slate-300 text-lg" title={log.errorMessage || ''}>❌</span>
 }
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* ======== API TEST ======== */}
 {activeTab === 'test' && (
 <div className="space-y-4">
 <div className="panel-theme p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-sm font-semibold text-current">🧪 Listing Engine API Test</h3>
 <button onClick={runApiTest} disabled={testRunning}
 className="btn-ghost px-5 py-2 disabled:opacity-50">
 {testRunning ? '⏳ Test Ediliyor...' : '▶ Testi Çalıştır'}
 </button>
 </div>
 <p className="text-xs text-current">
 Tüm listing-v2 endpoint'lerini test eder. Her test için HTTP status ve yanıt bilgisi gösterilir.
 </p>
 </div>

 {testResults.length > 0 && (
 <div className="panel-theme p-4 space-y-2">
 <div className="flex items-center justify-between mb-2">
 <h4 className="text-sm font-semibold text-current">📊 Test Sonuçları</h4>
 <span className="text-xs text-current">
 {testResults.filter(r => r.ok).length}/{testResults.length} başarılı
 </span>
 </div>
 <div className="divide-y divide-">
 {testResults.map((r, i) => (
 <div key={i} className="flex items-start gap-3 py-2">
 <span className="mt-0.5 text-base">{r.ok ? '✅' : '❌'}</span>
 <div className="flex-1 min-w-0">
 <div className="text-sm text-current font-medium">{r.name}</div>
 <div className={`text-xs mt-0.5 ${r.ok ? 'text-current' : 'text-current'}`}>
 {r.message}
 </div>
 </div>
 </div>
 ))}
 </div>
 <div className="pt-2 text-center text-xs text-current">
 {testResults.every(r => r.ok)
 ? '✅ TÜM TESTLER BAŞARILI'
 : `❌ ${testResults.filter(r => !r.ok).length} test başarısız`}
 </div>
 </div>
 )}

 {!testRunning && testResults.length === 0 && (
 <div className="text-center py-12 text-current">
 <div className="text-4xl mb-2">🧪</div>
 <div className="text-sm">API testini çalıştırmak için</div>
 <div className="text-xs mt-1">"Testi Çalıştır" butonuna tıklayın</div>
 </div>
 )}
 </div>
 )}
 </div>
 );
}
