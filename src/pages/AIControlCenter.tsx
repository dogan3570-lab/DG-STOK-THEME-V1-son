// ==================== AI KONTROL MERKEZI V2.0 ====================
// DG STOK V5.0 - Tum AI saglayicilarini tek noktadan yonet
import React, { useEffect, useState, useCallback, Fragment } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

// ==================== TYPES ====================

interface AIProvider {
 id: string; name: string; enabled: boolean; priority: number;
 status: string; model: string | null; baseUrl: string | null;
 dailyTokenLimit: number; usedTokens: number; apiKeyEncrypted: string | null;
 lastCheck: string | null; estimatedCost: number;
 createdAt: string; updatedAt: string;
}

interface AIRequestLog {
 id: string; module: string; provider: string;
 promptTokens: number; completionTokens: number; totalTokens: number;
 duration: number; success: boolean; error: string | null;
 createdAt: string;
}

interface AIStats {
 period: string; totalRequests: number; successCount: number;
 errorCount: number; successRate: number; errorRate: number;
 avgDuration: number; totalTokens: number;
 providerDistribution: Record<string, { requests: number; success: number; error: number; tokens: number; avgDuration: number }>;
}

// ==================== PROVIDER METADATA (Hardcoded Maps) ====================

const PROVIDER_MODELS: Record<string, string[]> = {
 groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b', 'qwen-2.5-32b'],
 github: ['gpt-4o-mini', 'gpt-4o', 'Phi-3.5-mini-instruct', 'AI21-Jamba-1.5-Mini', 'Cohere-command-r'],
 gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
 openrouter: ['google/gemini-2.0-flash-001', 'google/gemini-2.5-flash', 'meta-llama/llama-4-maverick', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'mistralai/mistral-small'],
 deepseek: ['deepseek-chat', 'deepseek-reasoner'],
 openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o3-mini'],
 mistral: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
 together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'deepseek-ai/DeepSeek-V3'],
 cerebras: ['llama3.1-8b', 'llama3.1-70b', 'mixtral-8x7b'],
 fireworks: ['accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct'],
};

const PROVIDER_LOGOS: Record<string, string> = {
 groq: '', github: '', gemini: '', openrouter: '',
 deepseek: '', openai: '', mistral: '',
 together: '', cerebras: '', fireworks: '', mock: '',
};

const PROVIDER_PAID: Record<string, boolean> = {
 groq: false, github: false, gemini: false, openrouter: false,
 deepseek: true, openai: true, mistral: true,
 together: true, cerebras: true, fireworks: true, mock: false,
};

function getLogo(name: string) { return PROVIDER_LOGOS[name] || ''; }
function isPaid(name: string) { return PROVIDER_PAID[name] ?? false; }
function getModels(name: string) { return PROVIDER_MODELS[name] || []; }

// ==================== COMPONENT ====================

