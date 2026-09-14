import type { AgentConfig, AgentState, AgentSelection, CompletionRequest, CompletionResponse, QuotaState, RequestLog } from '../types.ts';
import { BaseAgent } from './base.ts';
import { OmniRouteAgent } from './omniroute.ts';
import { NvidiaAgent } from './nvidia.ts';
import { OpenRouterAgent } from './openrouter.ts';
import { getQuotaState, isQuotaEligible, estimateQuota } from '../managers/quota.ts';
import { getHealthState, recordSuccess, recordFailure, isHealthEligible } from '../managers/health.ts';
import { logRequest, generateRequestId } from '../logger.ts';

export class AgentPool {
  private agents: Map<string, BaseAgent> = new Map();

  registerAgent(config: AgentConfig): BaseAgent {
    let agent: BaseAgent;
    switch (config.provider) {
      case 'omniroute': agent = new OmniRouteAgent(config); break;
      case 'nvidia': agent = new NvidiaAgent(config); break;
      case 'openrouter': agent = new OpenRouterAgent(config); break;
      default: throw new Error(`Unknown provider: ${config.provider}`);
    }
    this.agents.set(config.id, agent);
    return agent;
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getAllStates(): AgentState[] {
    return this.getAllAgents().map(a => {
      a.state.quotaState = getQuotaState(a.state);
      a.state.healthState = getHealthState(a.state);
      estimateQuota(a.state);
      return { ...a.state };
    });
  }

  selectBestAgent(): AgentSelection | null {
    const eligible = this.getAllAgents().filter(agent => {
      const quota = getQuotaState(agent.state);
      const health = getHealthState(agent.state);
      agent.state.quotaState = quota;
      agent.state.healthState = health;
      return isQuotaEligible(agent.state) && isHealthEligible(agent.state);
    });

    if (eligible.length === 0) return null;

    eligible.sort((a, b) => {
      const scoreA = this.calculateScore(a.state);
      const scoreB = this.calculateScore(b.state);
      return scoreB - scoreA;
    });

    const best = eligible[0];
    const model = best.config.freeModels[0] || 'auto/best-free';
    const reasons: string[] = [];
    if (best.state.quotaState === 'ACTIVE') reasons.push('quota<80%');
    if (best.state.healthState === 'HEALTHY') reasons.push('healthy');
    if (best.state.avgLatencyMs > 0) reasons.push(`latency=${best.state.avgLatencyMs}ms`);
    if (best.state.consecutiveFails === 0) reasons.push('no-fails');

    return {
      agentId: best.config.id,
      model,
      reason: reasons.join(', ') || 'best-score',
    };
  }

  private calculateScore(state: AgentState): number {
    let score = 100;
    if (state.quotaState === 'ACTIVE') score += 30;
    else if (state.quotaState === 'DRAINING') score -= 20;
    else if (state.quotaState === 'EXHAUSTED') score -= 50;

    if (state.healthState === 'HEALTHY') score += 20;
    else if (state.healthState === 'DEGRADED') score -= 15;
    else if (state.healthState === 'UNHEALTHY') score -= 40;

    const total = state.successCount + state.failCount;
    if (total > 0) {
      const successRate = state.successCount / total;
      score += Math.round(successRate * 20);
    }

    if (state.avgLatencyMs > 0 && state.avgLatencyMs < 3000) score += 10;
    else if (state.avgLatencyMs > 5000) score -= 10;

    if (state.consecutiveFails > 0) score -= state.consecutiveFails * 5;

    return score;
  }

  async routeRequest(request: CompletionRequest, excludeAgentIds: Set<string> = new Set()): Promise<CompletionResponse> {
    const requestId = generateRequestId();
    let fallbackFrom: string | undefined;
    let lastError = '';
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const selection = this.selectBestAgentExcluding(excludeAgentIds);
      if (!selection) {
        const log: RequestLog = {
          requestId,
          timestamp: new Date().toISOString(),
          agentId: 'none',
          provider: 'none',
          model: '',
          quotaState: 'UNKNOWN',
          healthState: 'UNKNOWN',
          selectionReason: 'no-eligible-agent',
          fallbackFrom,
          latencyMs: 0,
          status: 'ALL_UNAVAILABLE',
        };
        logRequest(log);
        return {
          ok: false,
          agentId: 'none',
          provider: 'none',
          model: '',
          content: null,
          latencyMs: 0,
          error: 'ALL_PROVIDERS_UNAVAILABLE: Hiçbir provider kullanılabilir değil',
          errorCode: 'ALL_UNAVAILABLE',
          fallbackFrom,
          requestId,
        };
      }

      const agent = this.agents.get(selection.agentId);
      if (!agent) continue;

      agent.state.totalRequests++;
      agent.state.lastRequestAt = new Date().toISOString();

      try {
        const result = await agent.getCompletion(request);
        result.requestId = requestId;

        if (result.ok) {
          recordSuccess(agent.state, result.latencyMs);
          const log: RequestLog = {
            requestId,
            timestamp: new Date().toISOString(),
            agentId: agent.config.id,
            provider: agent.config.provider,
            model: result.model,
            quotaState: agent.state.quotaState,
            healthState: agent.state.healthState,
            selectionReason: selection.reason,
            fallbackFrom,
            latencyMs: result.latencyMs,
            status: 'SUCCESS',
          };
          logRequest(log);
          return result;
        }

        recordFailure(agent.state, result.errorCode || 'UNKNOWN');
        lastError = result.error || 'Unknown error';
        const is429 = result.errorCode === '429' || result.status === 429;
        const isTimeout = result.errorCode === 'TIMEOUT';

        if (is429) {
          agent.state.quotaState = 'EXHAUSTED';
          agent.state.status = 'RATE_LIMITED';
        }

        excludeAgentIds.add(agent.config.id);
        if (!fallbackFrom) fallbackFrom = agent.config.id;

        const log: RequestLog = {
          requestId,
          timestamp: new Date().toISOString(),
          agentId: agent.config.id,
          provider: agent.config.provider,
          model: result.model,
          quotaState: agent.state.quotaState,
          healthState: agent.state.healthState,
          selectionReason: selection.reason,
          fallbackFrom: attempt > 0 ? fallbackFrom : undefined,
          fallbackTo: undefined,
          latencyMs: result.latencyMs,
          status: is429 ? 'RATE_LIMITED' : isTimeout ? 'TIMEOUT' : 'FAIL',
          errorCode: result.errorCode,
        };
        logRequest(log);
      } catch (err: any) {
        recordFailure(agent.state, 'EXCEPTION');
        lastError = err.message || 'Exception';
        excludeAgentIds.add(agent.config.id);
        if (!fallbackFrom) fallbackFrom = agent.config.id;
      }
    }

    return {
      ok: false,
      agentId: 'none',
      provider: 'none',
      model: '',
      content: null,
      latencyMs: 0,
      error: `ALL_RETRIES_EXHAUSTED: ${lastError}`,
      errorCode: 'ALL_RETRIES_EXHAUSTED',
      fallbackFrom,
      requestId,
    };
  }

  private selectBestAgentExcluding(excludeIds: Set<string>): AgentSelection | null {
    const eligible = this.getAllAgents().filter(agent => {
      if (excludeIds.has(agent.config.id)) return false;
      const quota = getQuotaState(agent.state);
      const health = getHealthState(agent.state);
      agent.state.quotaState = quota;
      agent.state.healthState = health;
      return isQuotaEligible(agent.state) && isHealthEligible(agent.state);
    });

    if (eligible.length === 0) return null;

    eligible.sort((a, b) => this.calculateScore(b.state) - this.calculateScore(a.state));
    const best = eligible[0];
    const model = best.config.freeModels[0] || 'auto/best-free';

    return {
      agentId: best.config.id,
      model,
      reason: `score=${this.calculateScore(best.state)}`,
    };
  }
}
