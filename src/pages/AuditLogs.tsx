import React, { useEffect, useState } from 'react';

interface AuditLogItem {
 id: string; action: string; entity: string; entityId: string | null;
 details: string | null; meta?: string | null; ipAddress?: string | null;
 success?: boolean; duration?: number | null;
 actorUser: { email: string; name: string | null } | null;
 createdAt: string;
}

const LOG_ACTIONS: Record<string, { icon: string; color: string }> = {
 CREATE: { icon: '➕', color: 'text-current' }, UPDATE: { icon: '✏️', color: 'text-current' },
 DELETE: { icon: '🗑️', color: 'text-current' }, LOGIN: { icon: '🔑', color: 'text-current' },
 LOGOUT: { icon: '🚪', color: 'text-current' }, ERROR: { icon: '❌', color: 'text-current' },
 SYNC: { icon: '🔄', color: 'text-current' }, EXPORT: { icon: '📥', color: 'text-current' },
 IMPORT: { icon: '📤', color: 'text-current' }, MATCH: { icon: '🔗', color: 'text-current' },
 AI: { icon: '🤖', color: 'text-current' },
};

const MODULES = ['', 'product', 'category', 'brand', 'variant', 'xml', 'order', 'finance', 'marketplace', 'user', 'system', 'notification', 'template'];

