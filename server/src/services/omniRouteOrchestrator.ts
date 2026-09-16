/**
 * OmniRoute Orchestrator
 * Merkezi AI yönlendirici — kota farkında, sağlık kontrollü, otomatik fallback'li
 */
import { prisma } from '../db/prisma.ts';
import { getRegistry, recordModelOutcome, type OmniRouteModelEntry } from './omniRouteManager.ts';

// ==================== TYPES ====================

export type TaskType = 'GENERAL' | 'CATEGORY_MATCHING' | 'CODE' | 'REASONING' | 'CLASSIFICATION' | 'EXTRACTION' | 'FAST' | 'IMAGE_ANALYSIS' | 'STRUCTURED_OUTPUT' | 'VARIANT_MATCHING';

export type HealthStatus = 'healthy' | 'degraded' | 'rate_limited' | 'quarantined' | 'disabled';

export type ModelCapability = 'coding' | 'reasoning' | 'classification' | 'vision' | 'long_context' | 'speed' | 'general';

export interface QuotaState {
  quotaLimit: number | null;
  quotaUsed: number;
  quotaRemaining: number | null;
  quotaPercent: number;
  quotaResetAt: string | null;
}

export interface ModelState {
  modelId: string;
  health: HealthStatus;
  quota: QuotaState;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  quarantineUntil: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  currentScore: number;
  capabilities: ModelCapability[];
  qualityScore: number;
  reliabilityScore: number;
  latencyScore: number;
  quotaHeadroomScore: number;
  taskFitScore: number;
}

export interface OrchestratorStatus {
  active: boolean;
  totalModels: number;
  freeModels: number;
  healthyCount: number;
  warningCount: number;
  quotaLockedCount: number;
  rateLimitedCount: number;
  unavailableCount: number;
  disabledCount: number;
  lastRoutingAt: string | null;
  totalRouted: number;
  totalFailed: number;
}

export interface RoutingResult {
  selected: ModelState;
  fallbackChain: ModelState[];
  allEligible: ModelState[];
  reason: string;
}

// ==================== CONSTANTS ====================

const QUOTA_WARNING_THRESHOLD = 70;
const QUOTA_HARD_THRESHOLD = 80;
const QUOTA_FULL_THRESHOLD = 100;
const MAX_CONSECUTIVE_FAILURES = 5;
const QUARANTINE_DURATION_MS = 30 * 60 * 1000;
const RATE_LIMIT_QUARANTINE_MS = 5 * 60 * 1000;
const STATE_KEY = 'omniroute_orchestrator_state';
const MAX_RETRY_ATTEMPTS = 5;

// ==================== IN-MEMORY STATE ====================

const ModelState = new Map<string, ModelState>();
let stateLoaded = false;
let orchestratorStats = {
  totalRouted: 0,
  totalFailed: 0,
  lastRoutingAt: null as string | null,
};

// ==================== TASK → CAPABILITY MAPPING ====================

const TASK_CAPABILITY_MAP: Record<TaskType, ModelCapability[]> = {
  GENERAL: ['general'],
  CATEGORY_MATCHING: ['classification', 'reasoning'],
  CODE: ['coding'],
  REASONING: ['reasoning'],
  CLASSIFICATION: ['classification'],
  EXTRACTION: ['classification', 'reasoning'],
  FAST: ['speed'],
  IMAGE_ANALYSIS: ['vision'],
  STRUCTURED_OUTPUT: ['general', 'reasoning'],
  VARIANT_MATCHING: ['classification', 'reasoning'],
};

const MODEL_CAPABILITY_MAP: Record<string, ModelCapability[]> = {
  'nemotron-3-ultra-free': ['reasoning', 'general'],
  'nemotron-3.5-lightning-free': ['speed', 'general'],
  'hy3-free': ['reasoning', 'general'],
  'big-pickle': ['coding', 'reasoning'],
  'deepseek-v4-flash-free': ['coding', 'reasoning', 'general'],
  'mimo-v2.5-free': ['coding', 'reasoning'],
  'muse-spark-1.2-contributor-free': ['general'],
  'x-preview-f-free': ['general'],
  'laguna-s-2.1-free': ['general'],
  'dots-3-note-preview:free': ['general'],
  'lfm-2.5-2.6b:free': ['speed', 'general'],
  'inkling:free': ['reasoning', 'general'],
  'inkling-small:free': ['speed', 'general'],
  'glm-5.2:free': ['reasoning', 'general'],
  'north-mini-code:free': ['coding'],
  'minimax-m3:free': ['general'],
  'minimax-m2.7:free': ['general'],
  'gemma-4-26b-a4b-it:free': ['general'],
  'gemma-4-31b-it:free': ['general'],
};

// ==================== QUALITY SCORES ====================

