import { prisma } from '../db/prisma.ts';
import { decryptApiKey } from './crypto.ts';
import { completeWithFreeModel, classifyError } from './omniRouteManager.ts';
import { executeMasterRequest, type TaskType } from './omniRouteOrchestrator.ts';
import { NVIDIA_MODEL_MAP } from './masterExecutors.ts';

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
  catalogModels?: number;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
  },
  opencode: {
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'big-pickle',
  },
  omniroute: {
    baseUrl: process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128',
    model: '',
  },
};

export async function getActiveProvidersByPriority(): Promise<ProviderConfig[]> {
  const providers = await prisma.aIProviderConfig.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
  });
  const mapped = providers.map(serializeProvider);
  mapped.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aHealthy = a.lastStatus === 'error' ? 1 : 0;
    const bHealthy = b.lastStatus === 'error' ? 1 : 0;
    return aHealthy - bHealthy;
  });
  return mapped;
}

export async function isProviderActive(provider: string): Promise<boolean> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider } });
  if (!p) return false;
  return Boolean(p.active);
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
  try {
    return decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
  } catch {
    return null;
  }
}

async function incrementRequestCount(provider: string, success: boolean, errorMsg?: string): Promise<void> {
  const now = new Date();
  await prisma.aIProviderConfig.update({
    where: { provider },
    data: {
      totalRequests: { increment: 1 },
      ...(success
        ? { successfulRequests: { increment: 1 }, lastStatus: 'connected', lastError: null, lastUsedAt: now }
        : { failedRequests: { increment: 1 }, lastStatus: 'error', lastError: errorMsg ?? null }),
    },
  });
}

