import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import KpiCard from '../components/ui/KpiCard';

/* ============================================================
 TYPES
 ============================================================ */

interface MarketplaceStats {
 total: number;
 connected: number;
 connectionError: number;
 apiError: number;
 sentProducts: number;
 pendingProducts: number;
 failedProducts: number;
 successfulProducts: number;
}

interface MarketplaceItem {
 id: string;
 key: string;
 name: string;
 logo?: string;
 apiKey: string | null;
 apiSecret: string | null;
 apiUrl: string | null;
 apiStatus: string;
 tokenStatus: string;
 clientId: string | null;
 merchantId: string | null;
 token: string | null;
 webhookUrl: string | null;
 environment: 'production' | 'sandbox';
 active: boolean;
 settings: string | null;
 lastSyncAt: string | null;
 productCount: number;
 orderCount: number;
 createdAt: string;
 updatedAt: string;
}

interface MarketplaceFormData {
 name: string;
 key: string;
 apiKey: string;
 apiSecret: string;
 clientId: string;
 merchantId: string;
 token: string;
 webhookUrl: string;
 environment: 'production' | 'sandbox';
}

type TabView = 'list' | 'detail';
type DetailTab = 'settings' | 'sync' | 'logs';

interface SyncLog {
 id: string;
 type: 'product' | 'order' | 'inventory' | 'price';
 status: 'success' | 'error' | 'running' | 'pending';
 startedAt: string;
 completedAt: string | null;
 message: string;
 itemCount: number;
}

/* ============================================================
 CONSTANTS
 ============================================================ */

const MARKETPLACE_LOGOS: Record<string, string> = {
 trendyol: '🛒',
 tt: '🛒',
 hepsiburada: '📦',
 he: '📦',
 n11: '🏪',
 amazon: '📦',
 amazon_tr: '📦',
 çiçeksepeti: '🌸',
 ciceksepeti: '🌸',
 pt: '📱',
 pttavm: '📱',
 idefix: '📚',
 pazarama: '🛍️',
 woocommerce: '🛒',
 shopify: '🛍️',
};

const EMPTY_FORM: MarketplaceFormData = {
 name: '',
 key: '',
 apiKey: '',
 apiSecret: '',
 clientId: '',
 merchantId: '',
 token: '',
 webhookUrl: '',
 environment: 'production',
};

/* ============================================================
 HELPERS
 ============================================================ */

function getMarketplaceLogo(key: string): string {
 const k = key.toLowerCase();
 return MARKETPLACE_LOGOS[k] || '🛍️';
}

function generateKey(name: string): string {
 return name
 .toLowerCase()
 .replace(/[^a-z0-9]/g, '')
 .substring(0, 20) || 'pazaryeri';
}

function formatDate(dateStr: string | null): string {
 if (!dateStr) return '-';
 try {
 return new Date(dateStr).toLocaleString('tr-TR', {
 day: '2-digit',
 month: '2-digit',
 year: 'numeric',
 hour: '2-digit',
 minute: '2-digit',
 });
 } catch {
 return '-';
 }
}

function getApiStatusLabel(status: string): { label: string; color: string } {
 const map: Record<string, { label: string; color: string }> = {
 connected: { label: 'Bağlı', color: 'bg-primary/10 text-primary border-current' },
 ok: { label: 'Bağlı', color: 'bg-primary/10 text-primary border-current' },
 error: { label: 'Hata', color: 'bg-primary/10 text-primary border-current' },
 unauthorized: { label: 'Yetkisiz', color: 'bg-primary/10 text-primary border-current' },
 unknown: { label: 'Bilinmiyor', color: 'bg-primary/10 text-primary border-current' },
 timeout: { label: 'Zaman Aşımı', color: 'bg-primary/10 text-primary border-current' },
 };
 return map[status] || { label: status, color: 'bg-primary/10 text-primary border-current' };
}

function getTokenStatusLabel(status: string): { label: string; color: string } {
 const map: Record<string, { label: string; color: string }> = {
 valid: { label: 'Geçerli', color: 'bg-primary/10 text-primary' },
 expired: { label: 'Süresi Doldu', color: 'bg-primary/10 text-primary' },
 missing: { label: 'Eksik', color: 'bg-primary/10 text-primary' },
 about_to_expire: { label: 'Yaklaşan', color: 'bg-primary/10 text-primary' },
 };
 return map[status] || { label: status, color: 'bg-primary/10 text-primary' };
}

function getSyncStatusIcon(status: string): string {
 const map: Record<string, string> = {
 success: '✅',
 error: '❌',
 running: '🔄',
 pending: '⏳',
 };
 return map[status] || '❓';
}