const MODEL_QUALITY: Record<string, number> = {
  'nemotron-3-ultra-free': 95,
  'hy3-free': 93,
  'big-pickle': 92,
  'deepseek-v4-flash-free': 94,
  'mimo-v2.5-free': 91,
  'nemotron-3.5-lightning-free': 88,
  'muse-spark-1.2-contributor-free': 80,
  'x-preview-f-free': 78,
  'laguna-s-2.1-free': 82,
  'inkling:free': 87,
  'inkling-small:free': 83,
  'glm-5.2:free': 89,
  'north-mini-code:free': 85,
  'minimax-m3:free': 84,
  'minimax-m2.7:free': 82,
  'gemma-4-26b-a4b-it:free': 86,
  'gemma-4-31b-it:free': 87,
  'dots-3-note-preview:free': 75,
  'lfm-2.5-2.6b:free': 72,
};

// ==================== STATE PERSISTENCE ====================

async function loadState(): Promise<void> {
  if (stateLoaded) return;
  try {
    const row = await prisma.setting.findUnique({ where: { key: STATE_KEY } });
    if (row?.value) {
      const data = JSON.parse(row.value);
      if (data.models && typeof data.models === 'object') {
        for (const [id, state] of Object.entries(data.models)) {
          ModelState.set(id, state as ModelState);
        }
      }
      if (data.stats) {
        orchestratorStats = { ...orchestratorStats, ...data.stats };
      }
    }
  } catch { /* ignore */ }
  stateLoaded = true;
}

async function saveState(): Promise<void> {
  const data = {
    models: Object.fromEntries(ModelState),
    stats: orchestratorStats,
    savedAt: new Date().toISOString(),
  };
  try {
    await prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: JSON.stringify(data) },
      update: { value: JSON.stringify(data) },
    });
  } catch { /* ignore */ }
}

// ==================== MODEL STATE MANAGEMENT ====================

function getOrCreateModelState(modelId: string): ModelState {
  if (ModelState.has(modelId)) return ModelState.get(modelId)!;
  const state: ModelState = {
    modelId,
    health: 'healthy',
    quota: { quotaLimit: null, quotaUsed: 0, quotaRemaining: null, quotaPercent: 0, quotaResetAt: null },
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    avgLatencyMs: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    quarantineUntil: null,
    lastError: null,
    lastErrorCode: null,
    currentScore: 0,
    capabilities: MODEL_CAPABILITY_MAP[extractBaseModelId(modelId)] || ['general'],
    qualityScore: MODEL_QUALITY[extractBaseModelId(modelId)] || 70,
    reliabilityScore: 100,
    latencyScore: 80,
    quotaHeadroomScore: 100,
    taskFitScore: 50,
  };
  ModelState.set(modelId, state);
  return state;
}

function extractBaseModelId(modelId: string): string {
  const parts = modelId.split('/');
  return parts[parts.length - 1] || modelId;
}

// ==================== QUOTA GUARD ====================

function isQuotaEligible(state: ModelState): boolean {
  const q = state.quota;
  if (q.quotaPercent >= QUOTA_HARD_THRESHOLD) return false;
  if (q.quotaResetAt) {
    const resetTime = new Date(q.quotaResetAt).getTime();
    if (Date.now() >= resetTime) {
      q.quotaUsed = 0;
      q.quotaPercent = 0;
      q.quotaResetAt = null;
      return true;
    }
  }
  return true;
}

function updateQuotaFromResponse(state: ModelState, headers: Record<string, string>): void {
  const limit = headers['x-ratelimit-limit'] || headers['ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'] || headers['ratelimit-reset'];
  const used = headers['x-ratelimit-used'] || headers['ratelimit-used'];

  if (limit) {
    state.quota.quotaLimit = parseInt(limit, 10) || null;
  }
  if (remaining) {
    const rem = parseInt(remaining, 10);
    if (state.quota.quotaLimit) {
      state.quota.quotaRemaining = rem;
      state.quota.quotaUsed = state.quota.quotaLimit - rem;
      state.quota.quotaPercent = Math.round((state.quota.quotaUsed / state.quota.quotaLimit) * 100);
    }
  }
  if (used) {
    state.quota.quotaUsed = parseInt(used, 10) || state.quota.quotaUsed;
    if (state.quota.quotaLimit) {
      state.quota.quotaPercent = Math.round((state.quota.quotaUsed / state.quota.quotaLimit) * 100);
    }
  }
  if (reset) {
    const resetTs = parseInt(reset, 10);
    if (resetTs > 1000000000) {
      state.quota.quotaResetAt = new Date(resetTs * 1000).toISOString();
    } else {
      state.quota.quotaResetAt = new Date(Date.now() + resetTs * 1000).toISOString();
    }
  }
}

// ==================== HEALTH GUARD ====================

