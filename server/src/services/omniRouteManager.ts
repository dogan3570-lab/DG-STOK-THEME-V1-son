import { prisma } from '../db/prisma.ts';

// ==================== TYPES ====================

export interface OmniRouteModelEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  free: boolean;
  health: 'healthy' | 'degraded' | 'unknown' | 'quarantined';
  lastError: string | null;
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  quarantineReason?: string | null;
}

export interface OmniRouteRegistry {
  version: 1;
  updatedAt: string;
  discoveredAt: string;
  lastDiscoveryError: string | null;
  models: OmniRouteModelEntry[];
}

export interface OmniRouteCompletionResult {
  ok: boolean;
  content: string | null;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  error?: string;
  errorCode?: string;
}

export interface OmniRouteStatus {
  connected: boolean;
  endpoint: string;
  version: string | null;
  modelsTotal: number;
  freeModelsTotal: number;
  healthyCount: number;
  degradedCount: number;
  quarantineCount: number;
  lastCheck: string | null;
  lastError: string | null;
}

// ==================== CONSTANTS ====================

const OMNIROUTE_BASE = process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128';
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY || '';
const REGISTRY_KEY = 'omniroute_registry';
const HEALTH_CHECK_TIMEOUT_MS = 10000;
const COMPLETION_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS_PER_REQUEST = 5;
const COOLDOWN_BASE_MS = 5 * 60 * 1000;
const COOLDOWN_MAX_MS = 4 * 60 * 60 * 1000;
const DISCOVERY_COOLDOWN_MS = 2 * 60 * 1000;

let discoveryLock = false;
let lastDiscoveryTimestamp = 0;

// ==================== REGISTRY I/O ====================

async function getSetting(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: REGISTRY_KEY } });
  return row?.value ?? null;
}

async function setSetting(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: REGISTRY_KEY },
    create: { key: REGISTRY_KEY, value },
    update: { value },
  });
}

function emptyRegistry(): OmniRouteRegistry {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    lastDiscoveryError: null,
    models: [],
  };
}

export async function getRegistry(): Promise<OmniRouteRegistry> {
  const raw = await getSetting();
  if (!raw) return emptyRegistry();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.models)) {
      return parsed as OmniRouteRegistry;
    }
    return emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(reg: OmniRouteRegistry): Promise<void> {
  reg.updatedAt = new Date().toISOString();
  await setSetting(JSON.stringify(reg));
}

// ==================== HEALTH CHECK ====================

export async function checkHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const res = await fetch(`${OMNIROUTE_BASE}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json() as any;
    return {
      ok: data.status === 'ok',
      version: data.version || null,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
}

// ==================== MODEL DISCOVERY ====================

async function fetchModels(): Promise<any[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (OMNIROUTE_API_KEY) {
    headers['Authorization'] = `Bearer ${OMNIROUTE_API_KEY}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const res = await fetch(`${OMNIROUTE_BASE}/v1/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP_${res.status} ${body}`.slice(0, 500));
    }

    const data = await res.json() as any;
    return Array.isArray(data?.data) ? data.data : [];
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
}

function isFreeModel(model: any): boolean {
  const id = String(model.id || '').toLowerCase();
  const name = String(model.name || '').toLowerCase();

  if (id.includes('-free') || name.includes('free')) return true;
  if (id.includes('free_') || name.includes('free ')) return true;

  const freeKeywords = ['big-pickle', 'hy3-free', 'nemotron-3-ultra-free', 'mimo-v2.5-free', 'deepseek-v4-flash-free'];
  if (freeKeywords.some(kw => id.includes(kw))) return true;

  return false;
}

function modelFromApi(model: any): OmniRouteModelEntry {
  const id = String(model.id || '');
  const provider = String(model.owned_by || model.provider || 'unknown');
  return {
    id,
    name: String(model.name || id),
    provider,
    contextWindow: typeof model.context_window === 'number' ? model.context_window : null,
    free: isFreeModel(model),
    health: 'unknown',
    lastError: null,
    lastErrorCode: null,
    lastLatencyMs: null,
    lastUsedAt: null,
    lastCheckedAt: null,
    consecutiveFailures: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
  };
}

/**
 * OmniRoute API'den modelleri keşfet ve DB'ye kaydet.
 * Mevcut health/cooldown/quarantine durumlarını korur.
 */
