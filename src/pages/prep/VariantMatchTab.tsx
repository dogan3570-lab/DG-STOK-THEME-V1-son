// ==================== VARYANT ESLESTIRME V3.1 ====================
// DG STOK V5.0 - Gorsel birebir tasarim:
// 3 adimli stepper (yesil/mor/lavanta), renkli noktali varyant listesi,
// hucre kaplayan badge'ler, dairesel ilerleme + ozet sayac,
// alt aksiyon butonlari + AI Onerileri kutusu.
// NOT: Backend API'leri korunmustur (variants CRUD / xml-variants /
// stats / bulk-match / auto-detect / unmatched-products).
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useMarketplace } from '../../context/MarketplaceContext';
import { showToast } from '../../components/ui/Toast';

// ==================== TIPLER ====================

interface VariantRecord { id: string; name: string; value: string; product?: { id: string; title: string | null; xmlKey: string } | null; }
interface DetectedVariant { name: string; value: string; confidence: number; }
interface XmlVariantItem { productId: string; productName: string; xmlKey: string; detectedVariants: DetectedVariant[]; }
interface VariantStats { totalVariants: number; matchedProducts: number; unmatchedProducts: number; }
type RowStatus = 'matched' | 'ai' | 'required' | 'manual';
interface VariantValueRow { key: string; name: string; value: string; productCount: number; status: RowStatus; productIds: string[]; confidence?: number; }
type StepKey = 1 | 2 | 3;

// ==================== RENK HARITASI ====================

const COLOR_MAP: Record<string, string> = {
  'kırmızı': '#ef4444', 'kirmizi': '#ef4444', 'mavi': '#3b82f6', 'siyah': '#1e293b',
  'beyaz': '#f8fafc', 'sarı': '#eab308', 'sari': '#eab308', 'yeşil': '#22c55e', 'yesil': '#22c55e',
  'mor': '#8b5cf6', 'turuncu': '#f97316', 'pembe': '#ec4899', 'gri': '#6b7280',
  'lacivert': '#1e3a5f', 'bordo': '#7f1d1d', 'bej': '#d4a574', 'kahverengi': '#78350f',
  'krem': '#fef3c7', 'füme': '#6b7280', 'fume': '#6b7280', 'altın': '#f59e0b', 'altin': '#f59e0b',
  'gümüş': '#9ca3af', 'gumus': '#9ca3af', 'turkuaz': '#14b8a6', 'metalik': '#94a3b8',
};

function dotColor(name: string, value: string): string {
  if (name === 'Renk') return COLOR_MAP[value.toLocaleLowerCase('tr-TR')] || '#94a3b8';
  if (name === 'Beden') return '#3b82f6';
  if (name === 'Numara') return '#8b5cf6';
  return '#94a3b8';
}

const STATUS_ORDER: Record<RowStatus, number> = { matched: 0, ai: 1, required: 2, manual: 3 };
const NAME_ORDER: Record<string, number> = { Renk: 0, Beden: 1, Numara: 2 };

// ==================== ANA BILESEN ====================

