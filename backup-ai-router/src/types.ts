export type QuotaState = 'ACTIVE' | 'DRAINING' | 'EXHAUSTED' | 'UNKNOWN';
export type HealthState = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type AgentStatus = 'ACTIVE' | 'DRAINING' | 'COOLDOWN' | 'RATE_LIMITED' | 'ERROR' | 'OFFLINE';
export type QuotaSource = 'OBSERVED' | 'ESTIMATED' | 'UNKNOWN';

export interface AgentConfig {
  id: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  freeModels: string[];
  maxTokens: number;
  timeoutMs: number;
}

export interface AgentState {
  id: string;
  provider: string;
  status: AgentStatus;
  quotaState: QuotaState;
  quotaSource: QuotaSource;
  quotaUsed: number;
  quotaLimit: number;
  quotaPercent: number;
  healthState: HealthState;
  successCount: number;
  failCount: number;
  consecutiveFails: number;
  totalRequests: number;
  avgLatencyMs: number;
  lastRequestAt: string | null;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  cooldownUntil: number | null;
  consecutiveQuotaFails: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: string };
}

export interface CompletionResponse {
  ok: boolean;
  agentId: string;
  provider: string;
  model: string;
  content: string | null;
  latencyMs: number;
  status?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: string;
  errorCode?: string;
  fallbackFrom?: string;
  fallbackTo?: string;
  requestId: string;
}

export interface RequestLog {
  requestId: string;
  timestamp: string;
  agentId: string;
  provider: string;
  model: string;
  quotaState: QuotaState;
  healthState: HealthState;
  selectionReason: string;
  fallbackFrom?: string;
  fallbackTo?: string;
  latencyMs: number;
  status: 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'RATE_LIMITED' | 'FALLBACK' | 'ALL_UNAVAILABLE';
  errorCode?: string;
}

export interface AgentSelection {
  agentId: string;
  model: string;
  reason: string;
}
