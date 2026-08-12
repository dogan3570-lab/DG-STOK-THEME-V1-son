import { prisma } from '../db/prisma.ts';
import { decryptApiKey } from './crypto.ts';

export interface ProviderConfig {
  id: string;
  provider: string;
  displayName: string;
  baseUrl: string;
  model: string | null;
  priority: number;
  active: boolean;
  lastStatus: string;
  lastError: string | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsedAt: Date | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface ChatCompletionResponse {
  ok: boolean;
  provider: string;
  model: string;
  content: string | null;
  latencyMs: number;
  error?: string;
  errorCode?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface TestResult {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  errorCode?: string;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-pro',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4',
  },
};

const NVIDIA_MODEL_MAP: Record<string, string> = {
  'GLM-5.2': 'z-ai/glm-5.2',
  'Nemotron 70B': 'nvidia/llama-3.1-nemotron-70b-instruct',
  'Nemotron Ultra 253B': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'Nemotron 3 Ultra': 'nvidia/nemotron-3-ultra-550b-a55b',
};

export async function getActiveProvidersByPriority(): Promise<ProviderConfig[]> {
  const providers = await prisma.aIProviderConfig.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
  });
  return providers.map(serializeProvider);
}

export async function getProvider(provider: string): Promise<ProviderConfig | null> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
  return p ? serializeProvider(p) : null;
}

export async function getAllProviders(): Promise<ProviderConfig[]> {
  const providers = await prisma.aIProviderConfig.findMany({ orderBy: { priority: 'asc' } });
  return providers.map(serializeProvider);
}

function serializeProvider(p: any): ProviderConfig {
  return {
    id: p.id,
    provider: p.provider,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    model: p.model,
    priority: p.priority,
    active: p.active,
    lastStatus: p.lastStatus,
    lastError: p.lastError,
    totalRequests: p.totalRequests,
    successfulRequests: p.successfulRequests,
    failedRequests: p.failedRequests,
    lastUsedAt: p.lastUsedAt,
  };
}

async function getDecryptedApiKey(provider: string): Promise<string | null> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
  if (!p || !p.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) return null;
  return decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
}

async function incrementRequestCount(provider: string, success: boolean): Promise<void> {
  const now = new Date();
  await prisma.aIProviderConfig.update({
    where: { provider },
    data: {
      totalRequests: { increment: 1 },
      ...(success
        ? { successfulRequests: { increment: 1 }, lastStatus: 'connected', lastError: null, lastUsedAt: now }
        : { failedRequests: { increment: 1 }, lastStatus: 'error' }),
    },
  });
}

