// ==================== XML ENGINE V5 - VERİ KAYNAKLARI PANELİ ====================
// XML/JSON/CSV/Excel/FTP/SFTP veri toplama motoru yönetim paneli
// Kaynak yönetimi, import, log, test, mapping
// ============================================================================

import React, { useEffect, useState, useCallback } from 'react';

// ==================== TİPLER ====================

interface XmlSourceItem {
 id: string;
 name: string;
 company: string | null;
 sourceType: string;
 url: string | null;
 username: string | null;
 active: boolean;
 connectionStatus: string;
 productCount: number;
 lastRunAt: string | null;
 lastSuccessAt: string | null;
 lastError: string | null;
 lastRunStatus: string | null;
 lastRunDurationMs: number | null;
 lastNewProducts: number;
 lastUpdatedProducts: number;
 lastFailedProducts: number;
 scheduleIntervalMinutes: number;
 currency: string;
 vatRate: number;
}

interface ImportProgress {
 sourceId: string;
 status: string;
 total: number;
 processed: number;
 created: number;
 updated: number;
 failed: number;
 errors: string[];
}

interface ImportRun {
 id: string;
 sourceId: string;
 startedAt: string;
 finishedAt: string | null;
 status: string;
 totalProducts: number;
 newProducts: number;
 updatedProducts: number;
 failedProducts: number;
 durationMs: number | null;
}

interface XmlField {
 name: string;
 type: string;
 sample: string;
}

interface FieldMappingEditorProps {
 sourceId: string;
 onClose: () => void;
}

// ==================== YARDIMCILAR ====================

