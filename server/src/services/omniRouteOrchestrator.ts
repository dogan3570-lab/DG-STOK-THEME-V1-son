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

export async function routeRequest(
  taskType: TaskType = 'GENERAL',
  excludeModels: Set<string> = new Set()
): Promise<RoutingResult | null> {
  await loadState();
  const registry = await getRegistry();

  const freeModels = registry.models.filter(m => m.free);
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
): Promise<{ ok: boolean; content: string | null; model: string; error?: string }> {
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
        return { ok: true, content: result.content, model: modelId };
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
  return { ok: false, content: null, model: '', error: `ALL_MODELS_FAILED: ${lastError}` };
}

// ==================== MODEL CALL ====================

async function callModel(
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

    const res = await fetch(`${process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128'}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const freeModels = registry.models.filter(m => m.free);

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
  const freeModels = registry.models.filter(m => m.free);
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

// ==================== STUB FUNCTIONS (post-checkpoint developments) ====================
// These functions were added after 29770fe but before deletion.
// Stubs provided to prevent import errors.

export async function executeMasterRequest(_opts: any): Promise<any> {
  console.warn('[omniRouteOrchestrator] executeMasterRequest: stub called');
  return { ok: false, error: { code: 'STUB', message: 'Not implemented in restore' } };
}

export function explainRouting(_taskType?: string, _modelId?: string, _capability?: string, _limit?: number): any[] {
  console.warn('[omniRouteOrchestrator] explainRouting: stub called');
  return [];
}

export async function getMasterStatus(): Promise<any> {
  return { status: 'stub', models: [] };
}

export function getMasterTrace(_limit?: number): any[] {
  return [];
}

export function notifyAvailabilitySignal(): void {
  // no-op stub
}

export async function getAvailabilitySnapshot(): Promise<any> {
  try {
    await loadState();
    const registry = await getRegistry();
    const freeModels = registry.models.filter(m => m.free);
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