async function callNvidiaApi(
  apiKey: string,
  model: string,
  request: ChatCompletionRequest,
  timeoutMs: number = 30000
): Promise<{ content: string; usage?: any }> {
  const baseUrl = PROVIDER_DEFAULTS.nvidia.baseUrl;
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model,
    messages: request.messages,
    temperature: request.temperature ?? 0.1,
    max_tokens: request.max_tokens ?? 1024,
    ...(request.response_format ? { response_format: request.response_format } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      let errorCode = `HTTP_${res.status}`;
      if (res.status === 429) errorCode = 'RATE_LIMIT';
      else if (res.status === 401) errorCode = 'INVALID_KEY';
      else if (res.status === 403) errorCode = 'FORBIDDEN';
      else if (res.status === 404) errorCode = 'MODEL_NOT_FOUND';
      else if (res.status >= 500) errorCode = 'SERVER_ERROR';

      throw new Error(errorBody || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? null;
    return { content, usage: data.usage };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

export async function chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  const providers = await getActiveProvidersByPriority();

  if (providers.length === 0) {
    return {
      ok: false,
      provider: 'none',
      model: 'none',
      content: null,
      latencyMs: 0,
      error: 'Aktif AI sağlayıcı bulunamadı',
      errorCode: 'NO_PROVIDER',
    };
  }

  const errors: string[] = [];

  for (const provider of providers) {
    const apiKey = await getDecryptedApiKey(provider.provider);
    if (!apiKey) {
      errors.push(`${provider.displayName}: API key yapılandırılmamış`);
      continue;
    }

    const displayModel = provider.model || PROVIDER_DEFAULTS[provider.provider]?.model || 'default';
    const model = provider.provider === 'nvidia' && NVIDIA_MODEL_MAP[displayModel]
      ? NVIDIA_MODEL_MAP[displayModel]
      : displayModel;
    const startTime = Date.now();

    try {
      let result: { content: string; usage?: any };

      if (provider.provider === 'nvidia') {
        result = await callNvidiaApi(apiKey, model, request);
      } else {
        errors.push(`${provider.displayName}: Desteklenmeyen sağlayıcı`);
        continue;
      }

      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider.provider, true);

      return {
        ok: true,
        provider: provider.provider,
        model,
        content: result.content,
        latencyMs,
        usage: result.usage,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider.provider, false);

      let errorMsg = err.message || 'Unknown error';
      let errorCode = 'UNKNOWN';

      if (errorMsg === 'TIMEOUT') {
        errorCode = 'TIMEOUT';
        errorMsg = 'İstek zaman aşımına uğradı';
      } else if (errorMsg.includes('INVALID_KEY') || errorMsg.includes('401')) {
        errorCode = 'INVALID_KEY';
        errorMsg = 'Geçersiz API key';
        await prisma.aIProviderConfig.update({
          where: { provider: provider.provider },
          data: { lastStatus: 'error', lastError: 'Geçersiz API key' },
        });
      } else if (errorMsg.includes('RATE_LIMIT') || errorMsg.includes('429')) {
        errorCode = 'RATE_LIMIT';
        errorMsg = 'Rate limit aşıldı';
      } else if (errorMsg.includes('403')) {
        errorCode = 'FORBIDDEN';
        errorMsg = 'Erişim engellendi';
      } else if (errorMsg.includes('5')) {
        errorCode = 'SERVER_ERROR';
        errorMsg = 'Sunucu hatası';
      }

      await prisma.aIProviderConfig.update({
        where: { provider: provider.provider },
        data: { lastError: errorMsg },
      });

      errors.push(`${provider.displayName}: ${errorMsg}`);

      if (errorCode === 'INVALID_KEY') break;
      if (errorCode === 'TIMEOUT' || errorCode === 'RATE_LIMIT' || errorCode === 'SERVER_ERROR') continue;
      break;
    }
  }

  return {
    ok: false,
    provider: providers[0]?.provider || 'none',
    model: providers[0]?.model || 'none',
    content: null,
    latencyMs: 0,
    error: errors.join(' | ') || 'Tüm sağlayıcılar başarısız',
    errorCode: 'ALL_FAILED',
  };
}

// ==================== CATEGORY MATCHING ====================

export interface ProductForMatch {
  id: string;
  xmlKey: string;
  title: string | null;
  supplierCategory: string | null;
  xmlBrandName: string | null;
  description: string | null;
}

export interface CategoryCandidate {
  id: string;
  name: string;
  fullPath: string;
}

export interface CategoryMatchResult {
  productId: string;
  categoryId: string;
  confidence: number;
  reason: string;
}

export interface CategoryMatchResponse {
  ok: boolean;
  provider: string;
  model: string;
  matches: CategoryMatchResult[];
  latencyMs: number;
  error?: string;
  errorCode?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function buildCategoryMatchPrompt(
  products: ProductForMatch[],
  categories: CategoryCandidate[],
  marketplaceName: string | null
): ChatMessage[] {
  const categoryList = categories.map(c => `- ID: "${c.id}" | Name: "${c.name}" | Path: "${c.fullPath}"`).join('\n');

  const productList = products.map(p => {
    const parts: string[] = [];
    parts.push(`productId: "${p.id}"`);
    if (p.title) parts.push(`title: "${p.title.substring(0, 120)}"`);
    if (p.supplierCategory) parts.push(`supplierCategory: "${p.supplierCategory}"`);
    if (p.xmlBrandName) parts.push(`brand: "${p.xmlBrandName}"`);
    if (p.description) parts.push(`description: "${p.description.substring(0, 200)}"`);
    return `  { ${parts.join(', ')} }`;
  }).join(',\n');

  const marketplaceNote = marketplaceName
    ? `\nThe categories listed above are the system categories. Match products to the most appropriate system category.`
    : `\nMatch products to the most appropriate system category.`;

  const systemMessage = `You are a product category matcher for an e-commerce system. Your task is to match products to the correct system category.

RULES:
1. You MUST only choose from the provided category list. Never invent new categories.
2. Return ONLY valid JSON, no other text.
3. Each product must be matched to exactly one category.
4. Confidence must be between 0 and 1.
5. confidence >= 0.95 = automatic match, 0.85-0.949 = suggestion, < 0.85 = manual review.
6. If you are not confident, set confidence below 0.85.
7. Look at the product title, supplier category path, and brand to determine the best category.

Response format (strict JSON):
{
  "matches": [
    { "productId": "...", "categoryId": "...", "confidence": 0.95, "reason": "brief reason" }
  ]
}`;

  const userMessage = `Match these products to categories:

PRODUCTS:
[${productList}]

AVAILABLE CATEGORIES:
${categoryList}
${marketplaceNote}

Return ONLY the JSON response.`;

  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ];
}

function parseAndValidateMatches(
  content: string,
  validCategoryIds: Set<string>,
  productIds: Set<string>
): CategoryMatchResult[] {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  // Handle markdown code blocks
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try to find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI yanıtında JSON bulunamadı');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.matches || !Array.isArray(parsed.matches)) {
    throw new Error('AI yanıtında "matches" dizisi bulunamadı');
  }

  const results: CategoryMatchResult[] = [];
  for (const match of parsed.matches) {
    // Validate required fields
    if (!match.productId || !match.categoryId || typeof match.confidence !== 'number') continue;

    // Validate product exists
    if (!productIds.has(match.productId)) continue;

    // Validate category exists in system
    if (!validCategoryIds.has(match.categoryId)) continue;

    // Clamp confidence
    const confidence = Math.max(0, Math.min(1, match.confidence));

    results.push({
      productId: match.productId,
      categoryId: match.categoryId,
      confidence,
      reason: typeof match.reason === 'string' ? match.reason.substring(0, 200) : 'ai_match',
    });
  }

  return results;
}