/* ============================================================
 MAIN COMPONENT
 ============================================================ */

export default function MarketplacePage() {
 /* ---- State ------------------------------------------- */
 const [marketplaces, setMarketplaces] = useState<MarketplaceItem[]>([]);
 const [stats, setStats] = useState<MarketplaceStats | null>(null);
 const [loading, setLoading] = useState(true);
 const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

 /* Modal (Yeni / Düzenle) */
 const [showModal, setShowModal] = useState(false);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [formData, setFormData] = useState<MarketplaceFormData>(EMPTY_FORM);
 const [submitting, setSubmitting] = useState(false);

 /* Bağlantı Testi */
 const [testingIds, setTestingIds] = useState<Record<string, boolean>>({});

 /* Detay Paneli */
 const [view, setView] = useState<TabView>('list');
 const [selectedMarketplace, setSelectedMarketplace] = useState<MarketplaceItem | null>(null);
 const [detailTab, setDetailTab] = useState<DetailTab>('settings');
 const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
 const [syncLogsLoading, setSyncLogsLoading] = useState(false);

 /* ---- Veri Çekme ------------------------------------- */
 const fetchMarketplaces = useCallback(async () => {
 try {
 const res = await apiFetch<any>('/marketplaces');
 if (res.ok && res.data) {
 setMarketplaces(res.data.items || []);
 }
 } catch (err) {
 console.error('Pazaryeri listesi hatası:', err);
 }
 }, []);

 const fetchStats = useCallback(async () => {
 try {
 const res = await apiFetch<any>('/marketplaces/stats');
 if (res.ok && res.data) {
 setStats(res.data);
 }
 } catch (err) {
 console.error('Pazaryeri istatistik hatası:', err);
 }
 }, []);

 const fetchAll = useCallback(async () => {
 setLoading(true);
 await Promise.all([fetchMarketplaces(), fetchStats()]);
 setLoading(false);
 }, [fetchMarketplaces, fetchStats]);

 useEffect(() => {
 fetchAll();
 }, [fetchAll]);

 /* ---- Mesaj Yönetimi --------------------------------- */
 const showMessage = (type: 'success' | 'error', text: string) => {
 setMessage({ type, text });
 setTimeout(() => setMessage(null), 4000);
 };

 /* ---- Modal Yönetimi --------------------------------- */
 const openAddModal = () => {
 setEditingId(null);
 setFormData(EMPTY_FORM);
 setShowModal(true);
 };

 const openEditModal = (mp: MarketplaceItem) => {
 setEditingId(mp.id);
 setFormData({
 name: mp.name,
 key: mp.key,
 apiKey: mp.apiKey || '',
 apiSecret: '',
 clientId: mp.clientId || '',
 merchantId: mp.merchantId || '',
 token: mp.token || '',
 webhookUrl: mp.webhookUrl || '',
 environment: mp.environment || 'production',
 });

 // settings JSON içinden ek bilgileri çek
 if (mp.settings) {
 try {
 const s = JSON.parse(mp.settings);
 if (s.apiKey && !formData.apiKey) setFormData((prev) => ({ ...prev, apiKey: s.apiKey }));
 if (s.apiSecret && !formData.apiSecret) setFormData((prev) => ({ ...prev, apiSecret: s.apiSecret }));
 if (s.clientId) setFormData((prev) => ({ ...prev, clientId: s.clientId }));
 if (s.merchantId) setFormData((prev) => ({ ...prev, merchantId: s.merchantId }));
 if (s.token) setFormData((prev) => ({ ...prev, token: s.token }));
 if (s.webhookUrl) setFormData((prev) => ({ ...prev, webhookUrl: s.webhookUrl }));
 if (s.environment) setFormData((prev) => ({ ...prev, environment: s.environment }));
 } catch { /* ignore */ }
 }

 setShowModal(true);
 };

 const closeModal = () => {
 setShowModal(false);
 setEditingId(null);
 setFormData(EMPTY_FORM);
 };

 /* ---- Form İşlemleri --------------------------------- */
 const handleFormChange = (field: keyof MarketplaceFormData, value: string) => {
 setFormData((prev) => {
 const next = { ...prev, [field]: value };
 // Name değişince otomatik key oluştur (sadece yeni kayıtta)
 if (field === 'name' && !editingId) {
 next.key = generateKey(value);
 }
 return next;
 });
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setSubmitting(true);

 try {
 const isEdit = !!editingId;
 const url = isEdit ? `/marketplaces/${editingId}` : '/marketplaces';
 const method = isEdit ? 'PUT' : 'POST';

 const body: Record<string, string | boolean> = {
 key: formData.key || generateKey(formData.name),
 name: formData.name.trim(),
 environment: formData.environment,
 };

 if (formData.apiKey.trim()) body.apiKey = formData.apiKey.trim();
 if (formData.apiSecret.trim()) body.apiSecret = formData.apiSecret.trim();
 if (formData.clientId.trim()) body.clientId = formData.clientId.trim();
 if (formData.merchantId.trim()) body.merchantId = formData.merchantId.trim();
 if (formData.token.trim()) body.token = formData.token.trim();
 if (formData.webhookUrl.trim()) body.webhookUrl = formData.webhookUrl.trim();

 const res = await apiFetch(url, {
 method,
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });

 if (res.ok) {
 showMessage('success', isEdit ? '✅ Pazaryeri güncellendi' : '✅ Pazaryeri eklendi');
 closeModal();
 await fetchAll();
 } else {
 showMessage('error', `❌ ${res.error?.message || 'İşlem başarısız'}`);
 }
 } catch {
 showMessage('error', '❌ Ağ hatası');
 } finally {
 setSubmitting(false);
 }
 };

 /* ---- Silme ------------------------------------------ */
 const handleDelete = async (id: string, name: string) => {
 if (!confirm(`"${name}" pazaryerini silmek istediğinizden emin misiniz?\nBu işlem geri alınamaz.`)) return;
 try {
 const res = await apiFetch(`/marketplaces/${id}`, { method: 'DELETE' });
 if (res.ok) {
 showMessage('success', `🗑️ "${name}" silindi`);
 await fetchAll();
 // Detay görünümündeysek listeye dön
 if (selectedMarketplace?.id === id) {
 setView('list');
 setSelectedMarketplace(null);
 }
 } else {
 showMessage('error', '❌ Silme başarısız');
 }
 } catch {
 showMessage('error', '❌ Ağ hatası');
 }
 };

 /* ---- Bağlantı Testi --------------------------------- */
 const handleTestConnection = async (id: string) => {
 setTestingIds((prev) => ({ ...prev, [id]: true }));
 try {
 const res = await apiFetch<any>(`/marketplaces/${id}/test`, { method: 'POST' });
 if (res.ok && res.data?.ok) {
 showMessage('success', '✅ Bağlantı başarılı');
 } else {
 showMessage('error', `❌ ${res.error?.message || 'Bağlantı hatası'}`);
 }
 await fetchAll();
 } catch {
 showMessage('error', '❌ Ağ hatası');
 } finally {
 setTestingIds((prev) => ({ ...prev, [id]: false }));
 }
 };

 /* ---- Detay Paneli ----------------------------------- */
 const openDetail = (mp: MarketplaceItem) => {
 setSelectedMarketplace(mp);
 setDetailTab('settings');
 setSyncLogs([]);
 setView('detail');
 };

 const closeDetail = () => {
 setView('list');
 setSelectedMarketplace(null);
 setSyncLogs([]);
 };

 const fetchSyncLogs = async (marketplaceId: string) => {
 setSyncLogsLoading(true);
 try {
 const res = await apiFetch<any>(`/marketplaces/${marketplaceId}/sync-logs`);
 if (res.ok && res.data) {
 setSyncLogs(res.data.items || []);
 }
 } catch {
 setSyncLogs([]);
 } finally {
 setSyncLogsLoading(false);
 }
 };

 const handleDetailTabChange = (tab: DetailTab) => {
 setDetailTab(tab);
 if (tab === 'logs' && selectedMarketplace) {
 fetchSyncLogs(selectedMarketplace.id);
 }
 };

 const handleSyncNow = async (key: string) => {
 try {
 const res = await apiFetch('/actions/marketplace/sync', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ marketplaceKey: key, totalSteps: 5 }),
 });
 if (res.ok) {
 showMessage('success', '🔄 Senkronizasyon başlatıldı');
 } else {
 showMessage('error', `❌ ${res.error?.message || 'Senkronizasyon hatası'}`);
 }
 } catch {
 showMessage('error', '❌ Ağ hatası');
 }
 };

 /* ============================================================
 RENDER: ANA SAYFA
 ============================================================ */
 if (view === 'detail' && selectedMarketplace) {
 return (
 <DetailView
 mp={selectedMarketplace}
 activeTab={detailTab}
 syncLogs={syncLogs}
 syncLogsLoading={syncLogsLoading}
 onDetailTabChange={handleDetailTabChange}
 onClose={closeDetail}
 onSyncNow={handleSyncNow}
 onTestConnection={handleTestConnection}
 onEdit={() => {
 closeDetail();
 openEditModal(selectedMarketplace);
 }}
 />
 );
 }

 return (
 <div className="space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Pazaryeri Yönetimi</h2>
 <p className="text-sm text-current">
 Pazaryeri entegrasyonlarını yönetin, API bilgilerini girin, bağlantı testi yapın ve senkronizasyonu izleyin
 </p>
 </div>
 <button
 type="button"
 onClick={openAddModal}
 className="btn-ghost px-4 py-2 transition-colors"
 >
 + Yeni Pazaryeri Ekle
 </button>
 </div>

 {/* Bildirim Mesajı */}
 {message && (
 <div
 className={`rounded-lg border px-4 py-3 text-sm ${ message.type === 'success' ? 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current' : 'border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 text-current' }`}
 >
 {message.text}
 </div>
 )}

 {/* KPI Kartları */}
 <KPISection stats={stats} />

 {/* Pazaryeri Listesi veya Boş Durum */}
 {loading ? (
 <div className="flex items-center justify-center p-12 text-current">Yükleniyor...</div>
 ) : marketplaces.length === 0 ? (
 <EmptyState onAdd={openAddModal} />
 ) : (
 <MarketplaceTable
 items={marketplaces}
 onTest={handleTestConnection}
 onSync={(key) => handleSyncNow(key)}
 onEdit={openEditModal}
 onDelete={handleDelete}
 onDetail={openDetail}
 testingIds={testingIds}
 />
 )}

 {/* Modal */}
 {showModal && (
 <AddEditModal
 formData={formData}
 editingId={editingId}
 submitting={submitting}
 onChange={handleFormChange}
 onSubmit={handleSubmit}
 onClose={closeModal}
 />
 )}
 </div>
 );
}

