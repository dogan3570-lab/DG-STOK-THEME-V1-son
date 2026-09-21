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

// Profit Engine API functions
export async function profitEngineCalculate(input: {
  grossSales: number;
  discount?: number;
  productCost: number;
  commission: number;
  shippingCost: number;
  serviceFee?: number;
  stopaj?: number;
  advertising?: number;
  marketing?: number;
  returnCost?: number;
  otherExpenses?: number;
  vatRate: number;
}) {
  return apiFetch('/profit-engine/calculate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function profitEngineSummary() {
  return apiFetch('/profit-engine/summary');
}

export async function profitEngineAnomalies() {
  return apiFetch('/profit-engine/anomalies');
}

export async function profitEngineLearning() {
  const r = await apiFetch('/profit-engine/learning');
  return { ok: r.ok, data: (r.data as any)?.data ?? r.data, error: r.error };
}

export async function profitEngineDetectAnomaly(input: {
  orderId: string;
  marketplaceKey: string;
  expected: number;
  actual: number;
}) {
  return apiFetch('/profit-engine/detect-anomaly', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function profitEngineSnapshots() {
  return apiFetch('/profit-engine/snapshots');
}

export async function profitEngineLearningAdd(input: {
  type: string;
  conditions: any[];
  result: number;
  source: string;
}) {
  return apiFetch('/profit-engine/learning', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function profitEngineSnapshotsList() {
  return apiFetch('/profit-engine/snapshots');
}

// ── Ticari Öğrenme API'leri (Commercial Learning) ──

function unwrapData<T = any>(r: { ok: boolean; data?: any; error?: string }): { ok: boolean; data?: T; error?: string } {
  return { ok: r.ok, data: (r.data?.data ?? r.data) as T, error: r.error };
}

export async function profitEngineLearnStats() {
  return unwrapData(await apiFetch('/profit-engine/learn/stats'));
}

export async function profitEngineLearnInsights(params?: { marketplace?: string; category?: string; metric?: string }) {
  const qs = new URLSearchParams();
  if (params?.marketplace) qs.set('marketplace', params.marketplace);
  if (params?.category) qs.set('category', params.category);
  if (params?.metric) qs.set('metric', params.metric);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return unwrapData(await apiFetch('/profit-engine/learn/insights' + suffix));
}

export async function profitEngineLearnAlerts() {
  return unwrapData(await apiFetch('/profit-engine/learn/alerts'));
}

export async function profitEngineLearnAccuracy(params?: { marketplace?: string; category?: string; metric?: string }) {
  const qs = new URLSearchParams();
  if (params?.marketplace) qs.set('marketplace', params.marketplace);
  if (params?.category) qs.set('category', params.category);
  if (params?.metric) qs.set('metric', params.metric);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return unwrapData(await apiFetch('/profit-engine/learn/accuracy' + suffix));
}

export async function profitEngineLearnDataStatus() {
  return unwrapData(await apiFetch('/profit-engine/learn/data-status'));
}

export async function profitEngineLearnEstimate(params: { marketplace: string; metric: string; official?: number; category?: string }) {
  const qs = new URLSearchParams({ marketplace: params.marketplace, metric: params.metric });
  if (params.official !== undefined) qs.set('official', String(params.official));
  if (params.category) qs.set('category', params.category);
  return unwrapData(await apiFetch('/profit-engine/learn/estimate?' + qs.toString()));
}

export async function profitEngineLearnSimulate(scenarios: Array<{
  orderId?: string;
  marketplaceKey?: string;
  category?: string;
  expected: Record<string, number>;
  actual: Record<string, number>;
  orderTotal?: number;
}>) {
  const r = await apiFetch('/profit-engine/learn/simulate', {
    method: 'POST',
    body: JSON.stringify({ scenarios }),
  });
  return unwrapData(r);
}