export default function AuditLogsPage() {
 const [logs, setLogs] = useState<AuditLogItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [page, setPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const [total, setTotal] = useState(0);
 const [moduleFilter, setModuleFilter] = useState('');
 const [search, setSearch] = useState('');
 const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

 useEffect(() => { fetchLogs(); }, [page, moduleFilter]);

 async function fetchLogs() {
 setLoading(true);
 try {
 const params = new URLSearchParams({ page: String(page), limit: '50' });
 if (moduleFilter) params.append('entity', moduleFilter);
 if (search) params.append('search', search);
 const res = await fetch(`/audit-logs?${params}`, { credentials: 'include' });
 const data = await res.json();
 setLogs(data.items || []);
 setTotalPages(data.pagination?.totalPages || 1);
 setTotal(data.pagination?.total || 0);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 function getActionInfo(action: string) {
 const upper = action.toUpperCase();
 for (const [key, val] of Object.entries(LOG_ACTIONS)) {
 if (upper.includes(key)) return val;
 }
 return { icon: '📝', color: 'text-current' };
 }

 function getTimeAgo(date: string) {
 const diff = Date.now() - new Date(date).getTime();
 const mins = Math.floor(diff / 60000);
 if (mins < 1) return 'Az önce';
 if (mins < 60) return `${mins} dk önce`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours} saat önce`;
 return new Date(date).toLocaleDateString('tr-TR');
 }

 const successCount = logs.filter(l => l.success !== false).length;
 const failCount = logs.filter(l => l.success === false).length;

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Log Sistemi</h2>
 <p className="text-sm text-current">Denetim, güvenlik ve sistem izleme</p>
 </div>
 <button onClick={() => fetchLogs()} className="btn-ghost px-3 py-1.5">🔄</button>
 </div>

 {/* KPI Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Toplam Log</div>
 <div className="text-lg font-semibold text-current">{total.toLocaleString()}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Başarılı</div>
 <div className="text-lg font-semibold text-current">{successCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Başarısız</div>
 <div className="text-lg font-semibold text-current">{failCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Modül</div>
 <div className="text-lg font-semibold text-current">{MODULES.length - 1}</div>
 </div>
 </div>

 {/* Filters */}
 <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
 placeholder="Log ara (ID, kullanıcı, işlem)..." className="flex-1 min-w-[200px] select-theme px-3 py-2" />
 <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }}
 className="select-theme px-3 py-2">
 <option value="">Tüm Modüller</option>
 {MODULES.filter(Boolean).map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
 </select>
 <span className="text-xs text-current">Sayfa {page}/{totalPages}</span>
 </div>

 {/* Log List */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="p-8 text-center text-current">Yükleniyor...</div>
 ) : logs.length === 0 ? (
 <div className="p-8 text-center text-current">
 <div className="text-4xl mb-2">📝</div>
 <div>Log kaydı bulunamadı</div>
 </div>
 ) : (
 <div className="divide-y divide-">
 {logs.map(log => {
 const actionInfo = getActionInfo(log.action);
 return (
 <div key={log.id} onClick={() => setSelectedLog(log)}
 className="flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
 <span className={`text-lg mt-0.5 ${actionInfo.color}`}>{actionInfo.icon}</span>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-current">{log.action}</span>
 {log.entity && <span className="text-xs bg-transparent px-1.5 py-0.5 rounded text-current">{log.entity}</span>}
 {log.success === false && <span className="text-xs text-current">❌</span>}
 </div>
 <div className="text-xs text-current mt-0.5">{log.details || '-'}</div>
 <div className="flex items-center gap-2 mt-1 text-xs text-current">
 <span>{getTimeAgo(log.createdAt)}</span>
 {log.actorUser && <span>· 👤 {log.actorUser.name || log.actorUser.email}</span>}
 {log.ipAddress && <span>· 🌐 {log.ipAddress}</span>}
 {log.duration != null && <span>· ⏱ {log.duration}ms</span>}
 </div>
 </div>
 <span className="text-xs text-current shrink-0">{new Date(log.createdAt).toLocaleTimeString('tr-TR')}</span>
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* Pagination */}
 {totalPages > 1 && (
 <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <span className="text-sm text-current">Toplam {total.toLocaleString()} kayıt</span>
 <div className="flex gap-2">
 <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">◀</button>
 <span className="text-sm text-current px-2 py-1.5">{page} / {totalPages}</span>
 <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-1.5 text-sm text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50">▶</button>
 </div>
 </div>
 )}

 {/* Detail Modal */}
 {selectedLog && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedLog(null)}>
 <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-lg font-semibold text-current">Log Detayı</h3>
 <button onClick={() => setSelectedLog(null)} className="rounded-lg p-2 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20">✕</button>
 </div>
 <div className="grid grid-cols-2 gap-3 text-sm">
 <div><span className="text-slate-700 dark:text-slate-300">İşlem:</span> <span className="text-current ml-1">{selectedLog.action}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Modül:</span> <span className="text-current ml-1">{selectedLog.entity || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Kullanıcı:</span> <span className="text-current ml-1">{selectedLog.actorUser?.name || selectedLog.actorUser?.email || '-'}</span></div>
 <div><span className="text-slate-700 dark:text-slate-300">Tarih:</span> <span className="text-current ml-1">{new Date(selectedLog.createdAt).toLocaleString('tr-TR')}</span></div>
 {selectedLog.ipAddress && <div><span className="text-slate-700 dark:text-slate-300">IP:</span> <span className="text-current ml-1">{selectedLog.ipAddress}</span></div>}
 {selectedLog.duration != null && <div><span className="text-slate-700 dark:text-slate-300">Süre:</span> <span className="text-current ml-1">{selectedLog.duration}ms</span></div>}
 <div><span className="text-slate-700 dark:text-slate-300">Başarılı:</span> <span className={selectedLog.success !== false ? 'text-current ml-1' : 'text-current ml-1'}>{selectedLog.success !== false ? '✅ Evet' : '❌ Hayır'}</span></div>
 </div>
 <div className="mt-3">
 <div className="text-xs text-current mb-1">Açıklama / Detay</div>
 <div className="rounded-lg bg-transparent p-3 text-sm text-current whitespace-pre-wrap">{selectedLog.details || '-'}</div>
 </div>
 {selectedLog.meta && (
 <div className="mt-3">
 <div className="text-xs text-current mb-1">Meta (JSON)</div>
 <pre className="rounded-lg bg-transparent p-3 text-xs text-current overflow-x-auto">{(() => { try { return JSON.stringify(JSON.parse(selectedLog.meta!), null, 2); } catch { return selectedLog.meta; } })()}</pre>
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
}
