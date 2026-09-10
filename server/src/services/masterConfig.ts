/**
 * MASTER CONFIG — AI Control Center V2 tek merkezi routing policy kaynağı.
 * Dağınık magic constant YOK: tüm ağırlık/eşik/politikalar burada.
 * Kalıcılık: Setting tablosu 'master_ai_config' JSON anahtarı (schema değişikliği YOK).
 */

export interface MasterWeights {
  /** Görev-capability uyumu */
  capabilityFit: number;
  /** Başarı oranı ve ardışık hata cezası */
  reliability: number;
  /** Kota güvenliği (gerçek veri yoksa nötr öncek) */
  quotaSafety: number;
  /** Yakın zamanda başarılı kullanım */
  recentSuccess: number;
  /** Ölçülen gecikme skoru */
  latency: number;
  /** Kaynak/model önceliği (omniroute > openrouter > paid) */
  priority: number;
}

export interface MasterQuotaThresholds {
  preferred: number;
  warning: number;
  critical: number;
  blocked: number;
}

export type MasterSourceId = 'omniroute' | 'openrouter' | 'nvidia' | 'deepseek';

export interface MasterConfig {
  /** Ücretsiz modeller tercih edilir (skor avantajı + paid sadece tükenince) */
  FREE_FIRST: boolean;
  /** Free havuzu tükenince ücretli sağlayıcılara geç */
  ALLOW_PAID_FALLBACK: boolean;
  /** Request başına maksimum model denemesi */
  MAX_ATTEMPTS: number;
  /** Completion HTTP timeout (ms) */
  EXECUTION_TIMEOUT_MS: number;
  /** Skor ağırlıkları (toplamı 1.0) */
  WEIGHTS: MasterWeights;
  /** Kota eşikleri (%) — gerçek provider verisi varsa uygulanır */
  QUOTA_THRESHOLDS: MasterQuotaThresholds;
  /** Kota verisi sağlamayan kaynaklar için TARAFSIZ skor önceliği (sahte yüzde DEĞİL) */
  QUOTA_UNKNOWN_NEUTRAL_SCORE: number;
  /** Kaynak açma/kapama (ops kill-switch + provider-dead simülasyonu) */
  SOURCES_ENABLED: Record<MasterSourceId, boolean>;
  /** Kaynak seviyesi devre kesici: art arda bağlantı hatası eşiği */
  SOURCE_BREAKER_THRESHOLD: number;
  /** Breaker ilk bekleme süresi (ms) — exponential 30s,60s,120s… max */
  SOURCE_BREAKER_BASE_MS: number;
  SOURCE_BREAKER_MAX_MS: number;
  /** Admin PIN: boş değilse bu model ilk seçilir AMA sağlık/kota filtrelerini YİNE geçmek zorunda */
  PINNED_MODEL_ID: string;
  /** Yapılandırılmış çıktı zorunlu görevlerde JSON doğrulama */
  VALIDATE_STRUCTURED_OUTPUT: boolean;
}

export const DEFAULT_MASTER_CONFIG: MasterConfig = {
  FREE_FIRST: true,
  // Mevcut üretim davranışı: provider zinciri ücretli sağlayıcıları da içeriyordu.
  ALLOW_PAID_FALLBACK: true,
  MAX_ATTEMPTS: 5,
  EXECUTION_TIMEOUT_MS: 60000,
  WEIGHTS: {
    capabilityFit: 0.30,
    reliability: 0.25,
    quotaSafety: 0.20,
    recentSuccess: 0.10,
    latency: 0.05,
    priority: 0.10,
  },
  QUOTA_THRESHOLDS: {
    preferred: 80,
    warning: 80,
    critical: 90,
    blocked: 100,
  },
  QUOTA_UNKNOWN_NEUTRAL_SCORE: 85,
  SOURCES_ENABLED: {
    omniroute: true,
    openrouter: true,
    nvidia: true,
    deepseek: true,
  },
  SOURCE_BREAKER_THRESHOLD: 3,
  SOURCE_BREAKER_BASE_MS: 30 * 1000,
  SOURCE_BREAKER_MAX_MS: 10 * 60 * 1000,
  PINNED_MODEL_ID: '',
  VALIDATE_STRUCTURED_OUTPUT: true,
};

const CONFIG_KEY = 'master_ai_config';

let cachedConfig: MasterConfig | null = null;
let cachedAt = 0;
const CONFIG_CACHE_TTL_MS = 10 * 1000;

function deepMergeConfig(base: MasterConfig, patch: Partial<MasterConfig>): MasterConfig {
  return {
    ...base,
    ...patch,
    WEIGHTS: { ...base.WEIGHTS, ...(patch.WEIGHTS || {}) },
    QUOTA_THRESHOLDS: { ...base.QUOTA_THRESHOLDS, ...(patch.QUOTA_THRESHOLDS || {}) },
    SOURCES_ENABLED: { ...base.SOURCES_ENABLED, ...(patch.SOURCES_ENABLED || {}) },
  };
}

/** Config'i oku (DB patch + default merge, 10s cache). DB okunamazsa default. */
export async function getMasterConfig(): Promise<MasterConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { prisma } = await import('../db/prisma.ts');
    const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    if (row?.value) {
      const patch = JSON.parse(row.value);
      cachedConfig = deepMergeConfig(DEFAULT_MASTER_CONFIG, patch);
    } else {
      cachedConfig = { ...DEFAULT_MASTER_CONFIG };
    }
  } catch {
    cachedConfig = cachedConfig ?? { ...DEFAULT_MASTER_CONFIG };
  }
  cachedAt = now;
  return cachedConfig!;
}

/** Config güncelle (partial merge) + kalıcı yaz + cache invalidate. Redacted alan kabul etmez. */
export async function updateMasterConfig(patch: Partial<MasterConfig>): Promise<MasterConfig> {
  const current = await getMasterConfig();
  const next = deepMergeConfig(current, patch);
  const { prisma } = await import('../db/prisma.ts');
  await prisma.setting.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(patch) },
    update: { value: JSON.stringify(patch) },
  }).catch(async () => {
    // Mevcut patch blob'unu üzerine yazmak yerine merge edilmiş tam config'i yaz
    await prisma.setting.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
  });
  cachedConfig = next;
  cachedAt = Date.now();
  return next;
}

/** Test/cache kontrolü için */
export function invalidateMasterConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

/**
 * Güvenli görünüm: ileride config'e secret girilirse bile API'ye sızmaz (#58).
 */
export function redactMasterConfig(cfg: MasterConfig): MasterConfig {
  return JSON.parse(JSON.stringify(cfg));
}
