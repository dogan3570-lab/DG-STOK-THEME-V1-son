import React, { useEffect, useState } from 'react';

interface AutomationRule {
 id: string;
 name: string;
 type: string;
 triggerType: string;
 triggerConfig: string | null;
 actionType: string;
 actionConfig: string | null;
 active: boolean;
 schedule: string | null;
 marketplaceId: string | null;
 lastRunAt: string | null;
 lastSuccessAt: string | null;
 lastError: string | null;
 createdAt: string;
 updatedAt: string;
}

const AUTOMATION_TYPES: Record<string, string> = {
 xml_sync: 'XML Senkronizasyon',
 price_update: 'Fiyat Güncelleme',
 stock_update: 'Stok Güncelleme',
 order_sync: 'Sipariş Senkronizasyon',
 cargo_sync: 'Kargo Senkronizasyon',
 notification: 'Bildirim Gönderme',
};

const TRIGGER_TYPES: Record<string, string> = {
 schedule: 'Zamanlayıcı',
 webhook: 'Webhook',
 cron: 'Cron İfadesi',
 event: 'Olay Tabanlı',
};

const ACTION_TYPES: Record<string, string> = {
 sync_xml: 'XML Senkronize Et',
 update_price: 'Fiyat Güncelle',
 update_stock: 'Stok Güncelle',
 sync_order: 'Siparişleri Senkronize Et',
 send_notification: 'Bildirim Gönder',
};