export async function matchCategoriesWithAI(
  products: ProductForMatch[],
  categories: CategoryCandidate[],
  marketplaceName: string | null
): Promise<CategoryMatchResponse> {
  const providers = await getActiveProvidersByPriority();

  if (providers.length === 0) {
    return {
      ok: false,
      provider: 'none',
      model: 'none',
      matches: [],
      latencyMs: 0,
      error: 'Aktif AI sağlayıcı bulunamadı',
      errorCode: 'NO_PROVIDER',
    };
  }

  const validCategoryIds = new Set(categories.map(c => c.id));
  const productIds = new Set(products.map(p => p.id));
  const errors: string[] = [];

  for (const provider of providers) {
    const apiKey = await getDecryptedApiKey(provider.provider);
    if (!apiKey) {
      errors.push(`${provider.displayName}: API key yapılandırılmamış`);
      continue;
    }

    const displayModel = provider.model || PROVIDER_DEFAULTS[provider.provider]?.model || 'default';
    const model = provider.provider === 'nvidia' && NVIDIA_MODEL_MAP[displayModel]
      ? NVIDIA_MODEL_MAP[displayModel]
      : displayModel;
    const messages = buildCategoryMatchPrompt(products, categories, marketplaceName);
    const startTime = Date.now();

    try {
      let result: { content: string; usage?: any };

      if (provider.provider === 'nvidia') {
        result = await callNvidiaApi(apiKey, model, {
          messages,
          temperature: 0.05,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        });
      } else {
        errors.push(`${provider.displayName}: Desteklenmeyen sağlayıcı`);
        continue;
      }

      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider.provider, true);

      if (!result.content) {
        errors.push(`${provider.displayName}: Boş yanıt`);
        continue;
      }

      const matches = parseAndValidateMatches(result.content, validCategoryIds, productIds);

      return {
        ok: true,
        provider: provider.provider,
        model,
        matches,
        latencyMs,
        usage: result.usage,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider.provider, false);

      let errorMsg = err.message || 'Unknown error';
      let errorCode = 'UNKNOWN';

      if (errorMsg === 'TIMEOUT') { errorCode = 'TIMEOUT'; errorMsg = 'Zaman aşımı'; }
      else if (errorMsg.includes('401') || errorMsg.includes('INVALID_KEY')) { errorCode = 'INVALID_KEY'; errorMsg = 'Geçersiz API key'; }
      else if (errorMsg.includes('429') || errorMsg.includes('RATE_LIMIT')) { errorCode = 'RATE_LIMIT'; errorMsg = 'Rate limit'; }
      else if (errorMsg.includes('403')) { errorCode = 'FORBIDDEN'; errorMsg = 'Erişim engellendi'; }
      else if (errorMsg.includes('JSON')) { errorCode = 'PARSE_ERROR'; errorMsg = 'JSON ayrıştırma hatası'; }

      await prisma.aIProviderConfig.update({
        where: { provider: provider.provider },
        data: { lastError: errorMsg },
      });

      errors.push(`${provider.displayName}: ${errorMsg}`);

      if (errorCode === 'INVALID_KEY') break;
      if (errorCode === 'TIMEOUT' || errorCode === 'RATE_LIMIT' || errorCode === 'SERVER_ERROR') continue;
      break;
    }
  }

  return {
    ok: false,
    provider: providers[0]?.provider || 'none',
    model: providers[0]?.model || 'none',
    matches: [],
    latencyMs: 0,
    error: errors.join(' | ') || 'Tüm sağlayıcılar başarısız',
    errorCode: 'ALL_FAILED',
  };
}

