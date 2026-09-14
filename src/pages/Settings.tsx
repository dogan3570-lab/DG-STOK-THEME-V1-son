import React, { useEffect, useState } from 'react';

const SETTINGS_TABS = [
 { id: 'genel', label: '⚙️ Genel', desc: 'Sistem adı, tema, dil' },
 { id: 'sirket', label: '🏢 Şirket', desc: 'Firma bilgileri, vergi' },
 { id: 'xml', label: '🔗 XML', desc: 'XML işleme ayarları' },
 { id: 'api', label: '🔌 API', desc: 'API timeout, rate limit' },
 { id: 'ai', label: '🤖 AI', desc: 'AI servisleri, API anahtarları' },
 { id: 'smtp', label: '📧 SMTP', desc: 'E-posta ayarları' },
 { id: 'sifre', label: '🔑 Şifre', desc: 'Şifre değiştir' },
];

export default function SettingsPage() {
 const [settings, setSettings] = useState<Record<string, string>>({});
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState('');
 const [activeTab, setActiveTab] = useState('genel');
 const [showPasswordModal, setShowPasswordModal] = useState(false);
 const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
 const [passwordMessage, setPasswordMessage] = useState('');

 // Form state
 const [form, setForm] = useState({
 site_name: 'DG STOK V5.0', company_name: '', tax_office: '', tax_no: '',
 phone: '', email: '', address: '', website: '',
 xml_timeout: '30', xml_retry: '3', xml_encoding: 'UTF-8',
 api_timeout: '30', rate_limit: '100', jwt_expiry: '24',
 ai_provider: 'openai', ai_key: '', ai_model: 'gpt-4', ai_temp: '0.7',
 smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '',
 });

 useEffect(() => { fetchSettings(); }, []);

 async function fetchSettings() {
 try {
 const res = await fetch('/settings', { credentials: 'include' });
 const data = await res.json();
 const items = data.items || {};
 setSettings(items);
 // Map to form
 const mapped: any = {};
 for (const key of Object.keys(form)) mapped[key] = items[key] || (form as any)[key];
 setForm(prev => ({ ...prev, ...mapped }));
 } catch (err) { console.error(err); }
 finally { setLoading(false); }
 }

async function handleSave() {
  setSaving(true); setMessage('');
  try {
  const res = await fetch('/settings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
  body: JSON.stringify({ settings: form }),
  });
  if (res.ok) { setMessage('✅ Ayarlar kaydedildi'); fetchSettings(); }
  else setMessage('❌ Kaydetme başarısız');
  } catch (err) { setMessage('❌ Ağ hatası'); }
  finally { setSaving(false); setTimeout(() => setMessage(''), 3000); }
  }

