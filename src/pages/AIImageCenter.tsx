import React, { useEffect, useState } from 'react';

interface DashboardStats {
 totalAnalyses: number;
 excellent: number;
 good: number;
 needsReview: number;
 poor: number;
 reject: number;
 watermarkIssues: number;
 backgroundIssues: number;
 resolutionIssues: number;
 angleIssues: number;
 byMarketplace: Record<string, number>;
}

interface IssueItem {
 id: string;
 issueType: string;
 severity: string;
 confidence: number;
 description: string;
 recommendation: string;
 approved: boolean;
 resolved: boolean;
 createdAt: string;
 analysis?: {
 productId: string;
 imageUrl: string;
 overallScore: number;
 };
}

const API_BASE = '/api';

export default function AIImageCenter() {
 const [stats, setStats] = useState<DashboardStats | null>(null);
 const [issues, setIssues] = useState<IssueItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [activeTab, setActiveTab] = useState<'dashboard' | 'issues' | 'analyze'>('dashboard');
 const [bulkCount, setBulkCount] = useState<number>(100);
 const [analyzing, setAnalyzing] = useState(false);
 const [bulkResult, setBulkResult] = useState<string | null>(null);

 useEffect(() => {
 loadDashboard();
 loadIssues();
 }, []);

 const loadDashboard = async () => {
 try {
 const res = await fetch(`${API_BASE}/ai-image/dashboard`);
 const json = await res.json();
 if (json.ok && json.data) {
 setStats(json.data);
 }
 } catch (err) {
 console.error('Dashboard yüklenemedi:', err);
 } finally {
 setLoading(false);
 }
 };

 const loadIssues = async () => {
 try {
 const res = await fetch(`${API_BASE}/ai-image/issues`);
 const json = await res.json();
 if (json.ok && json.data) {
 setIssues(json.data);
 }
 } catch (err) {
 console.error('Sorunlar yüklenemedi:', err);
 }
 };

 const handleBulkAnalyze = async () => {
 setAnalyzing(true);
 setBulkResult(null);
 try {
 const res = await fetch(`${API_BASE}/ai-image/bulk-analyze`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ count: bulkCount }),
 });
 const json = await res.json();
 if (json.ok) {
 setBulkResult(`${json.data.totalProcessed} ürün tarandı. ${json.data.successful} başarılı, ${json.data.failed} başarısız.`);
 loadDashboard();
 loadIssues();
 } else {
 setBulkResult('Hata: ' + (json.error?.message || 'Bilinmeyen hata'));
 }
 } catch (err: any) {
 setBulkResult('Hata: ' + err.message);
 } finally {
 setAnalyzing(false);
 }
 };

 const handleApproveIssue = async (issueId: string, approved: boolean) => {
 try {
 await fetch(`${API_BASE}/ai-image/approve`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ issueId, approved }),
 });
 loadIssues();
 } catch (err) {
 console.error('Onaylama hatası:', err);
 }
 };

 const getSeverityColor = (severity: string): string => {
 switch (severity) {
 case 'CRITICAL': return 'bg-transparent';
 case 'HIGH': return 'bg-transparent';
 case 'MEDIUM': return 'bg-transparent';
 case 'LOW': return 'bg-transparent';
 default: return 'bg-transparent';
 }
 };

 const getScoreColor = (score: number): string => {
 if (score >= 95) return 'text-current';
 if (score >= 85) return 'text-current';
 if (score >= 70) return 'text-current';
 if (score >= 50) return 'text-current';
 return 'text-current';
 };

 const getStatusLabel = (status: string): string => {
 const labels: Record<string, string> = {
 EXCELLENT: 'Mükemmel',
 GOOD: 'İyi',
 NEEDS_REVIEW: 'İncelenecek',
 POOR: 'Zayıf',
 REJECT: 'Reddedildi',
 };
 return labels[status] || status;
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center h-64">
 <div className="text-slate-700 dark:text-slate-300 text-lg">Yükleniyor...</div>
 </div>
 );
 }

 return (
 <div className="space-y-6">
 {/* Başlık */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-bold text-current">AI Görsel Kalite Merkezi</h1>
 <p className="text-slate-700 dark:text-slate-300 mt-1">Ürün görsellerini AI ile analiz et ve kalite kontrolü yap</p>
 </div>
 <div className="flex gap-2">
 <button
 onClick={() => setActiveTab('dashboard')}
 className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${ activeTab === 'dashboard' ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 Dashboard
 </button>
 <button
 onClick={() => setActiveTab('issues')}
 className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${ activeTab === 'issues' ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 Sorunlar ({issues.length})
 </button>
 <button
 onClick={() => setActiveTab('analyze')}
 className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${ activeTab === 'analyze' ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 Toplu Analiz
 </button>
 </div>
 </div>

 {activeTab === 'dashboard' && stats && (
 <>
 {/* KPI Kartları */}
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">Toplam Analiz</div>
 <div className="text-2xl font-bold text-current mt-1">{stats.totalAnalyses}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">Mükemmel (95+)</div>
 <div className="text-2xl font-bold text-current mt-1">{stats.excellent}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">İyi (85+)</div>
 <div className="text-2xl font-bold text-current mt-1">{stats.good}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">İncelenecek</div>
 <div className="text-2xl font-bold text-current mt-1">{stats.needsReview}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">Zayıf / Red</div>
 <div className="text-2xl font-bold text-current mt-1">{stats.poor + stats.reject}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="text-slate-700 dark:text-slate-300 text-sm">Toplam Sorun</div>
 <div className="text-2xl font-bold text-current mt-1">{issues.length}</div>
 </div>
 </div>

 {/* Sorun Detay Kartları */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="flex items-center gap-2">
 <span className="text-lg">💧</span>
 <span className="text-slate-700 dark:text-slate-300 text-sm">Filigran</span>
 </div>
 <div className="text-xl font-bold text-current mt-2">{stats.watermarkIssues}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="flex items-center gap-2">
 <span className="text-lg">⬜</span>
 <span className="text-slate-700 dark:text-slate-300 text-sm">Beyaz Fon Eksik</span>
 </div>
 <div className="text-xl font-bold text-current mt-2">{stats.backgroundIssues}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="flex items-center gap-2">
 <span className="text-lg">📷</span>
 <span className="text-slate-700 dark:text-slate-300 text-sm">Düşük Çözünürlük</span>
 </div>
 <div className="text-xl font-bold text-current mt-2">{stats.resolutionIssues}</div>
 </div>
 <div className="bg-transparent rounded-xl p-4 border border-slate-200 dark:border-slate-800/60">
 <div className="flex items-center gap-2">
 <span className="text-lg">📐</span>
 <span className="text-slate-700 dark:text-slate-300 text-sm">Yanlış Açı</span>
 </div>
 <div className="text-xl font-bold text-current mt-2">{stats.angleIssues}</div>
 </div>
 </div>

 {/* Skor Dağılımı */}
 <div className="bg-transparent rounded-xl p-6 border border-slate-200 dark:border-slate-800/60">
 <h3 className="text-current font-semibold mb-4">Skor Dağılımı</h3>
 <div className="space-y-3">
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">Mükemmel (95-100)</span>
 <span className="text-slate-700 dark:text-slate-300">{stats.excellent}</span>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full" style={{ width: `${stats.totalAnalyses > 0 ? (stats.excellent / stats.totalAnalyses) * 100 : 0}%` }} />
 </div>
 </div>
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">İyi (85-94)</span>
 <span className="text-slate-700 dark:text-slate-300">{stats.good}</span>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full" style={{ width: `${stats.totalAnalyses > 0 ? (stats.good / stats.totalAnalyses) * 100 : 0}%` }} />
 </div>
 </div>
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">İncelenecek (70-84)</span>
 <span className="text-slate-700 dark:text-slate-300">{stats.needsReview}</span>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full" style={{ width: `${stats.totalAnalyses > 0 ? (stats.needsReview / stats.totalAnalyses) * 100 : 0}%` }} />
 </div>
 </div>
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">Zayıf (50-69)</span>
 <span className="text-slate-700 dark:text-slate-300">{stats.poor}</span>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full" style={{ width: `${stats.totalAnalyses > 0 ? (stats.poor / stats.totalAnalyses) * 100 : 0}%` }} />
 </div>
 </div>
 <div>
 <div className="flex justify-between text-sm mb-1">
 <span className="text-slate-700 dark:text-slate-300">Red ({'<'}50)</span>
 <span className="text-slate-700 dark:text-slate-300">{stats.reject}</span>
 </div>
 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div className="bg-transparent h-2 rounded-full" style={{ width: `${stats.totalAnalyses > 0 ? (stats.reject / stats.totalAnalyses) * 100 : 0}%` }} />
 </div>
 </div>
 </div>
 </div>
 </>
 )}

 {activeTab === 'issues' && (
 <div className="bg-transparent rounded-xl border border-slate-200 dark:border-slate-800/60 overflow-hidden">
 <div className="p-4 border-b border-slate-100 dark:border-slate-800/60">
 <h3 className="text-current font-semibold">Tespit Edilen Sorunlar</h3>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="text-left text-sm text-current border-b border-slate-100 dark:border-slate-800/60">
 <th className="p-3">Tip</th>
 <th className="p-3">Önem</th>
 <th className="p-3">Güven</th>
 <th className="p-3">Açıklama</th>
 <th className="p-3">Öneri</th>
 <th className="p-3">Durum</th>
 <th className="p-3">İşlem</th>
 </tr>
 </thead>
 <tbody>
 {issues.length === 0 ? (
 <tr>
 <td colSpan={7} className="p-6 text-center text-current">
 Henüz sorun tespit edilmedi.
 </td>
 </tr>
 ) : (
 issues.map((issue) => (
 <tr key={issue.id} className="table-row text-sm">
 <td className="p-3">
 <span className="text-slate-700 dark:text-slate-300">{issue.issueType}</span>
 </td>
 <td className="p-3">
 <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-current ${getSeverityColor(issue.severity)}`}>
 {issue.severity}
 </span>
 </td>
 <td className="p-3">
 <span className="text-slate-700 dark:text-slate-300">%{issue.confidence}</span>
 </td>
 <td className="p-3 max-w-xs">
 <span className="text-current truncate block">{issue.description}</span>
 </td>
 <td className="p-3 max-w-xs">
 <span className="text-slate-700 dark:text-slate-300 text-xs truncate block">{issue.recommendation}</span>
 </td>
 <td className="p-3">
 {issue.resolved ? (
 <span className="text-slate-700 dark:text-slate-300 text-xs">Çözüldü</span>
 ) : issue.approved ? (
 <span className="text-slate-700 dark:text-slate-300 text-xs">Onaylandı</span>
 ) : (
 <span className="text-slate-700 dark:text-slate-300 text-xs">Bekliyor</span>
 )}
 </td>
 <td className="p-3">
 {!issue.resolved && (
 <div className="flex gap-1">
 <button
 onClick={() => handleApproveIssue(issue.id, true)}
 className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current rounded"
 >
 Onayla
 </button>
 <button
 onClick={() => handleApproveIssue(issue.id, false)}
 className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current rounded"
 >
 Reddet
 </button>
 </div>
 )}
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {activeTab === 'analyze' && (
 <div className="space-y-6">
 <div className="bg-transparent rounded-xl p-6 border border-slate-200 dark:border-slate-800/60">
 <h3 className="text-current font-semibold mb-4">Toplu Görsel Analizi</h3>
 <p className="text-slate-700 dark:text-slate-300 text-sm mb-4">
 Belirli sayıda ürünün görsellerini AI ile analiz edin.
 </p>
 <div className="flex flex-wrap gap-3 mb-4">
 {[100, 500, 1000, 5000].map((count) => (
 <button
 key={count}
 onClick={() => setBulkCount(count)}
 className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${ bulkCount === count ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700' }`}
 >
 {count.toLocaleString('tr-TR')} Ürün
 </button>
 ))}
 </div>
 <button
 onClick={handleBulkAnalyze}
 disabled={analyzing}
 className="px-6 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary rounded-lg text-sm font-medium transition-colors"
 >
 {analyzing ? 'Analiz Ediliyor...' : 'Analizi Başlat'}
 </button>
 {bulkResult && (
 <div className="mt-4 p-3 bg-transparent rounded-lg text-sm text-current">
 {bulkResult}
 </div>
 )}
 </div>

 {/* Hızlı Analiz Formu */}
 <div className="bg-transparent rounded-xl p-6 border border-slate-200 dark:border-slate-800/60">
 <h3 className="text-current font-semibold mb-4">Tek Ürün Analizi</h3>
 <p className="text-slate-700 dark:text-slate-300 text-sm mb-4">
 Belirli bir ürün ID'si için görsel analizi yapın.
 </p>
 <form
 onSubmit={async (e) => {
 e.preventDefault();
 const form = e.target as HTMLFormElement;
 const formData = new FormData(form);
 const productId = formData.get('productId') as string;
 if (!productId) return;

 setAnalyzing(true);
 try {
 const res = await fetch(`${API_BASE}/ai-image/analyze`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ productId }),
 });
 const json = await res.json();
 if (json.ok) {
 alert(`Analiz tamamlandı! Skor: ${json.data.analysis.overallScore}`);
 loadDashboard();
 loadIssues();
 } else {
 alert('Hata: ' + (json.error?.message || 'Bilinmeyen hata'));
 }
 } catch (err: any) {
 alert('Hata: ' + err.message);
 } finally {
 setAnalyzing(false);
 }
 }}
 className="flex gap-3"
 >
 <input
 name="productId"
 placeholder="Ürün ID'si girin..."
 className="flex-1 px-4 py-2 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-current placeholder-current focus:outline-none focus:ring-2 focus:ring-0"
 required
 />
 <button
 type="submit"
 disabled={analyzing}
 className="px-6 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary rounded-lg text-sm font-medium transition-colors"
 >
 {analyzing ? 'Analiz...' : 'Analiz Et'}
 </button>
 </form>
 </div>
 </div>
 )}
 </div>
 );
}
