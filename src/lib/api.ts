const API_BASE = '';

export async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const token = localStorage.getItem('dgstok_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (res.status === 401) {
      localStorage.removeItem('dgstok_loggedin');
      localStorage.removeItem('dgstok_token');
      window.location.reload();
      return { ok: false, error: 'Oturum süreniz dolmuş' };
    }

    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: json?.error || `HTTP ${res.status}` };
    return { ok: true, data: json };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}
