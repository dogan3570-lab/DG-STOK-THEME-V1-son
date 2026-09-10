import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface ModuleCard {
 key: string; label: string; icon: string; desc: string; color: string;
 api: string; stats: Record<string, number | string>;
}

export default function Orchestrator() {
 const [modules, setModules] = useState<ModuleCard[]>([
 { key: 'brands', label: 'Brand Intelligence V6', icon: '🏷️', desc: 'Marka yönetimi, AI eşleştirme, ön ek sistemi', color: 'blue', api: '/brands/stats', stats: {} },
 { key: 'policy', label: 'Brand Policy Engine', icon: '📋', desc: '7 marka politikası, XML kaynağı bazlı kurallar', color: 'purple', api: '/brand-policies', stats: {} },
 { key: 'transform', label: 'Transformation V7', icon: '🔄', desc: 'Marka dönüşümü, başlık temizleme, validasyon', color: 'cyan', api: '/transform/logs', stats: {} },
 { key: 'title', label: 'Title Intelligence V8', icon: '📝', desc: 'Şablonlu başlık oluşturma, 12 değişken', color: 'teal', api: '/title/templates', stats: {} },
 { key: 'workflow', label: 'Workflow State', icon: '⚡', desc: 'Ürün yaşam döngüsü, hazırlık skoru', color: 'green', api: '/workflow-state/stats', stats: {} },
 { key: 'ai', label: 'AI Decision V1', icon: '🤖', desc: 'AI öğrenme, güven puanı, otomatik karar', color: 'violet', api: '/ai/stats', stats: {} },
 { key: 'plm', label: 'PLM V1', icon: '📊', desc: '24 aşamalı ürün yaşam döngüsü, sağlık skoru', color: 'orange', api: '/plm/health', stats: {} },
 { key: 'rules', label: 'Rule Engine V1', icon: '🔧', desc: '11 operatör, görsel kural oluşturma', color: 'red', api: '/rules', stats: {} },
 ]);

 useEffect(() => {
 modules.forEach((mod, i) => {
 apiFetch<any>(mod.api).then(res => {
 if (res.ok && res.data) {
 const stats = { ...mod.stats };
 if (mod.key === 'workflow' && res.data.total) { stats.total = res.data.total; stats.avgReadiness = `${res.data.avgReadiness || 0}%`; }
 if (mod.key === 'brands' && res.data.totalSystemBrands) { stats.marka = res.data.totalSystemBrands; stats.urun = res.data.matchedProducts; }
 if (mod.key === 'ai' && res.data.totalKnowledge) { stats.bilgi = res.data.totalKnowledge; stats.karar = res.data.totalDecisions; }
 if (mod.key === 'plm' && res.data.average) { stats.ortalama = `${res.data.average}%`; stats.toplam = res.data.total; }
 if (mod.key === 'rules' && res.data.items) stats.kural = res.data.items.length;
 if (mod.key === 'title' && res.data.items) stats.sablon = res.data.items.length;
 if (mod.key === 'policy' && res.data.items) stats.politika = res.data.items.length;
 if (mod.key === 'transform' && res.data.items) stats.islem = res.data.items.length;
 setModules(prev => { const n = [...prev]; n[i] = { ...n[i], stats }; return n; });
 }
 }).catch(() => {});
 });
 }, []);

 const colorClasses: Record<string, string> = {
 blue: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 purple: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 cyan: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 teal: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 green: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 violet: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 orange: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 red: 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current',
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-2xl font-bold text-current flex items-center gap-3">
 <span>🚀</span> DG STOK V5.0 Orchestrator
 <span className="text-xs bg-gradient-to-r from-transparent to-transparent text-current px-3 py-1 rounded-full font-normal">8 Modül Aktif</span>
 </h2>
 <p className="text-sm text-current mt-1">Tüm modüller tek ekranda · IQ300 Mission</p>
 </div>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
 {modules.map(mod => (
 <div key={mod.key} className={`rounded-xl border p-4 backdrop-blur-sm ${colorClasses[mod.color] || colorClasses.blue} hover:scale-[1.02] transition-all cursor-pointer`}
 onClick={() => {
 const pageMap: Record<string, string> = { brands: 'marka', policy: 'marka', transform: 'marka', title: 'marka', workflow: 'kontrol', ai: 'marka', plm: 'kontrol', rules: 'marka' };
 window.location.hash = pageMap[mod.key] || 'kontrol';
 }}>
 <div className="flex items-start justify-between mb-3">
 <span className="text-2xl">{mod.icon}</span>
 {Object.keys(mod.stats).length > 0 && (
 <span className="text-xs font-medium bg-transparent/10 px-2 py-1 rounded-full">
 {Object.values(mod.stats).slice(0, 2).join(' · ')}
 </span>
 )}
 </div>
 <h3 className="font-semibold text-sm mb-1">{mod.label}</h3>
 <p className="text-xs opacity-70">{mod.desc}</p>
 <div className="mt-3 flex flex-wrap gap-1">
 {Object.entries(mod.stats).map(([k, v]) => (
 <span key={k} className="text-[10px] bg-transparent/5 px-1.5 py-0.5 rounded">{k}: {v}</span>
 ))}
 </div>
 </div>
 ))}
 </div>

 {/* API Status */}
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🔌 API Durumu</h3>
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
 {modules.map(mod => (
 <div key={mod.key} className="flex items-center gap-2 p-2 rounded-lg bg-transparent">
 <span className="w-2 h-2 rounded-full bg-transparent" />
 <span className="text-current">{mod.icon}</span>
 <code className="text-current">/{mod.api.split('/')[1]}</code>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}
