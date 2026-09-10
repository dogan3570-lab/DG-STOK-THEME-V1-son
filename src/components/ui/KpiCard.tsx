import React from 'react';

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: { value: number; isUp: boolean };
  color?: string;
}

export default function KpiCard({ title, value, subtitle, icon, trend, color = 'indigo' }: Props) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
    blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  };

  return (
    <div className="bg-white dark:bg-[#0f1520] rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-500 dark:text-slate-400">{title}</span>
        {icon && <span className={`p-2 rounded-lg ${colorMap[color] || colorMap.indigo}`}>{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</div>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>}
      {trend && (
        <p className={`text-xs mt-1 ${trend.isUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {trend.isUp ? '↑' : '↓'} {Math.abs(trend.value)}%
        </p>
      )}
    </div>
  );
}
