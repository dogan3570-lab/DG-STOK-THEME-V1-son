import type { AgentConfig, CompletionRequest, CompletionResponse } from '../types.ts';
import { BaseAgent } from './base.ts';
import { httpPost } from '../http.ts';
import { updateQuotaFromHeaders } from '../managers/quota.ts';

export class OpenRouterAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super(config);
  }

  async getCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.config.freeModels[0] || 'meta-llama/llama-3.1-8b-instruct:free';
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
      'HTTP-Referer': 'http://localhost:4100',
      'X-Title': 'Backup AI Router',
    };

    const result = await this.postCompletion(
      `${this.config.baseUrl}/chat/completions`,
      body,
      headers,
      this.config.timeoutMs,
      ''
    );

    return result;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const result = await httpPost(
        `${this.config.baseUrl}/chat/completions`,
        {
          model: this.config.freeModels[0] || 'meta-llama/llama-3.1-8b-instruct:free',
          messages: [{ role: 'user', content: 'Say: OK' }],
          max_tokens: 5,
        },
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'http://localhost:4100',
          'X-Title': 'Backup AI Router',
        },
        15000
      );
      return result.ok;
    } catch {
      return false;
    }
  }
}