export async function testProvider(provider: string): Promise<TestResult> {
  const config = await getProvider(provider);
  if (!config) {
    return { ok: false, provider, model: 'unknown', latencyMs: 0, error: 'Sağlayıcı bulunamadı', errorCode: 'NOT_FOUND' };
  }

  const apiKey = await getDecryptedApiKey(provider);
  if (!apiKey) {
    return { ok: false, provider, model: config.model || 'unknown', latencyMs: 0, error: 'API key yapılandırılmamış', errorCode: 'NO_KEY' };
  }

  const displayModel = config.model || PROVIDER_DEFAULTS[provider]?.model || 'default';
  const model = provider === 'nvidia' && NVIDIA_MODEL_MAP[displayModel]
    ? NVIDIA_MODEL_MAP[displayModel]
    : displayModel;
  const startTime = Date.now();

  try {
    if (provider === 'nvidia') {
      const result = await callNvidiaApi(apiKey, model, {
        messages: [{ role: 'user', content: 'Respond with exactly: NVIDIA_OK' }],
        max_tokens: 10,
      }, 120000);

      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider, true);

      return { ok: true, provider, model, latencyMs };
    }

    return { ok: false, provider, model, latencyMs: Date.now() - startTime, error: 'Desteklenmeyen sağlayıcı', errorCode: 'UNSUPPORTED' };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    await incrementRequestCount(provider, false);

    let errorMsg = err.message || 'Unknown error';
    let errorCode = 'UNKNOWN';

    if (errorMsg === 'TIMEOUT') { errorCode = 'TIMEOUT'; errorMsg = 'Zaman aşımı'; }
    else if (errorMsg.includes('401') || errorMsg.includes('INVALID_KEY')) { errorCode = 'INVALID_KEY'; errorMsg = 'Geçersiz API key'; }
    else if (errorMsg.includes('429') || errorMsg.includes('RATE_LIMIT')) { errorCode = 'RATE_LIMIT'; errorMsg = 'Rate limit'; }

    await prisma.aIProviderConfig.update({
      where: { provider },
      data: { lastStatus: 'error', lastError: errorMsg },
    });

    return { ok: false, provider, model, latencyMs, error: errorMsg, errorCode };
  }
}