export default function VariantMatchTab() {
 const { marketplaceId, marketplaces, selectMarketplace } = useMarketplace();
 const [variantRecords, setVariantRecords] = useState<VariantRecord[]>([]);
 const [xmlVariantItems, setXmlVariantItems] = useState<XmlVariantItem[]>([]);
 const [stats, setStats] = useState<VariantStats | null>(null);
 const [unmatchedTotal, setUnmatchedTotal] = useState(0);
 const [loading, setLoading] = useState(true);
 const [step, setStep] = useState<StepKey>(1);
 const [aiRunning, setAiRunning] = useState(false);
 const [bulkRunning, setBulkRunning] = useState(false);
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

 const fetchAll = useCallback(async () => {
 setLoading(true);
 try {
 const [varRes, xmlRes, statsRes, unmatchedRes] = await Promise.all([
  apiFetch<{ items: VariantRecord[]; total: number }>('/variants?limit=1000'),
 apiFetch<{ items: XmlVariantItem[] }>('/variants/xml-variants'),
 apiFetch<VariantStats>('/variants/stats'),
 apiFetch<{ items: Array<{ id: string }>; total: number }>('/variants/unmatched-products?limit=500'),
 ]);
 if (varRes.ok && varRes.data) setVariantRecords(varRes.data.items || []);
 if (xmlRes.ok && xmlRes.data) setXmlVariantItems(xmlRes.data.items || []);
 if (statsRes.ok && statsRes.data) setStats(statsRes.data);
 if (unmatchedRes.ok && unmatchedRes.data) setUnmatchedTotal(unmatchedRes.data.total || 0);
 } finally { setLoading(false); }
 }, []);

 useEffect(() => { fetchAll(); }, [fetchAll]);

 const rows = useMemo<VariantValueRow[]>(() => {
 const result: VariantValueRow[] = [];
 const matchedKeys = new Set<string>();
 const matchedGroups = new Map<string, { name: string; value: string; productIds: Set<string> }>();
 for (const v of variantRecords) {
 const key = `${v.name}:${v.value}`;
 matchedKeys.add(key);
 const g = matchedGroups.get(key) || { name: v.name, value: v.value, productIds: new Set<string>() };
 if (v.product?.id) g.productIds.add(v.product.id);
 matchedGroups.set(key, g);
 }
 for (const [key, g] of matchedGroups) {
 result.push({ key, name: g.name, value: g.value, productCount: g.productIds.size, status: 'matched', productIds: [...g.productIds] });
 }

 const detectedGroups = new Map<string, { name: string; value: string; productIds: Set<string>; maxConf: number }>();
 for (const item of xmlVariantItems) {
 for (const d of item.detectedVariants || []) {
 const key = `${d.name}:${d.value}`;
 if (matchedKeys.has(key)) continue;
 const g = detectedGroups.get(key) || { name: d.name, value: d.value, productIds: new Set<string>(), maxConf: 0 };
 g.productIds.add(item.productId);
 g.maxConf = Math.max(g.maxConf, d.confidence || 0);
 detectedGroups.set(key, g);
 }
 }
 for (const [key, g] of detectedGroups) {
 result.push({ key, name: g.name, value: g.value, productCount: g.productIds.size, status: g.maxConf >= 80 ? 'ai' : 'required', productIds: [...g.productIds], confidence: g.maxConf });
 }

 const detectedProductIds = new Set(xmlVariantItems.map((i) => i.productId));
 const undetectedCount = Math.max(0, unmatchedTotal - detectedProductIds.size);
 if (undetectedCount > 0) {
 result.push({ key: '__manual__', name: 'Varyant', value: '(Tespit Edilemedi)', productCount: undetectedCount, status: 'manual', productIds: [] });
 }

 return result.sort((a, b) => {
 const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
 if (so !== 0) return so;
 const no = (NAME_ORDER[a.name] ?? 9) - (NAME_ORDER[b.name] ?? 9);
 if (no !== 0) return no;
 return a.value.localeCompare(b.value, 'tr');
 });
 }, [variantRecords, xmlVariantItems, unmatchedTotal]);

 const visibleRows = useMemo(() => {
 if (step === 2) return rows.filter((r) => r.status === 'ai');
 if (step === 3) return rows.filter((r) => r.status === 'required' || r.status === 'manual');
 return rows;
 }, [rows, step]);

 const matchedProducts = stats?.matchedProducts ?? 0;
 const unmatchedProducts = stats?.unmatchedProducts ?? unmatchedTotal;
 const percent = matchedProducts + unmatchedProducts > 0 ? Math.round((matchedProducts / (matchedProducts + unmatchedProducts)) * 100) : 0;

 const aiPendingProducts = useMemo(() => {
 const s = new Set<string>();
 for (const r of rows) if (r.status === 'ai') for (const id of r.productIds) s.add(id);
 return s.size;
 }, [rows]);

 const manualRow = rows.find((r) => r.status === 'manual');
 const manualNeeded = (manualRow?.productCount || 0) + rows.filter((r) => r.status === 'required').length;
 const aiCount = rows.filter((r) => r.status === 'ai').length;

 const handleApproveRow = async (row: VariantValueRow) => {
 if (!requireMarketplace()) return;
 const matches = row.productIds.map((pid) => ({ productId: pid, variants: [{ name: row.name, value: row.value }] }));
 if (matches.length === 0) return;
 const r = await apiFetch<{ totalCreated: number; message: string }>('/variants/bulk-match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matches, marketplaceId }),
 });
 if (r.ok) { showToast('success', `✅ "${row.name}: ${row.value}" eşleştirildi (${row.productIds.length} ürün)`); fetchAll(); }
 else { showToast('error', r.error?.message || 'Eşleştirme başarısız'); }
 };

 const handleMatchAll = async () => {
 if (!requireMarketplace()) return;
 const matches = xmlVariantItems.filter((i) => (i.detectedVariants || []).length > 0).map((i) => ({
 productId: i.productId, variants: i.detectedVariants.map((d) => ({ name: d.name, value: d.value })),
 }));
 if (matches.length === 0) { showToast('warning', 'Eşleştirilecek tespit edilmiş varyant bulunamadı.'); return; }
 setBulkRunning(true);
 try {
 const r = await apiFetch<{ totalCreated: number; totalProducts: number; message: string }>('/variants/bulk-match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matches, marketplaceId }),
 });
 if (r.ok && r.data) { showToast('success', `✅ ${r.data.message || `${r.data.totalCreated} varyant eşleştirildi`}`); fetchAll(); }
 else { showToast('error', r.error?.message || 'Toplu eşleştirme başarısız'); }
 } finally { setBulkRunning(false); }
 };

 const handleAiMatch = async () => {
 if (!requireMarketplace()) return;
 setAiRunning(true);
 try {
 const r = await apiFetch<{ totalDetected: number; totalProductsWithVariants: number; totalScanned: number; message: string }>('/variants/auto-detect', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketplaceId }),
 });
 if (r.ok && r.data) { showToast('success', `🤖 ${r.data.message || `${r.data.totalDetected} varyant tespit edildi`}`); setStep(2); fetchAll(); }
 else { showToast('error', r.error?.message || 'AI eşleştirme başarısız'); }
 } finally { setAiRunning(false); }
 };

 const handleManualApply = async (name: string, value: string) => {
 if (!requireMarketplace()) return;
 const r = await apiFetch<{ items: Array<{ id: string }> }>('/variants/unmatched-products?limit=500');
 if (!r.ok || !r.data) { showToast('error', 'Ürünler alınamadı'); return; }
 const detectedIds = new Set(xmlVariantItems.map((i) => i.productId));
 const targetIds = (r.data.items || []).map((p) => p.id).filter((id) => !detectedIds.has(id));
 if (targetIds.length === 0) { showToast('warning', 'Uygulanacak ürün bulunamadı'); return; }
 const matches = targetIds.map((pid) => ({ productId: pid, variants: [{ name, value }] }));
 const res = await apiFetch<{ totalCreated: number; message: string }>('/variants/bulk-match', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matches, marketplaceId }),
 });
 if (res.ok) { showToast('success', `✅ "${name}: ${value}" ${targetIds.length} ürüne uygulandı`); fetchAll(); }
 else { showToast('error', res.error?.message || 'Uygulama başarısız'); }
 };

 const steps: Array<{ key: StepKey; label: string; count?: number; tone: 'green' | 'purple' | 'neutral' }> = [
 { key: 1, label: '1. Otomatik Eşleşme', tone: 'green' },
 { key: 2, label: '2. AI Eşleştirme', count: aiCount, tone: 'purple' },
 { key: 3, label: '3. Manuel Eşleştirme', count: manualNeeded, tone: 'neutral' },
 ];

 return (
 <div className="relative">
 <h1 className="mb-6 pt-1 text-center text-[26px] font-extrabold tracking-tight" >Varyant Eşleştirme</h1>

 {/* ====== TEDARIKCI XML + PAZARYERI SECIM BAR ====== */}
 <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
 <select value={xmlSupplierId} onChange={e => setXmlSupplierId(e.target.value)}
 className="rounded-xl border border-current bg-secondary/5 px-4 py-2 text-sm font-medium text-current min-w-[200px]">
 <option value="">📦 Tedarikci / XML Seciniz...</option>
 {xmlSources.map(xs => <option key={xs.id} value={xs.id}>{xs.name}</option>)}
 </select>
 <select value={marketplaceId} onChange={e => selectMarketplace(e.target.value)}
 className="rounded-xl border border-current bg-secondary/5 px-4 py-2 text-sm font-medium text-current min-w-[200px]">
 <option value="">🛒 Pazaryeri Seciniz...</option>
 {marketplaces.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
 </select>
 </div>

 <div className="rounded-[28px] border p-5 shadow-card backdrop-blur-xl sm:p-7 bg-transparent border-current">
 {(!xmlSupplierId || !marketplaceId) && (
 <div className="flex items-center gap-3 p-3 my-4 bg-transparent border border-current rounded-xl text-current text-sm">
 <span className="text-lg">🚨</span>
 <span className="font-medium">İşleme devam etmek için lütfen yukarıdan <b>Tedarikçi (XML)</b> ve <b>Pazaryeri</b> seçiniz.</span>
 </div>
 )}
 <div className="mb-6 flex items-stretch justify-center">
 {steps.map((s, i) => {
 const active = step === s.key;
 return (
 <button key={s.key} type="button" onClick={() => setStep(s.key)}
 className={`relative px-7 py-3 text-sm font-bold transition-all duration-200 ${ active ? s.tone === 'green' ? 'bg-transparent text-current font-medium ' : s.tone === 'purple' ? 'bg-gradient-to-br from-[transparent] to-[transparent] text-current' : 'bg-gradient-to-br from-[transparent] to-[transparent] text-[transparent]' : 'bg-[transparent] text-[transparent] ' }`}
 style={{
 minWidth: '205px',
 clipPath: i === 0 ? 'polygon(12px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 12px 100%, 0 100%, 0 0)' : 'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)',
 boxShadow: active ? s.tone === 'green' ? '0 4px 12px -2px transparent' : '0 6px 18px -4px transparent' : 'none',
 marginLeft: i === 0 ? 0 : '-10px', zIndex: active ? 2 : 1}}>
 {s.label}
 {s.count !== undefined && s.count > 0 && (
 <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
 style={{}}>{s.count}</span>
 )}
 </button>
 );
 })}
 </div>

 <div className="flex flex-col gap-4 xl:flex-row">
 <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border bg-transparent shadow-soft" >
 <div className="grid grid-cols-[minmax(0,4fr)_minmax(0,4fr)_minmax(0,5fr)] px-6 py-4 bg-gradient-to-b from-[transparent] to-[transparent]">
 <div className="text-sm font-bold" style={{}}>XML Ürün Varyantları</div>
 <div className="text-sm font-bold" style={{}}>Eşleştirme Durumu</div>
 <div className="text-sm font-bold" style={{}}>Pazaryeri Varyantları</div>
 </div>

 {loading ? (
 <div className="flex items-center justify-center gap-3 py-16 text-current">
 <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
 <span className="text-sm">Varyantlar yükleniyor...</span>
 </div>
 ) : visibleRows.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16 text-center">
 <span className="mb-3 text-4xl">{step === 1 ? '📭' : '🎉'}</span>
 <p className="text-sm font-medium text-current">
 {step === 1 && 'Varyant bulunamadı. Önce XML kaynağından ürün aktarın.'}
 {step === 2 && 'AI önerisi bekleyen varyant yok.'}
 {step === 3 && 'Manuel eşleştirme gereken varyant kalmadı.'}
 </p>
 </div>
 ) : (
 <div className="divide-y divide-border/50" style={{ maxHeight: '430px', overflowY: 'auto' }}>
 {visibleRows.map((row) => (
 <VariantRow key={row.key} row={row} onApprove={() => handleApproveRow(row)} onManualApply={handleManualApply} />
 ))}
 </div>
 )}
 </div>

 <div className="flex w-full shrink-0 flex-col items-center gap-4 xl:w-56">
 <div className="rounded-full bg-transparent p-1.5 shadow-card" ><ProgressRing percent={percent} /></div>
 <div className="w-full overflow-hidden rounded-2xl border bg-transparent shadow-soft" >
 <SummaryRow icon="✅" iconBg="transparent" label="Tam Eşleşti" value={matchedProducts} color="currentColor" />
 <SummaryRow icon="🤖" iconBg="transparent" label="AI ile Eşleşti" value={aiPendingProducts} color="currentColor" borderTop />
 <SummaryRow icon="🔧" iconBg="transparent" label="Manuel Gereken" value={manualNeeded} color="currentColor" borderTop />
 </div>
 </div>
 </div>

 <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
 <button type="button" onClick={handleMatchAll} disabled={!marketplaceId || bulkRunning} className="btn-green !rounded-2xl !px-8 !py-3.5 !text-[15px]">
 {bulkRunning ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Eşleştiriliyor...</> : <>✓ Tümünü Eşleştir</>}
 </button>
 <button type="button" onClick={handleAiMatch} disabled={!marketplaceId || aiRunning} className="btn-purple !rounded-2xl !px-8 !py-3.5 !text-[15px]">
 {aiRunning ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />AI Çalışıyor...</> : <>⚙️ AI ile Eşleştir</>}
 </button>
 <button type="button" onClick={() => setStep(3)} className="btn-neutral !rounded-2xl !px-8 !py-3.5 !text-[15px]">🔧 Manuel Eşleştir</button>
 </div>
 </div>

 <div className="mt-5 flex justify-end">
 <div className="w-full rounded-2xl border bg-transparent p-4 shadow-soft lg:w-96" >
 <h3 className="mb-2.5 text-sm font-bold" >💡 AI Önerileri</h3>
 <ul className="space-y-2 text-xs" >
 {aiCount > 0 && (
 <li className="flex items-start gap-2">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />
 {aiCount} varyant değeri için AI önerisi hazır — satırdaki ✓ Onayla ile tek tıkla uygulayın.
 </li>
 )}
 {manualNeeded > 0 && (
 <li className="flex items-start gap-2">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />
 {manualNeeded} kayıt eşleşme bekliyor — "AI ile Eşleştir" otomatik tespiti çalıştırır.
 </li>
 )}
 {rows.filter((r) => r.status === 'required').length > 0 && (
 <li className="flex items-start gap-2">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />
 Düşük güvenli tespitlerde pazaryeri karşılığını düzenleyip ✓ Eşleştir'e basın.
 </li>
 )}
 {aiCount === 0 && manualNeeded === 0 && (
 <li className="flex items-start gap-2">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />
 Tüm varyantlar eşleşti. Yeni XML ürünleri geldiğinde öneriler burada listelenir.
 </li>
 )}
 <li className="flex items-start gap-2">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{}} />
 Renk ve beden değerleri pazaryeri kurallarına göre otomatik normalize edilir.
 </li>
 </ul>
 </div>
 </div>
 {/* ====== MERKEZI PAZARYERI UYARISI ====== */}
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

