import React from 'react';
import { PageTitle, KpiCard, KpiRow, Section, EmptyState } from '../lib/design-system';

const sparkD = [4, 7, 3, 9, 5, 11, 8, 13, 6];

const MARKETPLACES = [
 { id: 'trendyol', name: 'Trendyol', logo: '🛒', status: 'connected', products: 12750, orders: 843, errors: 3, lastSync: '2 dk önce', apiVersion: 'v2', health: 96 },
 { id: 'hepsiburada', name: 'Hepsiburada', logo: '📦', status: 'connected', products: 8450, orders: 412, errors: 0, lastSync: '5 dk önce', apiVersion: 'v1', health: 100 },
 { id: 'n11', name: 'N11', logo: '🏪', status: 'pending', products: 0, orders: 0, errors: 0, lastSync: '-', apiVersion: '-', health: 0 },
 { id: 'pazarama', name: 'Pazarama', logo: '🛍️', status: 'pending', products: 0, orders: 0, errors: 0, lastSync: '-', apiVersion: '-', health: 0 },
 { id: 'amazon', name: 'Amazon TR', logo: '📦', status: 'error', products: 0, orders: 0, errors: 2, lastSync: '1 saat önce', apiVersion: 'SP-API', health: 45 },
 { id: 'ciceksepeti', name: 'ÇiçekSepeti', logo: '🌸', status: 'pending', products: 0, orders: 0, errors: 0, lastSync: '-', apiVersion: '-', health: 0 },
];

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
 connected: { label: 'Bağlı', color: 'bg-primary/10 text-primary border-current', dot: 'bg-transparent' },
 pending: { label: 'Beklemede', color: 'bg-primary/10 text-primary border-current', dot: 'bg-transparent' },
 error: { label: 'Hatalı', color: 'bg-primary/10 text-primary border-current', dot: 'bg-transparent' },
};

