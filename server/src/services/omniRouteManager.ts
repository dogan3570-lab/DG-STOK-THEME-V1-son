import { prisma } from '../db/prisma.ts';
import http from 'http';

// ==================== HTTP HELPER (native fetch crash-safe) ====================

function httpGet(url: string, headers?: Record<string, string>, timeoutMs = 10000): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); }, timeoutMs);
    const req = http.get(url, { headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => { clearTimeout(timer); resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data, latencyMs: Date.now() - startTime }); });
      res.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
  });
}

function httpPost(url: string, bodyStr: string, headers?: Record<string, string>, timeoutMs = 60000): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); }, timeoutMs);
    const req = http.request(url, {
      method: 'POST',
      headers: { ...(headers || {}), 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c: any) => { data += c; });
      res.on('end', () => { clearTimeout(timer); resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data, latencyMs: Date.now() - startTime }); });
      res.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
    });
    req.on('error', () => { clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve({ ok: false, status: 0, body: '', latencyMs: Date.now() - startTime }); });
    req.write(bodyStr);
    req.end();
  });
}

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
// API key is read from DB (AIProviderConfig) via decryptApiKey, NOT from env.
// This allows the AI Control Center UI to set the key without code/env changes.
let OMNIROUTE_API_KEY = '';
let apiKeyResolved = false;

