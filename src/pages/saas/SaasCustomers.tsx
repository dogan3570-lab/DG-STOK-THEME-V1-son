import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../lib/api';

// ==================== TYPES ====================
interface CustomerItem {
  id: string;
  email: string;
  role: string;
  name: string | null;
  createdAt: string;
  mustChangePassword: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ==================== COMPONENT ====================
export default function SaasCustomers() {
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(search ? { search } : {}),
      });
      const data = await apiFetch(`/users/customers?${params}`);
      setCustomers(data.items);
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err.message || 'Müşteriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchCustomers();
  };

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormData({ email: '', password: '', name: '' });
    setShowModal(true);
  };

  const openEditModal = (customer: CustomerItem) => {
    setEditingCustomer(customer);
    setFormData({ email: customer.email, password: '', name: customer.name || '' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCustomer(null);
    setFormData({ email: '', password: '', name: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingCustomer) {
        // Update
        const updateData: Record<string, any> = {
          name: formData.name.trim() || null,
        };
        if (formData.email.trim().toLowerCase() !== editingCustomer.email) {
          updateData.email = formData.email.trim().toLowerCase();
        }
        if (formData.password.trim()) {
          updateData.password = formData.password;
        }
        await apiFetch(`/users/customers/${editingCustomer.id}`, {
          method: 'PUT',
          body: updateData,
        });
        setMessage('✅ Müşteri güncellendi');
      } else {
        // Create
        await apiFetch('/users/customers', {
          method: 'POST',
          body: {
            email: formData.email.trim().toLowerCase(),
            password: formData.password,
            name: formData.name.trim() || null,
          },
        });
        setMessage('✅ Müşteri oluşturuldu');
      }
      closeModal();
      fetchCustomers();
    } catch (err: any) {
      setError(err.message || (editingCustomer ? 'Güncelleme başarısız' : 'Oluşturma başarısız'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer: CustomerItem) => {
    if (!confirm(`"${customer.email}" (${customer.name || 'isimsiz'}) silinecek. Emin misiniz?`)) return;
    setError('');
    try {
      await apiFetch(`/users/customers/${customer.id}`, { method: 'DELETE' });
      setMessage('✅ Müşteri pasifleştirildi');
      fetchCustomers();
    } catch (err: any) {
      setError(err.message || 'Silme başarısız');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">Yükleniyor...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Müşteri Yönetimi</h2>
          <p className="text-slate-500 dark:text-slate-400">SaaS CUSTOMER rolündeki kullanıcıları yönetin</p>
        </div>
        <button onClick={openCreateModal} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
          <i className="fa-solid fa-plus mr-2"></i> Yeni Müşteri
        </button>
      </div>

      {message && <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</div>}
      {error && <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</div>}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        {/* Search */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-posta veya isim ile ara..."
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors">Ara</button>
            {search && <button type="button" onClick={() => { setSearch(''); setPage(1); fetchCustomers(); }} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors">Temizle</button>}
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">E-posta</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">İsim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Oluşturulma</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Şifre Değişimi</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                    {search ? 'Arama sonucu bulunamadı' : 'Henüz müşteri yok'}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{customer.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{customer.name || '<span class="text-slate-400">—</span>'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{formatDate(customer.createdAt)}</td>
                    <td className="px-4 py-3">
                      {customer.mustChangePassword ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          <i className="fa-solid fa-exclamation-triangle mr-1"></i> Gerekli
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                          <i className="fa-solid fa-check mr-1"></i> Tamamlandı
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(customer)}
                          className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 inline-flex items-center justify-center transition-colors"
                          title="Düzenle"
                        >
                          <i className="fa-solid fa-pen text-xs"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(customer)}
                          className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50 inline-flex items-center justify-center transition-colors"
                          title="Pasifleştir"
                        >
                          <i className="fa-solid fa-trash text-xs"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Sayfa {pagination.page} / {pagination.totalPages} — Toplam {pagination.total} müşteri
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <i className="fa-solid fa-chevron-left"></i>
              </button>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <i className="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingCustomer ? 'Müşteri Düzenle' : 'Yeni Müşteri Oluştur'}
              </h3>
              <button onClick={closeModal} className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors inline-flex items-center justify-center">
                <i className="fa-solid fa-xmark text-slate-500"></i>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">E-posta <span className="text-rose-500">*</span></label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  disabled={!!editingCustomer}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Şifre <span className="text-rose-500">{editingCustomer ? '' : '*'}</span>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingCustomer}
                  placeholder={editingCustomer ? 'Boş bırakılırsa değişmez' : 'En az 8 karakter'}
                  minLength={8}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">İsim</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">İptal</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors">
                  {saving ? '⏳ Kaydediliyor...' : (editingCustomer ? 'Güncelle' : 'Oluştur')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}