/* ============================================================
 SUB-COMPONENTS
 ============================================================ */

/* ---- KPI Bölümü ---------------------------------------- */
function KPISection({ stats }: { stats: MarketplaceStats | null }) {
 const items = [
 { title: 'Toplam Pazaryeri', value: stats?.total ?? 0, subtitle: 'Kayıtlı pazaryeri', icon: '🛒', color: 'blue' as const },
 { title: 'Bağlı', value: stats?.connected ?? 0, subtitle: 'API bağlantısı aktif', icon: '🔗', color: 'green' as const },
 { title: 'Bağlantı Hatası', value: stats?.connectionError ?? 0, subtitle: 'Bağlantı sorunu olan', icon: '⚠️', color: 'red' as const },
 { title: 'API Hatası', value: stats?.apiError ?? 0, subtitle: 'API yetki/limit hatası', icon: '🚫', color: 'red' as const },
 { title: 'Gönderilen Ürün', value: (stats?.sentProducts ?? 0).toLocaleString('tr-TR'), subtitle: 'Pazaryerine gönderilen', icon: '📤', color: 'green' as const },
 { title: 'Bekleyen', value: (stats?.pendingProducts ?? 0).toLocaleString('tr-TR'), subtitle: 'Senkronizasyon bekleyen', icon: '⏳', color: 'yellow' as const },
 { title: 'Başarısız', value: (stats?.failedProducts ?? 0).toLocaleString('tr-TR'), subtitle: 'Hata alan ürünler', icon: '❌', color: 'red' as const },
 { title: 'Başarılı', value: (stats?.successfulProducts ?? 0).toLocaleString('tr-TR'), subtitle: 'Başarıyla senkronize', icon: '✅', color: 'green' as const },
 ];

 return (
 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
 {items.map((item) => (
 <KpiCard key={item.title} {...item} />
 ))}
 </div>
 );
}