export async function resolveApiKey(): Promise<string> {
  if (apiKeyResolved) return OMNIROUTE_API_KEY;
  try {
    const { decryptApiKey } = await import('./crypto.ts');
    const row = await prisma.aIProviderConfig.findUnique({ where: { provider: 'omniroute' } });
    if (row && row.apiKeyEncrypted && row.apiKeyIv && row.apiKeyTag) {
      OMNIROUTE_API_KEY = decryptApiKey(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
    }
  } catch {}
  apiKeyResolved = true;
  return OMNIROUTE_API_KEY;
}
const REGISTRY_KEY = 'omniroute_registry';
const HEALTH_CHECK_TIMEOUT_MS = 10000;
const COMPLETION_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS_PER_REQUEST = 5;
const COOLDOWN_BASE_MS = 5 * 60 * 1000;
const COOLDOWN_MAX_MS = 4 * 60 * 60 * 1000;
const DISCOVERY_COOLDOWN_MS = 2 * 60 * 1000;
// Karantina TTL: auth/model hataları kendiliğinden düşer. 'removed_by_omniroute' kalıcıdır.
// Aksi halde geçmişteki tek bir 401 tüm free havuzunu KALICI kilitler → NO_MODEL.
const QUARANTINE_TTL_MS = 30 * 60 * 1000;

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
    const result = await httpGet(`${OMNIROUTE_BASE}/api/health`, undefined, HEALTH_CHECK_TIMEOUT_MS);
    if (!result.ok) {
      return { ok: false, error: `HTTP ${result.status}` };
    }
    const data = JSON.parse(result.body) as any;
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
  const apiKey = await resolveApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    let result: { ok: boolean; status: number; body: string } | null = null;
    let lastErr: string | null = null;
    const endpoints = [`${OMNIROUTE_BASE}/v1/models`, `${OMNIROUTE_BASE}/api/health`];
    for (const url of endpoints) {
      const r = await httpGet(url, headers, HEALTH_CHECK_TIMEOUT_MS);
      if (r.ok) { result = r; break; }
      lastErr = `HTTP_${r.status}`;
    }

    if (!result) {
      throw new Error(lastErr || 'No reachable OmniRoute model endpoint');
    }

    const data: any = JSON.parse(result.body || '{}');
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
    return list;
  } catch (err: any) {
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

    // Fix(2): /v1/models auth gerektirir; bu OmniRoute'ta /v1/chat/completions açıkken
    // /v1/models 401 dönebiliyor. Boş liste "gerçekten silindi" DEMEK DEĞİLDİR.
    // Eski kod boş listede TÜM modelleri kalıcı 'removed_by_omniroute' işaretliyordu
    // → manager 137/quarantine, orchestrator 129/healthy çelişkisi.
    if (apiModels.length === 0) {
      let healed = 0;
      for (const m of registry.models) {
        if (m.quarantineReason) {
          // Liste alınamadığında hiçbir karantina DOĞRULANAMAZ → tümü temizlenir.
          m.quarantineReason = null;
          if (m.health === 'quarantined') m.health = 'unknown';
          healed++;
        }
      }
      registry.lastDiscoveryError = 'MODEL_LIST_EMPTY: /v1/models boş/erişilemez döndü; kaldırma doğrulanamadı';
      await saveRegistry(registry);
      return {
        ok: false,
        freeCount: registry.models.filter(m => m.free).length,
        totalCount: 0,
        error: `OmniRoute /v1/models boş döndü — kaldırma doğrulanamadı; doğrulanamayan removed işaretleri temizlendi (${healed})`,
      };
    }

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
        // API'de yeniden görünen model karantinadan çıkar (artık "removed" değil).
        if (existing.quarantineReason === 'removed_by_omniroute') {
          existing.quarantineReason = null;
          existing.health = 'unknown';
          existing.lastError = null;
          existing.lastErrorCode = null;
        }
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

/**
 * Aktif karantina: 'removed_by_omniroute' kalıcıdır; diğer sebepler (auth/model hatası)
 * QUARANTINE_TTL_MS sonrası kendiliğinden düşer. Böylece geçici bir hata free havuzunu
 * kalıcı olarak kilitlemez (eski davranış → selectBestFreeModel NO_MODEL).
 */
export function isActivelyQuarantined(m: OmniRouteModelEntry): boolean {
  if (!m.quarantineReason) return false;
  if (m.quarantineReason === 'removed_by_omniroute') return true;
  const ref = m.lastCheckedAt || m.lastUsedAt;
  if (!ref) return false;
  return Date.now() - new Date(ref).getTime() < QUARANTINE_TTL_MS;
}

export function isUsable(m: OmniRouteModelEntry): boolean {
  return !isActivelyQuarantined(m);
}

function modelScore(m: OmniRouteModelEntry): number {
  let score = 0;
  if (m.health === 'healthy') score += 100;
  else if (m.health === 'unknown') score += 50;
  else if (m.health === 'degraded') score += 20;

  // Config-2: auto/* models use OmniRoute's native routing — always prefer them
  const id = m.id.toLowerCase();
  if (id.startsWith('auto/')) score += 200;

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
    model.quarantineReason = null; // başarı → karantina düşer (self-heal)
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
async function sendToOmniRoute(
  model: string,
  request: { messages: { role: string; content: string }[]; temperature?: number; max_tokens?: number; response_format?: { type: string } },
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; content: string | null; model: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; latencyMs: number; error?: string }> {
  const body: any = {
    model,
    messages: request.messages,
    temperature: request.temperature ?? 0.1,
    max_tokens: request.max_tokens ?? 1024,
    stream: false,
  };
  if (request.response_format) {
    body.response_format = request.response_format;
  }
  const bodyStr = JSON.stringify(body);
  const startTime = Date.now();
  console.log('[SOMR-01] sendToOmniRoute START model=' + model, new Date().toISOString());

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ ok: false, content: null, model, latencyMs: Date.now() - startTime, error: 'TIMEOUT: request timed out' });
    }, timeoutMs);

    const req = http.request(`${OMNIROUTE_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: timeoutMs,
    }, (res: any) => {
      let data = '';
      const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
      let totalBytes = 0;
      let aborted = false;
      res.on('data', (chunk: any) => {
        try {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            aborted = true;
            req.destroy();
            clearTimeout(timer);
            console.log('[SOMR-03] http RESPONSE_TOO_LARGE ' + totalBytes, new Date().toISOString());
            return resolve({ ok: false, content: null, model, latencyMs: Date.now() - startTime, error: 'RESPONSE_TOO_LARGE: response exceeds 2MB limit' });
          }
          data += chunk;
        } catch (err: any) {
          aborted = true;
          req.destroy();
          clearTimeout(timer);
          console.log('[SOMR-03] http DATA_ERROR err=' + (err?.message || 'unknown'), new Date().toISOString());
          resolve({ ok: false, content: null, model, latencyMs: Date.now() - startTime, error: `DATA_ERROR: ${err?.message || 'read failed'}` });
        }
      });
      res.on('end', () => {
        if (aborted) return;
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        console.log('[SOMR-02] http DONE status=' + res.statusCode + ' latency=' + latencyMs + ' bytes=' + totalBytes, new Date().toISOString());
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, content: null, model, latencyMs, error: `HTTP_${res.statusCode}: ${data.slice(0, 200) || res.statusCode}` });
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.message?.content ?? null;
          const usage = parsed?.usage
            ? { prompt_tokens: parsed.usage.prompt_tokens ?? 0, completion_tokens: parsed.usage.completion_tokens ?? 0, total_tokens: parsed.usage.total_tokens ?? 0 }
            : undefined;
          // Fix(visibility): OmniRoute yanıtı GERÇEK sunulan modeli (parsed.model) taşır.
          // İstenen 'auto/best-free' yerine gerçek modeli raporla (trace/UI gerçeği göstersin).
          const servedModel = (typeof parsed?.model === 'string' && parsed.model) ? parsed.model : model;
          resolve({ ok: true, content, model: servedModel, usage, latencyMs });
        } catch (e: any) {
          resolve({ ok: false, content: null, model, latencyMs, error: `PARSE_ERROR: ${e?.message}` });
        }
      });
      res.on('error', (err: any) => {
        if (aborted) return;
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        console.log('[SOMR-03] http RES_ERROR err=' + err.message, new Date().toISOString());
        const classified = classifyError(err);
        resolve({ ok: false, content: null, model, latencyMs, error: `${classified.errorCode}: ${classified.errorMsg}` });
      });
    });

    req.on('error', (err: any) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      console.log('[SOMR-03] http REQ_ERROR err=' + err.message, new Date().toISOString());
      const classified = classifyError(err);
      resolve({ ok: false, content: null, model, latencyMs, error: `${classified.errorCode}: ${classified.errorMsg}` });
    });

    req.on('timeout', () => {
      req.destroy();
      clearTimeout(timer);
      resolve({ ok: false, content: null, model, latencyMs: Date.now() - startTime, error: 'TIMEOUT: socket timeout' });
    });

    req.write(bodyStr);
    req.end();
  });
}

export async function completeWithFreeModel(request: {
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}): Promise<OmniRouteCompletionResult> {
  console.log('[CMFM-01] completeWithFreeModel START', new Date().toISOString());
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  console.log('[CMFM-02] resolving API key...');
  const apiKey = await resolveApiKey();
  console.log('[CMFM-03] apiKey resolved, hasKey=' + !!apiKey);
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const timeoutMs = Math.min(COMPLETION_TIMEOUT_MS, 60000);
  console.log('[CMFM-04] calling sendToOmniRoute auto/best-free', new Date().toISOString(), 'rss=' + Math.round(process.memoryUsage().rss/1024/1024) + 'MB');

  const primary = await sendToOmniRoute('auto/best-free', request, headers, timeoutMs);
  console.log('[CMFM-05] sendToOmniRoute returned ok=' + primary.ok + ' latency=' + primary.latencyMs, new Date().toISOString(), 'rss=' + Math.round(process.memoryUsage().rss/1024/1024) + 'MB');
  if (primary.ok) {
    try { await recordModelOutcome('auto/best-free', true, undefined, undefined, primary.latencyMs); } catch {}
    return { ok: true, content: primary.content, model: primary.model, usage: primary.usage };
  }
  try { await recordModelOutcome('auto/best-free', false, 'PRIMARY_FAILED', primary.error, primary.latencyMs); } catch {}

  const excluded = new Set<string>(['auto/best-free']);
  let lastError = primary.error || 'auto/best-free başarısız';

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_REQUEST; attempt++) {
    const modelEntry = await selectBestFreeModel(excluded);
    if (!modelEntry) break;
    excluded.add(modelEntry.id);

    const result = await sendToOmniRoute(modelEntry.id, request, headers, timeoutMs);
    const classified = result.error ? classifyError(new Error(result.error)) : null;
    try { await recordModelOutcome(modelEntry.id, result.ok, classified?.errorCode, classified?.errorMsg, result.latencyMs); } catch {}

    if (result.ok) {
      return { ok: true, content: result.content, model: result.model, usage: result.usage };
    }
    lastError = result.error || 'Model başarısız';
  }

  return {
    ok: false,
    content: null,
    model: 'none',
    error: `Tüm modeller başarısız: ${lastError}`,
    errorCode: 'ALL_MODELS_FAILED',
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
  // Fix: model verilmediyse üretim yolunun gerçek modelini (auto/best-free) test et.
  // Eski kod selectBestFreeModel() kullanıyordu; sticky karantina yüzünden null dönüp
  // NO_MODEL veriyordu (üretim auto/best-free ile çalışırken test başarısızdı).
  const targetModel = modelId || 'auto/best-free';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const resolvedKey = await resolveApiKey();
  if (resolvedKey) {
    headers['Authorization'] = `Bearer ${resolvedKey}`;
  }

  try {
    const result = await httpPost(
      `${OMNIROUTE_BASE}/v1/chat/completions`,
      JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Reply with exactly: OMNIROUTE_OK' }],
        max_tokens: 20,
        stream: false,
      }),
      headers,
      COMPLETION_TIMEOUT_MS,
    );

    const latencyMs = result.latencyMs;

    if (!result.ok) {
      const classified = classifyError(new Error(result.body));
      await recordModelOutcome(targetModel, false, classified.errorCode, classified.errorMsg, latencyMs);
      return { ok: false, model: targetModel, latencyMs, error: classified.errorMsg, errorCode: classified.errorCode };
    }

    const data: any = JSON.parse(result.body);
    const content = data?.choices?.[0]?.message?.content ?? '';
    const ok = content.toUpperCase().includes('OK');

    await recordModelOutcome(targetModel, ok, ok ? undefined : 'MODEL_TEST_FAILED', ok ? undefined : `Model testi başarısız: ${content.slice(0, 80)}`, latencyMs);

    // Fix(visibility): GERÇEK sunulan modeli raporla (istenen 'auto/best-free' yerine).
    const servedModel = (typeof data?.model === 'string' && data.model) ? data.model : targetModel;
    return {
      ok,
      model: servedModel,
      latencyMs,
      error: ok ? undefined : `Model testi OMNIROUTE_OK döndürmedi: ${content.slice(0, 80)}`,
      errorCode: ok ? undefined : 'MODEL_TEST_FAILED',
    };
  } catch (err: any) {
    const classified = classifyError(err);
    await recordModelOutcome(targetModel, false, classified.errorCode, classified.errorMsg, 0);
    return { ok: false, model: targetModel, latencyMs: 0, error: classified.errorMsg, errorCode: classified.errorCode };
  }
}

// ==================== STATUS ====================

export async function getOmniRouteStatus(): Promise<OmniRouteStatus> {
  const health = await checkHealth();
  const registry = await getRegistry();

  const freeModels = registry.models.filter(m => m.free);
  // Health kararı TEK kaynaktan: isUsable/isActivelyQuarantined (TTL farkındalıklı).
  // Eski kod kalıcı quarantineReason yüzünden 137/2 gibi çelişkili sayı üretiyordu.
  const usable = freeModels.filter(m => isUsable(m));
  const healthyCount = usable.filter(m => m.health === 'healthy').length;
  const degradedCount = usable.filter(m => m.health === 'degraded' || m.health === 'unknown').length;
  const quarantineCount = freeModels.filter(m => isActivelyQuarantined(m)).length;

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