// ==================== VARYANT SATIRI ====================

function VariantRow({ row, onApprove, onManualApply }: { row: VariantValueRow; onApprove: () => void; onManualApply: (name: string, value: string) => void; }) {
 const [editValue, setEditValue] = useState(row.status === 'manual' ? '' : row.value);
 const [editName, setEditName] = useState('Renk');
 const dot = dotColor(row.name, row.value);

 return (
 <div className="grid grid-cols-[minmax(0,4fr)_minmax(0,4fr)_minmax(0,5fr)] items-stretch transition-colors">
 <div className="flex min-w-0 items-center gap-2.5 px-6 py-4">
 <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-sm" style={{}} />
 <div className="min-w-0">
 <div className="truncate text-sm font-semibold" title={`${row.name}: ${row.value}`}>{row.value}</div>
 <div className="text-[10px] text-current">{row.name} • {row.productCount} ürün</div>
 </div>
 </div>

 {row.status === 'matched' && (
 <div className="flex items-center gap-2.5 px-5" style={{}}>
 <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-transparent/30 text-[11px] font-bold text-text">✓</span>
 <span className="text-sm font-bold text-text">Tam Eşleşti</span>
 </div>
 )}
 {row.status === 'ai' && (
 <div className="flex items-center gap-2.5 px-5" style={{}}>
 <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs text-text shadow-sm" style={{}}>🤖</span>
 <div>
 <div className="text-sm font-bold" style={{}}>AI Eşleşmesi Önerisi</div>
 {row.confidence != null && <div className="text-[10px]" style={{}}>Güven: %{row.confidence}</div>}
 </div>
 </div>
 )}
 {row.status === 'required' && (
 <div className="flex items-center gap-2.5 px-5" style={{}}>
 <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-text shadow-sm" style={{}}>!</span>
 <div>
 <div className="text-sm font-bold" style={{}}>AI Eşleşme Yok</div>
 <div className="text-[11px]" style={{}}>Düşük güven — doğrulama gerekli</div>
 </div>
 </div>
 )}
 {row.status === 'manual' && (
 <div className="flex items-center gap-2.5 px-5" style={{}}>
 <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-text shadow-sm" style={{}}>👤</span>
 <div>
 <div className="text-sm font-bold" style={{}}>Manuel Eşleştir</div>
 <div className="text-[11px]" style={{}}>Otomatik tespit yapılamadı</div>
 </div>
 </div>
 )}

 <div className="flex min-w-0 items-center gap-2 px-6 py-4">
 {row.status === 'matched' && (
 <>
 <span className="inline-flex min-w-[64px] items-center rounded-lg bg-transparent px-3 py-2 text-sm font-semibold shadow-inner" >{row.value}</span>
 <span className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-text shadow-sm" style={{}}>Tam Eşleşti</span>
 </>
 )}
 {row.status === 'ai' && (
 <>
 <span className="inline-flex min-w-[64px] items-center rounded-lg bg-transparent px-3 py-2 text-sm font-semibold shadow-inner border border-current text-current">{row.value}</span>
 <button type="button" onClick={onApprove} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-text shadow-sm transition-all hover:brightness-110" style={{}} title="AI önerisini onayla ve eşleştir">✓ Onayla</button>
 </>
 )}
 {row.status === 'required' && (
 <>
 <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Pazaryeri karşılığı..."
 className="w-32 rounded-lg bg-transparent px-3 py-2 text-sm font-semibold outline-none transition-all focus:ring-2" />
 <button type="button" onClick={() => { if (!editValue.trim()) { showToast('warning', 'Pazaryeri karşılığını yazın'); return; } onApprove(); }}
 className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-text shadow-sm transition-all hover:brightness-110" style={{}} title="Girilen değerle eşleştir">✓ Eşleştir</button>
 </>
 )}
 {row.status === 'manual' && (
 <>
 <select value={editName} onChange={(e) => setEditName(e.target.value)} className="rounded-lg bg-transparent px-2.5 py-2 text-xs font-semibold outline-none" >
 <option value="Renk">Renk</option><option value="Beden">Beden</option><option value="Numara">Numara</option>
 </select>
 <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Değer..."
 className="w-24 rounded-lg bg-transparent px-3 py-2 text-sm font-semibold outline-none" />
 <button type="button" onClick={() => { if (!editValue.trim()) { showToast('warning', 'Varyant değeri yazın'); return; } onManualApply(editName, editValue.trim()); }}
 className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition-all hover:brightness-110" style={{}} title={`${row.productCount} ürüne uygula`}>🔧 Uygula</button>
 </>
 )}
 </div>
 </div>
 );
}