export default function Automation() {
 const [rules, setRules] = useState<AutomationRule[]>([]);
 const [loading, setLoading] = useState(true);
 const [showModal, setShowModal] = useState(false);
 const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
 const [showLogs, setShowLogs] = useState(false);
 const [logs, setLogs] = useState<any[]>([]);
 const [logsLoading, setLogsLoading] = useState(false);
 const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

 const [form, setForm] = useState({
 name: '',
 type: 'xml_sync',
 triggerType: 'schedule',
 actionType: 'sync_xml',
 active: true,
 schedule: '*/60 * * * *',
 triggerConfig: '',
 actionConfig: '',
 marketplaceId: '',
 });

 const showToast = (type: 'success' | 'error', message: string) => {
 setToast({ type, message });
 setTimeout(() => setToast(null), 3000);
 };

 const fetchRules = async () => {
 try {
 setLoading(true);
 const res = await fetch('/api/automation');
 const data = await res.json();
 setRules(data.items || []);
 } catch (err) {
 console.error('Failed to fetch automation rules:', err);
 } finally {
 setLoading(false);
 }
 };

 const fetchLogs = async (ruleId?: string) => {
 try {
 setLogsLoading(true);
 const url = ruleId ? `/api/automation/logs?ruleId=${ruleId}` : '/api/automation/logs';
 const res = await fetch(url);
 const data = await res.json();
 setLogs(data.items || []);
 } catch (err) {
 console.error('Failed to fetch logs:', err);
 } finally {
 setLogsLoading(false);
 }
 };

 useEffect(() => {
 fetchRules();
 }, []);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 try {
 const body = {
 ...form,
 triggerConfig: form.triggerConfig ? JSON.parse(form.triggerConfig) : {},
 actionConfig: form.actionConfig ? JSON.parse(form.actionConfig) : {},
 marketplaceId: form.marketplaceId || null,
 };

 const url = editingRule ? `/api/automation/${editingRule.id}` : '/api/automation';
 const method = editingRule ? 'PUT' : 'POST';

 const res = await fetch(url, {
 method,
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });

 if (!res.ok) throw new Error('İşlem başarısız');

 showToast('success', editingRule ? 'Kural güncellendi' : 'Kural oluşturuldu');
 setShowModal(false);
 setEditingRule(null);
 resetForm();
 fetchRules();
 } catch (err) {
 showToast('error', err instanceof Error ? err.message : 'Bir hata oluştu');
 }
 };

 const handleToggle = async (rule: AutomationRule) => {
 try {
 const res = await fetch(`/api/automation/${rule.id}/toggle`, { method: 'POST' });
 if (!res.ok) throw new Error('Durum değiştirilemedi');
 showToast('success', `${rule.name} ${rule.active ? 'durduruldu' : 'başlatıldı'}`);
 fetchRules();
 } catch (err) {
 showToast('error', err instanceof Error ? err.message : 'Bir hata oluştu');
 }
 };

 const handleRun = async (rule: AutomationRule) => {
 try {
 const res = await fetch(`/api/automation/${rule.id}/run`, { method: 'POST' });
 if (!res.ok) throw new Error('Çalıştırılamadı');
 showToast('success', `"${rule.name}" manuel olarak çalıştırıldı`);
 fetchRules();
 } catch (err) {
 showToast('error', err instanceof Error ? err.message : 'Bir hata oluştu');
 }
 };

 const handleDelete = async (rule: AutomationRule) => {
 if (!window.confirm(`"${rule.name}" kuralını silmek istediğinize emin misiniz?`)) return;
 try {
 const res = await fetch(`/api/automation/${rule.id}`, { method: 'DELETE' });
 if (!res.ok) throw new Error('Silinemedi');
 showToast('success', 'Kural silindi');
 fetchRules();
 } catch (err) {
 showToast('error', err instanceof Error ? err.message : 'Bir hata oluştu');
 }
 };

 const openEdit = (rule: AutomationRule) => {
 setEditingRule(rule);
 setForm({
 name: rule.name,
 type: rule.type,
 triggerType: rule.triggerType,
 actionType: rule.actionType,
 active: rule.active,
 schedule: rule.schedule || '*/60 * * * *',
 triggerConfig: rule.triggerConfig || '',
 actionConfig: rule.actionConfig || '',
 marketplaceId: rule.marketplaceId || '',
 });
 setShowModal(true);
 };

 const resetForm = () => {
 setForm({
 name: '',
 type: 'xml_sync',
 triggerType: 'schedule',
 actionType: 'sync_xml',
 active: true,
 schedule: '*/60 * * * *',
 triggerConfig: '',
 actionConfig: '',
 marketplaceId: '',
 });
 };

 const openLogs = (rule?: AutomationRule) => {
 setShowLogs(true);
 fetchLogs(rule?.id);
 };

 const getTypeBadge = (type: string) => {
 const colors: Record<string, string> = {
 xml_sync: 'bg-primary/10 text-primary',
 price_update: 'bg-primary/10 text-primary',
 stock_update: 'bg-primary/10 text-primary',
 order_sync: 'bg-primary/10 text-primary',
 cargo_sync: 'bg-primary/10 text-primary',
 notification: 'bg-primary/10 text-primary',
 };
 return colors[type] || 'bg-primary/10 text-primary';
 };

 return (
 <div className="space-y-6">
 {/* Toast */}
 {toast && (
 <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${ toast.type === 'success' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>
 {toast.message}
 </div>
 )}

 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-bold text-current">Otomasyon</h1>
 <p className="text-sm text-current">Otomatik görevleri ve zamanlanmış işlemleri yönetin</p>
 </div>
 <div className="flex gap-3">
 <button
 onClick={() => openLogs()}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-4 py-2 text-sm font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 📋 İşlem Geçmişi
 </button>
 <button
 onClick={() => { setEditingRule(null); resetForm(); setShowModal(true); }}
 className="rounded-lg bg-transparent px-4 py-2 text-sm font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 + Yeni Kural
 </button>
 </div>
 </div>

 {/* Stats Cards */}
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <div className="panel-theme p-4">
 <div className="text-sm text-current">Toplam Kural</div>
 <div className="mt-1 text-2xl font-bold text-current">{rules.length}</div>
 </div>
 <div className="panel-theme p-4">
 <div className="text-sm text-current">Aktif Kurallar</div>
 <div className="mt-1 text-2xl font-bold text-current">{rules.filter(r => r.active).length}</div>
 </div>
 <div className="panel-theme p-4">
 <div className="text-sm text-current">Pasif Kurallar</div>
 <div className="mt-1 text-2xl font-bold text-current">{rules.filter(r => !r.active).length}</div>
 </div>
 <div className="panel-theme p-4">
 <div className="text-sm text-current">XML Senkronizasyon</div>
 <div className="mt-1 text-2xl font-bold text-current">{rules.filter(r => r.type === 'xml_sync').length}</div>
 </div>
 </div>

 {/* Rules List */}
 <div className="panel-theme">
 <div className="border-b border-slate-100 dark:border-slate-800/60 p-4">
 <h2 className="text-lg font-semibold text-current">Otomasyon Kuralları</h2>
 </div>

 {loading ? (
 <div className="flex items-center justify-center p-12">
 <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent" />
 </div>
 ) : rules.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-12 text-current">
 <span className="text-4xl mb-3">⚙️</span>
 <p className="text-lg font-medium">Henüz otomasyon kuralı bulunmuyor</p>
 <p className="mt-1 text-sm">Yeni bir kural ekleyerek otomatik işlemleri başlatın</p>
 </div>
 ) : (
 <div className="divide-y divide-">
 {rules.map((rule) => (
 <div key={rule.id} className="flex items-center justify-between p-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
 <div className="flex items-center gap-4 flex-1">
 {/* Status indicator */}
 <div className={`h-3 w-3 rounded-full ${rule.active ? 'bg-transparent' : 'bg-transparent'}`} />

 <div className="flex-1">
 <div className="flex items-center gap-2">
 <span className="font-medium text-current">{rule.name}</span>
 <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getTypeBadge(rule.type)}`}>
 {AUTOMATION_TYPES[rule.type] || rule.type}
 </span>
 </div>
 <div className="mt-1 flex items-center gap-3 text-xs text-current">
 <span>Tetikleyici: {TRIGGER_TYPES[rule.triggerType] || rule.triggerType}</span>
 <span>İşlem: {ACTION_TYPES[rule.actionType] || rule.actionType}</span>
 {rule.schedule && <span>⏱ {rule.schedule}</span>}
 {rule.lastRunAt && (
 <span>Son çalışma: {new Date(rule.lastRunAt).toLocaleString('tr-TR')}</span>
 )}
 </div>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <button
 onClick={() => handleRun(rule)}
 className="rounded-lg px-3 py-1.5 text-xs font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 title="Manuel Çalıştır"
 >
 ▶ Çalıştır
 </button>
 <button
 onClick={() => handleToggle(rule)}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${ rule.active ? 'text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20' : 'text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20' }`}
 >
 {rule.active ? '⏸ Durdur' : '▶ Başlat'}
 </button>
 <button
 onClick={() => openEdit(rule)}
 className="rounded-lg px-3 py-1.5 text-xs font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 ✏️
 </button>
 <button
 onClick={() => handleDelete(rule)}
 className="rounded-lg px-3 py-1.5 text-xs font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 🗑
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Add/Edit Modal */}
 {showModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
 <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl">
 <div className="mb-4 flex items-center justify-between">
 <h3 className="text-lg font-semibold text-current">
 {editingRule ? 'Kuralı Düzenle' : 'Yeni Otomasyon Kuralı'}
 </h3>
 <button onClick={() => setShowModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">✕</button>
 </div>

 <form onSubmit={handleSubmit} className="space-y-4">
 <div>
 <label className="mb-1 block text-sm font-medium text-current">Kural Adı</label>
 <input
 type="text"
 value={form.name}
 onChange={(e) => setForm({ ...form, name: e.target.value })}
 className="w-full input-theme px-3 py-2 focus:border-current focus:outline-none"
 placeholder="Örn: Günlük XML Senkronizasyonu"
 required
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="mb-1 block text-sm font-medium text-current">Otomasyon Tipi</label>
 <select
 value={form.type}
 onChange={(e) => setForm({ ...form, type: e.target.value })}
 className="w-full select-theme px-3 py-2 focus:border-current focus:outline-none"
 >
 {Object.entries(AUTOMATION_TYPES).map(([key, label]) => (
 <option key={key} value={key}>{label}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="mb-1 block text-sm font-medium text-current">Tetikleyici Tipi</label>
 <select
 value={form.triggerType}
 onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
 className="w-full select-theme px-3 py-2 focus:border-current focus:outline-none"
 >
 {Object.entries(TRIGGER_TYPES).map(([key, label]) => (
 <option key={key} value={key}>{label}</option>
 ))}
 </select>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="mb-1 block text-sm font-medium text-current">İşlem Tipi</label>
 <select
 value={form.actionType}
 onChange={(e) => setForm({ ...form, actionType: e.target.value })}
 className="w-full select-theme px-3 py-2 focus:border-current focus:outline-none"
 >
 {Object.entries(ACTION_TYPES).map(([key, label]) => (
 <option key={key} value={key}>{label}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="mb-1 block text-sm font-medium text-current">Zamanlama (Cron)</label>
 <input
 type="text"
 value={form.schedule}
 onChange={(e) => setForm({ ...form, schedule: e.target.value })}
 className="w-full input-theme px-3 py-2 focus:border-current focus:outline-none"
 placeholder="*/60 * * * *"
 />
 </div>
 </div>

 <div>
 <label className="mb-1 block text-sm font-medium text-current">
 Tetikleyici Yapılandırması (JSON)
 </label>
 <textarea
 value={form.triggerConfig}
 onChange={(e) => setForm({ ...form, triggerConfig: e.target.value })}
 className="w-full input-theme px-3 py-2 focus:border-current focus:outline-none"
 rows={2}
 placeholder='{"interval": 3600, "retryOnFail": true}'
 />
 </div>

 <div>
 <label className="mb-1 block text-sm font-medium text-current">
 İşlem Yapılandırması (JSON)
 </label>
 <textarea
 value={form.actionConfig}
 onChange={(e) => setForm({ ...form, actionConfig: e.target.value })}
 className="w-full input-theme px-3 py-2 focus:border-current focus:outline-none"
 rows={2}
 placeholder='{"marketplace": "trendyol", "updateFields": ["price", "stock"]}'
 />
 </div>

 <div className="flex items-center gap-2">
 <input
 type="checkbox"
 id="active"
 checked={form.active}
 onChange={(e) => setForm({ ...form, active: e.target.checked })}
 className="rounded border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current"
 />
 <label htmlFor="active" className="text-sm text-current">Aktif</label>
 </div>

 <div className="flex justify-end gap-3 pt-2">
 <button
 type="button"
 onClick={() => setShowModal(false)}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-4 py-2 text-sm font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 İptal
 </button>
 <button
 type="submit"
 className="rounded-lg bg-transparent px-4 py-2 text-sm font-medium text-current transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/20"
 >
 {editingRule ? 'Güncelle' : 'Oluştur'}
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* Logs Modal */}
 {showLogs && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
 <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl">
 <div className="mb-4 flex items-center justify-between">
 <h3 className="text-lg font-semibold text-current">İşlem Geçmişi</h3>
 <button onClick={() => setShowLogs(false)} className="text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">✕</button>
 </div>

 {logsLoading ? (
 <div className="flex items-center justify-center p-8">
 <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent" />
 </div>
 ) : logs.length === 0 ? (
 <div className="p-8 text-center text-current">
 <p>Henüz işlem kaydı bulunmuyor</p>
 </div>
 ) : (
 <div className="max-h-96 space-y-2 overflow-y-auto">
 {logs.map((log: any) => (
 <div key={log.id} className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3">
 <div className="flex items-center justify-between">
 <span className="text-sm font-medium text-current">{log.action}</span>
 <span className="text-xs text-current">
 {new Date(log.createdAt).toLocaleString('tr-TR')}
 </span>
 </div>
 {log.details && (
 <pre className="mt-1 overflow-auto rounded bg-transparent p-2 text-xs text-current">
 {log.details}
 </pre>
 )}
 {log.actorUser && (
 <div className="mt-1 text-xs text-current">
 {log.actorUser.name || log.actorUser.email}
 </div>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
}
