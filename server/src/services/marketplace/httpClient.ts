import { assertSafeApiUrl } from './ssrfGuard.ts';
import type { NormalizedProviderError } from './types.ts';
import { classifyHttpStatus, networkError, timeoutError } from './errors.ts';

/**
 * SSRF-korumalı, timeout'lu, bounded-retry'li marketplace HTTP istemcisi.
 * Raw provider body kullanıcıya/loglara DÖNMEZ; yalnızca parse için
 * truncate edilmiş bir kopya adapter'a iletilir ve asla loglanmaz.
 *
 * TRAFFIC LOGGING: Her istek/yanıt loglanır — Authorization header, API key,
 * secret, token ASLA loglanmaz. Yalnızca URL (host+path), method, status,
 * latency, retry bilgisi loglanır.
 */

export const MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30000;

// Circuit breaker
interface CircuitState {
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailureAt: number;
  openUntil: number;
}
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30000;
const circuitStates = new Map<string, CircuitState>();

function getCircuitKey(rawUrl: string): string {
  try { return new URL(rawUrl).host; } catch { return rawUrl; }
}

function circuitCheck(key: string): CircuitState {
  let state = circuitStates.get(key);
  if (!state) {
    state = { status: 'CLOSED', failures: 0, lastFailureAt: 0, openUntil: 0 };
    circuitStates.set(key, state);
  }
  if (state.status === 'OPEN' && Date.now() > state.openUntil) {
    state.status = 'HALF_OPEN';
    logTraffic({ direction: 'retry', url: key, attempt: 0, errorCode: 'CIRCUIT_HALF_OPEN', retryAfterMs: 0 });
  }
  return state;
}

function circuitRecord(key: string, success: boolean) {
  const state = circuitStates.get(key);
  if (!state) return;
  if (success) {
    state.failures = 0;
    state.status = 'CLOSED';
  } else {
    state.failures++;
    state.lastFailureAt = Date.now();
    if (state.failures >= CIRCUIT_THRESHOLD) {
      state.status = 'OPEN';
      state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
      logTraffic({ direction: 'error', url: key, errorCode: 'CIRCUIT_OPEN', latencyMs: 0 });
    }
  }
}

/**
 * URL'den credential sızıntısını önle — query parametrelerini ve
 * Authorization header'ı temizle, yalnızca host+path döndür.
 */
function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Traffic log — secret/token/apiKey ASLA loglanmaz.
 */
function logTraffic(entry: {
  direction: 'req' | 'res' | 'retry' | 'error';
  method?: string;
  url: string;
  status?: number;
  latencyMs?: number;
  attempt?: number;
  errorCode?: string;
  retryAfterMs?: number;
}) {
  const ts = new Date().toISOString().slice(11, 23);
  const url = sanitizeUrl(entry.url);
  if (entry.direction === 'req') {
    console.log(`[traffic] ${ts} → ${entry.method ?? 'GET'} ${url}`);
  } else if (entry.direction === 'res') {
    const statusClass = entry.status ? (entry.status < 300 ? '✓' : entry.status < 500 ? '⚠' : '✗') : '?';
    console.log(`[traffic] ${ts} ← ${statusClass} ${entry.status} ${url} ${entry.latencyMs}ms`);
  } else if (entry.direction === 'retry') {
    console.log(`[traffic] ${ts} ↻ retry attempt=${entry.attempt} code=${entry.errorCode} after=${entry.retryAfterMs}ms ${url}`);
  } else if (entry.direction === 'error') {
    console.log(`[traffic] ${ts} ✗ ${entry.errorCode} ${url} ${entry.latencyMs}ms`);
  }
}

export class ProviderHttpError extends Error {
  public readonly code: string;
  public readonly status: number | null;

  constructor(code: string, status: number | null) {
    super(code);
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, ProviderHttpError.prototype);
  }
}

export interface SafeHttpResponse {
  status: number;
  body: string;
  retryAfterSeconds: number | null;
}

export interface SafeHttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 5000);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const sec = Number(value);
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec, 300);
  return null;
}

export async function safeProviderFetch(rawUrl: string, options: SafeHttpOptions = {}): Promise<SafeHttpResponse> {
  const guard = await assertSafeApiUrl(rawUrl);
  if (!guard.ok || !guard.url) {
    throw new ProviderHttpError(`SSRF_BLOCKED_${guard.reason ?? 'UNKNOWN'}`, null);
  }

  logTraffic({ direction: 'req', method: options.method ?? 'GET', url: rawUrl });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(guard.url.toString(), {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body,
      signal: controller.signal,
      redirect: 'error',
    });

    const text = await res.text().catch(() => '');
    const latencyMs = Date.now() - start;
    logTraffic({ direction: 'res', url: rawUrl, status: res.status, latencyMs });

    return {
      status: res.status,
      body: text.slice(0, 2000),
      retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    if (err instanceof Error && err.name === 'AbortError') {
      logTraffic({ direction: 'error', url: rawUrl, errorCode: 'TIMEOUT', latencyMs });
      throw new ProviderHttpError('TIMEOUT', null);
    }
    logTraffic({ direction: 'error', url: rawUrl, errorCode: 'NETWORK_ERROR', latencyMs });
    throw new ProviderHttpError('NETWORK_ERROR', null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestWithBoundedRetry(
  rawUrl: string,
  options: SafeHttpOptions = {},
  onAttempt?: (err: NormalizedProviderError, attempt: number) => void
): Promise<SafeHttpResponse> {
  const circuitKey = getCircuitKey(rawUrl);
  const circuit = circuitCheck(circuitKey);
  if (circuit.status === 'OPEN') {
    throw new ProviderHttpError('CIRCUIT_OPEN', null);
  }

  let lastErr: NormalizedProviderError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: SafeHttpResponse;
    try {
      response = await safeProviderFetch(rawUrl, options);
    } catch (e) {
      if (e instanceof ProviderHttpError) {
        lastErr = e.code === 'TIMEOUT' ? timeoutError() : networkError();
        if (attempt < MAX_RETRIES) {
          const waitMs = backoffMs(attempt);
          logTraffic({ direction: 'retry', url: rawUrl, attempt, errorCode: lastErr.code, retryAfterMs: waitMs });
          onAttempt?.(lastErr, attempt);
          await sleep(waitMs);
          continue;
        }
        circuitRecord(circuitKey, false);
        throw e;
      }
      circuitRecord(circuitKey, false);
      throw e;
    }

    if (response.status === 429 || response.status >= 500) {
      lastErr = classifyHttpStatus(response.status, response.retryAfterSeconds);
      if (attempt < MAX_RETRIES) {
        const wait = response.status === 429 && response.retryAfterSeconds
          ? response.retryAfterSeconds * 1000
          : backoffMs(attempt);
        const waitMs = Math.min(wait, 300000);
        logTraffic({ direction: 'retry', url: rawUrl, attempt, errorCode: lastErr.code, retryAfterMs: waitMs });
        onAttempt?.(lastErr, attempt);
        await sleep(waitMs);
        continue;
      }
      circuitRecord(circuitKey, false);
      return response;
    }

    circuitRecord(circuitKey, true);
    return response;
  }

  throw new ProviderHttpError(lastErr?.code ?? 'NETWORK_ERROR', null);
}

export function getCircuitState(host: string): CircuitState | undefined {
  return circuitStates.get(host);
}