function isHealthEligible(state: ModelState): boolean {
  if (state.health === 'disabled') return false;
  if (state.quarantineUntil) {
    if (Date.now() < new Date(state.quarantineUntil).getTime()) return false;
    state.quarantineUntil = null;
    state.health = 'degraded';
  }
  if (state.health === 'quarantined') return false;
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false;
  return true;
}

// ==================== SCORING ====================

function calculateScore(state: ModelState, taskType: TaskType): number {
  const weights = {
    quality: 0.30,
    reliability: 0.25,
    latency: 0.15,
    quotaHeadroom: 0.20,
    taskFit: 0.10,
  };

  // Quality score (0-100)
  const quality = state.qualityScore;

  // Reliability score (0-100)
  const totalReqs = state.successCount + state.failureCount;
  const successRate = totalReqs > 0 ? (state.successCount / totalReqs) * 100 : 50;
  const failurePenalty = Math.min(30, state.consecutiveFailures * 10);
  const reliability = Math.max(0, successRate - failurePenalty);

  // Latency score (0-100)
  let latencyScore = 80;
  if (state.avgLatencyMs > 0) {
    if (state.avgLatencyMs < 1000) latencyScore = 100;
    else if (state.avgLatencyMs < 3000) latencyScore = 90;
    else if (state.avgLatencyMs < 5000) latencyScore = 70;
    else if (state.avgLatencyMs < 10000) latencyScore = 50;
    else latencyScore = 30;
  }

  // Quota headroom score (0-100)
  const quotaPercent = state.quota.quotaPercent;
  let quotaHeadroom = 100;
  if (quotaPercent < 30) quotaHeadroom = 100;
  else if (quotaPercent < 50) quotaHeadroom = 90;
  else if (quotaPercent < 70) quotaHeadroom = 70;
  else if (quotaPercent < 80) quotaHeadroom = 40;
  else quotaHeadroom = 0;

  // Task fit score (0-100)
  const requiredCaps = TASK_CAPABILITY_MAP[taskType] || ['general'];
  const modelCaps = state.capabilities;
  const matchedCaps = requiredCaps.filter(c => modelCaps.includes(c));
  const taskFit = requiredCaps.length > 0 ? (matchedCaps.length / requiredCaps.length) * 100 : 50;

  state.qualityScore = quality;
  state.reliabilityScore = reliability;
  state.latencyScore = latencyScore;
  state.quotaHeadroomScore = quotaHeadroom;
  state.taskFitScore = taskFit;

  const score =
    quality * weights.quality +
    reliability * weights.reliability +
    latencyScore * weights.latency +
    quotaHeadroom * weights.quotaHeadroom +
    taskFit * weights.taskFit;

  state.currentScore = Math.round(score);
  return state.currentScore;
}

// ==================== ROUTING ====================

// Fix(pool-quality): üretici OLMAYAN free modeller (safety/guard/embed/rerank/asr/tts/vision...)
// havuza alınıp Router tarafından genel görevlerde seçilirse modül çıktısı bozulur
// (ör. content-safety modeli "User Safety: safe" döner). Havuz yalnızca üretici modelleri alır.
const NON_GENERATIVE_MODEL_RE = /safety|guard|moderation|rerank|ranker|embed|asr\b|tts|whisper|parakeet|fastpitch|tacotron|flux|diffusion|calibration|detector|ocr\b|reward|judge|nemoguard|topic-control|allowlist|xlm-roberta|bge-|nv-embed|content-safety/i;
function isPoolCandidate(m: OmniRouteModelEntry): boolean {
  return m.free && !NON_GENERATIVE_MODEL_RE.test(m.id) && !NON_GENERATIVE_MODEL_RE.test(m.name || '');
}

/**
 * Ortak Free Model Pool: OmniRoute registry'sindeki üretici free modeller
 * + NVIDIA'nın GERÇEK /v1/models discovery'si ('nvidia/<id>'). Stale nvidia/* ID'leri
 * yerine gerçek NVIDIA model kimlikleri kullanılır.
 */
async function buildPoolModels(): Promise<OmniRouteModelEntry[]> {
  const registry = await getRegistry();
  const base = registry.models.filter(isPoolCandidate);
  const seen = new Set(base.map((m) => m.id));
  const merged: OmniRouteModelEntry[] = [...base];
  try {
    const { discoverNvidiaModels } = await import('./nvidiaModels.ts');
    for (const m of await discoverNvidiaModels()) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push({
        id: m.id, name: m.name, provider: 'nvidia', contextWindow: null,
        free: true, health: 'unknown', lastError: null, lastErrorCode: null,
        lastLatencyMs: null, lastUsedAt: null, lastCheckedAt: null,
        consecutiveFailures: 0, totalRequests: 0, successfulRequests: 0, failedRequests: 0,
      });
    }
  } catch { /* NVIDIA discovery erişilemezse registry havuzu kullanılır */ }
  return merged;
}

