import type { AgentConfig, AgentState, CompletionRequest, CompletionResponse } from '../types.ts';
import { httpPost, httpGet } from '../http.ts';

export abstract class BaseAgent {
  readonly config: AgentConfig;
  state: AgentState;

  constructor(config: AgentConfig) {
    this.config = config;
    this.state = this.createInitialState();
  }

  private createInitialState(): AgentState {
    return {
      id: this.config.id,
      provider: this.config.provider,
      status: 'ACTIVE',
      quotaState: 'UNKNOWN',
      quotaSource: 'UNKNOWN',
      quotaUsed: 0,
      quotaLimit: 0,
      quotaPercent: 0,
      healthState: 'UNKNOWN',
      successCount: 0,
      failCount: 0,
      consecutiveFails: 0,
      totalRequests: 0,
      avgLatencyMs: 0,
      lastRequestAt: null,
      lastSuccessAt: null,
      lastFailAt: null,
      lastError: null,
      lastErrorCode: null,
      cooldownUntil: null,
      consecutiveQuotaFails: 0,
    };
  }

  abstract getCompletion(request: CompletionRequest): Promise<CompletionResponse>;

  async healthCheck(): Promise<boolean> {
    try {
      const result = await httpGet(`${this.config.baseUrl}/api/health`, {}, 10000);
      return result.ok;
    } catch {
      return false;
    }
  }

  protected async postCompletion(
    url: string,
    body: any,
    headers: Record<string, string>,
    timeoutMs: number,
    requestId: string
  ): Promise<CompletionResponse> {
    const startTime = Date.now();
    const result = await httpPost(url, body, headers, timeoutMs);
    const latencyMs = Date.now() - startTime;

    this.state.totalRequests++;
    this.state.lastRequestAt = new Date().toISOString();

    if (result.ok) {
      try {
        const data = JSON.parse(result.body);
        const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || null;
        return {
          ok: true,
          agentId: this.config.id,
          provider: this.config.provider,
          model: data?.model || this.config.id,
          content,
          latencyMs,
          status: result.status,
          usage: data?.usage,
          requestId,
        };
      } catch {
        return {
          ok: false,
          agentId: this.config.id,
          provider: this.config.provider,
          model: this.config.id,
          content: null,
          latencyMs,
          status: result.status,
          error: 'Invalid JSON response',
          errorCode: 'INVALID_RESPONSE',
          requestId,
        };
      }
    }

    let errorCode = `HTTP_${result.status}`;
    if (result.status === 429) errorCode = '429';
    else if (result.status === 408) errorCode = 'TIMEOUT';
    else if (result.status === 401) errorCode = '401';
    else if (result.status === 403) errorCode = '403';

    return {
      ok: false,
      agentId: this.config.id,
      provider: this.config.provider,
      model: this.config.id,
      content: null,
      latencyMs,
      status: result.status,
      error: result.body.slice(0, 200) || `HTTP ${result.status}`,
      errorCode,
      requestId,
    };
  }
}
