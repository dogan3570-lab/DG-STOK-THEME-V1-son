import React, { useEffect, useState } from 'react';

interface UserItem {
 id: string; email: string; role: string;
 name: string | null; phone?: string | null;
 department?: string | null; status?: string;
 lastLogin?: string; createdAt: string;
}

const ROLES = [
 'SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'PRODUCT_MANAGER', 'XML_MANAGER',
 'CATEGORY_MANAGER', 'BRAND_MANAGER', 'VARIANT_MANAGER', 'ORDER_MANAGER',
 'ACCOUNTING', 'WAREHOUSE', 'SUPPORT', 'REPORTS', 'VIEW_ONLY', 'GUEST',
];

const DEPARTMENTS = ['Yönetim', 'Operasyon', 'Muhasebe', 'Depo', 'Pazarlama', 'Müşteri Hizmetleri', 'IT', 'Destek'];

const ROLE_LABELS: Record<string, string> = {
 SUPER_ADMIN: '👑 Süper Admin', ADMIN: '🔧 Admin', OPERATOR: '⚙️ Operatör',
 PRODUCT_MANAGER: '📦 Ürün Yöneticisi', XML_MANAGER: '🔗 XML Yöneticisi',
 CATEGORY_MANAGER: '🗂️ Kategori Yöneticisi', BRAND_MANAGER: '🏷️ Marka Yöneticisi',
 VARIANT_MANAGER: '🧬 Varyant Yöneticisi', ORDER_MANAGER: '📦 Sipariş Yöneticisi',
 ACCOUNTING: '💰 Muhasebe', WAREHOUSE: '📦 Depo', SUPPORT: '🎧 Destek',
 REPORTS: '📊 Raporlama', VIEW_ONLY: '👁️ Sadece Görüntüleme', GUEST: '🚪 Misafir',
};

