import React from 'react';

interface QualitySummary {
 id: string;
 name: string;
 type: string;
 totalProducts: number;
 overallScore: number;
 readinessRate: number;
 perfect: number;
 good: number;
 warning: number;
 error: number;
}

interface QualityReport {
 sourceId: string;
 sourceName: string;
 sourceType: string;
 totalProducts: number;
 overallScore: {
 overall: number;
 category: number;
 brand: number;
 variant: number;
 barcode: number;
 stock: number;
 price: number;
 image: number;
 content: number;
 integrity: number;
 details: Array<{ field: string; score: number; status: string; message: string }>;
 };
 summary: {
 perfect: number;
 good: number;
 warning: number;
 error: number;
 readinessRate: number;
 };
}

function getScoreColor(score: number): string {
 if (score >= 90) return 'text-current';
 if (score >= 70) return 'text-current';
 if (score >= 50) return 'text-current';
 return 'text-current';
}

function getScoreBg(score: number): string {
 if (score >= 90) return 'bg-transparent border-current';
 if (score >= 70) return 'bg-transparent border-current';
 if (score >= 50) return 'bg-transparent border-current';
 return 'bg-transparent border-current';
}

function getStatusIcon(status: string): string {
 switch (status) {
 case 'perfect': return '✅';
 case 'good': return '👍';
 case 'warning': return '⚠️';
 case 'error': return '❌';
 default: return '❓';
 }
}

const API_BASE = '';

