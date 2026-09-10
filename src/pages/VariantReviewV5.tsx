// ==================== VARYANT İNCELEME V5.0 ====================
// DG STOK V5.0 - Sadece gerçek istisnalar gösterilir
// ================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { showToast } from '../components/ui/Toast';

interface V5Product {
 id: string;
 title: string | null;
 xmlKey: string;
 sku: string | null;
 barcode: string | null;
 variantStatus: string;
 category?: { id: string; name: string } | null;
 brand?: { id: string; name: string } | null;
 xmlSource?: { id: string; name: string } | null;
}

export default function VariantReviewV5() {
 const [products, setProducts] = useState<V5Product[]>([]);
 const [loading, setLoading] = useState(true);
 const [total, setTotal] = useState(0);
 const [page, setPage] = useState(1);
 const pageSize = 50;

 const fetchProblems = useCallback(async () => {
 setLoading(true);
 try {
 // Sadece MANUAL_REVIEW statüsündeki ürünleri getir
 const params = new URLSearchParams({
 page: String(page),
 limit: String(pageSize),
 variantStatus: 'MANUAL_REVIEW',
 });
 const r = await apiFetch<any>(`/products?${params}`);
 if (r.ok && r.data) {
 setProducts(r.data.items || []);
 setTotal(r.data.pagination?.total || 0);
 }
 } finally {
 setLoading(false);
 }
 }, [page]);

 useEffect(() => { fetchProblems(); }, [fetchProblems]);

 const handleApprove = async (id: string) => {
 const r = await apiFetch<any>(`/products/${id}`, {
 method: 'PUT',
 body: JSON.stringify({ variantStatus: 'AUTO_APPROVED' }),
 });
 if (r.ok) {
 showToast('success', '✅ Ürün onaylandı');
 fetchProblems();
 }
 };

 return (
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Varyant İnceleme V5</h2>
 <p className="text-sm text-current">
 Sadece AI'nın çözemediği gerçek istisnalar gösterilir
 </p>
 </div>
 <span className="text-sm text-current">{total} ürün</span>
 </div>

 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 overflow-hidden">
 {loading ? (
 <div className="text-center py-12 text-current">Yükleniyor...</div>
 ) : products.length === 0 ? (
 <div className="text-center py-12 text-current">
 <div className="text-4xl mb-2">✅</div>
 <div className="text-sm font-medium text-current">
 İncelenecek ürün bulunamadı
 </div>
 <p className="text-xs text-current mt-1">
 Tüm ürünler V5 motoru tarafından otomatik karara bağlandı
 </p>
 </div>
 ) : (
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Ürün</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">XML</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Kategori</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">Durum</th>
 <th className="px-3 py-3 text-left text-xs font-semibold text-current">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {products.map(p => (
 <tr key={p.id} className="hover:bg-transparent">
 <td className="px-3 py-2.5">
 <div className="text-sm font-medium text-current">{p.title || p.xmlKey}</div>
 <div className="text-xs text-current">{p.sku || p.xmlKey}</div>
 </td>
 <td className="px-3 py-2.5 text-xs text-current">{p.xmlSource?.name || '-'}</td>
 <td className="px-3 py-2.5 text-xs text-current">{p.category?.name || '-'}</td>
 <td className="px-3 py-2.5">
 <span className="rounded-full bg-transparent text-current px-2 py-0.5 text-xs font-medium">
 ⏳ MANUAL_REVIEW
 </span>
 </td>
 <td className="px-3 py-2.5">
 <button
 onClick={() => handleApprove(p.id)}
 className="btn-ghost px-3 py-1.5"
 >
 ✅ Onayla
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </div>

 {total > pageSize && (
 <div className="flex items-center justify-between px-4 py-2">
 <span className="text-xs text-current">Sayfa {page}/{Math.ceil(total / pageSize)}</span>
 <div className="flex gap-1">
 <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
 className="rounded px-3 py-1 text-xs text-current hover:bg-transparent disabled:opacity-30">◀</button>
 <button onClick={() => setPage(p => p + 1)} disabled={page * pageSize >= total}
 className="rounded px-3 py-1 text-xs text-current hover:bg-transparent disabled:opacity-30">▶</button>
 </div>
 </div>
 )}
 </div>
 );
}