export default function AIControlCenter() {
 const [providers, setProviders] = useState<AIProvider[]>([]);
 const [logs, setLogs] = useState<AIRequestLog[]>([]);
 const [stats, setStats] = useState<AIStats | null>(null);
 const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState<'providers' | 'logs' | 'stats'>('providers');
 const [logPage, setLogPage] = useState(1);
 const [logTotal, setLogTotal] = useState(0);
 const [statsPeriod, setStatsPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

 const [editProviderId, setEditProviderId] = useState<string | null>(null);
 const [editForm, setEditForm] = useState({ apiKey: '', model: '', priority: 1, enabled: true });
 const [showKey, setShowKey] = useState<Record<string, boolean>>({});
 const [saving, setSaving] = useState(false);
 const [testing, setTesting] = useState<string | null>(null);
 const [testResults, setTestResults] = useState<Record<string, any>>({});

 // ==================== API CALLS ====================

 const fetchAll = useCallback(async () => {
 setLoading(true);
 try {
 const [pRes, lRes, sRes] = await Promise.all([
 apiFetch<{ items: AIProvider[] }>('/ai/providers'),
 apiFetch<{ items: AIRequestLog[]; total: number }>(`/ai/logs?page=${logPage}&limit=20`),
 apiFetch<AIStats>(`/ai/provider-stats?period=${statsPeriod}`),
 ]);
 if (pRes.ok && pRes.data) setProviders(pRes.data.items || []);
 if (lRes.ok && lRes.data) { setLogs(lRes.data.items || []); setLogTotal(lRes.data.total || 0); }
 if (sRes.ok && sRes.data) setStats(sRes.data);
 } catch { /* sessiz */ }
 finally { setLoading(false); }
 }, [logPage, statsPeriod]);

 useEffect(() => { fetchAll(); }, [fetchAll]);

 // ==================== PROVIDER ISLEMLERI ====================

 const handleSaveProvider = async (providerName: string) => {
 setSaving(true);
 try {
 const body: any = { name: providerName, priority: Number(editForm.priority), enabled: editForm.enabled };
 if (editForm.model) body.model = editForm.model;
 if (editForm.apiKey.trim()) body.apiKey = editForm.apiKey.trim();
 const r = await apiFetch('/ai/providers', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
 if (r.ok) { showToast('success', ` ${providerName} ayarlari kaydedildi`); setEditProviderId(null); fetchAll(); }
 else showToast('error', r.error?.message || 'Kaydetme basarisiz');
 } finally { setSaving(false); }
 };

 const handleDeleteProvider = async (name: string) => {
 if (!confirm(`${name} provider'ini silmek istediginize emin misiniz?`)) return;
 try {
 const r = await apiFetch(`/ai/providers/${name}`, { method: 'DELETE' });
 if (r.ok) { showToast('success', ` ${name} silindi`); fetchAll(); }
 else showToast('error', r.error?.message || 'Silme basarisiz');
 } catch { showToast('error', 'Silme basarisiz'); }
 };

 const handleToggleProvider = async (name: string) => {
 try {
 const r = await apiFetch('/ai/provider/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
 if (r.ok) { showToast('success', `${name} durumu guncellendi`); fetchAll(); }
 else showToast('error', r.error?.message || 'Guncelleme basarisiz');
 } catch { showToast('error', 'Guncelleme basarisiz'); }
 };

 const handleTestProvider = async (name: string) => {
 setTesting(name);
 setTestResults(prev => ({ ...prev, [name]: null }));
 try {
 const r = await apiFetch('/ai/provider/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
 if (r.ok && r.data) { setTestResults(prev => ({ ...prev, [name]: r.data })); showToast('success', ` ${name} baglantisi basarili`); }
 else { setTestResults(prev => ({ ...prev, [name]: { error: r.error?.message || 'Test basarisiz' } })); showToast('error', r.error?.message || 'Test basarisiz'); }
 } catch { setTestResults(prev => ({ ...prev, [name]: { error: 'Test sirasinda hata olustu' } })); }
 finally { setTesting(null); fetchAll(); }
 };

 const handleSeedProviders = async () => {
 try {
 const r = await apiFetch('/ai/providers/seed', { method: 'POST' });
 if (r.ok) { showToast('success', ' Provider\'lar basariyla olusturuldu'); fetchAll(); }
 else showToast('error', r.error?.message || 'Seed basarisiz');
 } catch { showToast('error', 'Seed basarisiz'); }
 };

 // ==================== HELPERS ====================

 const openEdit = (p: AIProvider) => {
 setEditProviderId(p.id);
 setEditForm({ apiKey: '', model: p.model || getModels(p.name)[0] || '', priority: p.priority, enabled: p.enabled });
 };

 const getStatusColor = (p: AIProvider) => {
 if (!p.enabled) return 'currentColor';
 if (p.status === 'healthy' || p.status === 'active') return 'currentColor';
 if (p.status === 'quota_exceeded' || p.status === 'rate_limited') return 'currentColor';
 if (p.status === 'error') return 'currentColor';
 return 'currentColor';
 };

 const getStatusLabel = (p: AIProvider) => {
 if (!p.enabled) return 'Pasif';
 if (p.status === 'healthy' || p.status === 'active') return 'Aktif';
 if (p.status === 'quota_exceeded') return 'Kota Doldu';
 if (p.status === 'rate_limited') return 'Limitli';
 if (p.status === 'error') return 'Hata';
 if (p.status === 'pending') return 'Bekliyor';
 return p.status;
 };

 const quotaPercent = (p: AIProvider) => p.dailyTokenLimit > 0 ? Math.round((p.usedTokens / p.dailyTokenLimit) * 100) : 0;
 const hasApiKey = (p: AIProvider) => p.apiKeyEncrypted && p.apiKeyEncrypted.length > 0;

 return (
 <div className="mx-auto max-w-7xl px-4 py-6">
 <div className="mb-6 flex items-center justify-between">
 <h1 className="text-[26px] font-extrabold tracking-tight" > AI Kontrol Merkezi V2</h1>
 <button onClick={handleSeedProviders} className="btn-ghost px-4 py-2 text-sm font-bold transition-all shadow-md">
  Seed Default Providers
 </button>
 </div>

 <div className="mb-6 flex justify-center gap-2">
 {(['providers', 'logs', 'stats'] as const).map(tab => (
 <button key={tab} onClick={() => setActiveTab(tab)}
 className={`rounded-xl px-6 py-2.5 text-sm font-bold transition-all ${activeTab === tab ? 'bg-primary text-white shadow-lg shadow-primary/25 ' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 '}`}>
 {tab === 'providers' && ' Providerlar'}{tab === 'logs' && ' AI Loglari'}{tab === 'stats' && ' Istatistikler'}
 </button>
 ))}
 </div>

 {loading ? (
 <div className="flex items-center justify-center gap-3 py-20 text-current"><span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" /><span>AI Kontrol Merkezi yukleniyor...</span></div>
 ) : (
 <>
 {activeTab === 'providers' && (
 <div className="space-y-3">
 {providers.length === 0 ? (
 <div className="py-16 text-center rounded-2xl border bg-transparent" >
 <div className="text-4xl mb-3"></div>
 <div className="text-sm font-semibold text-current mb-2">Henuz provider bulunamadi</div>
 <button onClick={handleSeedProviders} className="rounded-xl bg-transparent px-5 py-2 text-sm font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all"> Otomatik Olustur</button>
 </div>
 ) : (
 providers.map((p) => {
 const isEditing = editProviderId === p.id;
 const models = getModels(p.name);
 const testResult = testResults[p.name];
 const isTesting = testing === p.name;

 return (
 <div key={p.id} className="panel-theme overflow-hidden" >
 <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => openEdit(p)}>
 <div className="flex items-center gap-3 min-w-0 w-48">
 <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg">{getLogo(p.name)}</span>
 <div className="min-w-0">
 <div className="truncate font-bold text-sm flex items-center gap-1" >
 {p.name}
 {isPaid(p.name) && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full"></span>}
 </div>
 {p.lastCheck && <div className="text-[10px] text-current">Son kontrol: {new Date(p.lastCheck).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
 </div>
 </div>
 <div className="w-20 text-center">
 {hasApiKey(p) ? <span className="text-[10px] font-bold text-current bg-transparent px-2 py-0.5 rounded-full"> Var</span> : <span className="text-[10px] font-bold text-current bg-transparent px-2 py-0.5 rounded-full"> Yok</span>}
 </div>
 <div className="w-40 min-w-0"><span className="text-xs font-medium text-current truncate block">{p.model || ''}</span></div>
 <div className="w-14 text-center"><span className="text-xs font-bold text-current bg-transparent px-2 py-0.5 rounded-full">#{p.priority}</span></div>
 <div className="w-20 flex justify-center">
 <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold">
 <span className="h-1.5 w-1.5 rounded-full" style={{}} />{getStatusLabel(p)}
 </span>
 </div>
 <div className="w-28 min-w-0">
 <div className="mb-0.5 flex justify-between text-[10px]"><span className="text-slate-700 dark:text-slate-300">{p.usedTokens.toLocaleString('tr-TR')}</span><span className="text-slate-700 dark:text-slate-300">{p.dailyTokenLimit > 0 ? `${quotaPercent(p)}%` : ''}</span></div>
 <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, quotaPercent(p))}%` }} /></div>
 </div>
 <div className="flex-1" />
 <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
 <button onClick={() => handleTestProvider(p.name)} disabled={isTesting || !hasApiKey(p)} title={hasApiKey(p) ? 'Baglantiyi Test Et' : 'Once API Key girin'} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 transition-all">{isTesting ? '' : ' Test'}</button>
 <button onClick={() => handleToggleProvider(p.name)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all ${p.enabled ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 ' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 '}`}>{p.enabled ? 'Pasif' : 'Aktif'}</button>
 {p.name !== 'mock' && <button onClick={() => handleDeleteProvider(p.name)} className="rounded-lg px-2 py-1.5 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"></button>}
 </div>
 </div>

 {testResult && (
 <div className={`mx-5 mb-1 p-3 rounded-lg text-xs ${testResult.error ? 'bg-transparent border border-slate-200 dark:border-slate-800/60 ' : 'bg-transparent border border-slate-200 dark:border-slate-800/60 '}`}>
 {testResult.error ? <span className="text-slate-700 dark:text-slate-300"> {testResult.error}</span> : (
 <div className="flex flex-wrap gap-4">
 <span className="text-current font-bold"> {testResult.data?.message || 'API OK'}</span>
 {testResult.data?.latency && <span className="text-slate-700 dark:text-slate-300"> {testResult.data.latency}</span>}
 {testResult.data?.model && <span className="text-slate-700 dark:text-slate-300"> Model: {testResult.data.model}</span>}
 {testResult.data?.tokens !== undefined && <span className="text-slate-700 dark:text-slate-300"> {testResult.data.tokens} tokens</span>}
 </div>
 )}
 </div>
 )}

 {isEditing && (
 <div className="border-t bg-transparent px-5 py-4 space-y-3" >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
 <div>
 <label className="mb-1 block text-[10px] font-bold text-current uppercase">API Key</label>
 <div className="relative">
 <input type={showKey[p.name] ? 'text' : 'password'} value={editForm.apiKey} onChange={e => setEditForm(f => ({ ...f, apiKey: e.target.value }))} placeholder={p.name === 'mock' ? '(dahili)' : `${p.name.toUpperCase()}_API_KEY...`} disabled={p.name === 'mock'}
 className="w-full rounded-lg border bg-transparent px-3 py-2 pr-10 text-sm outline-none focus:border-current" />
 <button type="button" onClick={() => setShowKey(s => ({ ...s, [p.name]: !s[p.name] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-current hover:text-text"></button>
 </div>
 </div>
 <div>
 <label className="mb-1 block text-[10px] font-bold text-current uppercase">Model</label>
 <select value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))}
 className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-current" >
 {models.map(m => <option key={m} value={m}>{m}</option>)}
 {models.length === 0 && <option value={editForm.model}>{editForm.model}</option>}
 </select>
 </div>
 <div>
 <label className="mb-1 block text-[10px] font-bold text-current uppercase">Oncelik</label>
 <input type="number" min={1} max={999} value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: Math.max(1, Math.min(999, Number(e.target.value) || 1)) }))}
 className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-current" />
 </div>
 <div>
 <label className="mb-1 block text-[10px] font-bold text-current uppercase">Durum</label>
 <select value={editForm.enabled ? 'true' : 'false'} onChange={e => setEditForm(f => ({ ...f, enabled: e.target.value === 'true' }))}
 className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-current" >
 <option value="true"> Aktif</option><option value="false"> Pasif</option>
 </select>
 </div>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-current">{p.updatedAt && `Son guncelleme: ${new Date(p.updatedAt).toLocaleString('tr-TR')}`}</span>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setEditProviderId(null)} className="rounded-lg px-4 py-2 text-xs font-semibold text-current hover:bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Vazgec</button>
 <button type="button" onClick={() => handleSaveProvider(p.name)} disabled={saving} className="rounded-lg bg-transparent px-5 py-2 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50 transition-colors">{saving ? ' Kaydediliyor...' : ' Kaydet'}</button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
 })
 )}
 </div>
 )}

 {activeTab === 'logs' && (
 <div className="panel-theme overflow-hidden" >
 <div className="grid grid-cols-[130px_100px_100px_1fr_70px_70px_80px] gap-3 border-b px-5 py-3 text-xs font-bold text-current" >
 <span>Tarih</span><span>Provider</span><span>Modul</span><span>Hata</span><span className="text-center">Sure</span><span className="text-center">Token</span><span className="text-center">Durum</span>
 </div>
 {logs.map((log, i) => (
 <div key={log.id} className={`grid grid-cols-[130px_100px_100px_1fr_70px_70px_80px] items-center gap-3 border-b px-5 py-2.5 text-xs transition-colors hover:bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 ${i === logs.length - 1 ? 'border-b-0' : ''}`} >
 <span className="text-slate-700 dark:text-slate-300">{new Date(log.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
 <span className="truncate font-semibold" >{getLogo(log.provider)} {log.provider}</span>
 <span className="truncate text-current font-medium">{log.module}</span>
 <span className="truncate text-current text-[10px]">{log.error || ''}</span>
 <span className="text-center text-current">{log.duration}ms</span>
 <span className="text-center text-current">{log.totalTokens}</span>
 <span className="flex justify-center"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${log.success ? 'bg-primary/10 text-primary ' : 'bg-primary/10 text-primary '}`}>{log.success ? '' : ''}</span></span>
 </div>
 ))}
 {logs.length === 0 && <div className="py-16 text-center text-sm text-current">Henuz AI cagri log'u bulunamadi.</div>}
 {logTotal > 0 && (
 <div className="flex items-center justify-between border-t px-5 py-3" >
 <span className="text-xs text-current">Toplam: {logTotal} kayit | Sayfa {logPage}/{Math.max(1, Math.ceil(logTotal / 20))}</span>
 <div className="flex gap-1">
 <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage <= 1} className="rounded-md px-3 py-1 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30"> Onceki</button>
 <button onClick={() => setLogPage(p => p + 1)} disabled={logPage >= Math.ceil(logTotal / 20)} className="rounded-md px-3 py-1 text-xs font-bold text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-30">Sonraki </button>
 </div>
 </div>
 )}
 </div>
 )}

 {activeTab === 'stats' && (
 <div className="space-y-4">
 <div className="flex justify-center gap-2">
 {(['daily', 'weekly', 'monthly'] as const).map(period => (
 <button key={period} onClick={() => setStatsPeriod(period)} className={`rounded-xl px-4 py-1.5 text-xs font-bold transition-all ${statsPeriod === period ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 '}`}>
 {period === 'daily' && ' Gunluk'}{period === 'weekly' && ' Haftalik'}{period === 'monthly' && ' Aylik'}
 </button>
 ))}
 </div>
 {stats ? (
 <>
 <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
 {[
 { label: 'Toplam AI Cagrisi', value: stats.totalRequests.toLocaleString('tr-TR'), color: 'currentColor' },
 { label: 'Basari Orani', value: `%${stats.successRate}`, color: 'currentColor' },
 { label: 'Hata Orani', value: `%${stats.errorRate}`, color: 'currentColor' },
 { label: 'Ort. Sure', value: `${stats.avgDuration}ms`, color: 'currentColor' },
 { label: 'Toplam Token', value: stats.totalTokens.toLocaleString('tr-TR'), color: 'currentColor' },
 { label: 'Basarili', value: stats.successCount.toLocaleString('tr-TR'), color: 'currentColor' },
 { label: 'Hatali', value: stats.errorCount.toLocaleString('tr-TR'), color: 'currentColor' },
 { label: 'Provider Sayisi', value: providers.length.toString(), color: 'currentColor' },
 ].map(kpi => (
 <div key={kpi.label} className="panel-theme p-4" >
 <div className="text-xs font-semibold text-current">{kpi.label}</div>
 <div className="mt-1 text-xl font-extrabold" style={{}}>{kpi.value}</div>
 </div>
 ))}
 </div>
 {stats.providerDistribution && Object.keys(stats.providerDistribution).length > 0 && (
 <div className="panel-theme p-5" >
 <h3 className="mb-4 text-sm font-bold" >Provider Kullanim Dagilimi</h3>
 <div className="space-y-3">
 {Object.entries(stats.providerDistribution).sort(([, a], [, b]) => b.requests - a.requests).map(([name, data]) => {
 const maxReq = Math.max(...Object.values(stats.providerDistribution).map(d => d.requests), 1);
 return (
 <div key={name} className="space-y-1">
 <div className="flex items-center gap-3">
 <span className="w-24 truncate text-xs font-semibold" >{getLogo(name)} {name}</span>
 <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-transparent" style={{ width: `${Math.round((data.requests / maxReq) * 100)}%` }} /></div>
 <span className="w-32 text-right text-xs text-current">{data.requests} istek | {data.success}  | {data.error}  | {data.avgDuration}ms</span>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}
  </>
   ) : <div className="py-16 text-center text-sm text-current">Istatistikler yukleniyor...</div>}
   </div>
  )}
   </>
    )}
   </div>
   )
}