export async function discoverAndPersist(): Promise<{ ok: boolean; freeCount: number; totalCount: number; error?: string }> {
  if (discoveryLock) {
    return { ok: false, freeCount: 0, totalCount: 0, error: 'Discovery already in progress' };
  }
  discoveryLock = true;
  lastDiscoveryTimestamp = Date.now();

  try {
    const apiModels = await fetchModels();
    const totalCount = apiModels.length;

    const registry = await getRegistry();
    const existingMap = new Map<string, OmniRouteModelEntry>();
    for (const m of registry.models) {
      existingMap.set(m.id, m);
    }

    const apiModelIds = new Set<string>();
    const now = new Date().toISOString();
    const merged: OmniRouteModelEntry[] = [];

    for (const apiModel of apiModels) {
      const entry = modelFromApi(apiModel);
      apiModelIds.add(entry.id);

      const existing = existingMap.get(entry.id);
      if (existing) {
        existing.name = entry.name;
        existing.provider = entry.provider;
        existing.contextWindow = entry.contextWindow;
        existing.free = entry.free;
        existing.lastCheckedAt = now;
        merged.push(existing);
      } else {
        entry.lastCheckedAt = now;
        merged.push(entry);
      }
    }

    for (const existing of existingMap.values()) {
      if (!apiModelIds.has(existing.id)) {
        if (!existing.quarantineReason) {
          existing.health = 'quarantined';
          existing.quarantineReason = 'removed_by_omniroute';
          existing.lastError = 'Model removed from OmniRoute';
        }
        existing.lastCheckedAt = now;
        merged.push(existing);
      }
    }

    registry.models = merged;
    registry.discoveredAt = now;
    registry.lastDiscoveryError = null;
    await saveRegistry(registry);

    const freeCount = merged.filter(m => m.free).length;
    return { ok: true, freeCount, totalCount };
  } catch (err: any) {
    const msg = err.message || 'Discovery error';
    const registry = await getRegistry();
    registry.lastDiscoveryError = msg;
    await saveRegistry(registry);
    return { ok: false, freeCount: 0, totalCount: 0, error: msg };
  } finally {
    discoveryLock = false;
  }
}

// ==================== MODEL SELECTION ====================

export function isUsable(m: OmniRouteModelEntry): boolean {
  if (m.quarantineReason) return false;
  if (m.health === 'quarantined') return false;
  return true;
}

function modelScore(m: OmniRouteModelEntry): number {
  let score = 0;
  if (m.health === 'healthy') score += 100;
  else if (m.health === 'unknown') score += 50;
  else if (m.health === 'degraded') score += 20;

  const total = m.totalRequests || 1;
  const failRate = m.failedRequests / total;
  score -= failRate * 50;

  score -= Math.min(30, m.totalRequests / 3);

  if (m.contextWindow) {
    score += Math.min(30, m.contextWindow / 10000);
  }

  score += Math.min(20, m.successfulRequests / 10);

  if (m.lastUsedAt) {
    const hoursSinceUse = (Date.now() - new Date(m.lastUsedAt).getTime()) / 3600000;
    if (hoursSinceUse < 1) score -= 10;
  }

  return score;
}

export async function selectBestFreeModel(exclude: Set<string> = new Set()): Promise<OmniRouteModelEntry | null> {
  const registry = await getRegistry();
  const usable = registry.models.filter(m => m.free && isUsable(m) && !exclude.has(m.id));
  if (usable.length === 0) return null;
  usable.sort((a, b) => modelScore(b) - modelScore(a));
  return usable[0] || null;
}

// ==================== OUTCOME RECORDING ====================

function computeCooldownDuration(failures: number): number {
  const duration = COOLDOWN_BASE_MS * Math.pow(2, Math.min(failures - 1, 5));
  return Math.min(duration, COOLDOWN_MAX_MS);
}

