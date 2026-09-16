import { type TaskType } from './omniRouteOrchestrator.ts';

function generateRequestId(): string {
  return `adapter-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export interface BackupRouterRequest {
  messages: { role: string; content: string }[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface BackupRouterResponse {
  ok: boolean;
  content: string | null;
  model: string;
  error?: string;
  errorCode?: string;
  latencyMs?: number;
  provider?: string;
  agent?: string;
}

export interface BackupRouterErrorBody {
  ok?: boolean;
  error?: string;
  errorCode?: string;
  model?: string;
  content?: string;
}

export async function callBackupRouter(opts: {
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
  const requestId = generateRequestId();
  const { messages, maxTokens, temperature, response_format } = opts;

  const requestBody: BackupRouterRequest = {
    messages,
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(response_format !== undefined ? { response_format } : {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    console.log(`[ADAPTER] requestId=${requestId} START msgs=${messages.length} maxT=${maxTokens ?? 500}`);

    const res = await fetch(`${process.env.BACKUP_AI_ROUTER_URL || 'http://localhost:4100'}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    console.log(`[ADAPTER] requestId=${requestId} HTTP ${res.status} latency=${latencyMs}ms`);

    if (!res.ok) {
      let errorBody: BackupRouterErrorBody = {};
      try { errorBody = await res.json(); } catch {
        try { errorBody = { error: await res.text() }; } catch { errorBody = {}; }
      }

      let errorCode: string | undefined = 'HTTP_ERROR';
      let errorMsg = `HTTP ${res.status}: ${(errorBody.error || '').toString().slice(0, 200)}`;

      if (res.status === 401 || res.status === 403) { errorCode = 'AUTH_REQUIRED'; errorMsg = `Auth error ${res.status}`; }
      else if (res.status === 429) { errorCode = 'RATE_LIMIT'; errorMsg = 'Rate limit exceeded'; }
      else if (res.status === 404) { errorCode = 'MODEL_NOT_FOUND'; errorMsg = 'Model not found'; }
      else if (res.status === 402) { errorCode = 'QUOTA_EXCEEDED'; errorMsg = 'Quota exceeded'; }
      else if (res.status >= 500) { errorCode = 'SERVER_ERROR'; errorMsg = `Server error ${res.status}`; }

      if (errorBody.errorCode) errorCode = errorBody.errorCode;
      if (errorBody.error) errorMsg = errorBody.error;

      return {
        ok: false,
        content: null,
        model: errorBody.model || 'none',
        source: 'backup_router',
        totalLatencyMs: latencyMs,
        error: errorMsg,
        errorCode,
      };
    }

    const data: BackupRouterResponse = await res.json();
    const model = data.model || 'none';

    console.log(`[ADAPTER] requestId=${requestId} model=${model} contentLen=${(data.content ?? '').length}`);

    if (data.ok === false) {
      return {
        ok: false,
        content: data.content ?? null,
        model,
        source: 'backup_router',
        totalLatencyMs: latencyMs,
        error: data.error,
        errorCode: data.errorCode,
      };
    }

    console.log(`[ADAPTER] requestId=${requestId} DONE ok=true model=${model} latency=${latencyMs}ms`);
    return { ok: true, content: data.content ?? null, model, source: 'backup_router', totalLatencyMs: latencyMs };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (err.name === 'AbortError') {
      console.log(`[ADAPTER] requestId=${requestId} DONE ok=false errorCode=TIMEOUT latency=${latencyMs}ms`);
      return { ok: false, content: null, model: 'none', source: 'backup_router', totalLatencyMs: latencyMs, error: 'Request timeout', errorCode: 'TIMEOUT' };
    }

    console.log(`[ADAPTER] requestId=${requestId} DONE ok=false errorCode=CONNECTION_ERROR latency=${latencyMs}ms`);
    return { ok: false, content: null, model: 'none', source: 'backup_router', totalLatencyMs: latencyMs, error: err.message || 'Connection failed', errorCode: 'CONNECTION_ERROR' };
  }
}