export async function routeRequest(
  taskType: TaskType = 'GENERAL',
  excludeModels: Set<string> = new Set()
): Promise<RoutingResult | null> {
  await loadState();
  const registry = await getRegistry();

  const freeModels = await buildPoolModels();
  if (freeModels.length === null) return null;

  const eligible: ModelState[] = [];

  for (const model of freeModels) {
    if (excludeModels.has(model.id)) continue;
    const state = getOrCreateModelState(model.id);

    // Health guard
    if (!isHealthEligible(state)) continue;

    // Quota guard
    if (!isQuotaEligible(state)) continue;

    // Calculate score
    calculateScore(state, taskType);
    eligible.push(state);
  }

  if (eligible.length === 0) {
    return null;
  }

  // Sort by score descending
  eligible.sort((a, b) => b.currentScore - a.currentScore);

  const selected = eligible[0];
  const fallbackChain = eligible.slice(1, 6);

  orchestratorStats.totalRouted++;
  orchestratorStats.lastRoutingAt = new Date().toISOString();

  return {
    selected,
    fallbackChain,
    allEligible: eligible,
    reason: `Scored ${eligible.length} eligible models, selected ${selected.modelId} (score: ${selected.currentScore})`,
  };
}

// ==================== REQUEST DISPATCH ====================

export async function dispatchRequest(
  messages: { role: string; content: string }[],
  taskType: TaskType = 'GENERAL',
  maxTokens: number = 500,
  temperature: number = 0.7
): Promise<{ ok: boolean; content: string | null; model: string; source?: string; error?: string }> {
  const excludeModels = new Set<string>();
  let lastError = '';

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const routing = await routeRequest(taskType, excludeModels);
    if (!routing) {
      return { ok: false, content: null, model: '', error: 'NO_ELIGIBLE_FREE_MODEL: Tüm free modeller kota/sağlık limitinde veya kullanılamıyor' };
    }

    const modelState = routing.selected;
    const modelId = modelState.modelId;

    try {
      const result = await callModel(modelId, messages, maxTokens, temperature);

      if (result.ok) {
        // Record success
        const state = getOrCreateModelState(modelId);
        state.successCount++;
        state.consecutiveFailures = 0;
        state.lastSuccessAt = new Date().toISOString();
        if (result.latencyMs) {
          state.avgLatencyMs = state.avgLatencyMs > 0
            ? (state.avgLatencyMs + result.latencyMs) / 2
            : result.latencyMs;
        }
        if (result.headers) {
          updateQuotaFromResponse(state, result.headers);
        }
        await saveState();
        await recordModelOutcome(modelId, true, undefined, undefined, result.latencyMs);
        return { ok: true, content: result.content, model: modelId, source: providerSource(modelId) };
      }

      // Record failure
      const state = getOrCreateModelState(modelId);
      state.failureCount++;
      state.consecutiveFailures++;
      state.lastFailureAt = new Date().toISOString();
      state.lastError = result.error || 'Unknown error';
      state.lastErrorCode = result.errorCode || 'UNKNOWN';

      if (result.errorCode === 'RATE_LIMIT') {
        state.health = 'rate_limited';
        state.quarantineUntil = new Date(Date.now() + RATE_LIMIT_QUARANTINE_MS).toISOString();
      } else if (result.errorCode === 'AUTH_REQUIRED' || result.errorCode === 'FORBIDDEN') {
        state.health = 'disabled';
      } else if (result.errorCode === 'MODEL_NOT_FOUND') {
        state.health = 'quarantined';
        state.quarantineUntil = new Date(Date.now() + QUARANTINE_DURATION_MS).toISOString();
      } else if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.health = 'quarantined';
        state.quarantineUntil = new Date(Date.now() + QUARANTINE_DURATION_MS).toISOString();
      } else {
        state.health = 'degraded';
      }

      await saveState();
      await recordModelOutcome(modelId, false, result.errorCode, result.error, result.latencyMs);
      excludeModels.add(modelId);
      lastError = result.error || 'Unknown error';

    } catch (err: any) {
      const state = getOrCreateModelState(modelId);
      state.failureCount++;
      state.consecutiveFailures++;
      state.lastFailureAt = new Date().toISOString();
      state.health = 'degraded';
      await saveState();
      excludeModels.add(modelId);
      lastError = err.message || 'Exception';
    }
  }

  orchestratorStats.totalFailed++;
  await saveState();
  return { ok: false, content: null, model: '', source: 'none', error: `ALL_MODELS_FAILED: ${lastError}` };
}

// ==================== MODEL CALL ====================