export default function UsersPage() {
 const [users, setUsers] = useState<UserItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [showModal, setShowModal] = useState(false);
 const [editingUser, setEditingUser] = useState<UserItem | null>(null);
 const [search, setSearch] = useState('');
 const [roleFilter, setRoleFilter] = useState('');
 const [statusFilter, setStatusFilter] = useState('');

 // Form
 const [form, setForm] = useState({ name: '', email: '', password: '', role: 'OPERATOR', department: '', phone: '', active: true });

 useEffect(() => { fetchUsers(); }, []);

 async function fetchUsers() {
 setLoading(true);
 try {
 const res = await fetch('/users', { credentials: 'include' });
 const data = await res.json();
 setUsers(data.items || []);
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

 function openCreate() {
 setEditingUser(null);
 setForm({ name: '', email: '', password: '', role: 'OPERATOR', department: '', phone: '', active: true });
 setShowModal(true);
 }

 function openEdit(user: UserItem) {
 setEditingUser(user);
 setForm({ name: user.name || '', email: user.email, password: '', role: user.role, department: user.department || '', phone: user.phone || '', active: user.status !== 'passive' });
 setShowModal(true);
 }

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 try {
 const url = editingUser ? `/users/${editingUser.id}` : '/users';
 const method = editingUser ? 'PUT' : 'POST';
 const body: any = { name: form.name, email: form.email, role: form.role, department: form.department, phone: form.phone };
 if (form.password) body.password = form.password;

 const res = await fetch(url, {
 method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
 body: JSON.stringify(body),
 });
 if (res.ok) {
 setShowModal(false);
 fetchUsers();
 } else {
 const data = await res.json();
 alert(data.error?.message || 'Hata oluştu');
 }
 } catch (err) { console.error(err); }
 }

 async function handleToggleActive(user: UserItem) {
 try {
 await fetch(`/users/${user.id}`, {
 method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
 body: JSON.stringify({ role: user.role, name: user.name }),
 });
 fetchUsers();
 } catch (err) { console.error(err); }
 }

 const filteredUsers = users.filter(u =>
 (!search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())) &&
 (!roleFilter || u.role === roleFilter)
 );

 const activeCount = users.length;
 const onlineCount = 1;

 return (
 <div className="space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Kullanıcı Yönetimi</h2>
 <p className="text-sm text-current">Rol bazlı yetkilendirme ve kullanıcı yönetimi</p>
 </div>
 <button onClick={openCreate} className="btn-ghost px-4 py-2">+ Yeni Kullanıcı</button>
 </div>

 {/* KPI Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Toplam Kullanıcı</div>
 <div className="text-lg font-semibold text-current">{users.length}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Aktif</div>
 <div className="text-lg font-semibold text-current">{activeCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Pasif</div>
 <div className="text-lg font-semibold text-current">{users.length - activeCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Online</div>
 <div className="text-lg font-semibold text-current">{onlineCount}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Rol</div>
 <div className="text-lg font-semibold text-current">{ROLES.length}</div>
 </div>
 <div className="panel-theme p-3 backdrop-blur-sm">
 <div className="text-xs text-current">Departman</div>
 <div className="text-lg font-semibold text-current">{DEPARTMENTS.length}</div>
 </div>
 </div>

 {/* Filters */}
 <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-3 backdrop-blur-sm">
 <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
 placeholder="Kullanıcı ara (ad, e-posta)..." className="flex-1 min-w-[200px] select-theme px-3 py-2" />
 <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tüm Roller</option>
 {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
 </select>
 <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
 className="select-theme px-3 py-2">
 <option value="">Tüm Durumlar</option>
 <option value="active">Aktif</option>
 <option value="passive">Pasif</option>
 </select>
 </div>

 {/* Users Table */}
 <div className="rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 backdrop-blur-sm">
 {loading ? (
 <div className="p-8 text-center text-current">Yükleniyor...</div>
 ) : filteredUsers.length === 0 ? (
 <div className="p-8 text-center text-current">
 <div className="text-4xl mb-2">👥</div>
 <div>Kullanıcı bulunamadı</div>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-transparent">
 <tr>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">Kullanıcı</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">E-posta</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">Rol</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">Departman</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">Durum</th>
 <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-current">Son Giriş</th>
 <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-current">İşlem</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-">
 {filteredUsers.map(user => (
 <tr key={user.id} className="bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
 <td className="px-4 py-3">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full bg-transparent flex items-center justify-center text-sm font-bold text-current">
 {(user.name || user.email)[0].toUpperCase()}
 </div>
 <div>
 <div className="text-sm font-medium text-current">{user.name || '-'}</div>
 <div className="text-xs text-current">{user.phone || '-'}</div>
 </div>
 </div>
 </td>
 <td className="px-4 py-3 text-sm text-current">{user.email}</td>
 <td className="px-4 py-3">
 <span className="rounded-full bg-transparent px-2.5 py-1 text-xs font-medium text-current">
 {ROLE_LABELS[user.role] || user.role}
 </span>
 </td>
 <td className="px-4 py-3 text-sm text-current">{user.department || '-'}</td>
 <td className="px-4 py-3">
 <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary">
 <span className="w-1.5 h-1.5 rounded-full bg-transparent"></span>
 Aktif
 </span>
 </td>
 <td className="px-4 py-3 text-xs text-current">-</td>
 <td className="px-4 py-3 text-right">
 <div className="flex items-center justify-end gap-1">
 <button onClick={() => openEdit(user)} className="rounded-lg p-1.5 text-current hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:text-current" title="Düzenle">✏️</button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Rol Kartları */}
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-3">🔐 Sistem Rolleri</h3>
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
 {ROLES.map(role => (
 <div key={role} className="rounded-lg bg-transparent p-3">
 <div className="text-xs text-current">{ROLE_LABELS[role] || role}</div>
 <div className="text-lg font-semibold text-current mt-1">{users.filter(u => u.role === role).length}</div>
 </div>
 ))}
 </div>
 </div>

 {/* Create/Edit Modal */}
 {showModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
 <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <h3 className="text-lg font-semibold text-current mb-4">{editingUser ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı'}</h3>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-sm font-medium text-current mb-1">Ad Soyad</label>
 <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">E-posta *</label>
 <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
 className="w-full select-theme px-3 py-2" required />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">{editingUser ? 'Yeni Şifre (boş = değişmez)' : 'Şifre *'}</label>
 <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Telefon</label>
 <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Rol *</label>
 <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
 className="w-full select-theme px-3 py-2">
 {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
 </select>
 </div>
 <div>
 <label className="block text-sm font-medium text-current mb-1">Departman</label>
 <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
 className="w-full select-theme px-3 py-2">
 <option value="">Seçilmedi</option>
 {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
 </select>
 </div>
 </div>
 <div className="flex justify-end gap-3 pt-2">
 <button type="button" onClick={() => setShowModal(false)}
 className="btn-ghost px-4 py-2">İptal</button>
 <button type="submit"
 className="btn-ghost px-4 py-2">
 {editingUser ? 'Güncelle' : 'Oluştur'}
 </button>
 </div>
 </form>
 </div>
 </div>
 )}
 </div>
 );
}
