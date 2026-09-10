import React, { useEffect, useState, useRef } from 'react';

interface Message {
 role: 'user' | 'copilot';
 content: string;
 data?: any;
 tasks?: any[];
 requiresApproval?: boolean;
 conversationId?: string;
}

interface Suggestion {
 text: string;
}

interface CopilotStats {
 totalConversations: number;
 totalTasks: number;
 completedTasks: number;
 failedTasks: number;
 pendingTasks: number;
}

const API_BASE = '/api';

export default function AICopilot() {
 const [messages, setMessages] = useState<Message[]>([
 { role: 'copilot', content: 'Merhaba! Ben DG STOK AI Copilot. Size nasıl yardımcı olabilirim?\n\nÖrneğin:\n- "Hazır olmayan ürünleri göster"\n- "Trendyol\'u analiz et"\n- "Genel durumu göster"' },
 ]);
 const [input, setInput] = useState('');
 const [loading, setLoading] = useState(false);
 const [suggestions, setSuggestions] = useState<string[]>([]);
 const [stats, setStats] = useState<CopilotStats | null>(null);
 const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'tasks'>('chat');
 const messagesEndRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 loadSuggestions();
 loadStats();
 }, []);

 useEffect(() => {
 messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
 }, [messages]);

 const loadSuggestions = async () => {
 try {
 const res = await fetch(`${API_BASE}/copilot/suggestions`);
 const json = await res.json();
 if (json.ok) setSuggestions(json.data);
 } catch {}
 };

 const loadStats = async () => {
 try {
 const res = await fetch(`${API_BASE}/copilot/status`);
 const json = await res.json();
 if (json.ok) setStats(json.data);
 } catch {}
 };

 const handleSend = async () => {
 const question = input.trim();
 if (!question || loading) return;

 setInput('');
 setMessages(prev => [...prev, { role: 'user', content: question }]);
 setLoading(true);

 try {
 const res = await fetch(`${API_BASE}/copilot/chat`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ question }),
 });
 const json = await res.json();

 if (json.ok) {
 setMessages(prev => [...prev, {
 role: 'copilot',
 content: json.data.answer,
 data: json.data.data,
 tasks: json.data.pendingTasks,
 requiresApproval: json.data.requiresApproval,
 conversationId: json.data.conversationId,
 }]);

 loadStats();
 } else {
 setMessages(prev => [...prev, { role: 'copilot', content: 'Üzgünüm, bir hata oluştu: ' + (json.error?.message || '') }]);
 }
 } catch (err: any) {
 setMessages(prev => [...prev, { role: 'copilot', content: 'Bağlantı hatası: ' + err.message }]);
 } finally {
 setLoading(false);
 }
 };

 const handleApprove = async (taskId: string) => {
 try {
 const res = await fetch(`${API_BASE}/copilot/execute`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ taskId, approved: true }),
 });
 const json = await res.json();
 if (json.ok) {
 setMessages(prev => [...prev, { role: 'copilot', content: `✅ Görev başarıyla tamamlandı!` }]);
 }
 } catch {}
 };

 const handleReject = async (taskId: string) => {
 try {
 await fetch(`${API_BASE}/copilot/execute`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ taskId, approved: false }),
 });
 setMessages(prev => [...prev, { role: 'copilot', content: `❌ Görev reddedildi.` }]);
 } catch {}
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === 'Enter' && !e.shiftKey) {
 e.preventDefault();
 handleSend();
 }
 };

 return (
 <div className="flex flex-col h-full">
 {/* Başlık */}
 <div className="flex items-center justify-between mb-4">
 <div>
 <h1 className="text-2xl font-bold text-current">AI Copilot</h1>
 <p className="text-slate-700 dark:text-slate-300 text-sm mt-1">Doğal dil ile DG STOK V5.0 yönetimi</p>
 </div>
 <div className="flex gap-2">
 <button onClick={() => setActiveTab('chat')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'chat' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>Sohbet</button>
 <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'history' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>Geçmiş</button>
 <button onClick={() => setActiveTab('tasks')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'tasks' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>Görevler</button>
 </div>
 </div>

 {/* Stats */}
 {stats && (
 <div className="grid grid-cols-5 gap-2 mb-4">
 <div className="bg-transparent rounded-lg p-2 text-center border border-slate-200 dark:border-slate-800/60">
 <div className="text-lg font-bold text-current">{stats.totalConversations}</div>
 <div className="text-xs text-current">Konuşma</div>
 </div>
 <div className="bg-transparent rounded-lg p-2 text-center border border-slate-200 dark:border-slate-800/60">
 <div className="text-lg font-bold text-current">{stats.totalTasks}</div>
 <div className="text-xs text-current">Görev</div>
 </div>
 <div className="bg-transparent rounded-lg p-2 text-center border border-slate-200 dark:border-slate-800/60">
 <div className="text-lg font-bold text-current">{stats.completedTasks}</div>
 <div className="text-xs text-current">Tamamlanan</div>
 </div>
 <div className="bg-transparent rounded-lg p-2 text-center border border-slate-200 dark:border-slate-800/60">
 <div className="text-lg font-bold text-current">{stats.failedTasks}</div>
 <div className="text-xs text-current">Başarısız</div>
 </div>
 <div className="bg-transparent rounded-lg p-2 text-center border border-slate-200 dark:border-slate-800/60">
 <div className="text-lg font-bold text-current">{stats.pendingTasks}</div>
 <div className="text-xs text-current">Bekleyen</div>
 </div>
 </div>
 )}

 {activeTab === 'chat' && (
 <div className="flex-1 flex flex-col min-h-0">
 {/* Mesajlar */}
 <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
 {messages.map((msg, i) => (
 <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
 <div className={`max-w-[80%] rounded-xl p-4 ${ msg.role === 'user' ? 'bg-transparent border border-slate-200 dark:border-slate-800/60' : 'bg-transparent border border-slate-200 dark:border-slate-800/60' }`}>
 {msg.role === 'copilot' && (
 <div className="text-xs text-current font-medium mb-1">🤖 AI Copilot</div>
 )}
 <div className="text-sm text-current whitespace-pre-line">{msg.content}</div>

 {/* Onay Butonları */}
 {msg.requiresApproval && msg.tasks && msg.tasks.length > 0 && (
 <div className="mt-3 flex gap-2">
 {msg.tasks.map((task: any) => (
 <React.Fragment key={task.id}>
 <button onClick={() => handleApprove(task.id)} className="px-4 py-1.5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs text-slate-500 dark:text-slate-400 rounded-lg font-medium">✅ Onayla</button>
 <button onClick={() => handleReject(task.id)} className="px-4 py-1.5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs text-slate-500 dark:text-slate-400 rounded-lg font-medium">❌ Reddet</button>
 </React.Fragment>
 ))}
 </div>
 )}
 </div>
 </div>
 ))}

 {loading && (
 <div className="flex justify-start">
 <div className="bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-xl p-4">
 <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
 <div className="animate-pulse">🤖</div>
 <span>Düşünüyorum...</span>
 </div>
 </div>
 </div>
 )}

 <div ref={messagesEndRef} />
 </div>

 {/* Öneriler */}
 {suggestions.length > 0 && messages.length <= 2 && (
 <div className="mb-3">
 <div className="text-xs text-current mb-2">💡 Önerilen sorular:</div>
 <div className="flex flex-wrap gap-2">
 {suggestions.map((s, i) => (
 <button
 key={i}
 onClick={() => { setInput(s); }}
 className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs text-slate-500 dark:text-slate-400 rounded-full border border-slate-200 dark:border-slate-800/60 transition-colors"
 >
 {s}
 </button>
 ))}
 </div>
 </div>
 )}

 {/* Input */}
 <div className="flex gap-2">
 <textarea
 value={input}
 onChange={(e) => setInput(e.target.value)}
 onKeyDown={handleKeyDown}
 placeholder="Sorunuzu yazın..."
 rows={2}
 className="flex-1 px-4 py-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-xl text-current placeholder-current focus:outline-none focus:ring-2 focus:ring-0 resize-none text-sm"
 />
 <button
 onClick={handleSend}
 disabled={loading || !input.trim()}
 className="px-6 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary rounded-xl text-sm font-medium self-end transition-colors"
 >
 {loading ? '...' : 'Gönder'}
 </button>
 </div>
 </div>
 )}

 {activeTab === 'history' && (
 <HistoryView />
 )}

 {activeTab === 'tasks' && (
 <TasksView />
 )}
 </div>
 );
}

function HistoryView() {
 const [history, setHistory] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 fetch(`${API_BASE}/copilot/history`)
 .then(r => r.json())
 .then(j => { if (j.ok) setHistory(j.data); })
 .catch(() => {})
 .finally(() => setLoading(false));
 }, []);

 if (loading) return <div className="text-slate-700 dark:text-slate-300 text-center py-8">Yükleniyor...</div>;

 return (
 <div className="bg-transparent rounded-xl border border-slate-200 dark:border-slate-800/60 overflow-hidden">
 <div className="p-4 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-current font-semibold">Konuşma Geçmişi</h3>
 </div>
 {history.length === 0 ? (
 <div className="p-6 text-center text-current">Henüz konuşma yok.</div>
 ) : (
 <div className="divide-y divide-">
 {history.map((item: any) => (
 <div key={item.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
 <div className="text-xs text-current mb-1">{new Date(item.createdAt).toLocaleString('tr-TR')}</div>
 <div className="text-sm text-current font-medium mb-1">{item.question}</div>
 <div className="text-xs text-current line-clamp-2">{item.answer}</div>
 </div>
 ))}
 </div>
 )}
 </div>
 );
}

