import React, { useEffect, useState } from 'react';

interface ShipmentItem {
 id: string;
 orderNo: string;
 cargoCompany: string;
 trackingNo: string;
 status: string;
 createdAt: string;
}

export default function Shipments() {
 const [shipments, setShipments] = useState<ShipmentItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [statusFilter, setStatusFilter] = useState('');

 useEffect(() => { fetchShipments(); }, [statusFilter]);

 async function fetchShipments() {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (statusFilter) params.append('status', statusFilter);
 const response = await fetch(`/shipments?${params}`, { credentials: 'include' });
 const data = await response.json();
 setShipments(data.items || []);
 } catch (error) {
 console.error('Error fetching shipments:', error);
 } finally {
 setLoading(false);
 }
 }

 const statusColors: Record<string, string> = {
 pending: 'bg-transparent text-current',
 picked_up: 'bg-transparent text-current',
 in_transit: 'bg-transparent text-current',
 delivered: 'bg-transparent text-current',
 failed: 'bg-transparent text-current',
 };

 const statusLabels: Record<string, string> = {
 pending: 'Beklemede',
 picked_up: 'Teslim Alındı',
 in_transit: 'Yolda',
 delivered: 'Teslim Edildi',
 failed: 'Başarısız',
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Gönderim Merkezi</h2>
 <p className="text-sm text-current">Kargo takibi ve gönderim yönetimi</p>
 </div>
 </div>

 <div className="flex flex-wrap gap-2">
 {['', 'pending', 'picked_up', 'in_transit', 'delivered', 'failed'].map((s) => (
 <button key={s} onClick={() => setStatusFilter(s)}
 className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${ statusFilter === s ? 'bg-transparent text-current' : 'bg-transparent text-current hover:bg-transparent' }`}>
 {s ? statusLabels[s] || s : 'Tümü'}
 </button>
 ))}
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="flex items-center justify-center p-8 text-current">Yükleniyor...</div>
 ) : shipments.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-8 text-current">
 <div className="text-4xl mb-2">🚚</div>
 <div>Gönderim bulunamadı</div>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Sipariş No</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Kargo</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Takip No</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Durum</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-current">Tarih</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {shipments.map((s) => (
 <tr key={s.id} className="bg-transparent hover:bg-transparent transition-colors">
 <td className="px-4 py-3 font-medium text-current">{s.orderNo}</td>
 <td className="px-4 py-3 text-sm text-current">{s.cargoCompany}</td>
 <td className="px-4 py-3 text-sm text-current">{s.trackingNo}</td>
 <td className="px-4 py-3">
 <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusColors[s.status] || 'bg-transparent text-current'}`}>
 {statusLabels[s.status] || s.status}
 </span>
 </td>
 <td className="px-4 py-3 text-sm text-current">{new Date(s.createdAt).toLocaleDateString('tr-TR')}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 );
}
