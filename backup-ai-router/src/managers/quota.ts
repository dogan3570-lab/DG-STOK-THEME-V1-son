import type { AgentState, QuotaState, QuotaSource } from '../types.ts';

const QUOTA_DRAINING_THRESHOLD = 80;
const QUOTA_EXHAUSTED_THRESHOLD = 100;

export function getQuotaState(state: AgentState): QuotaState {
  if (state.quotaState === 'EXHAUSTED') return 'EXHAUSTED';
  if (state.quotaPercent >= QUOTA_EXHAUSTED_THRESHOLD) return 'EXHAUSTED';
  if (state.quotaPercent >= QUOTA_DRAINING_THRESHOLD) return 'DRAINING';
  if (state.quotaState === 'UNKNOWN' || state.quotaLimit === 0) return 'UNKNOWN';
  return 'ACTIVE';
}

export function updateQuotaFromHeaders(state: AgentState, headers: Record<string, string>): void {
  const remaining = headers['x-ratelimit-remaining'];
  const limit = headers['x-ratelimit-limit'];
  const retryAfter = headers['retry-after'];

  if (remaining !== undefined && limit !== undefined) {
    const rem = parseInt(remaining, 10);
    const lim = parseInt(limit, 10);
    if (!isNaN(rem) && !isNaN(lim) && lim > 0) {
      state.quotaUsed = lim - rem;
      state.quotaLimit = lim;
      state.quotaPercent = Math.round((rem / lim) * 100);
      state.quotaState = 'ACTIVE';
      state.quotaSource = 'OBSERVED';
      return;
    }
  }

  if (retryAfter !== undefined) {
    const retrySec = parseInt(retryAfter, 10);
    if (!isNaN(retrySec) && retrySec > 0) {
      state.quotaState = 'EXHAUSTED';
      state.quotaSource = 'OBSERVED';
      state.cooldownUntil = Date.now() + retrySec * 1000;
      return;
    }
  }
}

export function estimateQuota(state: AgentState): void {
  if (state.quotaSource === 'OBSERVED') return;
  const total = state.successCount + state.failCount;
  if (total < 5) {
    state.quotaState = 'UNKNOWN';
    state.quotaSource = 'UNKNOWN';
    return;
  }
  const successRate = state.successCount / total;
  if (successRate > 0.95) {
    state.quotaState = 'ACTIVE';
    state.quotaPercent = Math.min(70, Math.round((1 - successRate) * 100));
  } else if (successRate > 0.8) {
    state.quotaState = 'DRAINING';
    state.quotaPercent = Math.round((1 - successRate) * 100);
  } else {
    state.quotaState = 'EXHAUSTED';
    state.quotaPercent = Math.round((1 - successRate) * 100);
  }
  state.quotaSource = 'ESTIMATED';
}

export function isQuotaEligible(state: AgentState): boolean {
  if (state.cooldownUntil && Date.now() < state.cooldownUntil) return false;
  if (state.quotaState === 'EXHAUSTED') return false;
  if (state.status === 'RATE_LIMITED') return false;
  if (state.quotaPercent >= QUOTA_DRAINING_THRESHOLD && state.consecutiveQuotaFails >= 2) return false;
  return true;
}