function TasksView() {
 const [tasks, setTasks] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 fetch(`${API_BASE}/copilot/tasks`)
 .then(r => r.json())
 .then(j => { if (j.ok) setTasks(j.data); })
 .catch(() => {})
 .finally(() => setLoading(false));
 }, []);

 const getStatusColor = (status: string) => {
 switch (status) {
 case 'COMPLETED': return 'text-current';
 case 'FAILED': return 'text-current';
 case 'RUNNING': return 'text-current';
 case 'PENDING': return 'text-current';
 case 'REJECTED': return 'text-current';
 default: return 'text-current';
 }
 };

 if (loading) return <div className="text-slate-700 dark:text-slate-300 text-center py-8">Yükleniyor...</div>;

 return (
 <div className="bg-transparent rounded-xl border border-slate-200 dark:border-slate-800/60 overflow-hidden">
 <div className="p-4 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-current font-semibold">Görev Geçmişi</h3>
 </div>
 {tasks.length === 0 ? (
 <div className="p-6 text-center text-current">Henüz görev yok.</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="text-left text-sm text-current border-b border-slate-100 dark:border-slate-800/60">
 <th className="p-3">Modül</th>
 <th className="p-3">İşlem</th>
 <th className="p-3">Durum</th>
 <th className="p-3">Tarih</th>
 </tr>
 </thead>
 <tbody>
 {tasks.map((task: any) => (
 <tr key={task.id} className="table-row text-sm">
 <td className="p-3 text-current">{task.module}</td>
 <td className="p-3 text-current">{task.action}</td>
 <td className="p-3">
 <span className={`font-medium ${getStatusColor(task.status)}`}>{task.status}</span>
 </td>
 <td className="p-3 text-xs text-slate-500 dark:text-slate-400">{new Date(task.createdAt).toLocaleString('tr-TR')}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 );
}
