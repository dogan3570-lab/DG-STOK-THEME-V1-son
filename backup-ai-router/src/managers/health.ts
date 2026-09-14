import type { AgentState, HealthState } from '../types.ts';

const CONSECUTIVE_FAIL_THRESHOLD = 3;
const LATENCY_WARNING_MS = 5000;
const HEALTH_RECOVERY_TIMEOUT_MS = 60000;

export function getHealthState(state: AgentState): HealthState {
  if (state.healthState === 'UNHEALTHY' && state.cooldownUntil && Date.now() < state.cooldownUntil) {
    return 'UNHEALTHY';
  }
  if (state.cooldownUntil && Date.now() >= state.cooldownUntil) {
    state.cooldownUntil = null;
    state.healthState = 'DEGRADED';
  }
  if (state.consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) return 'UNHEALTHY';
  if (state.avgLatencyMs > LATENCY_WARNING_MS) return 'DEGRADED';
  return state.healthState;
}

export function recordSuccess(state: AgentState, latencyMs: number): void {
  state.successCount++;
  state.consecutiveFails = 0;
  state.consecutiveQuotaFails = 0;
  state.lastSuccessAt = new Date().toISOString();
  state.avgLatencyMs = state.avgLatencyMs > 0
    ? Math.round((state.avgLatencyMs + latencyMs) / 2)
    : latencyMs;
  state.healthState = 'HEALTHY';
  state.status = 'ACTIVE';
}

export function recordFailure(state: AgentState, errorCode: string): void {
  state.failCount++;
  state.consecutiveFails++;
  state.lastFailAt = new Date().toISOString();
  state.lastError = errorCode;
  state.lastErrorCode = errorCode;
  state.status = 'ERROR';

  if (errorCode === '429' || errorCode === 'RATE_LIMITED') {
    state.status = 'RATE_LIMITED';
    state.consecutiveQuotaFails++;
  }

  if (state.consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) {
    state.healthState = 'UNHEALTHY';
    state.cooldownUntil = Date.now() + HEALTH_RECOVERY_TIMEOUT_MS;
    state.status = 'COOLDOWN';
  } else if (state.consecutiveFails >= 1) {
    state.healthState = 'DEGRADED';
  }
}

export function isHealthEligible(state: AgentState): boolean {
  if (state.status === 'COOLDOWN' && state.cooldownUntil && Date.now() < state.cooldownUntil) return false;
  if (state.status === 'OFFLINE') return false;
  return true;
}