/* ---- Boş Durum ----------------------------------------- */
function EmptyState({ onAdd }: { onAdd: () => void }) {
 return (
 <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-12 backdrop-blur-sm">
 <div className="text-5xl mb-4">🛒</div>
 <h3 className="text-lg font-semibold text-current">Henüz Pazaryeri Eklenmemiş</h3>
 <p className="mt-1 text-sm text-current">İlk pazaryerini ekleyerek entegrasyonları başlatın</p>
 <button
 type="button"
 onClick={onAdd}
 className="mt-6 btn-ghost px-6 py-2.5 transition-colors"
 >
 + İlk Pazaryerini Ekle
 </button>
 </div>
 );
}

/* ---- Pazaryeri Tablosu ---------------------------------- */
function MarketplaceTable({
 items,
 onTest,
 onSync,
 onEdit,
 onDelete,
 onDetail,
 testingIds,
}: {
 items: MarketplaceItem[];
 onTest: (id: string) => void;
 onSync: (key: string) => void;
 onEdit: (mp: MarketplaceItem) => void;
 onDelete: (id: string, name: string) => void;
 onDetail: (mp: MarketplaceItem) => void;
 testingIds: Record<string, boolean>;
}) {
 return (
 <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Pazaryeri</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">API Durumu</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Token</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Son Senk.</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Ürün / Sipariş</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Durum</th>
 <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-current">İşlemler</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {items.map((mp) => {
 const apiStatus = getApiStatusLabel(mp.apiStatus);
 const tokenStatus = getTokenStatusLabel(mp.tokenStatus);
 return (
 <tr
 key={mp.id}
 className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
 onClick={() => onDetail(mp)}
 >
 {/* Pazaryeri Adı & Logo */}
 <td className="px-4 py-3">
 <div className="flex items-center gap-3">
 <span className="text-2xl">{getMarketplaceLogo(mp.key)}</span>
 <div>
 <div className="text-sm font-medium text-current">{mp.name}</div>
 <div className="text-xs text-current">{mp.key}</div>
 </div>
 </div>
 </td>

 {/* API Durumu */}
 <td className="px-4 py-3">
 <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${apiStatus.color}`}>
 {apiStatus.label}
 </span>
 </td>

 {/* Token Durumu */}
 <td className="px-4 py-3">
 <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tokenStatus.color}`}>
 {tokenStatus.label}
 </span>
 </td>

 {/* Son Senkronizasyon */}
 <td className="px-4 py-3">
 <div className="text-sm text-current">{formatDate(mp.lastSyncAt)}</div>
 <div className="text-xs text-current">
 {mp.lastSyncAt
 ? `Oluşturma: ${formatDate(mp.createdAt)}`
 : 'Henüz senkronize edilmedi'}
 </div>
 </td>

 {/* Ürün / Sipariş Sayısı */}
 <td className="px-4 py-3">
 <div className="flex items-center gap-3 text-sm">
 <span className="text-slate-700 dark:text-slate-300" title="Ürün Sayısı">📦 {mp.productCount ?? 0}</span>
 <span className="text-slate-700 dark:text-slate-300" title="Sipariş Sayısı">📑 {mp.orderCount ?? 0}</span>
 </div>
 </td>

 {/* Durum */}
 <td className="px-4 py-3">
 {mp.active ? (
 <span className="flex items-center gap-1.5 text-sm text-current">
 <span className="flex h-2 w-2 rounded-full bg-transparent"></span>
 Aktif
 </span>
 ) : (
 <span className="flex items-center gap-1.5 text-sm text-current">
 <span className="flex h-2 w-2 rounded-full bg-transparent"></span>
 Pasif
 </span>
 )}
 </td>

 {/* İşlemler */}
 <td className="px-4 py-3 text-right">
 <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
 <button
 type="button"
 onClick={() => onTest(mp.id)}
 disabled={testingIds[mp.id]}
 className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 disabled:opacity-50 transition-colors"
 title="Bağlantı Testi"
 >
 {testingIds[mp.id] ? '⏳' : '🔌 Test'}
 </button>
 <button
 type="button"
 onClick={() => onSync(mp.key)}
 className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 title="Senkronize Et"
 >
 🔄 Sync
 </button>
 <button
 type="button"
 onClick={() => onEdit(mp)}
 className="rounded-lg p-1.5 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current transition-colors"
 title="Düzenle"
 >
 ✏️
 </button>
 <button
 type="button"
 onClick={() => onDelete(mp.id, mp.name)}
 className="rounded-lg p-1.5 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current transition-colors"
 title="Sil"
 >
 🗑️
 </button>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>
 );
}

