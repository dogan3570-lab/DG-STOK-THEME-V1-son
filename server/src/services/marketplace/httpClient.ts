import { assertSafeApiUrl } from './ssrfGuard.ts';
import type { NormalizedProviderError } from './types.ts';
import { classifyHttpStatus, networkError, timeoutError } from './errors.ts';

/**
 * SSRF-korumalı, timeout'lu, bounded-retry'li marketplace HTTP istemcisi.
 * Raw provider body kullanıcıya/loglara DÖNMEZ; yalnızca parse için
 * truncate edilmiş bir kopya adapter'a iletilir ve asla loglanmaz.
 */

export const MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30000;

export class ProviderHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null
  ) {
    super(code);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(guard.url.toString(), {
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body,
      signal: controller.signal,
      redirect: 'error',
    });

    const text = await res.text().catch(() => '');
    return {
      status: res.status,
      body: text.slice(0, 2000),
      retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderHttpError('TIMEOUT', null);
    }
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
  let lastErr: NormalizedProviderError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: SafeHttpResponse;
    try {
      response = await safeProviderFetch(rawUrl, options);
    } catch (e) {
      if (e instanceof ProviderHttpError) {
        lastErr = e.code === 'TIMEOUT' ? timeoutError() : networkError();
        if (attempt < MAX_RETRIES) {
          onAttempt?.(lastErr, attempt);
          await sleep(backoffMs(attempt));
          continue;
        }
        throw e;
      }
      throw e;
    }

    if (response.status === 429 || response.status >= 500) {
      lastErr = classifyHttpStatus(response.status, response.retryAfterSeconds);
      if (attempt < MAX_RETRIES) {
        onAttempt?.(lastErr, attempt);
        const wait = response.status === 429 && response.retryAfterSeconds
          ? response.retryAfterSeconds * 1000
          : backoffMs(attempt);
        await sleep(Math.min(wait, 300000));
        continue;
      }
      return response;
    }

    return response;
  }

  throw new ProviderHttpError(lastErr?.code ?? 'NETWORK_ERROR', null);
}
