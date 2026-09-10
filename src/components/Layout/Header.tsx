import React from 'react';

interface Props {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  notifications?: number;
  user?: any;
  onLogout?: () => void;
}

export default function Header({ title, subtitle, onRefresh, notifications = 0, user, onLogout }: Props) {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('dg_theme', next ? 'dark' : 'light');
  };

  return (
    <header className="h-14 bg-white dark:bg-[#0f1520] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 flex-shrink-0">
      <div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button onClick={onRefresh} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="Yenile">
            🔄
          </button>
        )}
        <button onClick={toggleTheme} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          {dark ? '☀️' : '🌙'}
        </button>
        {notifications > 0 && (
          <span className="relative">
            🔔
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{notifications}</span>
          </span>
        )}
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-300">{user.name || user.email}</span>
            {onLogout && (
              <button onClick={onLogout} className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">Çıkış</button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