// ==================== PROVIDER DISPATCH ====================
// Router, seçilen adayı GERÇEK provider adaptörü üzerinden çalıştırır.
// Provider kimliği model id ön ekiyle korunur: 'openrouter/...' | 'nvidia/...' | diğerleri → OmniRoute.
const DIRECT_PROVIDER_BASE: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
};

async function getProviderApiKey(provider: string): Promise<string | null> {
  try {
    const { decryptApiKey } = await import('./crypto.ts');
    const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
    if (!p?.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) return null;
    return decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
  } catch { return null; }
}

export function providerSource(modelId: string): 'openrouter' | 'nvidia' | 'omniroute' {
  if (modelId.startsWith('openrouter/')) return 'openrouter';
  if (modelId.startsWith('nvidia/')) return 'nvidia';
  return 'omniroute';
}

async function callDirectProvider(
  provider: 'openrouter' | 'nvidia',
  modelId: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ ok: boolean; content: string | null; error?: string; errorCode?: string; latencyMs?: number; headers?: Record<string, string> }> {
  const startTime = Date.now();
  const apiModel = modelId.slice(provider.length + 1); // 'openrouter/' | 'nvidia/' ön eki soyulur
  const key = await getProviderApiKey(provider);
  if (!key) {
    return { ok: false, content: null, error: `${provider} API key yapılandırılmamış`, errorCode: 'AUTH_REQUIRED', latencyMs: 0 };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${DIRECT_PROVIDER_BASE[provider]}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        ...(provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:4000', 'X-Title': 'DG STOK' } : {}),
      },
      body: JSON.stringify({ model: apiModel, messages, max_tokens: maxTokens, temperature, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const errClass = classifyHttpError(res.status, errBody);
      return { ok: false, content: null, error: errClass.errorMsg, errorCode: errClass.errorCode, latencyMs };
    }
    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.message?.reasoning_content ?? null;
    if (!content) return { ok: false, content: null, error: 'Empty response from model', errorCode: 'INVALID_RESPONSE', latencyMs };
    return { ok: true, content, latencyMs };
  } catch (err: any) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (err.name === 'AbortError') return { ok: false, content: null, error: 'Request timeout', errorCode: 'TIMEOUT', latencyMs };
    return { ok: false, content: null, error: err.message || 'Connection failed', errorCode: 'CONNECTION_ERROR', latencyMs };
  }
}

async function callModel(
  modelId: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ ok: boolean; content: string | null; error?: string; errorCode?: string; latencyMs?: number; headers?: Record<string, string> }> {
  const src = providerSource(modelId);
  if (src === 'openrouter' || src === 'nvidia') {
    return callDirectProvider(src, modelId, messages, maxTokens, temperature);
  }
  return callOmniRoute(modelId, messages, maxTokens, temperature);
}