/* ============================================================
 DETAY GÖRÜNÜMÜ
 ============================================================ */

function DetailView({
 mp,
 activeTab,
 syncLogs,
 syncLogsLoading,
 onDetailTabChange,
 onClose,
 onSyncNow,
 onTestConnection,
 onEdit,
}: {
 mp: MarketplaceItem;
 activeTab: DetailTab;
 syncLogs: SyncLog[];
 syncLogsLoading: boolean;
 onDetailTabChange: (tab: DetailTab) => void;
 onClose: () => void;
 onSyncNow: (key: string) => void;
 onTestConnection: (id: string) => void;
 onEdit: () => void;
}) {
 const apiStatus = getApiStatusLabel(mp.apiStatus);
 const tokenStatus = getTokenStatusLabel(mp.tokenStatus);

 const tabs: { key: DetailTab; label: string; icon: string }[] = [
 { key: 'settings', label: 'Ayarlar', icon: '⚙️' },
 { key: 'sync', label: 'Senkronizasyon', icon: '🔄' },
 { key: 'logs', label: 'Loglar', icon: '📝' },
 ];

 return (
 <div className="space-y-6">
 {/* Geri ve Başlık */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-4">
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg p-2 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current transition-colors"
 title="Geri Dön"
 >
 ←
 </button>
 <div className="flex items-center gap-3">
 <span className="text-3xl">{getMarketplaceLogo(mp.key)}</span>
 <div>
 <h2 className="text-lg font-semibold text-current">{mp.name}</h2>
 <p className="text-sm text-current">{mp.key}</p>
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={() => onTestConnection(mp.id)}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-2 text-sm font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 >
 🔌 Bağlantı Testi
 </button>
 <button
 type="button"
 onClick={() => onSyncNow(mp.key)}
 className="btn-ghost px-3 py-2 transition-colors"
 >
 🔄 Senkronize Et
 </button>
 <button
 type="button"
 onClick={onEdit}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 px-3 py-2 text-sm font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 >
 ✏️ Düzenle
 </button>
 </div>
 </div>

 {/* Durum Kartı */}
 <div className="grid gap-4 md:grid-cols-4">
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="text-xs text-current">API Durumu</div>
 <div className="mt-1">
 <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${apiStatus.color}`}>
 {apiStatus.label}
 </span>
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="text-xs text-current">Token Durumu</div>
 <div className="mt-1">
 <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tokenStatus.color}`}>
 {tokenStatus.label}
 </span>
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="text-xs text-current">Ortam</div>
 <div className="mt-1 text-sm font-medium text-current">
 {mp.environment === 'production' ? '🚀 Production' : '🧪 Sandbox'}
 </div>
 </div>
 <div className="panel-theme p-4 backdrop-blur-sm">
 <div className="text-xs text-current">Durum</div>
 <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-current">
 {mp.active ? (
 <>
 <span className="flex h-2 w-2 rounded-full bg-transparent"></span>
 Aktif
 </>
 ) : (
 <>
 <span className="flex h-2 w-2 rounded-full bg-transparent"></span>
 Pasif
 </>
 )}
 </div>
 </div>
 </div>

 {/* Sekmeler */}
 <div className="border-b border-slate-100 dark:border-slate-800/60">
 <div className="flex gap-6">
 {tabs.map((tab) => (
 <button
 key={tab.key}
 type="button"
 onClick={() => onDetailTabChange(tab.key)}
 className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${ activeTab === tab.key ? 'border-current text-current' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary' }`}
 >
 <span>{tab.icon}</span>
 {tab.label}
 </button>
 ))}
 </div>
 </div>

 {/* Sekme İçeriği */}
 {activeTab === 'settings' && <SettingsTab mp={mp} />}
 {activeTab === 'sync' && <SyncTab mp={mp} onSyncNow={() => onSyncNow(mp.key)} />}
 {activeTab === 'logs' && <LogsTab logs={syncLogs} loading={syncLogsLoading} />}
 </div>
 );
}

/* ---- Ayarlar Sekmesi ----------------------------------- */
function SettingsTab({ mp }: { mp: MarketplaceItem }) {
 let settings: Record<string, string> = {};
 if (mp.settings) {
 try { settings = JSON.parse(mp.settings); } catch { /* ignore */ }
 }

 const fields: { label: string; value: string | null; sensitive?: boolean }[] = [
 { label: 'API Key', value: mp.apiKey || settings.apiKey, sensitive: true },
 { label: 'API Secret', value: mp.apiSecret || settings.apiSecret, sensitive: true },
 { label: 'Client ID', value: mp.clientId || settings.clientId, sensitive: true },
 { label: 'Merchant ID', value: mp.merchantId || settings.merchantId, sensitive: true },
 { label: 'Token', value: mp.token || settings.token, sensitive: true },
 { label: 'Webhook URL', value: mp.webhookUrl || settings.webhookUrl },
 { label: 'Ortam', value: mp.environment || settings.environment },
 { label: 'API URL', value: mp.apiUrl || settings.apiUrl },
 ];

 return (
 <div className="panel-theme p-6 backdrop-blur-sm">
 <h3 className="mb-4 text-sm font-semibold text-current">API Yapılandırması</h3>
 <div className="grid gap-4 md:grid-cols-2">
 {fields.map((field) => (
 <div key={field.label} className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4">
 <div className="text-xs text-current">{field.label}</div>
 <div className="mt-1 text-sm font-medium text-current truncate">
 {field.value
 ? field.sensitive
 ? `${field.value.substring(0, 4)}${'•'.repeat(Math.min(16, field.value.length - 4))}`
 : field.value
 : <span className="text-current italic">Tanımlanmamış</span>
 }
 </div>
 </div>
 ))}
 </div>
 </div>
 );
}

/* ---- Senkronizasyon Sekmesi ----------------------------- */
function SyncTab({ mp, onSyncNow }: { mp: MarketplaceItem; onSyncNow: () => void }) {
 const syncTypes = [
 { label: 'Ürün Senkronizasyonu', desc: 'Ürünleri pazaryerine gönder', icon: '📦', action: 'Ürünleri Senkronize Et' },
 { label: 'Stok Senkronizasyonu', desc: 'Stok bilgilerini güncelle', icon: '📊', action: 'Stokları Senkronize Et' },
 { label: 'Fiyat Senkronizasyonu', desc: 'Fiyat bilgilerini güncelle', icon: '💰', action: 'Fiyatları Senkronize Et' },
 { label: 'Sipariş Senkronizasyonu', desc: 'Siparişleri pazaryerinden çek', icon: '📑', action: 'Siparişleri Senkronize Et' },
 { label: 'Toplu Senkronizasyon', desc: 'Tüm verileri senkronize et', icon: '🔄', action: 'Tümünü Senkronize Et' },
 ];

 return (
 <div className="panel-theme p-6 backdrop-blur-sm">
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-sm font-semibold text-current">Senkronizasyon İşlemleri</h3>
 <div className="text-xs text-current">
 Son Senkronizasyon: {formatDate(mp.lastSyncAt)}
 </div>
 </div>
 <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
 {syncTypes.map((item) => (
 <div
 key={item.label}
 className="rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-4 hover:border-current transition-colors"
 >
 <div className="flex items-center gap-3 mb-3">
 <span className="text-2xl">{item.icon}</span>
 <div>
 <div className="text-sm font-medium text-current">{item.label}</div>
 <div className="text-xs text-current">{item.desc}</div>
 </div>
 </div>
 <button
 type="button"
 onClick={onSyncNow}
 className="w-full btn-ghost px-3 py-2 transition-colors"
 >
 {item.action}
 </button>
 </div>
 ))}
 </div>
 </div>
 );
}

/* ---- Loglar Sekmesi ------------------------------------- */
function LogsTab({ logs, loading }: { logs: SyncLog[]; loading: boolean }) {
 if (loading) {
 return (
 <div className="flex items-center justify-center p-12 text-current">Loglar yükleniyor...</div>
 );
 }

 if (logs.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-12 backdrop-blur-sm">
 <div className="text-4xl mb-3">📝</div>
 <h3 className="text-sm font-semibold text-current">Henüz Log Kaydı Yok</h3>
 <p className="text-xs text-current mt-1">Senkronizasyon işlemleri burada görünecek</p>
 </div>
 );
 }

 return (
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="border-b border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40">
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Tip</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Durum</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Mesaj</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Öğe Sayısı</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Başlangıç</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Bitiş</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {logs.map((log) => (
 <tr key={log.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
 <td className="px-4 py-3 text-sm text-current">{getSyncStatusIcon(log.type)} {log.type}</td>
 <td className="px-4 py-3">
 <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${ log.status === 'success' ? 'bg-primary/10 text-primary' : log.status === 'error' ? 'bg-primary/10 text-primary' : log.status === 'running' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary' }`}>
 {getSyncStatusIcon(log.status)}
 {log.status === 'success' ? 'Başarılı' : log.status === 'error' ? 'Hata' : log.status === 'running' ? 'Çalışıyor' : 'Bekliyor'}
 </span>
 </td>
 <td className="px-4 py-3 text-sm text-current max-w-[250px] truncate">{log.message || '-'}</td>
 <td className="px-4 py-3 text-sm text-current">{log.itemCount}</td>
 <td className="px-4 py-3 text-sm text-current">{formatDate(log.startedAt)}</td>
 <td className="px-4 py-3 text-sm text-current">{formatDate(log.completedAt)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 );
}

/* ============================================================
 EKLE / DÜZENLE MODAL
 ============================================================ */

function AddEditModal({
 formData,
 editingId,
 submitting,
 onChange,
 onSubmit,
 onClose,
}: {
 formData: MarketplaceFormData;
 editingId: string | null;
 submitting: boolean;
 onChange: (field: keyof MarketplaceFormData, value: string) => void;
 onSubmit: (e: React.FormEvent) => void;
 onClose: () => void;
}) {
 return (
 <div className="fixed inset-0 z-50 flex items-start justify-center bg-transparent/50 backdrop-blur-sm pt-10 overflow-y-auto">
 <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 shadow-xl my-10">
 {/* Sabit Başlık */}
 <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100 dark:border-slate-800/60">
 <div>
 <h3 className="text-lg font-semibold text-current">
 {editingId ? 'Pazaryerini Düzenle' : 'Yeni Pazaryeri Ekle'}
 </h3>
 <p className="text-sm text-current mt-1">
 {editingId
 ? 'API bilgilerini güncelleyin'
 : 'Yeni bir pazaryeri entegrasyonu ekleyin'}
 </p>
 </div>
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 >
 ✕
 </button>
 </div>

 {/* Scrollable İçerik */}
 <form onSubmit={onSubmit} className="overflow-y-auto p-6 space-y-5 max-h-[65vh]">
 {/* Temel Bilgiler */}
 <div>
 <h4 className="text-sm font-semibold text-current mb-3 flex items-center gap-2">
 <span>📋</span> Temel Bilgiler
 </h4>
 <div className="grid gap-4 md:grid-cols-2">
 <div>
 <label className="block text-sm font-medium text-current mb-1">
 Pazaryeri Adı <span className="text-slate-700 dark:text-slate-300">*</span>
 </label>
 <input
 type="text"
 value={formData.name}
 onChange={(e) => onChange('name', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="Örn: Trendyol, Hepsiburada"
 required
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">
 Key (Otomatik) <span className="text-slate-700 dark:text-slate-300">*</span>
 </label>
 <input
 type="text"
 value={formData.key}
 onChange={(e) => onChange('key', e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current focus:border-current focus:outline-none"
 placeholder="trendyol"
 required
 />
 </div>
 </div>
 </div>

 {/* API Bilgileri */}
 <div className="border-t border-slate-100 dark:border-slate-800/60 pt-5">
 <h4 className="text-sm font-semibold text-current mb-3 flex items-center gap-2">
 <span>🔑</span> API Kimlik Bilgileri
 </h4>
 <div className="grid gap-4 md:grid-cols-2">
 <div>
 <label className="block text-sm font-medium text-current mb-1">API Key</label>
 <input
 type="text"
 value={formData.apiKey}
 onChange={(e) => onChange('apiKey', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="API Key / App Key"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">API Secret</label>
 <input
 type="password"
 value={formData.apiSecret}
 onChange={(e) => onChange('apiSecret', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="API Secret / App Secret"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Client ID</label>
 <input
 type="text"
 value={formData.clientId}
 onChange={(e) => onChange('clientId', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="Client ID (varsa)"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Merchant ID</label>
 <input
 type="text"
 value={formData.merchantId}
 onChange={(e) => onChange('merchantId', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="Merchant ID / Satıcı Kodu"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Token</label>
 <input
 type="password"
 value={formData.token}
 onChange={(e) => onChange('token', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="API Token / Bearer Token"
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Ortam</label>
 <select
 value={formData.environment}
 onChange={(e) => onChange('environment', e.target.value)}
 className="w-full rounded-lg border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 px-3 py-2 text-current focus:border-current focus:outline-none"
 >
 <option value="production">🚀 Production</option>
 <option value="sandbox">🧪 Sandbox (Test)</option>
 </select>
 </div>
 </div>
 </div>

 {/* Webhook */}
 <div className="border-t border-slate-100 dark:border-slate-800/60 pt-5">
 <h4 className="text-sm font-semibold text-current mb-3 flex items-center gap-2">
 <span>🔗</span> Webhook & Bağlantı
 </h4>
 <div className="grid gap-4 md:grid-cols-1">
 <div>
 <label className="block text-sm font-medium text-current mb-1">Webhook URL</label>
 <input
 type="url"
 value={formData.webhookUrl}
 onChange={(e) => onChange('webhookUrl', e.target.value)}
 className="w-full input-theme px-3 py-2$5"
 placeholder="https://example.com/webhook"
 />
 <p className="mt-1 text-xs text-current">
 Pazaryeri tarafından gönderilen bildirimlerin alınacağı URL
 </p>
 </div>
 </div>
 </div>

 {/* Butonlar */}
 <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/60">
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg px-4 py-2 text-sm font-medium text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
 >
 İptal
 </button>
 <button
 type="submit"
 disabled={submitting || !formData.name.trim()}
 className="btn-ghost px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
 >
 {submitting ? '⏳ İşleniyor...' : editingId ? '💾 Güncelle' : '➕ Oluştur'}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
}
