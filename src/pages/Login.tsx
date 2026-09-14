import React, { useState } from 'react';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('admin@dgstok.com');
  const [password, setPassword] = useState('Admin1234!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.ok) {
        localStorage.setItem('dgstok_loggedin', 'true');
        // Token'ı localStorage'a kaydet (Authorization header'da kullanmak için)
        if (data.token) {
          localStorage.setItem('dgstok_token', data.token);
        }
        onLoginSuccess();
      } else {
        setError('E-posta veya şifre hatalı');
      }
    } catch (err) {
      setError('Sunucuya bağlanılamadı');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-[#090d16] transition-colors duration-300">
      <div className="w-full max-w-md panel-theme p-8 shadow-2xl">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/25">
            <span className="text-2xl font-bold">DG</span>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">DG STOK V5.0</div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">XML Entegratör + ERP + Pazaryeri Yönetim Sistemi</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">E-posta</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-slate-100 dark:bg-slate-800/50 border-none px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              placeholder="admin@dgstok.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-slate-100 dark:bg-slate-800/50 border-none px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary hover:bg-primary-hover text-white px-4 py-2.5 text-sm font-semibold shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          DG STOK V5.0 — Tüm hakları saklıdır.
        </div>
      </div>
    </div>
  );
}