async function callOmniRoute(
  modelId: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ ok: boolean; content: string | null; error?: string; errorCode?: string; latencyMs?: number; headers?: Record<string, string> }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const body = JSON.stringify({
      model: modelId,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    });

    // Fix(auth): execution yolu da health/discovery ile AYNI kaynaktan (DB) key kullanır.
    // Eski kod Authorization göndermiyordu → OmniRoute auth zorunlu olduğunda tutarsızlık.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const { resolveApiKey } = await import('./omniRouteManager.ts');
      const key = await resolveApiKey();
      if (key) headers['Authorization'] = `Bearer ${key}`;
    } catch { /* key yoksa auth'suz dene (mevcut davranış) */ }

    const res = await fetch(`${process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128'}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const errClass = classifyHttpError(res.status, errBody);
      return { ok: false, content: null, error: errClass.errorMsg, errorCode: errClass.errorCode, latencyMs, headers: responseHeaders };
    }

    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || null;

    if (!content && !data?.choices?.[0]?.message?.reasoning_content) {
      return { ok: false, content: null, error: 'Empty response from model', errorCode: 'INVALID_RESPONSE', latencyMs, headers: responseHeaders };
    }

    const finalContent = content || data?.choices?.[0]?.message?.reasoning_content || '';
    return { ok: true, content: finalContent, latencyMs, headers: responseHeaders };

  } catch (err: any) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (err.name === 'AbortError') {
      return { ok: false, content: null, error: 'Request timeout', errorCode: 'TIMEOUT', latencyMs };
    }
    return { ok: false, content: null, error: err.message || 'Connection failed', errorCode: 'CONNECTION_ERROR', latencyMs };
  }
}

function classifyHttpError(status: number, body: string): { errorCode: string; errorMsg: string } {
  const msg = body.toLowerCase();
  if (status === 401 || status === 403) return { errorCode: 'AUTH_REQUIRED', errorMsg: `Auth error ${status}` };
  if (status === 429) return { errorCode: 'RATE_LIMIT', errorMsg: 'Rate limit exceeded' };
  if (status === 404) return { errorCode: 'MODEL_NOT_FOUND', errorMsg: 'Model not found' };
  if (status === 402) return { errorCode: 'QUOTA_EXCEEDED', errorMsg: 'Quota exceeded' };
  if (status >= 500) return { errorCode: 'SERVER_ERROR', errorMsg: `Server error ${status}` };
  return { errorCode: 'HTTP_ERROR', errorMsg: `HTTP ${status}: ${body.slice(0, 200)}` };
}

// ==================== STATUS ====================

export async function getOrchestratorStatus(): Promise<OrchestratorStatus> {
  await loadState();
  const registry = await getRegistry();
  const freeModels = await buildPoolModels();

  let healthy = 0, warning = 0, quotaLocked = 0, rateLimited = 0, unavailable = 0, disabled = 0;

  for (const model of freeModels) {
    const state = getOrCreateModelState(model.id);
    switch (state.health) {
      case 'healthy': healthy++; break;
      case 'degraded': warning++; break;
      case 'rate_limited': rateLimited++; break;
      case 'quarantined': unavailable++; break;
      case 'disabled': disabled++; break;
    }
    if (state.quota.quotaPercent >= QUOTA_HARD_THRESHOLD) quotaLocked++;
  }

  return {
    active: true,
    totalModels: registry.models.length,
    freeModels: freeModels.length,
    healthyCount: healthy,
    warningCount: warning,
    quotaLockedCount: quotaLocked,
    rateLimitedCount: rateLimited,
    unavailableCount: unavailable,
    disabledCount: disabled,
    lastRoutingAt: orchestratorStats.lastRoutingAt,
    totalRouted: orchestratorStats.totalRouted,
    totalFailed: orchestratorStats.totalFailed,
  };
}

export async function getModelStates(): Promise<ModelState[]> {
  await loadState();
  const registry = await getRegistry();
  const freeModels = await buildPoolModels();
  return freeModels.map(m => {
    const state = getOrCreateModelState(m.id);
    calculateScore(state, 'GENERAL');
    return { ...state };
  });
}

// ==================== QUOTA UPDATE (from API response) ====================

export async function updateModelQuota(modelId: string, headers: Record<string, string>): Promise<void> {
  await loadState();
  const state = getOrCreateModelState(modelId);
  updateQuotaFromResponse(state, headers);
  await saveState();
}

// ==================== MANUAL QUOTA SET (for testing) ====================

export async function setModelQuota(modelId: string, percent: number): Promise<void> {
  await loadState();
  const state = getOrCreateModelState(modelId);
  state.quota.quotaPercent = percent;
  if (state.quota.quotaLimit) {
    state.quota.quotaUsed = Math.round(state.quota.quotaLimit * percent / 100);
    state.quota.quotaRemaining = state.quota.quotaLimit - state.quota.quotaUsed;
  }
  if (percent >= QUOTA_HARD_THRESHOLD) {
    state.quota.quotaResetAt = new Date(Date.now() + 3600000).toISOString();
  }
  await saveState();
}

export async function resetModelHealth(modelId: string): Promise<void> {
  await loadState();
  const state = getOrCreateModelState(modelId);
  state.health = 'healthy';
  state.consecutiveFailures = 0;
  state.quarantineUntil = null;
  state.lastError = null;
  state.lastErrorCode = null;
  await saveState();
}

export async function resetAllQuotas(): Promise<void> {
  await loadState();
  for (const [id, state] of ModelState) {
    state.quota.quotaUsed = 0;
    state.quota.quotaPercent = 0;
    state.quota.quotaRemaining = state.quota.quotaLimit;
    state.quota.quotaResetAt = null;
    state.health = 'healthy';
    state.consecutiveFailures = 0;
    state.quarantineUntil = null;
  }
  await saveState();
}

// ==================== MASTER REQUEST EXECUTION ====================
// Config-2: OmniRoute path (localhost:20128) via omniRouteManager.completeWithFreeModel
// Config-2a: Backup AI Control Center via DG-STOK Adapter (BACKUP_AI_ADAPTER=1/true/FORCE)

// ==================== MASTER TRACE / STATUS (gerçek runtime) ====================

export interface MasterTraceEntry {
  at: string;
  module: string;
  taskType: string;
  source: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  errorCode?: string;
}

const MASTER_TRACE_MAX = 100;
const masterTrace: MasterTraceEntry[] = [];
let lastExecution: MasterTraceEntry | null = null;

function recordMasterTrace(entry: MasterTraceEntry): void {
  masterTrace.unshift(entry);
  if (masterTrace.length > MASTER_TRACE_MAX) masterTrace.length = MASTER_TRACE_MAX;
  lastExecution = entry;
}

function traceFromResult(
  r: { ok: boolean; source?: string; model: string; error?: string; errorCode?: string },
  taskType: string,
  moduleName: string,
  startTime: number
): MasterTraceEntry {
  return {
    at: new Date().toISOString(),
    module: moduleName,
    taskType,
    source: r.source || 'omniroute',
    model: r.model || 'none',
    ok: !!r.ok,
    latencyMs: Date.now() - startTime,
    ...(r.error ? { error: r.error } : {}),
    ...(r.errorCode ? { errorCode: r.errorCode } : {}),
  };
}

export async function executeMasterRequest(opts: {
  taskType: TaskType;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
  metadata?: Record<string, any>;
}): Promise<{
  ok: boolean;
  content: string | null;
  model: string;
  source?: string;
  totalLatencyMs: number;
  error?: string;
  errorCode?: string;
  validatedJson?: any;
}> {
  const startTime = Date.now();
  
  const { taskType, messages, maxTokens = 500, temperature = 0.7, response_format, metadata } = opts;
  const moduleName = String(metadata?.module || 'unknown');
  
  console.log(`[EXEC-01] executeMasterRequest taskType=${taskType} msgs=${messages.length} maxT=${maxTokens}`, new Date().toISOString());
  
  // Config-2: Adapter geçişi — DG-STOK → Backup AI Control Center → Master Router
  const adapterEnabled = process.env.BACKUP_AI_ADAPTER === '1' || process.env.BACKUP_AI_ADAPTER === 'true';
  const adapterForced = process.env.BACKUP_AI_ADAPTER === 'FORCE';

  if (adapterEnabled || adapterForced) {
    const { callBackupRouter } = await import('./dgStokAiAdapter.ts');
    const adapterResult = await callBackupRouter({
      taskType,
      messages,
      maxTokens,
      temperature,
      response_format,
      metadata,
    });
    console.log(`[EXEC-03-ADAPTER] adapter ok=${adapterResult.ok} model=${adapterResult.model} source=${adapterResult.source} latency=${adapterResult.totalLatencyMs}`);
    recordMasterTrace(traceFromResult(adapterResult, taskType, moduleName, startTime));
    return adapterResult;
  }

  // Config-1 (DEFAULT): Direct OmniRoute (omniRouteManager.completeWithFreeModel)
  // Config-1 is NEVER modified, disabled, or intercepted by the adapter.
  
  // Config-2: calls OmniRoute-2 via omniRouteManager (not OpenRouter cloud)
  const { completeWithFreeModel } = await import('./omniRouteManager.ts');
  console.log('[EXEC-02] completeWithFreeModel imported', new Date().toISOString());
  
  let result: { ok: boolean; content: string | null; model: string; source?: string; usage?: any; error?: string; errorCode?: string };
  let execSource = 'omniroute';
  // Router Orkestra → Free Model Pool → gerçek provider adaptörü
  // (openrouter/*, nvidia/* → direkt provider; diğer modeller → OmniRoute).
  try {
    const routed = await dispatchRequest(opts.messages, taskType, maxTokens, temperature);
    if (routed.ok && routed.content) {
      result = { ok: true, content: routed.content, model: routed.model, source: routed.source || providerSource(routed.model) };
      execSource = result.source || 'omniroute';
      console.log(`[EXEC-03-ROUTER] pool ok model=${result.model} source=${execSource}`, new Date().toISOString());
    } else {
      result = { ok: false, content: null, model: routed.model || 'none', error: routed.error, errorCode: 'ROUTER_POOL_FAILED' };
    }
  } catch (err: any) {
    result = { ok: false, content: null, model: 'none', error: err?.message || 'router exception', errorCode: 'ROUTER_EXCEPTION' };
  }
  
  console.log(`[EXEC-03] completeWithFreeModel ok=${result.ok} model=${result.model} error=${result.error || 'none'}`, new Date().toISOString());
  
  const totalLatencyMs = Date.now() - startTime;
  
  // Fallback: havuz boş/başarısızsa eski OmniRoute yolu (çalışan sistem korunur).
  if (!result.ok) {
    console.log('[EXEC-03-FALLBACK] router pool failed → completeWithFreeModel', result.error || '', new Date().toISOString());
    try {
      const fb = await completeWithFreeModel({
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 500,
        response_format: opts.response_format,
      });
      result = { ok: fb.ok, content: fb.content, model: fb.model, source: 'omniroute', usage: fb.usage, error: fb.error, errorCode: fb.errorCode };
      execSource = 'omniroute';
    } catch (err: any) {
      console.error('[EXEC-03] completeWithFreeModel CRASH:', err?.message || err);
      result = { ok: false, content: null, model: 'none', source: 'omniroute', error: `AI request crashed: ${err?.message || 'unknown'}`, errorCode: 'AI_REQUEST_CRASH' };
    }
  }

  if (!result.ok) {
    const failResult = {
      ok: false,
      content: null,
      model: result.model || 'none',
      source: execSource,
      totalLatencyMs: Date.now() - startTime,
      error: result.error,
      errorCode: result.errorCode,
    };
    recordMasterTrace(traceFromResult(failResult, taskType, moduleName, startTime));
    return failResult;
  }
  
  // Try to parse JSON if response_format is json_object
  let validatedJson: any = undefined;
  if (result.ok && opts.response_format?.type === 'json_object' && result.content) {
    try {
      const jsonStr = result.content.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object') {
          validatedJson = parsed;
        }
      }
    } catch {
      // JSON parsing failed, leave validatedJson as undefined
    }
  }
  
  const successResult = {
    ok: true,
    content: result.content,
    model: result.model,
    source: result.source || execSource,
    totalLatencyMs: Date.now() - startTime,
    validatedJson,
  };
  recordMasterTrace(traceFromResult(successResult, taskType, moduleName, startTime));
  return successResult;
}

/**
 * Gerçek routing tablosu: taskType için canlı ModelState skorları ve seçim nedeni.
 * Stub DEĞİL — routeRequest ile aynı skorlama kullanılır.
 */
export async function explainRouting(taskType: TaskType = 'GENERAL', _modelId?: string, _capability?: string, limit = 14): Promise<any> {
  const routing = await routeRequest(taskType);
  if (!routing) {
    return { taskType, selected: null, selectedReason: 'NO_ELIGIBLE_FREE_MODEL', fallbackChain: [], table: [] };
  }
  const table = routing.allEligible.slice(0, Math.max(1, limit)).map((s, i) => ({
    rank: i + 1,
    modelId: s.modelId,
    score: s.currentScore,
    health: s.health,
    capabilities: s.capabilities,
    quotaPercent: s.quota.quotaPercent,
    avgLatencyMs: Math.round(s.avgLatencyMs || 0),
    qualityScore: s.qualityScore,
    reliabilityScore: s.reliabilityScore,
    taskFitScore: s.taskFitScore,
    selected: i === 0,
  }));
  return {
    taskType,
    selected: routing.selected.modelId,
    selectedReason: routing.reason,
    fallbackChain: routing.fallbackChain.map(s => s.modelId),
    table,
  };
}

/**
 * Gerçek runtime durumu: orchestrator health + son gerçek execution (aktif agent/provider/model).
 */
export async function getMasterStatus(): Promise<any> {
  const status = await getOrchestratorStatus();
  return {
    ...status,
    status: 'active',
    activeAgent: lastExecution
      ? {
          source: lastExecution.source,
          model: lastExecution.model,
          taskType: lastExecution.taskType,
          module: lastExecution.module,
          ok: lastExecution.ok,
          latencyMs: lastExecution.latencyMs,
          at: lastExecution.at,
          error: lastExecution.error || null,
        }
      : null,
  };
}

/** Son gerçek AI çağrılarının döngüsel izi (module → router → source → model → sonuç). */
export function getMasterTrace(limit = 25): MasterTraceEntry[] {
  return masterTrace.slice(0, Math.max(1, Math.min(MASTER_TRACE_MAX, limit)));
}

/**
 * AI Kontrol Merkezi görünürlüğü: son GERÇEK execution (provider/model/agent/latency).
 * Config'ten TAHMİN EDİLMEZ — gerçek runtime trace'inden gelir.
 */
export function getLastExecution(): MasterTraceEntry | null {
  return lastExecution;
}

export function notifyAvailabilitySignal(): void {
  // no-op stub
}

export async function getAvailabilitySnapshot(): Promise<any> {
  try {
    await loadState();
    const registry = await getRegistry();
    const freeModels = await buildPoolModels();
    let active = 0;
    for (const model of freeModels) {
      const state = getOrCreateModelState(model.id);
      if (isHealthEligible(state) && isQuotaEligible(state)) active++;
    }
    const level = active > 0 ? 'ACTIVE' : 'DEGRADED';
    const currentAI = orchestratorStats.lastRoutingAt
      ? { source: 'omniroute', modelId: '', at: orchestratorStats.lastRoutingAt }
      : null;
    return { available: active, total: freeModels.length, level, currentAI };
  } catch {
    return { available: 0, total: 0, level: 'DOWN', currentAI: null };
  }
}

export function invalidateCandidateCache(): void {
  // no-op stub
}

export async function startAvailabilitySupervisor(): Promise<void> {
  console.log('[omniRouteOrchestrator] Availability supervisor: stub (not started)');
}

export { ModelState, QUOTA_WARNING_THRESHOLD, QUOTA_HARD_THRESHOLD, QUOTA_FULL_THRESHOLD };
