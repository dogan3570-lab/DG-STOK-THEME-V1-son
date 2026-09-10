import React, { useEffect, useState } from 'react';

interface NotificationItem {
 id: string; type: string; title: string; message: string;
 read: boolean; priority?: string; module?: string;
 createdAt: string;
}

const PRIORITY_LABELS: Record<string, string> = { P1: '🔴 Kritik', P2: '🟠 Yüksek', P3: '🟡 Orta', P4: '🔵 Düşük' };
const PRIORITY_COLORS: Record<string, string> = { P1: 'bg-transparent text-current border-current', P2: 'bg-transparent text-current border-current', P3: 'bg-transparent text-current border-current', P4: 'bg-transparent text-current border-current' };
const TYPE_ICONS: Record<string, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', critical: '🚨', ai: '🤖', system: '⚙️', security: '🔒', operation: '🔧' };

export default function NotificationsPage() {
 const [notifications, setNotifications] = useState<NotificationItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [filter, setFilter] = useState('all');
 const [typeFilter, setTypeFilter] = useState('');
 const [priorityFilter, setPriorityFilter] = useState('');
 const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);

 useEffect(() => { fetchNotifications(); }, []);

 async function fetchNotifications() {
 try {
 const res = await fetch('/notifications', { credentials: 'include' });
 const data = await res.json();
 setNotifications(data.items || []);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 async function handleMarkRead(id: string) {
 try {
 await fetch(`/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
 setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
 } catch (err) { console.error(err); }
 }

 async function handleMarkAllRead() {
 for (const n of notifications.filter(n => !n.read)) {
 await fetch(`/notifications/${n.id}/read`, { method: 'POST', credentials: 'include' });
 }
 setNotifications(prev => prev.map(n => ({ ...n, read: true })));
 }

 const totalCount = notifications.length;
 const unreadCount = notifications.filter(n => !n.read).length;
 const criticalCount = notifications.filter(n => n.priority === 'P1' || n.type === 'critical').length;
 const warningCount = notifications.filter(n => n.priority === 'P2' || n.type === 'warning').length;

 const filtered = notifications.filter(n => {
 if (filter === 'unread' && n.read) return false;
 if (filter === 'read' && !n.read) return false;
 if (filter === 'critical' && n.priority !== 'P1' && n.type !== 'critical') return false;
 if (typeFilter && n.type !== typeFilter) return false;
 if (priorityFilter && n.priority !== priorityFilter) return false;
 return true;
 });

 function getTypeIcon(type: string) { return TYPE_ICONS[type] || '🔔'; }
 function getTimeAgo(date: string) {
 const diff = Date.now() - new Date(date).getTime();
 const mins = Math.floor(diff / 60000);
 if (mins < 1) return 'Az önce';
 if (mins < 60) return `${mins} dk önce`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours} saat önce`;
 return new Date(date).toLocaleDateString('tr-TR');
 }

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Bildirim Merkezi</h2>
 <p className="text-sm text-current">Tüm sistem olayları ve uyarılar</p>
 </div>
 <div className="flex gap-2">
 {unreadCount > 0 && (
 <button onClick={handleMarkAllRead} className="btn-ghost px-3 py-1.5">✅ Tümünü Okundu İşaretle</button>
 )}
 <button onClick={fetchNotifications} className="btn-ghost px-3 py-1.5">🔄</button>
 </div>
 </div>

 {/* KPI Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Toplam</div>
 <div className="text-lg font-semibold text-current">{totalCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Okunmamış</div>
 <div className="text-lg font-semibold text-current">{unreadCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Okunmuş</div>
 <div className="text-lg font-semibold text-current">{totalCount - unreadCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🔴 Kritik</div>
 <div className="text-lg font-semibold text-current">{criticalCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">🟠 Uyarı</div>
 <div className="text-lg font-semibold text-current">{warningCount}</div>
 </div>
 </div>

 {/* Filters */}
 <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 {[
 { key: 'all', label: 'Tümü' }, { key: 'unread', label: 'Okunmamış' },
 { key: 'read', label: 'Okunmuş' }, { key: 'critical', label: 'Kritik' },
 ].map(f => (
 <button key={f.key} onClick={() => setFilter(f.key)}
 className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === f.key ? 'bg-transparent text-current' : 'bg-transparent text-current hover:bg-transparent'}`}>{f.label}</button>
 ))}
 <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
 className="select-theme px-2 py-1.5">
 <option value="">Tüm Tipler</option>
 {Object.entries(TYPE_ICONS).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
 </select>
 <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
 className="select-theme px-2 py-1.5">
 <option value="">Tüm Öncelik</option>
 {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
 </select>
 </div>

 {/* Notifications List */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="p-8 text-center text-current">Yükleniyor...</div>
 ) : filtered.length === 0 ? (
 <div className="p-8 text-center text-current">
 <div className="text-4xl mb-2">🔔</div>
 <div>Bildirim bulunamadı</div>
 </div>
 ) : (
 <div className="divide-y divide-">
 {filtered.map(n => (
 <div key={n.id} onClick={() => setSelectedNotif(n)}
 className={`flex items-start gap-3 p-4 cursor-pointer transition-colors hover:bg-transparent ${!n.read ? 'bg-transparent' : ''}`}>
 <div className="text-xl mt-0.5">{getTypeIcon(n.type)}</div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-current">{n.title}</span>
 {!n.read && <span className="w-2 h-2 rounded-full bg-transparent shrink-0"></span>}
 {n.priority && (
 <span className={`text-xs px-1.5 py-0.5 rounded-full border ${PRIORITY_COLORS[n.priority] || ''}`}>
 {PRIORITY_LABELS[n.priority] || n.priority}
 </span>
 )}
 </div>
 <div className="text-xs text-current mt-0.5 line-clamp-2">{n.message}</div>
 <div className="flex items-center gap-2 mt-1 text-xs text-current">
 <span>{getTimeAgo(n.createdAt)}</span>
 {n.module && <span>· {n.module}</span>}
 </div>
 </div>
 <div className="flex gap-1 shrink-0">
 {!n.read && (
 <button onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
 className="rounded p-1.5 text-current hover:bg-transparent hover:text-current" title="Okundu">✅</button>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Detail Modal */}
 {selectedNotif && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedNotif(null)}>
 <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-start justify-between mb-4">
 <div className="flex items-center gap-3">
 <span className="text-2xl">{getTypeIcon(selectedNotif.type)}</span>
 <div>
 <h3 className="text-lg font-semibold text-current">{selectedNotif.title}</h3>
 {selectedNotif.priority && (
 <span className={`text-xs px-2 py-0.5 rounded-full border mt-1 inline-block ${PRIORITY_COLORS[selectedNotif.priority] || ''}`}>
 {PRIORITY_LABELS[selectedNotif.priority]}
 </span>
 )}
 </div>
 </div>
 <button onClick={() => setSelectedNotif(null)} className="rounded-lg p-2 text-current hover:bg-transparent">✕</button>
 </div>
 <div className="text-sm text-current mb-4">{selectedNotif.message}</div>
 <div className="flex justify-between text-xs text-current">
 <span>📅 {new Date(selectedNotif.createdAt).toLocaleString('tr-TR')}</span>
 <span>📁 {selectedNotif.module || 'Genel'}</span>
 </div>
 <div className="flex gap-2 mt-4">
 {!selectedNotif.read && (
 <button onClick={() => { handleMarkRead(selectedNotif.id); setSelectedNotif({ ...selectedNotif, read: true }); }}
 className="flex-1 btn-ghost px-3 py-2">✅ Okundu İşaretle</button>
 )}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