async function handlePasswordChange(e: React.FormEvent) {
  e.preventDefault(); setPasswordMessage('');
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
  setPasswordMessage('❌ Şifreler eşleşmiyor'); return;
  }
  try {
  const res = await fetch('/auth/change-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
  body: JSON.stringify({ currentPassword: passwordForm.oldPassword, newPassword: passwordForm.newPassword }),
  });
  const data = await res.json();
  if (res.ok) { setPasswordMessage('✅ Şifre güncellendi'); setShowPasswordModal(false); }
  else setPasswordMessage(`❌ ${data.error?.message || 'Hata'}`);
  } catch (err) { setPasswordMessage('❌ Ağ hatası'); }
  }

 async function handleTest(key: string) {
 try {
 const res = await fetch(`/settings/test-${key}`, { method: 'POST', credentials: 'include' });
 const data = await res.json();
 alert(data.ok ? `✅ Test başarılı` : `❌ Test başarısız: ${data.error?.message || ''}`);
 } catch (err) { alert('❌ Test hatası'); }
 }

 function update(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })); }

 if (loading) return <div className="flex items-center justify-center h-64 text-current">Yükleniyor...</div>;

 return (
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-current">Sistem Ayarları</h2>
 <p className="text-sm text-current">Sistem yapılandırma ve yönetim paneli</p>
 </div>
 <button onClick={handleSave} disabled={saving}
 className="btn-ghost px-4 py-2 disabled:opacity-50">
 {saving ? '⏳ Kaydediliyor...' : '💾 Kaydet'}
 </button>
 </div>

 {message && <div className="rounded-lg bg-transparent p-3 text-sm text-current">{message}</div>}

 {/* Tabs */}
 <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-800/40 p-1">
 {SETTINGS_TABS.map(tab => (
 <button key={tab.id} onClick={() => setActiveTab(tab.id)}
 className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-primary/10 text-primary' : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary'}`}
 title={tab.desc}>{tab.label}</button>
 ))}
 </div>

 {/* ===== GENEL ===== */}
 {activeTab === 'genel' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">⚙️ Genel Ayarlar</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">Sistem Adı</label>
 <input type="text" value={form.site_name} onChange={(e) => update('site_name', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Firma Adı</label>
 <input type="text" value={form.company_name} onChange={(e) => update('company_name', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Telefon</label>
 <input type="text" value={form.phone} onChange={(e) => update('phone', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">E-posta</label>
 <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div className="md:col-span-2">
 <label className="block text-xs text-current mb-1">Adres</label>
 <textarea value={form.address} onChange={(e) => update('address', e.target.value)} rows={2}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 </div>
 )}

 {/* ===== ŞİRKET ===== */}
 {activeTab === 'sirket' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">🏢 Şirket Bilgileri</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">Vergi Dairesi</label>
 <input type="text" value={form.tax_office} onChange={(e) => update('tax_office', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Vergi No</label>
 <input type="text" value={form.tax_no} onChange={(e) => update('tax_no', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Web Sitesi</label>
 <input type="url" value={form.website} onChange={(e) => update('website', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 </div>
 )}

 {/* ===== XML ===== */}
 {activeTab === 'xml' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">🔗 XML Ayarları</h3>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">Timeout (sn)</label>
 <input type="number" value={form.xml_timeout} onChange={(e) => update('xml_timeout', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Retry Sayısı</label>
 <input type="number" value={form.xml_retry} onChange={(e) => update('xml_retry', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Encoding</label>
 <select value={form.xml_encoding} onChange={(e) => update('xml_encoding', e.target.value)}
 className="w-full select-theme px-3 py-2">
 <option>UTF-8</option><option>ISO-8859-9</option><option>Windows-1254</option>
 </select>
 </div>
 </div>
 </div>
 )}

 {/* ===== API ===== */}
 {activeTab === 'api' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">🔌 API Ayarları</h3>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">API Timeout (sn)</label>
 <input type="number" value={form.api_timeout} onChange={(e) => update('api_timeout', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Rate Limit (dk)</label>
 <input type="number" value={form.rate_limit} onChange={(e) => update('rate_limit', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">JWT Süre (saat)</label>
 <input type="number" value={form.jwt_expiry} onChange={(e) => update('jwt_expiry', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 <button onClick={() => handleTest('api')} className="mt-3 btn-ghost px-3 py-1.5">🔌 API Test</button>
 </div>
 )}

 {/* ===== AI ===== */}
 {activeTab === 'ai' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">🤖 AI Servis Ayarları</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">AI Sağlayıcı</label>
 <select value={form.ai_provider} onChange={(e) => update('ai_provider', e.target.value)}
 className="w-full select-theme px-3 py-2">
 <option value="openai">OpenAI</option>
 <option value="gemini">Google Gemini</option>
 <option value="claude">Anthropic Claude</option>
 <option value="deepseek">DeepSeek</option>
 <option value="mistral">Mistral</option>
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">API Anahtarı</label>
 <input type="password" value={form.ai_key} onChange={(e) => update('ai_key', e.target.value)}
 className="w-full select-theme px-3 py-2" placeholder="sk-..." />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Model</label>
 <select value={form.ai_model} onChange={(e) => update('ai_model', e.target.value)}
 className="w-full select-theme px-3 py-2">
 <option>gpt-4</option><option>gpt-4-turbo</option><option>gpt-3.5-turbo</option>
 <option>gemini-pro</option><option>claude-3</option><option>deepseek-chat</option>
 </select>
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Sıcaklık (0-2)</label>
 <input type="number" step="0.1" min="0" max="2" value={form.ai_temp} onChange={(e) => update('ai_temp', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 </div>
 )}

 {/* ===== SMTP ===== */}
 {activeTab === 'smtp' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">📧 SMTP Ayarları</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="block text-xs text-current mb-1">SMTP Sunucu</label>
 <input type="text" value={form.smtp_host} onChange={(e) => update('smtp_host', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Port</label>
 <input type="number" value={form.smtp_port} onChange={(e) => update('smtp_port', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Kullanıcı Adı</label>
 <input type="text" value={form.smtp_user} onChange={(e) => update('smtp_user', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Şifre</label>
 <input type="password" value={form.smtp_pass} onChange={(e) => update('smtp_pass', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Gönderen E-posta</label>
 <input type="email" value={form.smtp_from} onChange={(e) => update('smtp_from', e.target.value)}
 className="w-full select-theme px-3 py-2" />
 </div>
 </div>
 <button onClick={() => handleTest('email')} className="mt-3 btn-ghost px-3 py-1.5">📧 Test E-postası Gönder</button>
 </div>
 )}

 {/* ===== ŞİFRE ===== */}
 {activeTab === 'sifre' && (
 <div className="panel-theme p-4 backdrop-blur-sm">
 <h3 className="text-sm font-semibold text-current mb-4">🔑 Şifre Değiştir</h3>
 <div className="max-w-md space-y-3">
 <div>
 <label className="block text-xs text-current mb-1">Eski Şifre</label>
 <input type="password" value={passwordForm.oldPassword} onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Yeni Şifre</label>
 <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <div>
 <label className="block text-xs text-current mb-1">Yeni Şifre Tekrar</label>
 <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
 className="w-full select-theme px-3 py-2" />
 </div>
 <button onClick={handlePasswordChange}
 className="btn-ghost px-4 py-2">🔑 Şifreyi Güncelle</button>
 {passwordMessage && <div className="text-sm text-current">{passwordMessage}</div>}
 </div>
 </div>
 )}
 </div>
 );
}
