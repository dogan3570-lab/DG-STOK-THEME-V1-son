import { useEffect } from 'react';

export function useKeyboard(key: string, handler: (e: KeyboardEvent) => void, deps: any[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === key || (key === 'Escape' && e.key === 'Escape')) handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, ...deps]);
}