export default function DataHealthCenter() {
 const [summaries, setSummaries] = React.useState<QualitySummary[]>([]);
 const [selectedReport, setSelectedReport] = React.useState<QualityReport | null>(null);
 const [loading, setLoading] = React.useState(true);
 const [error, setError] = React.useState<string | null>(null);

 React.useEffect(() => {
 loadSummaries();
 }, []);

 async function loadSummaries() {
 setLoading(true);
 setError(null);
 try {
 const res = await fetch(`${API_BASE}/api/xmlv2/quality`);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 setSummaries(data.items || []);
 } catch (err: any) {
 setError(err.message || 'Yuklenirken hata olustu');
 } finally {
 setLoading(false);
 }
 }

 async function loadReport(sourceId: string) {
 setSelectedReport(null);
 try {
 const res = await fetch(`${API_BASE}/api/xmlv2/quality/${sourceId}`);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json();
 setSelectedReport(data.report);
 } catch (err: any) {
 setError(err.message || 'Rapor yuklenemedi');
 }
 }

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-bold text-current">Veri Sağlık Merkezi</h1>
 <p className="text-slate-700 dark:text-slate-300 mt-1">XML Motoru V2 - Kalite analizi ve guven skoru</p>
 </div>
 <button
 onClick={loadSummaries}
 className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-current rounded-lg transition"
 >
 🔄 Yenile
 </button>
 </div>

 {error && (
 <div className="p-4 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-current">
 {error}
 </div>
 )}

 {loading ? (
 <div className="text-center py-12 text-current">Yukleniyor...</div>
 ) : summaries.length === 0 ? (
 <div className="text-center py-12 text-current">
 Henuz XML kaynagi bulunamadi. Once bir XML kaynagi ekleyin.
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {summaries.map((s) => (
 <div
 key={s.id}
 onClick={() => loadReport(s.id)}
 className={`p-4 rounded-lg border cursor-pointer transition hover:scale-[1.02] ${getScoreBg(s.overallScore)}`}
 >
 <div className="flex justify-between items-start mb-3">
 <h3 className="text-current font-semibold truncate">{s.name}</h3>
 <span className="text-xs text-current uppercase">{s.type}</span>
 </div>
 <div className="flex items-center gap-3 mb-3">
 <span className={`text-3xl font-bold ${getScoreColor(s.overallScore)}`}>
 {s.overallScore}
 </span>
 <span className="text-slate-700 dark:text-slate-300">/100</span>
 </div>
 <div className="flex gap-2 text-xs">
 <span className="px-2 py-1 rounded bg-primary/10 text-primary">
 ✅ {s.perfect}
 </span>
 <span className="px-2 py-1 rounded bg-primary/10 text-primary">
 👍 {s.good}
 </span>
 <span className="px-2 py-1 rounded bg-primary/10 text-primary">
 ⚠️ {s.warning}
 </span>
 <span className="px-2 py-1 rounded bg-primary/10 text-primary">
 ❌ {s.error}
 </span>
 </div>
 <div className="mt-3 text-sm text-current">
 {s.totalProducts} urun • Gonderime hazirlik: %{s.readinessRate}
 </div>
 </div>
 ))}
 </div>
 )}

 {selectedReport && (
 <div className="mt-6 p-6 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg">
 <div className="flex justify-between items-center mb-4">
 <h2 className="text-xl font-bold text-current">
 {selectedReport.sourceName} - Detayli Rapor
 </h2>
 <button
 onClick={() => setSelectedReport(null)}
 className="text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition"
 >
 ✕ Kapat
 </button>
 </div>

 {/* Genel Skor */}
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
 <div className="p-3 bg-transparent rounded-lg text-center">
 <div className={`text-2xl font-bold ${getScoreColor(selectedReport.overallScore.overall)}`}>
 {selectedReport.overallScore.overall}
 </div>
 <div className="text-xs text-current mt-1">Genel Puan</div>
 </div>
 <div className="p-3 bg-transparent rounded-lg text-center">
 <div className={`text-2xl font-bold ${getScoreColor(selectedReport.overallScore.category)}`}>
 {selectedReport.overallScore.category}
 </div>
 <div className="text-xs text-current mt-1">Kategori</div>
 </div>
 <div className="p-3 bg-transparent rounded-lg text-center">
 <div className={`text-2xl font-bold ${getScoreColor(selectedReport.overallScore.brand)}`}>
 {selectedReport.overallScore.brand}
 </div>
 <div className="text-xs text-current mt-1">Marka</div>
 </div>
 <div className="p-3 bg-transparent rounded-lg text-center">
 <div className={`text-2xl font-bold ${getScoreColor(selectedReport.overallScore.barcode)}`}>
 {selectedReport.overallScore.barcode}
 </div>
 <div className="text-xs text-current mt-1">Barkod</div>
 </div>
 <div className="p-3 bg-transparent rounded-lg text-center">
 <div className={`text-2xl font-bold ${getScoreColor(selectedReport.overallScore.image)}`}>
 {selectedReport.overallScore.image}
 </div>
 <div className="text-xs text-current mt-1">Gorsel</div>
 </div>
 </div>

 {/* Detayli Puanlar */}
 <div className="space-y-2 mb-6">
 {selectedReport.overallScore.details.map((d, i) => (
 <div key={i} className="flex items-center justify-between p-2 bg-transparent rounded">
 <div className="flex items-center gap-2">
 <span>{getStatusIcon(d.status)}</span>
 <span className="text-current capitalize">{d.field}</span>
 </div>
 <div className="flex items-center gap-3">
 <div className="w-32 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
 <div
 className={`h-2 rounded-full ${d.score >= 70 ? 'bg-transparent' : d.score >= 50 ? 'bg-transparent' : 'bg-transparent'}`}
 style={{ width: `${d.score}%` }}
 />
 </div>
 <span className={`text-sm font-mono ${getScoreColor(d.score)}`}>
 {d.score}/100
 </span>
 </div>
 </div>
 ))}
 </div>

 {/* Ozet */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="p-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-center">
 <div className="text-2xl font-bold text-current">{selectedReport.summary.perfect}</div>
 <div className="text-xs text-current">Mukemmel</div>
 </div>
 <div className="p-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-center">
 <div className="text-2xl font-bold text-current">{selectedReport.summary.good}</div>
 <div className="text-xs text-current">Iyi</div>
 </div>
 <div className="p-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-center">
 <div className="text-2xl font-bold text-current">{selectedReport.summary.warning}</div>
 <div className="text-xs text-current">Uyari</div>
 </div>
 <div className="p-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-center">
 <div className="text-2xl font-bold text-current">{selectedReport.summary.error}</div>
 <div className="text-xs text-current">Hata</div>
 </div>
 </div>

 <div className="mt-4 p-3 bg-transparent rounded-lg text-center">
 <div className="text-sm text-current">Gonderime Hazirlik Orani</div>
 <div className={`text-3xl font-bold mt-1 ${getScoreColor(selectedReport.summary.readinessRate)}`}>
 %{selectedReport.summary.readinessRate}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
