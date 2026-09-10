/**
 * OpenCode Models - Stub
 * Original file was lost during deletion. This is a minimal stub
 * that provides the required exports without crashing the server.
 * 
 * TODO: Re-implement full model discovery logic if needed.
 */

interface OpenCodeModel {
  modelId: string;
  displayName: string;
  provider: string;
  active: boolean;
  health: string;
  freeStatus: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
}

let cachedModels: OpenCodeModel[] = [];

export async function getCachedModels(): Promise<OpenCodeModel[]> {
  return cachedModels;
}

export async function discoverOpenCodeModels(forceRefresh: boolean = false): Promise<OpenCodeModel[]> {
  if (!forceRefresh && cachedModels.length > 0) {
    return cachedModels;
  }
  // Stub: return empty array
  cachedModels = [];
  return cachedModels;
}

export async function getActiveFreeModels(): Promise<OpenCodeModel[]> {
  const all = await getCachedModels();
  return all.filter(m => m.active && m.health === 'healthy');
}

export async function recordModelOutcome(
  modelId: string,
  ok: boolean,
  latencyMs?: number,
  errorMsg?: string,
  errorCode?: string
): Promise<void> {
  const models = await getCachedModels();
  const model = models.find(m => m.modelId === modelId);
  if (!model) return;

  model.totalRequests++;
  model.lastUsedAt = new Date().toISOString();
  model.lastCheckedAt = new Date().toISOString();

  if (ok) {
    model.successfulRequests++;
    model.health = 'healthy';
    model.consecutiveFailures = 0;
    model.lastError = null;
    model.lastErrorCode = null;
    model.lastLatencyMs = latencyMs ?? null;
  } else {
    model.failedRequests++;
    model.lastError = errorMsg ?? null;
    model.lastErrorCode = errorCode ?? null;
    model.lastLatencyMs = latencyMs ?? null;

    if (errorCode === 'MODEL_NOT_FOUND' || errorCode === 'MODEL_DEPRECATED' || errorCode === 'UNSUPPORTED_MODEL') {
      model.health = 'quarantined';
      model.active = false;
    } else if (errorCode === 'RATE_LIMIT' || errorCode === 'TIMEOUT' || errorCode === 'SERVER_ERROR') {
      model.consecutiveFailures++;
      if (model.consecutiveFailures >= 3) {
        model.health = 'degraded';
      }
    }
  }
}