function timeAgo(dateStr: string): string {
 const diff = Date.now() - new Date(dateStr).getTime();
 const mins = Math.floor(diff / 60000);
 if (mins < 1) return 'az önce';
 if (mins < 60) return `${mins} dk önce`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours} saat önce`;
 return `${Math.floor(hours / 24)} gün önce`;
}

function formatDuration(ms: number | null): string {
 if (!ms) return '-';
 if (ms < 1000) return `${ms}ms`;
 if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
 return `${Math.floor(ms / 60000)}dk ${Math.floor((ms % 60000) / 1000)}s`;
}

function statusBadge(status: string) {
 const colors: Record<string, string> = {
 active: 'bg-primary/10 text-primary border-current',
 passive: 'bg-primary/10 text-primary border-current',
 error: 'bg-primary/10 text-primary border-current',
 syncing: 'bg-primary/10 text-primary border-current',
 unknown: 'bg-primary/10 text-primary border-current',
 completed: 'bg-primary/10 text-primary border-current',
 running: 'bg-primary/10 text-primary border-current',
 connected: 'bg-primary/10 text-primary border-current',
 auth_error: 'bg-primary/10 text-primary border-current',
 timeout: 'bg-primary/10 text-primary border-current',
 };
 const cls = colors[status.toLowerCase()] || colors.unknown;
 return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

// ==================== SOURCE TYPE ICON ====================

function sourceIcon(type: string) {
 const icons: Record<string, string> = {
 xml: '📄',
 json: '📋',
 csv: '📊',
 excel: '📗',
 ftp: '📁',
 sftp: '🔒',
 api: '🔌',
 manual: '✏️',
 };
 return icons[type.toLowerCase()] || '📄';
}

// ==================== ALAN EŞLEŞTİRME DÜZENLEYİCİSİ ====================

function FieldMappingEditor({ sourceId, onClose }: FieldMappingEditorProps) {
 const [fields, setFields] = useState<string[]>([]);
 const [mapping, setMapping] = useState<Record<string, string>>({});
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);

 const systemFields = [
 'title', 'description', 'detail', 'sku', 'barcode', 'stockCode',
 'stock', 'minStock', 'salePrice', 'purchasePrice', 'vatRate',
 'currency', 'brand', 'category', 'images', 'link', 'unit',
 ];

 useEffect(() => {
 const load = async () => {
 try {
 const [fieldsRes, mappingRes] = await Promise.all([
 fetch(`/xml-sources/${sourceId}/fields`),
 fetch(`/api/xml-engine/mapping/${sourceId}`),
 ]);
 if (fieldsRes.ok) {
 const d = await fieldsRes.json();
 setFields(d.fields || d.allTags || []);
 if (d.mapping) setMapping(d.mapping);
 }
 if (mappingRes.ok) {
 const d = await mappingRes.json();
 if (d.mapping && Object.keys(d.mapping).length > 0) {
 setMapping(prev => ({ ...prev, ...d.mapping }));
 }
 }
 } catch (err) {
 console.error('Field load error:', err);
 } finally {
 setLoading(false);
 }
 };
 load();
 }, [sourceId]);

 const saveMapping = async () => {
 setSaving(true);
 try {
 await fetch(`/api/xml-engine/mapping/${sourceId}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ mapping }),
 });
 onClose();
 } catch (err) {
 console.error('Save mapping error:', err);
 } finally {
 setSaving(false);
 }
 };

 if (loading) return <div className="text-xs text-current">Yükleniyor...</div>;

 return (
 <div className="mt-3 p-3 bg-transparent rounded-lg border border-slate-200 dark:border-slate-800/60">
 <h4 className="text-xs font-semibold text-current mb-3">Alan Eşleştirme</h4>
 <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
 {fields.filter(f => !['xmlKey', 'id'].includes(f.toLowerCase())).map(field => (
 <div key={field} className="flex items-center gap-2 text-[10px]">
 <span className="text-current w-24 truncate" title={field}>{field}</span>
 <span className="text-slate-700 dark:text-slate-300">→</span>
 <select
 value={mapping[field] || ''}
 onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
 className="flex-1 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded text-[10px] text-current px-1 py-0.5"
 >
 <option value="">— Eşleme —</option>
 {systemFields.map(sf => (
 <option key={sf} value={sf}>{sf}</option>
 ))}
 </select>
 </div>
 ))}
 </div>
 {fields.length === 0 && (
 <div className="text-[10px] text-current text-center py-2">XML alanları bulunamadı</div>
 )}
 <div className="flex gap-2 mt-3">
 <button onClick={saveMapping} disabled={saving}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary px-3 py-1 rounded">
 {saving ? 'Kaydediliyor...' : 'Kaydet'}
 </button>
 <button onClick={onClose}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-3 py-1 rounded">
 İptal
 </button>
 </div>
 </div>
 );
}

// ==================== YENİ KAYNAK DİYALOG ====================

function NewSourceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
 const [form, setForm] = useState({
 name: '',
 company: '',
 sourceType: 'xml',
 url: '',
 username: '',
 password: '',
 currency: 'TRY',
 vatRate: 20,
 scheduleIntervalMinutes: 60,
 });

 const create = async () => {
 if (!form.name) return;
 try {
 const res = await fetch('/xml-sources', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(form),
 });
 if (res.ok) {
 onCreated();
 onClose();
 }
 } catch (err) {
 console.error('Create source error:', err);
 }
 };

 return (
 <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
 <div className="bg-transparent rounded-xl border border-slate-200 dark:border-slate-800/60 p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
 <h3 className="text-sm font-semibold text-current mb-4">Yeni XML Kaynağı</h3>
 
 <div className="space-y-3">
 <div>
 <label className="text-[10px] text-current block mb-1">Kaynak Adı *</label>
 <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>

 <div>
 <label className="text-[10px] text-current block mb-1">Firma Adı</label>
 <input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>

 <div>
 <label className="text-[10px] text-current block mb-1">Kaynak Tipi</label>
 <select value={form.sourceType} onChange={e => setForm(p => ({ ...p, sourceType: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current">
 <option value="xml">XML</option>
 <option value="json">JSON</option>
 <option value="csv">CSV</option>
 <option value="excel">Excel</option>
 <option value="ftp">FTP</option>
 <option value="sftp">SFTP</option>
 </select>
 </div>

 <div>
 <label className="text-[10px] text-current block mb-1">URL / FTP Adresi</label>
 <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
 placeholder={form.sourceType === 'ftp' ? 'ftp://ftp.ornek.com/dosya.xml' : form.sourceType === 'sftp' ? 'sftp://sftp.ornek.com/dosya.xml' : 'https://ornek.com/urunler.xml'}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>

 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[10px] text-current block mb-1">Kullanıcı Adı</label>
 <input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>
 <div>
 <label className="text-[10px] text-current block mb-1">Şifre</label>
 <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>
 </div>

 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[10px] text-current block mb-1">Para Birimi</label>
 <select value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current">
 <option value="TRY">TRY</option>
 <option value="USD">USD</option>
 <option value="EUR">EUR</option>
 </select>
 </div>
 <div>
 <label className="text-[10px] text-current block mb-1">KDV %</label>
 <input type="number" value={form.vatRate} onChange={e => setForm(p => ({ ...p, vatRate: Number(e.target.value) }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>
 </div>

 <div>
 <label className="text-[10px] text-current block mb-1">Güncelleme Sıklığı (dk)</label>
 <input type="number" value={form.scheduleIntervalMinutes} onChange={e => setForm(p => ({ ...p, scheduleIntervalMinutes: Number(e.target.value) }))}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg px-3 py-2 text-xs text-current" />
 </div>
 </div>

 <div className="flex gap-2 mt-4">
 <button onClick={create} disabled={!form.name}
 className="flex-1 text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary px-3 py-2 rounded-lg">
 Oluştur
 </button>
 <button onClick={onClose}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-3 py-2 rounded-lg">
 İptal
 </button>
 </div>
 </div>
 </div>
 );
}

// ==================== ANA BİLEŞEN ====================

export default function XmlEnginePanel() {
 const [sources, setSources] = useState<XmlSourceItem[]>([]);
 const [imports, setImports] = useState<ImportProgress[]>([]);
 const [runs, setRuns] = useState<Record<string, ImportRun[]>>({});
 const [loading, setLoading] = useState(true);
 const [selectedSource, setSelectedSource] = useState<string | null>(null);
 const [showNewDialog, setShowNewDialog] = useState(false);
 const [mappingSource, setMappingSource] = useState<string | null>(null);
 const [testResult, setTestResult] = useState<any>(null);
 const [testContent, setTestContent] = useState('');
 const [showTestTool, setShowTestTool] = useState(false);
 const [globalStats, setGlobalStats] = useState<any>(null);

 const fetchData = useCallback(async () => {
 try {
 const [srcRes, impRes, statsRes] = await Promise.all([
 fetch('/xml-sources'),
 fetch('/api/xml-engine/progress'),
 fetch('/api/xml-engine/stats'),
 ]);

 if (srcRes.ok) {
 const d = await srcRes.json();
 setSources(d.items || []);
 }
 if (impRes.ok) {
 const d = await impRes.json();
 setImports(d.imports || []);
 }
 if (statsRes.ok) {
 const d = await statsRes.json();
 if (d.ok) setGlobalStats(d.stats);
 }
 } catch (err) {
 console.error('XML Engine fetch error:', err);
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => { fetchData(); const iv = setInterval(fetchData, 10000); return () => clearInterval(iv); }, [fetchData]);

 // Import başlat
 const startImport = async (sourceId: string) => {
 try {
 const res = await fetch(`/api/xml-engine/import/${sourceId}`, { method: 'POST' });
 const d = await res.json();
 if (d.ok) fetchData();
 } catch (err) {
 console.error('Import start error:', err);
 }
 };

 // Import iptal
 const cancelImport = async (sourceId: string) => {
 try {
 await fetch(`/api/xml-engine/cancel/${sourceId}`, { method: 'POST' });
 fetchData();
 } catch (err) {
 console.error('Cancel error:', err);
 }
 };

 // Kaynak test
 const testSource = async (sourceId: string) => {
 try {
 const res = await fetch(`/xml-sources/${sourceId}/test`, { method: 'POST' });
 const d = await res.json();
 fetchData();
 return d;
 } catch (err) {
 console.error('Test error:', err);
 }
 };

 // Import log'larını getir
 const loadRuns = async (sourceId: string) => {
 try {
 const res = await fetch(`/api/xml-engine/runs/${sourceId}?limit=15`);
 const d = await res.json();
 if (d.ok) setRuns(prev => ({ ...prev, [sourceId]: d.runs }));
 } catch (err) {
 console.error('Load runs error:', err);
 }
 };

 // XML test
 const runTest = async () => {
 if (!testContent.trim()) return;
 try {
 const res = await fetch('/api/xml-engine/test', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ content: testContent, sourceType: 'xml' }),
 });
 const d = await res.json();
 setTestResult(d);
 } catch (err) {
 console.error('Test error:', err);
 }
 };

 const activeImport = imports.find(i => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled');

 if (loading) {
 return (
 <div className="flex items-center justify-center min-h-[40vh]">
 <div className="animate-spin h-8 w-8 border-2 border-current border-t-transparent rounded-full" />
 </div>
 );
 }

 return (
 <div className="space-y-5">
 {/* Başlık */}
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div>
 <h1 className="text-xl font-semibold text-current">XML Veri Kaynakları V5</h1>
 <p className="text-sm text-current mt-0.5">
 {sources.length} kaynak · XML/JSON/CSV/Excel/FTP/SFTP desteği
 {globalStats && ` · Bugün ${globalStats.todayRuns} import`}
 </p>
 </div>
 <div className="flex gap-2">
 {activeImport && (
 <div className="flex items-center gap-2 text-xs text-current bg-transparent px-3 py-1.5 rounded-lg">
 <span className="animate-pulse">●</span>
 İşleniyor: {activeImport.processed}/{activeImport.total}
 </div>
 )}
 <button onClick={() => setShowTestTool(p => !p)}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-3 py-1.5 rounded-lg transition-colors">
 🧪 Test
 </button>
 <button onClick={() => setShowNewDialog(true)}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-3 py-1.5 rounded-lg transition-colors">
 + Yeni Kaynak
 </button>
 </div>
 </div>

 {/* Global İstatistikler */}
 {globalStats && (
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
 <div className="panel-theme p-3 text-center">
 <div className="text-lg font-semibold text-current">{globalStats.totalRuns}</div>
 <div className="text-[10px] text-current">Toplam Import</div>
 </div>
 <div className="panel-theme p-3 text-center">
 <div className="text-lg font-semibold text-current">{globalStats.totalCreated?.toLocaleString('tr-TR')}</div>
 <div className="text-[10px] text-current">Oluşturulan</div>
 </div>
 <div className="panel-theme p-3 text-center">
 <div className="text-lg font-semibold text-current">{globalStats.totalUpdated?.toLocaleString('tr-TR')}</div>
 <div className="text-[10px] text-current">Güncellenen</div>
 </div>
 <div className="panel-theme p-3 text-center">
 <div className="text-lg font-semibold text-current">{globalStats.totalFailed?.toLocaleString('tr-TR')}</div>
 <div className="text-[10px] text-current">Hatalı</div>
 </div>
 <div className="panel-theme p-3 text-center">
 <div className="text-lg font-semibold text-current">{globalStats.todayRuns}</div>
 <div className="text-[10px] text-current">Bugün</div>
 </div>
 </div>
 )}

 {/* Aktif Import Progress */}
 {activeImport && (
 <div className="panel-theme p-4">
 <div className="flex items-center justify-between mb-2">
 <span className="text-sm font-medium text-current">
 {sources.find(s => s.id === activeImport.sourceId)?.name || activeImport.sourceId.substring(0, 8)} import ediliyor
 </span>
 <button onClick={() => cancelImport(activeImport.sourceId)}
 className="text-xs text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">
 İptal
 </button>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full transition-all"
 style={{ width: `${activeImport.total > 0 ? (activeImport.processed / activeImport.total * 100) : 0}%` }} />
 </div>
 <div className="flex gap-4 mt-2 text-xs text-current">
 <span>✓ {activeImport.created} oluşturuldu</span>
 <span>↻ {activeImport.updated} güncellendi</span>
 <span>⚠ {activeImport.failed} hata</span>
 </div>
 {activeImport.errors.length > 0 && (
 <div className="mt-2 text-[10px] text-current max-h-16 overflow-y-auto">
 {activeImport.errors.slice(0, 5).map((e, i) => (
 <div key={i}>{e}</div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* Kaynak Listesi */}
 <div className="grid gap-4">
 {sources.length === 0 ? (
 <div className="text-center py-12 text-current">
 <div className="text-4xl mb-3">📄</div>
 <div className="text-sm">Henüz XML kaynağı bulunmuyor</div>
 <button onClick={() => setShowNewDialog(true)}
 className="mt-3 text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-4 py-2 rounded-lg">
 İlk Kaynağı Oluştur
 </button>
 </div>
 ) : (
 sources.map(source => (
 <div key={source.id}
 className="panel-theme p-4 backdrop-blur-sm">
 {/* Üst Kısım */}
 <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <div className="text-2xl">{sourceIcon(source.sourceType)}</div>
 <div>
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-current">{source.name}</span>
 {statusBadge(source.active ? source.connectionStatus || 'active' : 'passive')}
 <span className="text-[10px] text-current uppercase">{source.sourceType}</span>
 </div>
 {source.company && <div className="text-xs text-current">{source.company}</div>}
 </div>
 </div>
 <div className="flex items-center gap-1 flex-wrap">
 <button onClick={() => testSource(source.id)}
 className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary px-2 py-1 rounded transition-colors">
 Test
 </button>
 <button onClick={() => { setMappingSource(mappingSource === source.id ? null : source.id); }}
 className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary px-2 py-1 rounded transition-colors">
 {mappingSource === source.id ? 'Kapat' : 'Eşleme'}
 </button>
 <button onClick={() => { setSelectedSource(selectedSource === source.id ? null : source.id); loadRuns(source.id); }}
 className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary px-2 py-1 rounded transition-colors">
 {selectedSource === source.id ? 'Gizle' : 'Log'}
 </button>
 <button onClick={() => startImport(source.id)}
 disabled={activeImport?.sourceId === source.id}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary px-3 py-1.5 rounded-lg transition-colors">
 {activeImport?.sourceId === source.id ? 'İşleniyor...' : 'İçe Aktar'}
 </button>
 </div>
 </div>

 {/* İstatistikler */}
 <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
 <div>
 <div className="text-lg font-semibold text-current">{source.productCount.toLocaleString('tr-TR')}</div>
 <div className="text-[10px] text-current">Ürün</div>
 </div>
 <div>
 <div className="text-lg font-semibold text-current">{source.lastNewProducts || 0}</div>
 <div className="text-[10px] text-current">Yeni</div>
 </div>
 <div>
 <div className="text-lg font-semibold text-current">{source.lastUpdatedProducts || 0}</div>
 <div className="text-[10px] text-current">Güncelleme</div>
 </div>
 <div>
 <div className="text-lg font-semibold text-current">{source.lastFailedProducts || 0}</div>
 <div className="text-[10px] text-current">Hata</div>
 </div>
 <div>
 <div className="text-lg font-semibold text-current">{formatDuration(source.lastRunDurationMs)}</div>
 <div className="text-[10px] text-current">Süre</div>
 </div>
 <div>
 <div className="text-lg font-semibold text-current">{source.scheduleIntervalMinutes}dk</div>
 <div className="text-[10px] text-current">Periyot</div>
 </div>
 </div>

 {/* Alt Bilgi */}
 <div className="flex items-center justify-between flex-wrap mt-3 text-[10px] text-current gap-1">
 <span>Para: {source.currency} | KDV: %{source.vatRate}</span>
 {source.lastRunAt && <span>Son çalışma: {timeAgo(source.lastRunAt)}</span>}
 {source.lastSuccessAt && <span>Başarılı: {timeAgo(source.lastSuccessAt)}</span>}
 {source.lastError && <span className="text-slate-700 dark:text-slate-300" title={source.lastError}>⚠ {source.lastError.substring(0, 40)}</span>}
 {source.url && <span className="truncate max-w-[200px]" title={source.url}>{source.url}</span>}
 </div>

 {/* Alan Eşleştirme */}
 {mappingSource === source.id && (
 <FieldMappingEditor sourceId={source.id} onClose={() => setMappingSource(null)} />
 )}

 {/* Detay: Import Log'ları */}
 {selectedSource === source.id && (
 <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <h4 className="text-xs font-semibold text-current mb-2">Import Geçmişi</h4>
 {runs[source.id]?.length > 0 ? (
 <div className="space-y-1 max-h-48 overflow-y-auto">
 {runs[source.id].map(run => (
 <div key={run.id} className="flex items-center justify-between text-xs text-current bg-transparent rounded px-3 py-1.5">
 <div className="flex items-center gap-3">
 {statusBadge(run.status)}
 <span>{new Date(run.startedAt).toLocaleString('tr-TR')}</span>
 </div>
 <div className="flex gap-3">
 <span className="text-slate-700 dark:text-slate-300">+{run.newProducts}</span>
 <span className="text-slate-700 dark:text-slate-300">~{run.updatedProducts}</span>
 <span className="text-slate-700 dark:text-slate-300">!{run.failedProducts}</span>
 <span className="text-slate-700 dark:text-slate-300">{formatDuration(run.durationMs)}</span>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="text-xs text-current text-center py-3">Henüz import kaydı yok</div>
 )}
 </div>
 )}
 </div>
 ))
 )}
 </div>

 {/* XML Test Aracı */}
 {showTestTool && (
 <div className="panel-theme p-4">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-sm font-semibold text-current">🧪 XML Test Aracı</h3>
 <button onClick={() => setShowTestTool(false)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">Kapat</button>
 </div>
 <textarea
 value={testContent}
 onChange={e => setTestContent(e.target.value)}
 placeholder="XML/JSON/CSV içeriğini yapıştırın ve Parse Et butonuna tıklayın..."
 rows={6}
 className="w-full bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg p-3 text-xs text-current font-mono resize-none"
 />
 <div className="flex gap-2 mt-2">
 <button onClick={runTest}
 className="text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current px-3 py-1.5 rounded-lg transition-colors">
 Parse Et
 </button>
 </div>
 {testResult && (
 <div className="mt-3 p-3 bg-transparent rounded-lg">
 <div className="flex items-center gap-3 text-xs mb-2">
 {testResult.ok !== false ? (
 <span className="text-slate-700 dark:text-slate-300">✓ {testResult.total} ürün bulundu</span>
 ) : (
 <span className="text-slate-700 dark:text-slate-300">⚠ Hata: {testResult.error}</span>
 )}
 {testResult.errors?.length > 0 && (
 <span className="text-slate-700 dark:text-slate-300">⚠ {testResult.errors.length} uyarı</span>
 )}
 </div>
 {testResult.sample?.length > 0 && (
 <pre className="text-[10px] text-current overflow-x-auto max-h-60 overflow-y-auto">
 {JSON.stringify(testResult.sample, null, 2)}
 </pre>
 )}
 </div>
 )}
 </div>
 )}

 {/* Yeni Kaynak Diyaloğu */}
 {showNewDialog && (
 <NewSourceDialog
 onClose={() => setShowNewDialog(false)}
 onCreated={fetchData}
 />
 )}
 </div>
 );
}
