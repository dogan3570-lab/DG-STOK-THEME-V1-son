import { prisma } from '../db/prisma.ts';
import { decryptApiKey } from './crypto.ts';
import { extractResponseText } from './errorTaxonomy.ts';

// ==================== TYPES ====================

export interface OpenRouterModelEntry {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt: string; completion: string } | null;
  reasoningMandatory: boolean;
  supportsImages: boolean;
  free: true;
  createdAt: number | null;
  lastCheckedAt: string | null;
  health: 'healthy' | 'degraded' | 'unknown' | 'quarantined';
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorCode: string | null;
  cooldownUntil: string | null;
  quarantineReason: string | null;
  quarantinedAt: string | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsedAt: string | null;
  lastLatencyMs: number | null;
}

export interface OpenRouterRegistry {
  version: 1;
  updatedAt: string;
  discoveredAt: string;
  lastDiscoveryError: string | null;
  keyUsage: {
    usageMonthly: number | null;
    limit: number | null;
    limitRemaining: number | null;
    isFreeTier: boolean | null;
    lastCheckedAt: string | null;
  } | null;
  models: OpenRouterModelEntry[];
}

export interface OpenRouterCompletionResult {
  ok: boolean;
  content: string | null;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  error?: string;
  errorCode?: string;
}

export interface OpenRouterStatus {
  aiStatus: 'active' | 'switching' | 'unavailable' | 'no_key';
  currentModel: string | null;
  currentModelName: string | null;
  nextModel: string | null;
  nextModelName: string | null;
  freeModelsTotal: number;
  healthyCount: number;
  degradedCount: number;
  cooldownCount: number;
  quarantineCount: number;
  removedCount: number;
  rotationLimitCount: number;
  freeModelRequestThreshold: number;
  quotaAvailable: boolean;
  lastCheck: string | null;
  keyConfigured: boolean;
  quotaPercent: number | null;
  lastDiscoveryError: string | null;
}

// ==================== REGISTRY I/O ====================

async function getSetting(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: REGISTRY_KEY } });
  return row?.value ?? null;
}

async function setSetting(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: REGISTRY_KEY },
    create: { key: REGISTRY_KEY, value },
    update: { value },
  });
}

function emptyRegistry(): OpenRouterRegistry {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    lastDiscoveryError: null,
    keyUsage: null,
    models: [],
  };
}

export async function getRegistry(): Promise<OpenRouterRegistry> {
  const raw = await getSetting();
  if (!raw) return emptyRegistry();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.models)) {
      const reg = parsed as OpenRouterRegistry;
      normalizeQuarantines(reg);
      return reg;
    }
    return emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(reg: OpenRouterRegistry): Promise<void> {
  reg.updatedAt = new Date().toISOString();
  await setSetting(JSON.stringify(reg));
}

// ==================== API KEY ====================

async function getApiKey(): Promise<string | null> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (!p || !p.apiKeyEncrypted || !p.apiKeyIv || !p.apiKeyTag) return null;
  try {
    return decryptApiKey(p.apiKeyEncrypted, p.apiKeyIv, p.apiKeyTag);
  } catch {
    return null;
  }
}

export interface ClassifiedError {
  type: 'transient' | 'permanent' | 'auth' | 'unknown';
  errorCode: string;
  errorMsg: string;
}

// ==================== CONSTANTS ====================

const REGISTRY_KEY = 'openrouter_registry';
const OR_API_BASE = 'https://openrouter.ai/api/v1';
const MAX_ATTEMPTS_PER_REQUEST = 5;
const COOLDOWN_BASE_MS = 5 * 60 * 1000;
const COOLDOWN_MAX_MS = 4 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const REFRESH_RETRY_BACKOFF_MS = 5 * 60 * 1000;
const FREE_MODEL_REQUEST_THRESHOLD = Number(process.env.OPENROUTER_FREE_MODEL_REQUEST_THRESHOLD ?? '90');
const DISCOVERY_COOLDOWN_MS = 2 * 60 * 1000;
/** FIX(RT-ACC): Kalıcı sınıf karantina inceleme süresi (removed_by_* hariç). */
const QUARANTINE_REVIEW_MS = 30 * 60 * 1000;
let discoveryLock = false;
let lastDiscoveryTimestamp = 0;

// ==================== MUTEX (FIX RT-ACC: lost-update race) ====================
let registryLock: Promise<unknown> = Promise.resolve();
function withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = registryLock.then(fn, fn);
  registryLock = run.catch(() => {});
  return run;
}

