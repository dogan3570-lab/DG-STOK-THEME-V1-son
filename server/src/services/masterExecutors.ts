/**
 * MASTER EXECUTORS — kaynak bazlı model çalıştırıcıları.
 * Master Orchestrator buradaki adaptörler üzerinden TÜM provider'lara çıkar;
 * hiçbir modül bu dosyayı atlayamaz (tek kapı ilkesi).
 * Secret ASLA loglanmaz/taşınmaz (#58).
 */
import { prisma } from '../db/prisma.ts';
import { decryptApiKey } from './crypto.ts';
import { classifyError } from './omniRouteManager.ts';

export type ExecutorSource = 'omniroute' | 'openrouter' | 'nvidia' | 'deepseek';

const OMNIROUTE_BASE = process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128';
const OR_API_BASE = 'https://openrouter.ai/api/v1';
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

/** NVIDIA display ad → gerçek API model id (aiGateway'den taşındı; tek kaynak). */
export const NVIDIA_MODEL_MAP: Record<string, string> = {
  'GLM-5.2': 'z-ai/glm-5.2',
  'Nemotron 70B': 'nvidia/llama-3.1-nemotron-70b-instruct',
  'Nemotron Ultra 253B': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'Nemotron 3 Ultra': 'nvidia/nemotron-3-ultra-550b-a55b',
};

export interface ExecutionRequest {
  messages: { role: string; content: string }[];
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  responseFormat?: { type: string };
}

export interface ExecutionResult {
  ok: boolean;
  content: string | null;
  error?: string;
  errorCode?: string;
  latencyMs: number;
  headers: Record<string, string>;
}

function captureHeaders(res: Response): Record<string, string> {
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return h;
}

async function postChatCompletion(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<ExecutionResult> {
  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startTime;
    const respHeaders = captureHeaders(res);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      const classified = classifyError(new Error(`HTTP_${res.status} ${errorBody.slice(0, 400)}`));
      return { ok: false, content: null, error: classified.errorMsg, errorCode: classified.errorCode, latencyMs, headers: respHeaders };
    }

    const data: any = await res.json();
    const { extractResponseText } = await import('./errorTaxonomy.ts');
    const text = extractResponseText(data);
    if (!text) {
      // FIX(V2 #39): reasoning-only yanıtlar çıkarılır; gerçekten usable çıktı yoksa
      // sahte başarı ÜRETİLMEZ.
      return { ok: false, content: null, error: 'Boş yanıt (content/reasoning yok)', errorCode: 'EMPTY_RESPONSE', latencyMs, headers: respHeaders };
    }
    return { ok: true, content: text, latencyMs, headers: respHeaders };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { ok: false, content: null, error: 'İstek zaman aşımı', errorCode: 'TIMEOUT', latencyMs, headers: {} };
    }
    const classified = classifyError(err);
    // Bağlantı seviyesi hatalar source-breaker için CONNECTION_ERROR olarak işaretlenir
    const isConn = /fetch failed|econnrefused|enotfound|econnreset|socket/i.test(String(err?.message || err?.cause?.code || ''));
    return { ok: false, content: null, error: classified.errorMsg || (err?.message ?? 'Connection failed'), errorCode: isConn ? 'CONNECTION_ERROR' : classified.errorCode, latencyMs, headers: {} };
  }
}

// ==================== SOURCE ADAPTERS ====================

async function getProviderApiKey(provider: string): Promise<string | null> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
  if (!p || !p.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) return null;
  try { return decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag); } catch { return null; }
}

export async function executeOmnirouteModel(modelId: string, req: ExecutionRequest): Promise<ExecutionResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.OMNIROUTE_API_KEY || '';
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return postChatCompletion(
    `${OMNIROUTE_BASE}/v1/chat/completions`,
    headers,
    { model: modelId, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature, stream: false, ...(req.responseFormat ? { response_format: req.responseFormat } : {}) },
    req.timeoutMs
  );
}

export async function executeOpenRouterModel(modelId: string, req: ExecutionRequest): Promise<ExecutionResult> {
  const apiKey = await getProviderApiKey('openrouter');
  if (!apiKey) {
    return { ok: false, content: null, error: 'OpenRouter API key yapılandırılmamış', errorCode: 'NO_KEY', latencyMs: 0, headers: {} };
  }
  return postChatCompletion(
    `${OR_API_BASE}/chat/completions`,
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:4000',
      'X-Title': 'DG STOK',
    },
    { model: modelId, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature, stream: false, ...(req.responseFormat ? { response_format: req.responseFormat } : {}) },
    req.timeoutMs
  );
}

export async function executePaidModel(source: 'nvidia' | 'deepseek', displayModel: string, req: ExecutionRequest): Promise<ExecutionResult> {
  const apiKey = await getProviderApiKey(source);
  if (!apiKey) {
    return { ok: false, content: null, error: `${source} API key yapılandırılmamış`, errorCode: 'NO_KEY', latencyMs: 0, headers: {} };
  }
  const baseUrl = source === 'nvidia' ? NVIDIA_BASE : DEEPSEEK_BASE;
  let modelId = displayModel;
  if (source === 'nvidia') {
    modelId = NVIDIA_MODEL_MAP[displayModel] || displayModel;
  }
  if (!modelId || modelId === 'default') {
    return { ok: false, content: null, error: `${source} için model yapılandırılmamış`, errorCode: 'NO_MODEL_CONFIGURED', latencyMs: 0, headers: {} };
  }
  return postChatCompletion(
    `${baseUrl}/chat/completions`,
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    { model: modelId, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature, stream: false, ...(req.responseFormat ? { response_format: req.responseFormat } : {}) },
    req.timeoutMs
  );
}

// ==================== STRUCTURED OUTPUT VALIDATION (#40/#44) ====================

/**
 * JSON beklentisini doğrular. Geçersizse null döner → INVALID_OUTPUT sayılır,
 * sıradaki modele geçilir (200 dönmek SAHTE başarı değildir).
 */
export function validateStructuredOutput(content: string): { valid: boolean; parsed?: any } {
  let s = String(content || '').trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return { valid: false };
  try {
    return { valid: true, parsed: JSON.parse(m[0]) };
  } catch {
    return { valid: false };
  }
}