export async function recordModelOutcome(
  modelId: string,
  ok: boolean,
  errorCode?: string,
  errorMsg?: string,
  latencyMs?: number
): Promise<void> {
  const registry = await getRegistry();
  const model = registry.models.find(m => m.id === modelId);
  if (!model) return;

  const now = new Date().toISOString();
  model.lastUsedAt = now;
  model.lastCheckedAt = now;

  if (ok) {
    model.totalRequests++;
    model.successfulRequests++;
    model.health = 'healthy';
    model.consecutiveFailures = 0;
    model.lastError = null;
    model.lastErrorCode = null;
    model.lastLatencyMs = latencyMs ?? null;
  } else {
    model.totalRequests++;
    model.failedRequests++;
    model.lastError = errorMsg ?? null;
    model.lastErrorCode = errorCode ?? null;
    model.lastLatencyMs = latencyMs ?? null;

    if (errorCode === 'MODEL_NOT_FOUND' || errorCode === 'MODEL_DEPRECATED' || errorCode === 'UNSUPPORTED_MODEL') {
      model.health = 'quarantined';
      model.quarantineReason = errorMsg || 'Model not found';
    } else if (errorCode === 'RATE_LIMIT' || errorCode === 'TIMEOUT' || errorCode === 'SERVER_ERROR') {
      model.consecutiveFailures++;
      model.health = 'degraded';
    } else if (errorCode === 'INVALID_KEY' || errorCode === 'FORBIDDEN') {
      model.health = 'quarantined';
      model.quarantineReason = errorMsg || 'Authentication failed';
    }
  }

  await saveRegistry(registry);
}

// ==================== COMPLETION ====================

export function classifyError(err: any): { type: string; errorCode: string; errorMsg: string } {
  const msg = String(err?.message || err?.toString?.() || '').toLowerCase();

  if (msg.includes('401') || msg.includes('invalid_key') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('403')) {
    return { type: 'auth', errorCode: msg.includes('403') ? 'FORBIDDEN' : 'INVALID_KEY', errorMsg: 'API key yetkisi geçersiz' };
  }
  if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('too many requests')) {
    return { type: 'transient', errorCode: 'RATE_LIMIT', errorMsg: 'Rate limit aşıldı' };
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    return { type: 'transient', errorCode: 'TIMEOUT', errorMsg: 'İstek zaman aşımı' };
  }
  if (msg.includes('404') || msg.includes('model_not_found') || msg.includes('model not found') || msg.includes('unavailable')) {
    return { type: 'permanent', errorCode: 'MODEL_NOT_FOUND', errorMsg: 'Model bulunamadı/kullanılamıyor' };
  }
  if (msg.includes('402') || msg.includes('payment required') || msg.includes('insufficient')) {
    return { type: 'auth', errorCode: 'INSUFFICIENT_CREDITS', errorMsg: 'Bakiye yetersiz' };
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return { type: 'transient', errorCode: 'SERVER_ERROR', errorMsg: 'Sunucu hatası' };
  }

  return { type: 'unknown', errorCode: 'UNKNOWN', errorMsg: msg.slice(0, 200) || 'Bilinmeyen hata' };
}

/**
 * OmniRoute üzerinden completion yapar.
 * Free modeller ile fallback zinciri çalıştırır.
 */