// ==================== OZET SATIRI ====================

function SummaryRow({ icon, iconBg, label, value, color, borderTop = false }: { icon: string; iconBg: string; label: string; value: number; color: string; borderTop?: boolean; }) {
 return (
 <div className="flex items-center justify-between px-4 py-3" style={borderTop ? { borderTop: '1px solid currentColor' } : undefined}>
 <div className="flex items-center gap-2">
 <span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] text-text" style={{}}>{icon}</span>
 <span className="text-xs font-semibold !text-current">{label}</span>
 </div>
 <span className="text-sm font-extrabold !text-current">{value.toLocaleString('tr-TR')}</span>
 </div>
 );
}

// ==================== DAIRESEL ILERLEME ====================

function ProgressRing({ percent }: { percent: number }) {
 const size = 118; const stroke = 11; const r = (size - stroke) / 2 - 2; const c = 2 * Math.PI * r;
 const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100);

 return (
 <div className="relative" style={{ width: size, height: size }}>
 <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
 <defs>
 <linearGradient id="ringGradVar" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="currentColor" /><stop offset="100%" stopColor="currentColor" />
 </linearGradient>
 </defs>
 <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} />
 <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={percent > 0 ? 'url(#ringGradVar)' : 'transparent'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className="text-[26px] font-extrabold leading-none tracking-tight" style={{}}>%{percent}</span>
 <span className="mt-1 text-xs font-semibold" style={{}}>Eşleşti</span>
 </div>
 </div>
 );
}
