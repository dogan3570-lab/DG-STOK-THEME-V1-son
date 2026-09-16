import type { AgentConfig, CompletionRequest, CompletionResponse } from '../types.ts';
import { BaseAgent } from './base.ts';
import { httpPost } from '../http.ts';
import { updateQuotaFromHeaders } from '../managers/quota.ts';

export class OmniRouteAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
  }

  async getCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.config.freeModels[0] || 'auto/best-free';
    const body = {
      model,
      messages: request.messages,
      max_tokens: request.max_tokens ?? this.config.maxTokens,
      temperature: request.temperature ?? 0.1,
      stream: false,
      ...(request.response_format ? { response_format: request.response_format } : {}),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    console.log(`[omniroute] Requesting ${this.config.baseUrl}/v1/chat/completions model=${model}`);
    const startTime = Date.now();
    const result = await httpPost(
      `${this.config.baseUrl}/v1/chat/completions`,
      body,
      headers,
      this.config.timeoutMs
    );
    const latencyMs = Date.now() - startTime;

    this.state.totalRequests++;
    this.state.lastRequestAt = new Date().toISOString();

    if (result.ok) {
      updateQuotaFromHeaders(this.state, result.headers);
    }

    if (result.ok) {
      try {
        const data = JSON.parse(result.body);
        const content = data?.choices?.[0]?.message?.content || null;
        console.log(`[omniroute] Success model=${data?.model || model} latency=${latencyMs}ms`);
        return {
          ok: true,
          agentId: this.config.id,
          provider: this.config.provider,
          model: data?.model || model,
          content,
          latencyMs,
          usage: data?.usage,
          requestId: '',
        };
      } catch {
        console.error('[omniroute] Invalid JSON from OmniRoute');
        return {
          ok: false,
          agentId: this.config.id,
          provider: this.config.provider,
          model,
          content: null,
          latencyMs,
          error: 'Invalid JSON from OmniRoute',
          errorCode: 'INVALID_RESPONSE',
          requestId: '',
        };
      }
    }

    let errorCode = `HTTP_${result.status}`;
    if (result.status === 429) errorCode = '429';
    else if (result.status === 504) errorCode = 'TIMEOUT';

    console.error(`[omniroute] Error status=${result.status} body=${result.body.slice(0, 200)}`);
    return {
      ok: false,
      agentId: this.config.id,
      provider: this.config.provider,
      model,
      content: null,
      latencyMs,
      error: result.body.slice(0, 200),
      errorCode,
      requestId: '',
    };
  }
}