export async function completeWithFreeModel(request: {
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}): Promise<OmniRouteCompletionResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (OMNIROUTE_API_KEY) {
    headers['Authorization'] = `Bearer ${OMNIROUTE_API_KEY}`;
  }

  const excluded = new Set<string>();
  let lastError: string | null = null;
  let lastErrorCode: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_REQUEST; attempt++) {
    const modelEntry = await selectBestFreeModel(excluded);
    if (!modelEntry) {
      return {
        ok: false,
        content: null,
        model: 'none',
        error: lastError ? `Tüm modeller başarısız: ${lastError}` : 'Uygun ücretsiz model bulunamadı',
        errorCode: lastErrorCode || 'NO_MODEL_AVAILABLE',
      };
    }

    excluded.add(modelEntry.id);
    const startTime = Date.now();

    const body: any = {
      model: modelEntry.id,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: request.max_tokens ?? 1024,
      stream: false,
    };
    if (request.response_format) {
      body.response_format = request.response_format;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);

      const res = await fetch(`${OMNIROUTE_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        const errorCode = `HTTP_${res.status}`;
        const errorMsg = errorBody || `HTTP ${res.status}`;
        const classified = classifyError(new Error(`${errorCode} ${errorMsg}`));

        await recordModelOutcome(modelEntry.id, false, classified.errorCode, classified.errorMsg, latencyMs);

        lastError = classified.errorMsg;
        lastErrorCode = classified.errorCode;
        continue;
      }

      const data: any = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? null;
      const usage = data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined;

      await recordModelOutcome(modelEntry.id, true, undefined, undefined, latencyMs);

      return {
        ok: true,
        content,
        model: modelEntry.id,
        usage,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const classified = classifyError(err);
      await recordModelOutcome(modelEntry.id, false, classified.errorCode, classified.errorMsg, latencyMs);

      lastError = classified.errorMsg;
      lastErrorCode = classified.errorCode;
    }
  }

  return {
    ok: false,
    content: null,
    model: 'none',
    error: lastError ? `Tüm modeller başarısız: ${lastError}` : 'Tüm denemeler başarısız',
    errorCode: lastErrorCode || 'ALL_MODELS_FAILED',
  };
}

// ==================== TEST ====================

export async function testModel(modelId?: string): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  error?: string;
  errorCode?: string;
}> {
  const startTime = Date.now();

  const targetModel = modelId || (await selectBestFreeModel())?.id;
  if (!targetModel) {
    return { ok: false, model: 'none', latencyMs: 0, error: 'Uygun model bulunamadı', errorCode: 'NO_MODEL' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (OMNIROUTE_API_KEY) {
    headers['Authorization'] = `Bearer ${OMNIROUTE_API_KEY}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);

    const res = await fetch(`${OMNIROUTE_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Reply with exactly: OMNIROUTE_OK' }],
        max_tokens: 20,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      const classified = classifyError(new Error(errorBody));
      await recordModelOutcome(targetModel, false, classified.errorCode, classified.errorMsg, latencyMs);
      return { ok: false, model: targetModel, latencyMs, error: classified.errorMsg, errorCode: classified.errorCode };
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const ok = content.toUpperCase().includes('OK');

    await recordModelOutcome(targetModel, ok, ok ? undefined : 'MODEL_TEST_FAILED', ok ? undefined : `Model testi başarısız: ${content.slice(0, 80)}`, latencyMs);

    return {
      ok,
      model: targetModel,
      latencyMs,
      error: ok ? undefined : `Model testi OMNIROUTE_OK döndürmedi: ${content.slice(0, 80)}`,
      errorCode: ok ? undefined : 'MODEL_TEST_FAILED',
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const classified = classifyError(err);
    await recordModelOutcome(targetModel, false, classified.errorCode, classified.errorMsg, latencyMs);
    return { ok: false, model: targetModel, latencyMs, error: classified.errorMsg, errorCode: classified.errorCode };
  }
}

// ==================== STATUS ====================

export async function getOmniRouteStatus(): Promise<OmniRouteStatus> {
  const health = await checkHealth();
  const registry = await getRegistry();

  const freeModels = registry.models.filter(m => m.free);
  const healthyCount = freeModels.filter(m => m.health === 'healthy').length;
  const degradedCount = freeModels.filter(m => m.health === 'degraded').length;
  const quarantineCount = freeModels.filter(m => m.health === 'quarantined' || m.quarantineReason).length;

  return {
    connected: health.ok,
    endpoint: OMNIROUTE_BASE,
    version: health.version || null,
    modelsTotal: registry.models.length,
    freeModelsTotal: freeModels.length,
    healthyCount,
    degradedCount,
    quarantineCount,
    lastCheck: registry.discoveredAt || null,
    lastError: registry.lastDiscoveryError || health.error || null,
  };
}

// ==================== BACKGROUND REFRESH ====================

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startBackgroundRefresh(): void {
  stopBackgroundRefresh();

  const tick = async () => {
    if (Date.now() - lastDiscoveryTimestamp < DISCOVERY_COOLDOWN_MS) return;
    await discoverAndPersist().catch(() => {});
  };

  setTimeout(() => {
    tick();
    refreshTimer = setInterval(tick, 15 * 60 * 1000);
  }, 60000);
}

export function stopBackgroundRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export async function resetModelState(modelId: string): Promise<{ ok: boolean; message?: string; resetCount: number }> {
  const registry = await getRegistry();
  const model = registry.models.find(m => m.id === modelId);
  if (!model) {
    return { ok: false, message: `Model ${modelId} not found`, resetCount: 0 };
  }
  model.health = 'healthy';
  model.consecutiveFailures = 0;
  model.lastError = null;
  model.lastErrorCode = null;
  model.quarantineReason = null;
  return { ok: true, message: `Model ${modelId} state reset`, resetCount: 1 };
}