export default function MarketplaceIntegrationPage() {
 const healthColor = (h: number) => h >= 90 ? 'text-current' : h >= 70 ? 'text-current' : 'text-current';
 const healthBar = (h: number) => h >= 90 ? 'bg-transparent' : h >= 70 ? 'bg-transparent' : 'bg-transparent';

 return (
 <div className="space-y-5">
 <PageTitle title="🚚 Entegrasyon Merkezi" description="Tüm pazaryerlerini tek merkezden yönetin" />

 {/* 1. KPI */}
 <KpiRow>
 <KpiCard label="Bağlı Pazaryeri" value={MARKETPLACES.filter(m => m.status === 'connected').length + '/' + MARKETPLACES.length} icon="🏪" color="blue" trend={{ value: 2, positive: true }} sparklineData={sparkD} />
 <KpiCard label="Aktif Entegrasyon" value={MARKETPLACES.filter(m => m.status !== 'pending').length} icon="✅" color="emerald" trend={{ value: 1, positive: true }} sparklineData={sparkD} />
 <KpiCard label="Son Senkronizasyon" value="2 dk önce" icon="🔄" color="cyan" trend={{ value: 0, positive: true }} sparklineData={sparkD} />
 <KpiCard label="Bekleyen İşlem" value={3} icon="⏳" color="amber" trend={{ value: 5, positive: false }} sparklineData={sparkD} />
 <KpiCard label="Hatalı İşlem" value={5} icon="❌" color="rose" trend={{ value: 12, positive: false }} sparklineData={sparkD} />
 <KpiCard label="Sistem Sağlığı" value="%92" icon="💚" color="emerald" trend={{ value: 3, positive: true }} sparklineData={sparkD} />
 </KpiRow>

 {/* 2. PAZARYERİ KARTLARI */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
 {MARKETPLACES.map(mp => {
 const s = STATUS_MAP[mp.status] || STATUS_MAP.pending;
 return (
 <div key={mp.id} className="group rounded-2xl bg-transparent p-4 border border-slate-200 dark:border-slate-800/60 hover:border-current hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
 {/* Header */}
 <div className="flex items-center justify-between mb-3">
 <span className="text-2xl">{mp.logo}</span>
 <div className="flex items-center gap-1.5">
 <span className={`w-2 h-2 rounded-full ${s.dot}`} />
 <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
 </div>
 </div>
 <p className="text-sm font-semibold text-current mb-0.5">{mp.name}</p>
 <p className="text-[10px] text-current mb-3">API: {mp.apiVersion} · Son: {mp.lastSync}</p>
 {/* Stats */}
 <div className="space-y-1.5 text-[10px]">
 <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Ürün</span><span className="text-current font-medium">{mp.products.toLocaleString()}</span></div>
 <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Sipariş</span><span className="text-current font-medium">{mp.orders}</span></div>
 <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Hata</span><span className={mp.errors > 0 ? 'text-current font-medium' : 'text-current'}>{mp.errors}</span></div>
 </div>
 {/* Health */}
 <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <div className="flex items-center justify-between mb-1">
 <span className="text-[9px] text-current">Sağlık</span>
 <span className={`text-xs font-bold ${healthColor(mp.health)}`}>{mp.health}/100</span>
 </div>
 <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div className={`h-full rounded-full ${healthBar(mp.health)}`} style={{ width: mp.health + '%' }} />
 </div>
 </div>
 {/* Actions */}
 <div className="flex gap-1 mt-3">
 <button className="flex-1 rounded-lg bg-transparent py-1 text-[9px] text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all">🔍 Test</button>
 <button className="flex-1 rounded-lg bg-transparent py-1 text-[9px] text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all">⚙ Ayarlar</button>
 <button className="flex-1 rounded-lg bg-transparent py-1 text-[9px] text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all">📋 Log</button>
 </div>
 </div>
 );
 })}
 </div>

 {/* 3. API SAĞLIK MERKEZİ + SENKRONİZASYON */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
 <Section>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">💚</span></div>
 <h3 className="text-sm font-semibold text-current">API Sağlık Merkezi</h3>
 </div>
 {MARKETPLACES.filter(m => m.status !== 'pending').map(mp => (
 <div key={mp.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
 <span className="text-lg">{mp.logo}</span>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between">
 <p className="text-xs font-medium text-current">{mp.name}</p>
 <span className={`text-[10px] font-bold ${healthColor(mp.health)}`}>{mp.health}%</span>
 </div>
 <div className="h-1 rounded-full bg-transparent mt-1 overflow-hidden">
 <div className={`h-full rounded-full ${healthBar(mp.health)}`} style={{ width: mp.health + '%' }} />
 </div>
 </div>
 </div>
 ))}
 </Section>

 <Section>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">🔄</span></div>
 <h3 className="text-sm font-semibold text-current">Senkronizasyon Kuyruğu</h3>
 </div>
 <div className="space-y-2">
 {[
 { mp: 'Trendyol', action: 'Ürün Gönderimi', progress: 78, status: 'devam' },
 { mp: 'Trendyol', action: 'Stok Güncelleme', progress: 45, status: 'devam' },
 { mp: 'Hepsiburada', action: 'Sipariş Alma', progress: 100, status: 'tamam' },
 { mp: 'Amazon TR', action: 'Fiyat Güncelleme', progress: 30, status: 'hata' },
 ].map((item, i) => (
 <div key={i} className="p-2.5 rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60">
 <div className="flex items-center justify-between mb-1">
 <div className="flex items-center gap-2">
 <span className="text-xs text-current">{item.mp}</span>
 <span className="text-[10px] text-current">{item.action}</span>
 </div>
 <span className={`text-[10px] font-medium ${item.status === 'tamam' ? 'text-current' : item.status === 'hata' ? 'text-current' : 'text-current'}`}>
 {item.status === 'tamam' ? '%100' : item.status === 'hata' ? 'Hata' : `%${item.progress}`}
 </span>
 </div>
 <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
 <div className={`h-full rounded-full transition-all ${item.status === 'tamam' ? 'bg-transparent' : item.status === 'hata' ? 'bg-transparent' : 'bg-transparent'}`}
 style={{ width: (item.status === 'tamam' ? 100 : item.progress) + '%' }} />
 </div>
 </div>
 ))}
 </div>
 </Section>
 </div>

 {/* 4. 🛡️ AKILLI STOK KORUMA DASHBOARD */}
 <div className="rounded-2xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-5">
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">🛡️</span></div>
 <h3 className="text-sm font-semibold text-current">Akıllı Stok Koruma</h3>
 <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
 <span className="w-1.5 h-1.5 rounded-full bg-transparent animate-pulse" />
 Çalışıyor
 </span>
 </div>

 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
 {/* Bugün Kapandı */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Bugün Kapandı</p>
 <p className="text-2xl font-bold text-current">18</p>
 <p className="text-[9px] text-current mt-1">ürün</p>
 </div>

 {/* Bugün Açıldı */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Bugün Açıldı</p>
 <p className="text-2xl font-bold text-current">12</p>
 <p className="text-[9px] text-current mt-1">ürün</p>
 </div>

 {/* Bekleyen */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Bekleyen</p>
 <p className="text-2xl font-bold text-current">7</p>
 <p className="text-[9px] text-current mt-1">işlem</p>
 </div>

 {/* Son XML */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Son XML</p>
 <p className="text-lg font-bold text-current">11:42</p>
 <p className="text-[9px] text-current mt-1">bugün</p>
 </div>

 {/* Son API */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Son API</p>
 <p className="text-lg font-bold text-current">11:43</p>
 <p className="text-[9px] text-current mt-1">bugün</p>
 </div>

 {/* Başarı Oranı */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Başarı</p>
 <p className="text-2xl font-bold text-current">%99.6</p>
 <div className="h-1 rounded-full bg-transparent mt-2 overflow-hidden">
 <div className="h-full rounded-full bg-transparent" style={{ width: '99.6%' }} />
 </div>
 </div>

 {/* Hata */}
 <div className="rounded-xl bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 text-center">
 <p className="text-[9px] text-current uppercase tracking-wider mb-1">Hata</p>
 <p className="text-2xl font-bold text-current">2</p>
 <p className="text-[9px] text-current mt-1">son 24h</p>
 </div>
 </div>

 {/* Alt bilgi: Global/Pazaryeri mod + Kritik Stok Eşiği */}
 <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/60">
 <div className="flex items-center gap-1.5 text-[10px] text-current">
 <span className="w-1.5 h-1.5 rounded-full bg-transparent" />
 Global Mod · Kritik Stok: 3
 </div>
 <span className="text-slate-700 dark:text-slate-300">|</span>
 <button className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors">⚙ Yapılandır</button>
 <button className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors">📋 Loglar</button>
 <button className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary transition-colors">🛡️ Muaf Ürünler</button>
 </div>
 </div>

 {/* 5. HATA MERKEZİ + LOG */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
 <Section>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">❌</span></div>
 <h3 className="text-sm font-semibold text-current">Hata Merkezi</h3>
 </div>
 {[
 { mp: 'Amazon TR', code: 'AUTH_FAILED', msg: 'API kimlik doğrulama başarısız', count: 3, time: '5 dk önce' },
 { mp: 'Trendyol', code: 'RATE_LIMIT', msg: 'Rate limit aşıldı', count: 2, time: '12 dk önce' },
 { mp: 'Trendyol', code: 'PRODUCT_INVALID', msg: 'Ürün JSON formatı hatalı', count: 1, time: '1 saat önce' },
 ].map((err, i) => (
 <div key={i} className="rounded-lg bg-transparent border border-slate-200 dark:border-slate-800/60 p-3 mb-2 last:mb-0">
 <div className="flex items-center justify-between mb-1">
 <div className="flex items-center gap-2">
 <span className="text-[10px] font-semibold text-current">{err.mp}</span>
 <span className="text-[9px] text-current">{err.code}</span>
 </div>
 <span className="text-[9px] text-current">×{err.count} · {err.time}</span>
 </div>
 <p className="text-[11px] text-current">{err.msg}</p>
 <div className="flex gap-2 mt-2">
 <button className="text-[9px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">🔄 Tekrar Dene</button>
 <button className="text-[9px] text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary">📋 Log</button>
 </div>
 </div>
 ))}
 </Section>

 <Section>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">📝</span></div>
 <h3 className="text-sm font-semibold text-current">İşlem Geçmişi</h3>
 </div>
 <div className="space-y-0">
 {[
 { t: '10:45', mp: '🛒', e: 'Trendyol\'a ürün gönderildi', s: 'Başarılı' },
 { t: '10:30', mp: '📦', e: 'Hepsiburada\'dan sipariş alındı', s: 'Başarılı' },
 { t: '10:12', mp: '🛒', e: 'Trendyol stok güncellendi', s: 'Başarılı' },
 { t: '09:55', mp: '📦', e: 'Amazon TR API hatası', s: 'Hata' },
 { t: '09:30', mp: '🛒', e: 'Trendyol fiyat güncellendi', s: 'Başarılı' },
 ].map((log, i) => (
 <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
 <span className="w-12 text-[10px] text-current">{log.t}</span>
 <span className="text-sm">{log.mp}</span>
 <span className="flex-1 text-[11px] text-current truncate">{log.e}</span>
 <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${log.s === 'Başarılı' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'}`}>{log.s}</span>
 </div>
 ))}
 </div>
 </Section>
 </div>

 {/* 6. TEST MERKEZİ */}
 <Section>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-8 h-8 rounded-lg bg-transparent flex items-center justify-center"><span className="text-sm">🔍</span></div>
 <h3 className="text-sm font-semibold text-current">Test Merkezi</h3>
 </div>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {['🔌 Bağlantı Testi', '🔑 Yetki Testi', '📦 Ürün Testi', '📋 Sipariş Testi', '📊 Stok Testi', '💰 Fiyat Testi', '🔄 Toplu Test', '📝 Rapor Oluştur'].map((test, i) => (
 <button key={i} className="rounded-xl bg-transparent p-3 border border-slate-200 dark:border-slate-800/60 hover:border-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-all text-left">
 <p className="text-xs font-medium text-current">{test}</p>
 <p className="text-[9px] text-current mt-0.5">Son: -</p>
 </button>
 ))}
 </div>
 </Section>
 </div>
 );
}
