import React, { useEffect, useState } from 'react';

interface MessageItem {
 id: string; channel: string; customerName: string;
 subject: string; message: string; status: string;
 aiSuggestion: string | null; createdAt: string;
}

export default function Messages() {
 const [messages, setMessages] = useState<MessageItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [statusFilter, setStatusFilter] = useState('');

 useEffect(() => { fetchMessages(); }, [statusFilter]);

 async function fetchMessages() {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams();
 if (statusFilter) params.append('status', statusFilter);
 const response = await fetch(`/messages?${params}`, { credentials: 'include' });
 if (!response.ok) throw new Error(`HTTP ${response.status}`);
 const data = await response.json();
 setMessages(Array.isArray(data.items) ? data.items : []);
 } catch (error: any) {
 console.error('Error fetching messages:', error);
 setError(error.message || 'Mesajlar yüklenemedi');
 } finally {
 setLoading(false);
 }
 }

 async function handleUpdateStatus(id: string, status: string) {
 try {
 await fetch(`/messages/${id}`, {
 method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
 body: JSON.stringify({ status }),
 });
 fetchMessages();
 } catch (err) { console.error(err); }
 }

 const statusColors: Record<string, string> = {
 unread: 'bg-transparent text-current', read: 'bg-transparent text-current',
 replied: 'bg-transparent text-current', spam: 'bg-transparent text-current',
 };

 if (error) {
 return (
 <div className="space-y-4">
 <h2 className="text-lg font-semibold text-current">Mesajlar</h2>
 <div className="panel-theme p-8 backdrop-blur-sm">
 <div className="text-center text-current">
 <div className="text-4xl mb-2">💬</div>
 <div className="text-sm">Mesaj yüklenemedi: {error}</div>
 <button onClick={fetchMessages} className="mt-4 btn-ghost px-4 py-2">🔄 Tekrar Dene</button>
 </div>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-semibold text-current">Mesajlar</h2>
 <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tümü</option>
 <option value="unread">Okunmamış</option>
 <option value="read">Okunmuş</option>
 <option value="replied">Yanıtlanmış</option>
 </select>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="p-8 text-center text-current">Yükleniyor...</div>
 ) : messages.length === 0 ? (
 <div className="p-8 text-center text-current">
 <div className="text-4xl mb-2">💬</div>
 <div className="text-sm">Mesaj bulunamadı</div>
 </div>
 ) : (
 <div className="divide-y divide-">
 {messages.map(m => (
 <div key={m.id} className="p-4 hover:bg-transparent transition-colors">
 <div className="flex items-start justify-between">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className={`w-2 h-2 rounded-full ${m.status === 'unread' ? 'bg-transparent' : 'bg-transparent'}`}></span>
 <span className="text-sm font-medium text-current">{m.subject}</span>
 <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[m.status] || 'bg-transparent text-current'}`}>{m.status}</span>
 </div>
 <div className="text-xs text-current mt-1">{m.customerName} · {m.channel}</div>
 <div className="text-sm text-current mt-1 line-clamp-2">{m.message}</div>
 <div className="flex items-center gap-2 mt-2">
 <button onClick={() => handleUpdateStatus(m.id, 'read')} className="rounded bg-transparent px-2 py-1 text-xs text-current hover:bg-transparent">📖 Okundu</button>
 <button onClick={() => handleUpdateStatus(m.id, 'replied')} className="rounded bg-transparent px-2 py-1 text-xs text-current hover:bg-transparent">✉️ Yanıtla</button>
 </div>
 </div>
 <div className="text-xs text-current shrink-0 ml-3">{new Date(m.createdAt).toLocaleDateString('tr-TR')}</div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 );
}