// ==================== QUARANTINE NORMALIZATION ====================

/**
 * FIX(RT-ACC): Karantina süre tutarlılığı (omniRouteManager ile aynı politika).
 * - removed_by_openrouter: kalıcı (katalog geri gelince discover merge temizler —
 *   mevcut merge zaten listede kalmalarını sağlar; dönüşte resurrect için merge'e bakın).
 * - Diğer kalıcı sınıflar: quarantinedAt + QUARANTINE_REVIEW_MS sonunda taze şans.
 */
function normalizeQuarantines(reg: OpenRouterRegistry): void {
  const now = Date.now();
  for (const m of reg.models) {
    if (!m.quarantineReason || m.quarantineReason === 'removed_by_openrouter') continue;
    if (!m.quarantinedAt) {
      m.quarantinedAt = new Date(now).toISOString();
      continue;
    }
    if (new Date(m.quarantinedAt).getTime() + QUARANTINE_REVIEW_MS <= now) {
      m.quarantineReason = null;
      m.quarantinedAt = null;
      m.health = 'unknown';
      m.consecutiveFailures = 0;
      m.cooldownUntil = null;
      m.lastError = null;
      m.lastErrorCode = null;
    }
  }
}
// ==================== DISCOVERY ====================

async function fetchCatalog(apiKey: string): Promise<any[]> {
  const res = await fetch(`${OR_API_BASE}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP_${res.status} ${body}`.slice(0, 500));
  }
  const data: any = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function fetchKeyUsage(apiKey: string): Promise<OpenRouterRegistry['keyUsage']> {
  try {
    const res = await fetch(`${OR_API_BASE}/auth/key`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const d = data?.data;
    if (!d) return null;
    return {
      usageMonthly: typeof d.usage_monthly === 'number' ? d.usage_monthly : null,
      limit: typeof d.limit === 'number' ? d.limit : null,
      limitRemaining: typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
      isFreeTier: typeof d.is_free_tier === 'boolean' ? d.is_free_tier : null,
      lastCheckedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function isFreeModel(m: any): boolean {
  const p = m?.pricing;
  if (!p) return false;
  const prompt = parseFloat(String(p.prompt ?? ''));
  const completion = parseFloat(String(p.completion ?? ''));
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

function modelFromCatalog(m: any): OpenRouterModelEntry {
  const arch = m?.architecture ?? {};
  const inputMods: string[] = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
  const reasoning = m?.reasoning ?? {};
  return {
    id: m.id,
    name: m.name || m.id,
    contextLength: m.context_length ?? null,
    pricing: m.pricing ?? null,
    reasoningMandatory: reasoning?.mandatory === true,
    supportsImages: inputMods.includes('image'),
    free: true,
    createdAt: m.created ?? null,
    lastCheckedAt: null,
    health: 'unknown',
    consecutiveFailures: 0,
    lastError: null,
    lastErrorCode: null,
    cooldownUntil: null,
    quarantineReason: null,
    quarantinedAt: null,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    lastUsedAt: null,
    lastLatencyMs: null,
  };
}

/**
 * FAZ 1 — OpenRouter gerçek API'den ücretsiz modelleri keşfet ve DB'ye kaydet.
 * Mevcut health/cooldown/quarantine durumlarını korur. Sahte model verisi yazmaz.
 */
export async function discoverAndPersist(): Promise<{ ok: boolean; freeCount: number; totalCount: number; error?: string }> {
  if (discoveryLock) {
    return { ok: false, freeCount: 0, totalCount: 0, error: 'Discovery already in progress' };
  }
  discoveryLock = true;
  lastDiscoveryTimestamp = Date.now();

  const apiKey = await getApiKey();
  if (!apiKey) {
    discoveryLock = false;
    return { ok: false, freeCount: 0, totalCount: 0, error: 'API key yapılandırılmamış' };
  }

  try {
    return await withRegistryLock(async () => {
      const catalog = await fetchCatalog(apiKey);
      const totalCount = catalog.length;
      const freeFromApi = catalog.filter(isFreeModel);

      const registry = await getRegistry();
      const existingMap = new Map<string, OpenRouterModelEntry>();
      for (const m of registry.models) {
        existingMap.set(m.id, m);
      }

      const apiModelIds = new Set<string>();
      const now = new Date().toISOString();
      const merged: OpenRouterModelEntry[] = [];

      for (const apiModel of freeFromApi) {
        apiModelIds.add(apiModel.id);
        const existing = existingMap.get(apiModel.id);

        if (existing) {
          existing.contextLength = apiModel.context_length ?? existing.contextLength;
          existing.pricing = apiModel.pricing ?? existing.pricing;
          existing.name = apiModel.name || apiModel.id || existing.name;
          existing.createdAt = apiModel.created ?? existing.createdAt;
          existing.lastCheckedAt = now;
          // FIX(RT-ACC): Kataloga geri dönen model karantinadan çıkar.
          if (existing.quarantineReason === 'removed_by_openrouter') {
            existing.quarantineReason = null;
            existing.quarantinedAt = null;
            existing.health = 'unknown';
            existing.consecutiveFailures = 0;
            existing.lastError = null;
            existing.lastErrorCode = null;
          }
          merged.push(existing);
        } else {
          const entry = modelFromCatalog(apiModel);
          entry.lastCheckedAt = now;
          merged.push(entry);
        }
      }

      for (const existing of existingMap.values()) {
        if (!apiModelIds.has(existing.id)) {
          if (!existing.quarantineReason) {
            existing.health = 'quarantined';
            existing.quarantineReason = 'removed_by_openrouter';
            existing.quarantinedAt = now;
          }
          existing.lastCheckedAt = now;
          merged.push(existing);
        }
      }

      const keyUsage = await fetchKeyUsage(apiKey);

      registry.models = merged;
      registry.discoveredAt = now;
      registry.lastDiscoveryError = null;
      registry.keyUsage = keyUsage;
      await saveRegistry(registry);

      if (merged.length === 0) {
        await setActiveModel(null);
      }

      return { ok: true, freeCount: merged.length, totalCount };
    });
  } catch (err: any) {
    const msg = err.message || 'Keşif hatası';
    const registry = await getRegistry();
    registry.lastDiscoveryError = msg;
    await saveRegistry(registry);
    return { ok: false, freeCount: registry.models.length, totalCount: 0, error: msg };
  } finally {
    discoveryLock = false;
  }
}

/**
 * Server açılışında çağrılır. Registry yoksa veya boşsa discover yapar.
 */
export async function ensureRegistrySeeded(): Promise<void> {
  const registry = await getRegistry();
  if (registry.models.length > 0) return;
  await discoverAndPersist();
}
// ==================== MODEL SELECTION ====================

export function isUsable(m: OpenRouterModelEntry): boolean {
  if (m.quarantineReason) return false;
  if (m.health === 'quarantined') return false;
  if (m.cooldownUntil) {
    const until = new Date(m.cooldownUntil).getTime();
    if (Date.now() < until) return false;
  }
  // FIX(RT326): totalRequests lifetime ban KALDIRILDI.
  // Lifetime totalRequests sonsuza kadar dışlanmaya yol açmamalı.
  // Sağlık kararı: quarantine, cooldown, failure-rate üzerinden verilir.
  // totalRequests yalnızca telemetry/istatistik amaçlıdır.
  if (m.id.includes('content-safety') || m.id.includes('safety')) return false;
  return true;
}

export function hasRotationLimitReached(m: OpenRouterModelEntry): boolean {
  // FIX(RT326): Artık lifetime ban üretmez; sadece high-usage bilgisi döndürür.
  return m.totalRequests >= FREE_MODEL_REQUEST_THRESHOLD;
}

export function isRemoved(m: OpenRouterModelEntry): boolean {
  return m.quarantineReason === 'removed_by_openrouter';
}

function modelScore(m: OpenRouterModelEntry): number {
  let score = 0;
  if (m.health === 'healthy') score += 100;
  else if (m.health === 'unknown') score += 50;
  else if (m.health === 'degraded') score += 20;

  const total = m.totalRequests || 1;
  const failRate = m.failedRequests / total;
  score -= failRate * 50;

  // FIX(RT326): totalRequests artık yalnızca depriyoritizasyon cezası (ban değil).
  // Yoğun kullanılan modeller alt sıralara itilir ama dışlanmaz.
  // rotation limit aşımında bile seçim devam eder.
  score -= Math.min(30, m.totalRequests / 3);

  if (m.contextLength) {
    score += Math.min(30, m.contextLength / 10000);
  }

  score += Math.min(20, m.successfulRequests / 10);

  if (m.lastUsedAt) {
    const hoursSinceUse = (Date.now() - new Date(m.lastUsedAt).getTime()) / 3600000;
    if (hoursSinceUse < 1) score -= 10;
  }

  if (!m.reasoningMandatory) score += 5;

  return score;
}

export async function getActiveModel(): Promise<string | null> {
  const p = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  return p?.model || null;
}

async function setActiveModel(modelId: string | null): Promise<void> {
  await prisma.aIProviderConfig.update({
    where: { provider: 'openrouter' },
    data: { model: modelId ?? '' },
  });
}

/**
 * FAZ 2 — En uygun sağlıklı ücretsiz modeli seçer.
 * exclude: bu request lifecycle'da zaten denenmiş modeller
 */
export async function selectBestModel(exclude: Set<string> = new Set()): Promise<OpenRouterModelEntry | null> {
  const registry = await getRegistry();
  const usable = registry.models.filter(m => isUsable(m) && !exclude.has(m.id));
  if (usable.length === 0) return null;
  usable.sort((a, b) => modelScore(b) - modelScore(a));
  return usable[0] || null;
}

/**
 * Mevcut aktif modeli kullanılabilir durumda döndürür.
 * Kullanılamazsa yeni model seçer ve AIProviderConfig.model'e yazar.
 */
export async function getOrSelectActiveModel(exclude: Set<string> = new Set()): Promise<OpenRouterModelEntry | null> {
  const activeId = await getActiveModel();
  if (activeId) {
    const registry = await getRegistry();
    const active = registry.models.find(m => m.id === activeId);
    if (active && isUsable(active) && !exclude.has(active.id)) {
      return active;
    }
  }

  const best = await selectBestModel(exclude);
  if (best) {
    await setActiveModel(best.id);
  }
  return best;
}
// ==================== ERROR CLASSIFICATION ====================

/**
 * FAZ 2/3 — Hata kodunu sınıflandırır.
 * transient:   429, 5xx, timeout → cooldown + fallback
 * permanent:   404, 410, model_not_found, unsupported, deprecated → quarantine
 * auth:        401, 403 → provider lastStatus=error
 *
 * FIX(RT-ACC): HTTP status ÖNCE gelir (spec #7). Metin eşleşmeleri
 * word-boundary ile sıkılaştırıldı ("1429" artık 429 sanılmaz,
 * "people" içindeki 'eol' artık deprecated sanılmaz).
 */
export function classifyError(err: any): ClassifiedError {
  const msg = String(err?.message || err?.toString?.() || '').toLowerCase();
  const status = extractHttpStatus(msg);

  // FIX(RT-ACC): Gerçek HTTP status her şeyden önce.
  if (status >= 500) {
    return { type: 'transient', errorCode: 'SERVER_ERROR', errorMsg: 'OpenRouter sunucu hatası' };
  }
  if (status === 429) {
    return { type: 'transient', errorCode: 'RATE_LIMIT', errorMsg: 'Rate limit aşıldı' };
  }
  if (status === 403) {
    return { type: 'auth', errorCode: 'FORBIDDEN', errorMsg: 'Erişim yasak' };
  }
  if (status === 401) {
    return { type: 'auth', errorCode: 'INVALID_KEY', errorMsg: 'API key yetkisi geçersiz' };
  }

  // Metin fallback'i — status çıkarılamadığında (yalın gövde metinleri).
  if (/\b401\b/.test(msg) || msg.includes('invalid_key') || msg.includes('unauthorized')) {
    return { type: 'auth', errorCode: 'INVALID_KEY', errorMsg: 'API key yetkisi geçersiz' };
  }
  if (/\b403\b/.test(msg) || msg.includes('forbidden')) {
    return { type: 'auth', errorCode: 'FORBIDDEN', errorMsg: 'Erişim yasak' };
  }
  if (/\b429\b/.test(msg) || msg.includes('rate_limit') || msg.includes('too many requests') || msg.includes('rate limit exceeded')) {
    return { type: 'transient', errorCode: 'RATE_LIMIT', errorMsg: 'Rate limit aşıldı' };
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    return { type: 'transient', errorCode: 'TIMEOUT', errorMsg: 'İstek zaman aşımı' };
  }

  if (status === 404 || /\b404\b/.test(msg) || msg.includes('model_not_found') || msg.includes('model not found')) {
    return { type: 'permanent', errorCode: 'MODEL_NOT_FOUND', errorMsg: 'Model bulunamadı/kullanımdan kalkmış' };
  }
  // FIX(RT-ACC): 'eol' çıplak alt-dizi olarak kaldırıldı ('people' tuzakları).
  if (status === 410 || /\b410\b/.test(msg) || /\bgone\b/.test(msg) || msg.includes('deprecated') || msg.includes('end of life')) {
    return { type: 'permanent', errorCode: 'MODEL_DEPRECATED', errorMsg: 'Model kullanımdan kalkmış' };
  }
  if (msg.includes('unsupported') || msg.includes('not available for this model') || msg.includes('does not exist') || msg.includes('unknown model')) {
    return { type: 'permanent', errorCode: 'UNSUPPORTED_MODEL', errorMsg: 'Model desteklenmiyor' };
  }
  if (status === 402 || /\b402\b/.test(msg) || msg.includes('payment required') || msg.includes('payment_required') || msg.includes('insufficient balance') || msg.includes('insufficient credits') || msg.includes('billing')) {
    return { type: 'auth', errorCode: 'INSUFFICIENT_CREDITS', errorMsg: 'OpenRouter bakiye yetersiz (hesap bazlı)' };
  }
  if (status === 400) {
    return { type: 'permanent', errorCode: 'BAD_REQUEST', errorMsg: 'Geçersiz istek (model geçersiz olabilir)' };
  }

  return { type: 'unknown', errorCode: 'UNKNOWN', errorMsg: msg.slice(0, 200) || 'Bilinmeyen hata' };
}

function extractHttpStatus(msg: string): number {
  const match = msg.match(/http_(\d{3})/);
  if (match) return parseInt(match[1], 10);
  const match2 = msg.match(/\b(\d{3})\b/);
  if (match2) {
    const n = parseInt(match2[1], 10);
    if (n >= 400 && n < 600) return n;
  }
  return 0;
}

// ==================== OUTCOME RECORDING ====================

function computeCooldownDuration(failures: number): number {
  const duration = COOLDOWN_BASE_MS * Math.pow(2, Math.min(failures - 1, 5));
  return Math.min(duration, COOLDOWN_MAX_MS);
}

/**
 * FAZ 2/3/4 — Model kullanım sonucunu kaydeder, cooldown/quarantine uygular.
 * Gerekirse aktif modeli değiştirir.
 */
export async function recordModelOutcome(
  modelId: string,
  ok: boolean,
  errorCode?: string,
  errorMsg?: string,
  latencyMs?: number
): Promise<void> {
  await withRegistryLock(async () => {
    const registry = await getRegistry();
    const model = registry.models.find(m => m.id === modelId);
    if (!model) return;

    const now = new Date().toISOString();
    model.lastUsedAt = now;
    model.lastCheckedAt = now;

    if (ok) {
      model.totalRequests++;
      model.successfulRequests++;
      model.health = 'healthy';
      model.consecutiveFailures = 0;
      model.lastError = null;
      model.lastErrorCode = null;
      model.cooldownUntil = null;
      // FIX(RT-ACC): Başarı her türlü karantinayı temizler (savunmacı).
      model.quarantineReason = null;
      model.quarantinedAt = null;
      model.lastLatencyMs = latencyMs ?? null;
    } else {
      model.totalRequests++;
      model.failedRequests++;
      model.lastError = errorMsg ?? null;
      model.lastErrorCode = errorCode ?? null;
      model.lastLatencyMs = latencyMs ?? null;

      const classified = errorCode
        ? classifyError(new Error(`${errorCode} ${errorMsg || ''}`))
        : { type: 'unknown' as const, errorCode: errorCode || 'UNKNOWN', errorMsg: errorMsg || 'Bilinmeyen hata' };

      if (classified.type === 'permanent') {
        model.health = 'quarantined';
        model.quarantineReason = classified.errorMsg;
        model.quarantinedAt = now;
        model.cooldownUntil = null;
      } else if (classified.type === 'transient' || classified.type === 'unknown') {
        model.consecutiveFailures++;
        model.health = 'degraded';
        model.quarantineReason = null;
        model.quarantinedAt = null;
        model.cooldownUntil = new Date(Date.now() + computeCooldownDuration(model.consecutiveFailures)).toISOString();
      }
    }

    await saveRegistry(registry);
  });

  const activeId = await getActiveModel();
  if (activeId === modelId && !ok) {
    const registry2 = await getRegistry();
    const model2 = registry2.models.find(m => m.id === modelId);
    if (model2 && !isUsable(model2)) {
      const next = await selectBestModel(new Set([modelId]));
      if (next) {
        await setActiveModel(next.id);
      } else {
        await setActiveModel(null);
      }
    }
  }
}

export async function recordModelSuccess(modelId: string, latencyMs?: number): Promise<void> {
  return recordModelOutcome(modelId, true, undefined, undefined, latencyMs);
}

export async function recordModelFailure(modelId: string, errorCode: string, errorMsg: string, latencyMs?: number): Promise<void> {
  return recordModelOutcome(modelId, false, errorCode, errorMsg, latencyMs);
}

// ==================== MANUAL RESET (FIX RT-ACC) ====================

/**
 * Model veya tüm modeller için runtime cezalarını sıfırlar
 * (cooldown + karantina + failure sayaçları). removed_by_* dahil.
 */
export async function resetModelState(modelId?: string): Promise<{ resetCount: number }> {
  return withRegistryLock(async () => {
    const registry = await getRegistry();
    let resetCount = 0;
    for (const m of registry.models) {
      if (modelId && m.id !== modelId) continue;
      m.cooldownUntil = null;
      m.quarantineReason = null;
      m.quarantinedAt = null;
      m.health = 'unknown';
      m.consecutiveFailures = 0;
      m.lastError = null;
      m.lastErrorCode = null;
      resetCount++;
    }
    await saveRegistry(registry);
    if (modelId === undefined) {
      await setActiveModel(null).catch(() => {});
    }
    return { resetCount };
  });
}
// ==================== QUOTA ====================

/**
 * FAZ 3 — Gerçek quota yüzdesi hesaplar.
 * Yalnızca API limit != null && limit > 0 ise yüzde döndürür. Aksi halde null (sahte yüzde ÜRETMEZ).
 */
export function computeUsagePercent(registry: OpenRouterRegistry): number | null {
  const ku = registry.keyUsage;
  if (!ku || ku.limit === null || ku.limit === undefined || ku.limit <= 0) return null;
  if (ku.usageMonthly === null || ku.usageMonthly === undefined) return 0;
  return (ku.usageMonthly / ku.limit) * 100;
}

/**
 * FAZ 3 — Kota kontrolü yapar. Yalnızca gerçek limit varsa çalışır.
 * limit yoksa { rotated: false, percent: null } döner — tahmin ÜRETMEZ.
 */
export async function checkQuotaAndRotate(): Promise<{ rotated: boolean; percent: number | null; reason: string | null }> {
  const registry = await getRegistry();
  const percent = computeUsagePercent(registry);
  if (percent === null) {
    return { rotated: false, percent: null, reason: 'Quota bilgisi API tarafından sağlanmıyor' };
  }

  if (percent >= 90) {
    const activeId = await getActiveModel();
    const next = await selectBestModel(activeId ? new Set([activeId]) : new Set());
    if (next) {
      await setActiveModel(next.id);
      await prisma.auditLog.create({
        data: {
          action: 'OPENROUTER_QUOTA_ROTATE',
          entity: 'ai_provider',
          entityId: 'openrouter',
          details: `Kota %${percent.toFixed(1)} → model değiştirildi: ${next.id}`,
          meta: JSON.stringify({ quotaPercent: percent, newModel: next.id, oldModel: activeId }),
        },
      }).catch(() => {});
      return { rotated: true, percent, reason: `Kota %${percent.toFixed(1)} ≥ %90 → model değiştirildi` };
    }
    return { rotated: false, percent, reason: `Kota %${percent.toFixed(1)} ≥ %90 ama uygun model bulunamadı` };
  }

  if (percent >= 80) {
    return { rotated: false, percent, reason: `Kota %${percent.toFixed(1)} ≥ %80 — yakında model değişebilir` };
  }

  return { rotated: false, percent, reason: null };
}

// ==================== HELPER: MAX_TOKENS NORMALIZATION ====================

/**
 * OpenRouter için external max_tokens parametresini güvenli hale getirir.
 * 
 * Amaç: External source (VS Code Copilot Chat, etc.) tarafından gönderilen
 * 32000 gibi aşırı değerlerin OpenRouter'a blind pass-through olmasını önlemek.
 * 
 * Stratoji:
 * - External value yoksa: mevcut default (1024) kullan
 * - External value varsa: güvenli ceiling ile clamp et
 * - Context length varsa: sadece total context taşmasını kontrol et
 * - Negatif/NaN/Infinity değerleri kabul etme
 * 
 * ÖNEMLI: context_length = total context window (input+output)
 * Gerçek output token limiti = bilinmiyor (OpenRouter API sağlamıyor)
 * %50 ceiling = conservative safety margin
 */
function normalizeMaxTokensForOpenRouter(
  externalMaxTokens: number | undefined,
  modelContextLength: number | null
): number {
  // Default safe value for OpenRouter free models
  const DEFAULT_SAFE_MAX_TOKENS = 1024;

  // If no external value provided, use safe default
  if (externalMaxTokens === undefined) {
    return DEFAULT_SAFE_MAX_TOKENS;
  }

  // Validate external value type and finiteness
  if (typeof externalMaxTokens !== 'number' || !Number.isFinite(externalMaxTokens)) {
    return DEFAULT_SAFE_MAX_TOKENS;
  }

  // Reject negative or zero values
  if (externalMaxTokens <= 0) {
    return DEFAULT_SAFE_MAX_TOKENS;
  }

  // Determine safe ceiling
  let ceiling = 4096; // Conservative upper bound for OpenRouter free models

  if (modelContextLength && modelContextLength > 0) {
    // Context length is total window (input+output)
    // Use 50% as safety ceiling to prevent context overflow
    // (accounting for prompt tokens in the request)
    ceiling = Math.floor(modelContextLength * 0.5);
    // Ensure minimum safety floor
    ceiling = Math.max(ceiling, DEFAULT_SAFE_MAX_TOKENS);
  }

  // Clamp external value to safe ceiling
  const normalized = Math.min(externalMaxTokens, ceiling);

  // Log for debugging if significant normalization occurred
  if (normalized < externalMaxTokens) {
    console.log(
      `[openRouter] max_tokens normalized: ${externalMaxTokens} → ${normalized} (ceiling: ${ceiling})`
    );
  }

  return normalized;
}

// ==================== COMPLETION ====================

/**
 * FAZ 2/6 — OpenRouter üzerinden ücretsiz model ile completion yapar.
 * En fazla MAX_ATTEMPTS_PER_REQUEST model dener.
 * Transient/permanent hata yönetimi + cooldown/quarantine + registry güncellemesi İÇERİR.
 */
export async function completeWithFreeModel(request: {
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}): Promise<OpenRouterCompletionResult> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { ok: false, content: null, model: 'none', error: 'API key yapılandırılmamış', errorCode: 'NO_KEY' };
  }

  const excluded = new Set<string>();
  let lastError: string | null = null;
  let lastErrorCode: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_REQUEST; attempt++) {
    const modelEntry = await getOrSelectActiveModel(excluded);
    if (!modelEntry) {
      return {
        ok: false,
        content: null,
        model: 'none',
        error: lastError ? `Tüm modeller başarısız: ${lastError}` : 'Uygun ücretsiz model bulunamadı',
        errorCode: lastErrorCode || 'NO_MODEL_AVAILABLE',
      };
    }

    excluded.add(modelEntry.id);
    const startTime = Date.now();
    const body = {
      model: modelEntry.id,
      messages: request.messages,
      temperature: request.temperature ?? 0.1,
      max_tokens: normalizeMaxTokensForOpenRouter(request.max_tokens, modelEntry.contextLength),
      ...(request.response_format ? { response_format: request.response_format } : {}),
    };

    try {
      const res = await fetch(`${OR_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:4000',
          'X-Title': 'DG STOK',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        const errorCode = `HTTP_${res.status}`;
        const errorMsg = errorBody || `HTTP ${res.status}`;
        const classified = classifyError(new Error(`${errorCode} ${errorMsg}`));

        await recordModelFailure(modelEntry.id, classified.errorCode, classified.errorMsg, latencyMs);

        lastError = classified.errorMsg;
        lastErrorCode = classified.errorCode;
        continue;
      }

      const data: any = await res.json();
      // FIX(RT-ACC): Reasoning modeller content:'' + reasoning_content/reasoning
      // döndürebilir. Boş metin → INVALID_RESPONSE, sıradaki modele geç;
      // boş yanıt SAHTE başarı sayılmaz.
      const text = extractResponseText(data);
      if (!text) {
        await recordModelFailure(modelEntry.id, 'INVALID_RESPONSE', 'Boş yanıt (content/reasoning yok)', latencyMs);
        lastError = 'Boş yanıt (content/reasoning yok)';
        lastErrorCode = 'INVALID_RESPONSE';
        continue;
      }
      const usage = data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens ?? 0,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined;

      await recordModelSuccess(modelEntry.id, latencyMs);

      return {
        ok: true,
        content: text,
        model: modelEntry.id,
        usage,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const classified = classifyError(err);
      await recordModelFailure(modelEntry.id, classified.errorCode, classified.errorMsg, latencyMs);

      lastError = classified.errorMsg;
      lastErrorCode = classified.errorCode;
    }
  }

  return {
    ok: false,
    content: null,
    model: 'none',
    error: lastError ? `Tüm modeller başarısız: ${lastError}` : 'Tüm denemeler başarısız',
    errorCode: lastErrorCode || 'ALL_MODELS_FAILED',
  };
}
// ==================== STATUS ====================

/**
 * FAZ 5 — AI Control Center UI için durum bilgisi döndürür.
 */
export async function getOpenRouterStatus(): Promise<OpenRouterStatus> {
  const key = await getApiKey();
  if (!key) {
    return {
      aiStatus: 'no_key',
      currentModel: null,
      currentModelName: null,
      nextModel: null,
      nextModelName: null,
      freeModelsTotal: 0,
      healthyCount: 0,
      degradedCount: 0,
      cooldownCount: 0,
      quarantineCount: 0,
      removedCount: 0,
      rotationLimitCount: 0,
      freeModelRequestThreshold: FREE_MODEL_REQUEST_THRESHOLD,
      quotaAvailable: false,
      lastCheck: null,
      keyConfigured: false,
      quotaPercent: null,
      lastDiscoveryError: null,
    };
  }

  const registry = await getRegistry();
  const activeId = await getActiveModel();
  const activeModel = activeId ? registry.models.find(m => m.id === activeId) : null;

  const exclude = activeId ? new Set([activeId]) : new Set<string>();
  const nextModel = await selectBestModel(exclude);

  const healthyCount = registry.models.filter(m => m.health === 'healthy' && !hasRotationLimitReached(m)).length;
  const degradedCount = registry.models.filter(m => m.health === 'degraded').length;
  const cooldownCount = registry.models.filter(m => m.cooldownUntil && new Date(m.cooldownUntil).getTime() > Date.now()).length;
  const quarantineCount = registry.models.filter(m => (m.health === 'quarantined' || m.quarantineReason) && !isRemoved(m)).length;
  const removedCount = registry.models.filter(isRemoved).length;
  const rotationLimitCount = registry.models.filter(hasRotationLimitReached).length;

  let aiStatus: OpenRouterStatus['aiStatus'] = 'unavailable';
  if (activeModel && isUsable(activeModel)) {
    aiStatus = 'active';
  } else if (registry.models.some(m => isUsable(m))) {
    aiStatus = 'switching';
  } else {
    aiStatus = 'unavailable';
  }

  return {
    aiStatus,
    currentModel: activeModel?.id ?? null,
    currentModelName: activeModel?.name ?? null,
    nextModel: nextModel?.id ?? null,
    nextModelName: nextModel?.name ?? null,
    freeModelsTotal: registry.models.length,
    healthyCount,
    degradedCount,
    cooldownCount,
    quarantineCount,
    removedCount,
    rotationLimitCount,
    freeModelRequestThreshold: FREE_MODEL_REQUEST_THRESHOLD,
    quotaAvailable: registry.keyUsage !== null && registry.keyUsage.limit !== null && registry.keyUsage.limit > 0,
    lastCheck: registry.discoveredAt ?? null,
    keyConfigured: true,
    quotaPercent: computeUsagePercent(registry),
    lastDiscoveryError: registry.lastDiscoveryError,
  };
}

// ==================== BACKGROUND REFRESH ====================

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshBackoff = REFRESH_INTERVAL_MS;

/**
 * FAZ 4 — Arka plan model discovery ve health check.
 * 15dk interval; başarısız olursa 5dk sonra tekrar dener (backoff).
 * Sonsuz polling yapmaz, API'yi spamlemez.
 */
export function startBackgroundRefresh(): void {
  stopBackgroundRefresh();

  const tick = async () => {
    if (Date.now() - lastDiscoveryTimestamp < DISCOVERY_COOLDOWN_MS) {
      return;
    }

    const result = await discoverAndPersist();
    if (result.ok) {
      refreshBackoff = REFRESH_INTERVAL_MS;
    } else {
      refreshBackoff = REFRESH_RETRY_BACKOFF_MS;
    }
    await checkQuotaAndRotate().catch(() => {});
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = setInterval(tick, refreshBackoff);
    }
  };

  setTimeout(() => {
    tick();
    refreshTimer = setInterval(tick, refreshBackoff);
  }, 30000);
}

export function stopBackgroundRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
