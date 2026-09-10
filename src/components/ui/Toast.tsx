import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info'; }
interface ToastContextType { showToast: (message: string, type?: Toast['type']) => void; }

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm animate-slide-in ${
            t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-slate-700'
          }`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }

let _showToast: ((msg: string, type?: Toast['type']) => void) | null = null;

export function showToast(message: string, type: Toast['type'] = 'info') {
  if (_showToast) { _showToast(message, type); return; }
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm ${
    type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-slate-700'
  }`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function initToastBinder(fn: typeof _showToast) { _showToast = fn; }

export default function ToastContainer() { return null; }