async function callNvidiaApi(
  apiKey: string,
  model: string,
  request: ChatCompletionRequest,
  timeoutMs: number = 120000
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

async function callDeepseekApi(
  apiKey: string,
  model: string,
  request: ChatCompletionRequest,
  timeoutMs: number = 120000
): Promise<{ content: string; usage?: any }> {
  const url = `${PROVIDER_DEFAULTS.deepseek.baseUrl}/chat/completions`;

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

async function callOpenRouterApi(
  apiKey: string,
  model: string,
  request: ChatCompletionRequest,
  timeoutMs: number = 120000
): Promise<{ content: string; usage?: any }> {
  const url = `${PROVIDER_DEFAULTS.openrouter.baseUrl}/chat/completions`;

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
        'HTTP-Referer': 'http://localhost:4000',
        'X-Title': 'DG STOK',
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
      throw new Error(`${errorCode} ${errorBody}`.slice(0, 500));
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

async function fetchOpenRouterModels(apiKey: string): Promise<any[]> {
  const url = `${PROVIDER_DEFAULTS.openrouter.baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let code = `HTTP_${res.status}`;
      if (res.status === 429) code = 'RATE_LIMIT';
      else if (res.status === 401) code = 'INVALID_KEY';
      else if (res.status === 403) code = 'FORBIDDEN';
      else if (res.status >= 500) code = 'SERVER_ERROR';
      throw new Error(`${code} ${body}`.slice(0, 500));
    }

    const data = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

async function callOpenCodeApi(
  apiKey: string,
  model: string,
  request: ChatCompletionRequest,
  timeoutMs: number = 120000
): Promise<{ content: string; usage?: any }> {
  const baseUrl = PROVIDER_DEFAULTS.opencode.baseUrl;
  const url = `${baseUrl}/chat/completions`;
  const normalizedModel = model.replace(/^opencode\//, '');

  const body = {
    model: normalizedModel,
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
      throw new Error(`${errorCode} ${errorBody}`.slice(0, 500));
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
export async function getOpenRouterFreeModels(): Promise<Array<{ id: string; name: string; context: number | null; pricing: any }>> {
  const apiKey = await getDecryptedApiKey('openrouter');
  if (!apiKey) throw new Error('API key yapılandırılmamış');

  const models = await fetchOpenRouterModels(apiKey);
  return models
    .filter((m: any) => {
      const p = m?.pricing;
      if (!p) return false;
      const prompt = parseFloat(String(p.prompt ?? ''));
      const completion = parseFloat(String(p.completion ?? ''));
      return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
    })
    .map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context_length ?? null,
      pricing: m.pricing ?? null,
    }));
}

export async function chatCompletion(request: ChatCompletionRequest, taskType: TaskType = 'GENERAL'): Promise<ChatCompletionResponse> {
  /**
   * V2 TEK KAPI (#1/#26/#62): Üretim AI trafiğinin TAMAMI Master Orchestrator'dan
   * geçer. Eski iki katmanlı yapı (orchestrator + manuel provider zinciri)
   * KALDIRILDI — modüller provider/model SEÇEMEZ, kendi fallback'ini ÇALIŞTIRAMAZ.
   * Provider/model yürütmesi masterExecutors adaptörlerindedir; testProvider
   * teşhis yolu ayrıdır ve üretim trafiğine karışmaz.
   */
  const result = await executeMasterRequest({
    taskType,
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    maxTokens: request.max_tokens ?? 500,
    temperature: request.temperature ?? 0.7,
    response_format: request.response_format,
    metadata: { module: 'gateway.chatCompletion' },
  });

  return {
    ok: result.ok,
    // Gerçek kaynağı raporla (omniroute/openrouter/nvidia/deepseek) — UI gerçeği
    provider: result.source || 'none',
    model: result.model || 'none',
    content: result.content,
    latencyMs: result.totalLatencyMs,
    error: result.error,
    errorCode: result.errorCode,
    usage: undefined,
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
  score?: number;
}

export interface CategoryMatchResult {
  productId: string;
  categoryId: string;
  confidence: number;
  reason: string;
  decision?: 'MATCH' | 'NO_SAFE_MATCH';
  reasonCode?: string;
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
  candidatesByProduct: Map<string, CategoryCandidate[]>,
  marketplaceName: string | null
): ChatMessage[] {

  const productList = products.map(p => {
    const cands = candidatesByProduct.get(p.id) || [];
    const candList = cands.map(c => `    - ID: "${c.id}" | Name: "${c.name}" | Path: "${c.fullPath}"`).join('\n');
    const parts: string[] = [];
    parts.push(`productId: "${p.id}"`);
    if (p.title) parts.push(`title: "${p.title.substring(0, 150)}"`);
    if (p.supplierCategory) parts.push(`supplierCategory: "${p.supplierCategory}"`);
    if (p.xmlBrandName) parts.push(`brand: "${p.xmlBrandName}"`);
    if (p.description) parts.push(`description: "${p.description.substring(0, 250)}"`);
    parts.push(`candidates:\n${candList || '    (no candidates)'}`);
    return `  {\n    ${parts.join(',\n    ')}\n  }`;
  }).join(',\n');

  const systemMessage = `You are a marketplace category judge for an e-commerce system.

TASK:
For each product, select the BEST MATCHING category from its candidates list.
If no candidate is a good match, return NO_SAFE_MATCH.

RULES:
1. Each product's candidates are independent — never mix between products.
2. Only choose from the provided candidates for each product.
3. Return ONLY valid JSON.
4. Focus on the product's CORE TYPE (what it IS), not brand/color/size.
5. Product vs accessory: "iPhone case" → Kılıflar, "iPhone" → Cihazlar.

SELECTION STRATEGY:
Step 1: Read the product title and identify what the product IS.
Step 2: Look through the candidates for a category that matches this product type.
Step 3: If you find a matching category → select it with appropriate confidence.
Step 4: Only if NO candidate matches the product type at all → NO_SAFE_MATCH.

IMPORTANT: "Best available match" is always better than NO_SAFE_MATCH.
If a candidate is in the same product family or closely related, SELECT IT.
NO_SAFE_MATCH is only for when ALL candidates are completely wrong.

CONFIDENCE RULES (STRICT — follow exactly):
- 0.95+: The candidate name is the EXACT product type or an obvious synonym (e.g., "Kulaklık" for earphone, "Vantilatör" for fan)
- 0.85-0.94: The candidate clearly matches the product type with minor naming difference
- 0.70-0.84: The candidate is the BEST AVAILABLE but product type name differs from category name
- Below 0.70: NO_SAFE_MATCH

When the product title contains a word that appears directly in a candidate category name, use 0.95+.
When the product is clearly the same type as the category but with a different name, use 0.85+.
Do NOT use confidence below 0.85 when the product type is unambiguous.

Return format:
{
  "results": [{
    "productId": "...",
    "decision": "MATCH" or "NO_SAFE_MATCH",
    "selectedCategoryId": "CATEGORY_ID" or null,
    "confidence": 0.92,
    "reasonCode": "DIRECT_PRODUCT_TYPE_MATCH" or "EXACT_SEMANTIC_MATCH" or "BEST_AVAILABLE_MATCH" or "NO_VALID_CANDIDATE"
  }]
}`;

  const marketplaceNote = marketplaceName
    ? `\nCategories are from the ${marketplaceName} marketplace.`
    : '';

  const userMessage = `Match these products to categories:

PRODUCTS:
[${productList}]
${marketplaceNote}

Return ONLY the JSON response.`;

  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ];
}

/**
 * JSON string literal içindeki ham kontrol karakterlerini (U+0000..U+001F) escape eder.
 * LLM bazen "reason" gibi alanlarda ham newline/tab üretebilir; strict JSON.parse bunu reddeder.
 * String dışındaki whitespace korunur.
 */
export function sanitizeJsonControlChars(s: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; }
      else if (ch === '\\') { out += ch; escaped = true; }
      else if (ch === '"') { out += ch; inString = false; }
      else if (ch.charCodeAt(0) < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      }
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseAndValidateMatches(
  content: string,
  validCategoryIds: Set<string>,
  productIds: Set<string>
): CategoryMatchResult[] {
  let jsonStr = content.trim();

  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const results: CategoryMatchResult[] = [];
  const seenProducts = new Set<string>();

  const pushValid = (m: { productId?: unknown; categoryId?: unknown; selectedCategoryId?: unknown; confidence?: unknown; reason?: unknown; decision?: unknown; reasonCode?: unknown }): boolean => {
    if (!m || typeof m.productId !== 'string') return false;
    if (!productIds.has(m.productId)) return false;
    if (seenProducts.has(m.productId)) return false;

    const decision = String(m.decision ?? 'MATCH');
    if (decision === 'NO_SAFE_MATCH') {
      seenProducts.add(m.productId);
      results.push({
        productId: m.productId,
        categoryId: '',
        confidence: 0,
        reason: typeof m.reasonCode === 'string' ? m.reasonCode : 'NO_SAFE_MATCH',
        decision: 'NO_SAFE_MATCH',
        reasonCode: typeof m.reasonCode === 'string' ? m.reasonCode : 'NO_VALID_CANDIDATE',
      });
      return true;
    }

    const catId = String(m.categoryId ?? m.selectedCategoryId ?? '');
    if (!catId || !validCategoryIds.has(catId)) return false;

    const conf = Number(m.confidence);
    if (!Number.isFinite(conf)) return false;

    seenProducts.add(m.productId);
    results.push({
      productId: m.productId,
      categoryId: catId,
      confidence: Math.max(0, Math.min(1, conf)),
      reason: typeof m.reason === 'string' ? m.reason.substring(0, 200) : (typeof m.reasonCode === 'string' ? m.reasonCode : 'ai_match'),
      decision: 'MATCH',
      reasonCode: typeof m.reasonCode === 'string' ? m.reasonCode : undefined,
    });
    return true;
  };

  // 1) KATI YOL: JSON.parse
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(sanitizeJsonControlChars(jsonMatch[0]));

      // YENİ FORMAT: { results: [...] }
      if (parsed && Array.isArray(parsed.results)) {
        for (const match of parsed.results) pushValid(match);
        if (results.length > 0) return results;
      }

      // ESKİ FORMAT: { matches: [...] }
      if (parsed && Array.isArray(parsed.matches)) {
        for (const match of parsed.matches) pushValid(match);
        if (results.length > 0) return results;
      }
    } catch {
      /* LLM bozuk JSON üretti → regex recovery'ye düş */
    }
  }

  // 2) TOLERANSLI YOL: regex ile productId+categoryId/selectedCategoryId+confidence çıkar
  const fieldRegex = /"productId"\s*:\s*"([^"]+)"\s*,\s*(?:"categoryId"|"selectedCategoryId")\s*:\s*"([^"]+)"\s*,\s*"confidence"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(jsonStr)) !== null) {
    pushValid({ productId: m[1], categoryId: m[2], confidence: Number(m[3]), reason: 'ai_match' });
  }

  // 3) NO_SAFE_MATCH regex: productId + decision=NO_SAFE_MATCH
  const noMatchRegex = /"productId"\s*:\s*"([^"]+)"\s*,\s*"decision"\s*:\s*"NO_SAFE_MATCH"/g;
  while ((m = noMatchRegex.exec(jsonStr)) !== null) {
    pushValid({ productId: m[1], decision: 'NO_SAFE_MATCH', reasonCode: 'NO_VALID_CANDIDATE' });
  }

  return results;
}

export async function matchCategoriesWithAI(
  products: ProductForMatch[],
  candidatesByProduct: Map<string, CategoryCandidate[]> | CategoryCandidate[],
  marketplaceName: string | null
): Promise<CategoryMatchResponse> {
  // Geriye uyumluluk: flat array ise → tüm ürünler için aynı aday listesini kullan
  const candidatesMap: Map<string, CategoryCandidate[]> = candidatesByProduct instanceof Map
    ? candidatesByProduct
    : new Map(products.map(p => [p.id, candidatesByProduct]));

  // Tüm adayları topla (validasyon için)
  const allCandidateIds = new Set<string>();
  for (const cands of candidatesMap.values()) {
    for (const c of cands) allCandidateIds.add(c.id);
  }
  const validCategoryIds = allCandidateIds;
  const productIds = new Set(products.map(p => p.id));

  /**
   * DeepSeek aktif kontrolü: DeepSeek aktifse CATEGORY_MATCHING'in ilk adayı olur.
   * DeepSeek pasifse hiç çağrı yapılmaz; sadece aktif free providerlar kullanılır.
   */
  const deepSeekActive = await isProviderActive('deepseek') && (await getDecryptedApiKey('deepseek')) !== null;

  /**
   * V2 TEK KAPI (#26): Routing kararı Master Orchestrator'da. Eski manuel
   * provider zinciri KALDIRILDI. JSON uyumsuzluğunda master'a "bu modeli dışla"
   * bilgisiyle TEK merkezi retry yapılır — modül kendi fallback'ini çalıştırmaz.
   */
  const messages = buildCategoryMatchPrompt(products, candidatesMap, marketplaceName);

  const runMaster = (excludeModelKeys?: string[]) => executeMasterRequest({
    taskType: 'CATEGORY_MATCHING',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    maxTokens: 4096,
    temperature: 0.05,
    response_format: { type: 'json_object' },
    metadata: { module: 'category-match', ...(excludeModelKeys && excludeModelKeys.length > 0 ? { excludeModelKeys } : {}) },
  });

  const toScoped = (r: Awaited<ReturnType<typeof executeMasterRequest>>) => {
    if (!r.ok || !r.content) return { r, scopedMatches: [] as CategoryMatchResult[], noJson: false };
    const matches = parseAndValidateMatches(r.content, validCategoryIds, productIds);
    // FIX(RT326): ürün-bazlı aday kısıtı korunur (iş mantığı DOKUNULMADI).
    const scopedMatches = matches.filter((m) => {
      if (m.decision === 'NO_SAFE_MATCH') return true;
      const own = candidatesMap.get(m.productId);
      return !!own && own.some((c) => c.id === m.categoryId);
    });
    return { r, scopedMatches, noJson: scopedMatches.length === 0 };
  };

  // DeepSeek aktifse önce DeepSeek'i dene; başarısız olursa normal routing ile devam
  if (deepSeekActive) {
    const result = toScoped(await runMaster(['deepseek:deepseek-chat']));
    // DeepSeek başarılıysa (source deepseek) → sonuç döndür
    if (result.r.ok && result.r.source === 'deepseek') {
      return {
        ok: true,
        provider: 'deepseek',
        model: result.r.model,
        matches: result.scopedMatches,
        latencyMs: result.r.totalLatencyMs,
      };
    }
  }

  // DeepSeek pasifse veya DeepSeek başarısızsa → Normal routing ile fallback'lar
  let result = toScoped(await runMaster());

  // Model 200 dönüp işe yarar JSON üretmediyse (#40/#44): aynı modeli dışlayıp
  // master'dan bir sonraki en iyi eligible modeli iste.
  if (result.noJson && result.r.source) {
    const badKey = `${result.r.source}:${result.r.model}`;
    console.log(`[ai-gateway] category-match BAD_OUTPUT model=${badKey} → master retry (excluded)`);
    result = toScoped(await runMaster([badKey]));
  }

  if (result.r.ok && result.scopedMatches.length > 0) {
    if (process.env.DRY_RUN_DEBUG === '1') {
      console.log(`  [AI RAW] model=${result.r.model} products=${products.length} matches=${result.scopedMatches.length}`);
    }
    return {
      ok: true,
      provider: result.r.source || 'none',
      model: result.r.model,
      matches: result.scopedMatches,
      latencyMs: result.r.totalLatencyMs,
    };
  }

  return {
    ok: false,
    provider: 'none',
    model: 'none',
    matches: [],
    latencyMs: result.r.totalLatencyMs,
    error: result.r.error || 'AI eşleştirme şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
    errorCode: 'NO_AI_PROVIDER_AVAILABLE',
  };
}

export async function testProvider(provider: string, modelOverride?: string): Promise<TestResult> {
  const config = await getProvider(provider);
  if (!config) {
    return { ok: false, provider, model: 'unknown', latencyMs: 0, error: 'Sağlayıcı bulunamadı', errorCode: 'NOT_FOUND' };
  }

  // ACTIVE CHECK: Pasif providerlar test edilemez
  const isActive = await isProviderActive(provider);
  if (!isActive) {
    return { ok: false, provider, model: config.model || 'unknown', latencyMs: 0, error: 'Sağlayıcı pasif', errorCode: 'PROVIDER_INACTIVE' };
  }

  const apiKey = await getDecryptedApiKey(provider);
  if (!apiKey) {
    return { ok: false, provider, model: config.model || 'unknown', latencyMs: 0, error: 'API key yapılandırılmamış', errorCode: 'NO_KEY' };
  }

  const configuredModel = modelOverride || config.model;
  const displayModel = configuredModel || PROVIDER_DEFAULTS[provider]?.model || 'default';
  const model = provider === 'nvidia' && NVIDIA_MODEL_MAP[displayModel]
    ? NVIDIA_MODEL_MAP[displayModel]
    : displayModel;
  const startTime = Date.now();

  try {
    if (provider === 'nvidia') {
      const result = await callNvidiaApi(apiKey, model, {
        messages: [{ role: 'user', content: 'Respond with exactly: NVIDIA_OK' }],
        max_tokens: 20,
      }, 120000);

      const latencyMs = Date.now() - startTime;
      // FIX(RT-ACC): NVIDIA testi de protokol yanıtını doğrular (kör başarı değil).
      const ok = !!result.content && String(result.content).toUpperCase().includes('NVIDIA_OK');
      await incrementRequestCount(provider, ok, ok ? undefined : `Model testi NVIDIA_OK döndürmedi: ${String(result.content ?? '').slice(0, 80)}`);

      return {
        ok,
        provider,
        model,
        latencyMs,
        error: ok ? undefined : `Model testi NVIDIA_OK döndürmedi: ${String(result.content ?? '').slice(0, 80)}`,
        errorCode: ok ? undefined : 'MODEL_TEST_FAILED',
      };
    }

    if (provider === 'deepseek') {
      const result = await callDeepseekApi(apiKey, model, {
        messages: [{ role: 'user', content: 'Return exactly: DEEPSEEK_OK' }],
        max_tokens: 20,
      }, 120000);

      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider, true);

      const ok = !!result.content && String(result.content).toUpperCase().includes('DEEPSEEK_OK');
      return {
        ok,
        provider,
        model,
        latencyMs,
        error: ok ? undefined : `Model testi DEEPSEEK_OK döndürmedi: ${String(result.content ?? '').slice(0, 80)}`,
        errorCode: ok ? undefined : 'MODEL_TEST_FAILED',
      };
    }

    if (provider === 'opencode') {
      const result = await callOpenCodeApi(apiKey, model, {
        messages: [{ role: 'user', content: 'Return exactly: OPENCODE_OK' }],
        max_tokens: 200,
      }, 120000);

      const latencyMs = Date.now() - startTime;
      await incrementRequestCount(provider, true);

      const ok = !!result.content && String(result.content).toUpperCase().includes('OPENCODE_OK');
      return {
        ok,
        provider,
        model,
        latencyMs,
        error: ok ? undefined : `Model testi OPENCODE_OK döndürmedi: ${String(result.content ?? '').slice(0, 80)}`,
        errorCode: ok ? undefined : 'MODEL_TEST_FAILED',
      };
    }
    if (provider === 'openrouter') {
      const modelTest = await completeWithFreeModel({
        messages: [{ role: 'user', content: 'Return exactly: OPENROUTER_TEST_OK' }],
        max_tokens: 20,
      });

      const latencyMs = Date.now() - startTime;

      let catalogModels = 0;
      try {
        const { getRegistry: getOrRegistry } = await import('./openRouterManager.ts');
        catalogModels = (await getOrRegistry()).models.length;
      } catch { /* katalog okunamadıysa 0 kalır */ }

      const ok = modelTest.ok && !!modelTest.content && String(modelTest.content).toUpperCase().includes('OPENROUTER_TEST_OK');
      // FIX(RT-ACC): Başarısız test artık provider'ı 'connected' işaretlemiyor.
      // Eski kod sonucu beklemeden incrementRequestCount(provider, true) çağırıyordu
      // → UI "Bağlı" gösterirken gerçekte test başarısızdı.
      await incrementRequestCount(provider, ok, ok ? undefined : (modelTest.error || 'Model testi başarısız'));

      return {
        ok,
        provider,
        model: modelTest.ok ? modelTest.model : '(model yok)',
        latencyMs,
        catalogModels,
        error: ok ? undefined : `Model testi başarısız: ${modelTest.error || 'OPENROUTER_TEST_OK döndürülmedi'}`,
        errorCode: ok ? undefined : modelTest.errorCode || 'MODEL_TEST_FAILED',
      };
    }

    if (provider === 'omniroute') {
      const { testModel, getRegistry } = await import('./omniRouteManager.ts');
      // FIX(RC4): config.model boşken PROVIDER_DEFAULTS zinciri 'default'
      // üretiyordu ve OmniRoute'a gönderiliyordu → garanti hata.
      // Sadece kullanıcı açıkça model override verdiyse gönder; yoksa
      // testModel en iyi free modeli kendi seçer.
      const omniTest = await testModel(modelOverride || undefined);

      const latencyMs = Date.now() - startTime;

      let catalogModels = 0;
      try {
        catalogModels = (await getRegistry()).models.length;
      } catch { /* katalog okunamadıysa 0 kalır */ }

      // FIX(RT-ACC): Başarısız test artık provider'ı 'connected' işaretlemiyor.
      await incrementRequestCount(provider, omniTest.ok, omniTest.ok ? undefined : (omniTest.error || 'OmniRoute model testi başarısız'));

      return {
        ok: omniTest.ok,
        provider,
        model: omniTest.model,
        latencyMs,
        catalogModels,
        error: omniTest.error,
        errorCode: omniTest.errorCode,
      };
    }

    return { ok: false, provider, model, latencyMs: Date.now() - startTime, error: 'Desteklenmeyen sağlayıcı', errorCode: 'UNSUPPORTED' };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const classified = classifyError(err);
    await incrementRequestCount(provider, false, classified.errorMsg);

    return { ok: false, provider, model, latencyMs, error: classified.errorMsg, errorCode: classified.errorCode };
  }
}

// ==================== V3: AI CATEGORY VERIFICATION ====================

export interface CategoryVerification {
  productId: string;
  fit: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECT';
  reason: string;
  confidence: number;
  contradictsExcluded: boolean;
}

export interface SemanticIdentity {
  coreObject: string;
  productType: string;
  primaryFunction: string;
  useCase: string;
  material: string | null;
  excludedInterpretations: string[];
  domain: string;
}

export interface StageCandidate {
  id: string;
  name: string;
  fullPath: string;
  matchStage: string;
  matchScore: number;
  semanticFit: string;
  // FIX(build): categoryCore V3 fast-path adayın gerçek marketplace externalId'sini taşır.
  externalId?: number | null;
}

const VERIFICATION_SYSTEM_PROMPT = `You are a STRICT e-commerce category verifier. Your job is to determine if a product belongs in a specific category.

PRODUCT IDENTITY:
- Core Object: what the product physically IS (e.g., "kulaklık", "kül tablası", "çadır")
- Product Type: the category of product
- Primary Function: what it does
- Use Case: how it's used
- Material: what it's made of
- Excluded Interpretations: product types this is NOT

FIT DEFINITIONS (STRICT):
- STRONG: The product IS this category type. A specific leaf (e.g., "Kulak İçi Kulaklık") is STRONG for a product that IS a kulaklık.
  Example: Product is "kulaklık" → Category "Kulak İçi Kulaklık" = STRONG (it IS a kulaklık)
  Example: Product is "kül tablası" → Category "Kül Tablaları" = STRONG
  Example: Product is "kamp çadırı" → Category "Kamp Çadırları" = STRONG
  Example: Product is "kasap bıçağı" → Category "Bıçak Setleri" = STRONG (it IS a bıçak)
  Example: Product is "kedi oyuncağı" → Category "Kedi Oyunları" = STRONG
  Example: Product is "saklama kabı" → Category "Saklama Kapları" = STRONG
  Example: Product is "led ışık" → Category "LED Aydınlatma" = STRONG
  Example: Product is "uzaktan kumanda" → Category "Uzaktan Kumanda" = STRONG
- MEDIUM: The product is related but this is not its primary category.
  Example: Product is "aromaterapi difüzörü" → Category "Difüzör" = MEDIUM
- WEAK: The product shares keywords but is a different product type entirely.
  Example: Product is "aromaterapi difüzörü" → Category "Gaz Lambası" = WEAK
- REJECT: Completely different product. Do NOT select as best fit.
  Example: Product is "aromaterapi difüzörü" → Category "Kulaklık" = REJECT

CRITICAL RULE: If the product IS a specific type of item (e.g., "kulaklık"), then ANY category that contains that item type (e.g., "Kulak İçi Kulaklık", "Kulak Üstü Kulaklık") is a STRONG fit.

RULES:
1. The product IS the core object. Categories containing the core object type = STRONG.
2. If product is "X" and category is "X something" or "Something X" → STRONG.
3. If product is "X" and category is in the same product family → MEDIUM.
4. If product is "X" and category is a different product type → WEAK or REJECT.
5. You MUST return fit=STRONG for at least one candidate if a true match exists.
6. Keyword overlap alone is NOT sufficient — the product must truly BE the category type.
7. CRITICAL: Excluded interpretations refer to the PRODUCT IDENTITY, not to taxonomy path text.
   If the product IS "kasap bıçağı" and the candidate is "Bıçak ve Bıçak Seti",
   the fact that the path contains "Bıçak Setleri" does NOT make it WEAK.
   A kasap bıçağı IS a bıçak → "Bıçak ve Bıçak Seti" = STRONG.
   Only reject if the product is genuinely a different product type than what the leaf represents.

RETURN: JSON with a "results" array containing objects with:
- productId: the product ID
- fit: STRONG/MEDIUM/WEAK/REJECT
- reason: brief explanation (must mention the core object)
- confidence: 0.0-1.0
- contradictsExcluded: true if the candidate matches an excluded interpretation

Return ONLY valid JSON, no markdown.`;

/**
 * V3 AI verification: strict semantic check of candidate categories.
 * Unlike the old system, this does NOT accept "best available" — only true matches.
 */
export async function verifyCategoryMatch(
  identity: SemanticIdentity,
  candidates: StageCandidate[],
  previousErrors?: string,
): Promise<CategoryVerification[]> {
  if (candidates.length === 0) return [];

  const userMessage = `Verify these candidate categories for the product:

PRODUCT:
- Core Object: ${identity.coreObject}
- Product Type: ${identity.productType}
- Primary Function: ${identity.primaryFunction}
- Use Case: ${identity.useCase}
- Material: ${identity.material ?? 'N/A'}
- Domain: ${identity.domain}
- Excluded Interpretations: ${identity.excludedInterpretations.join(', ')}
${previousErrors ? `\nPrevious errors: ${previousErrors}` : ''}

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. [${c.matchStage}] ${c.name} (score=${c.matchScore}) — Path: ${c.fullPath}`).join('\n')}

For each candidate, determine if the product REALLY belongs there. Return ONLY the JSON.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: VERIFICATION_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  // FIX(V2 #3): DIRECT BYPASS kaldırıldı — transport artık Master Orchestrator'dan.
  const result = await executeMasterRequest({
    taskType: 'CATEGORY_MATCHING',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: 0.1,
    maxTokens: 2000,
    response_format: { type: 'json_object' },
    metadata: { module: 'category-core.verify' },
  });

  if (!result.ok || !result.content) {
    return candidates.map((c) => ({
      productId: '',
      fit: 'WEAK' as const,
      reason: 'AI verification unavailable',
      confidence: 0.5,
      contradictsExcluded: false,
    }));
  }

  try {
    // Master structured-output doğrulaması geçerli JSON'u validatedJson olarak verir
    const parsed = result.validatedJson ?? JSON.parse(result.content);
    const results = Array.isArray(parsed.results) ? parsed.results : [];

    return results.map((r: any) => ({
      productId: String(r.productId || ''),
      fit: ['STRONG', 'MEDIUM', 'WEAK', 'REJECT'].includes(r.fit) ? r.fit : 'WEAK',
      reason: String(r.reason || ''),
      confidence: clamp(parseFloat(r.confidence) || 0.5, 0, 1),
      contradictsExcluded: Boolean(r.contradictsExcluded),
    }));
  } catch {
    return candidates.map((c) => ({
      productId: '',
      fit: 'WEAK' as const,
      reason: 'AI verification parse error',
      confidence: 0.5,
      contradictsExcluded: false,
    }));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

