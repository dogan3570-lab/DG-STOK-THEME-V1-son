// ============================================================
// TİCARİ ÖĞRENME MOTORU
// Sipariş gözlemlerinden öğrenme, sapma analizi ve akıllı uyarılar
// Dosya tabanlı persistans ile — PM2 restart sonrası veri korunur
// ============================================================

import { LearningEngine } from './learning';
import { RuleType, RuleCondition, DataSource } from '../../shared/types';
import { saveLearningState, loadLearningState, PersistedLearningState } from './learning-persistence';

// ──────────────────────────────────────────────────────────────
// TIPLER / ARAYÜZLER
// ──────────────────────────────────────────────────────────────

/**
 * Gözlem kaynağı.
 * - real: gerçek sipariş/pazaryeri verisinden üretildi (üretim öğrenmesi)
 * - test: geliştirici/otomatik test verisi
 * - simulation: senaryo simülasyonu (üretim state'ini ETKİLEMEZ)
 */
export type ObservationSource = 'real' | 'test' | 'simulation';

/** Sipariş gözlemi: beklenen vs gerçekleşen değerler */
export interface OrderObservation {
  /** id verilmezse otomatik üretilir */
  id?: string;
  orderId: string;
  marketplaceKey: string;
  category?: string;
  sellerId?: string;
  /** Kaynak türü — varsayılan 'real' */
  source?: ObservationSource;

  /** Beklenen değerler (tahmin / DB kuralı / resmi oran) */
  expected: {
    commissionRate: number;
    shippingCost: number;
    returnRate: number;
    discountRate: number;
    advertisingCost: number;
  };

  /** Gerçekleşen değerler */
  actual: {
    commissionRate: number;
    shippingCost: number;
    returnRate: number;
    discountRate: number;
    advertisingCost: number;
  };

  /** Siparişin toplam tutarı */
  orderTotal: number;

  /** timestamp verilmezse otomatik üretilir */
  timestamp?: Date;
}

/** Sapma kaydı: tek bir metrik için beklenen vs gerçek farkı */
export interface Deviation {
  id: string;
  observationId: string;
  orderId: string;
  marketplaceKey: string;
  category?: string;
  source: ObservationSource;

  metric: 'commissionRate' | 'shippingCost' | 'returnRate' | 'discountRate' | 'advertisingCost';
  expected: number;
  actual: number;
  absoluteDiff: number;
  percentageDiff: number;

  /** Sapma yönü: pozitif = gerçek daha yüksek, negatif = gerçek daha düşük */
  direction: 'over' | 'under';

  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

/** Öğrenilen bilgi: resmi kural ile karşılaştırılmış bilgi */
export interface LearnedInsight {
  id: string;
  marketplaceKey: string;
  category?: string;
  metric: string;

  /** Veri tabanından gelen resmi/kanonik değer */
  officialValue: number | null;
  officialSource: string | null;

  /** Gözlemlerden öğrenilen gerçek değer */
  learnedValue: number;

  /** Resmi değerden sapma yüzdesi */
  deviationFromOfficial: number | null;

  /** Bu kural için toplam örnek sayısı */
  sampleCount: number;

  /** Güven skoru (0-1) — minSamples'a ulaşıldıkça artar */
  confidence: number;

  /** Kural durumu */
  status: 'emerging' | 'confirmed' | 'divergent';

  firstSeen: Date;
  lastSeen: Date;
}

/** Akıllı uyarı: dikkat gerektiren durumlar */
export interface LearningAlert {
  id: string;
  type: 'recurring_deviation' | 'confidence_drop' | 'marketplace_shift' | 'rule_conflict' | 'new_pattern';
  severity: 'info' | 'warning' | 'critical';
  marketplaceKey: string;
  category?: string;
  metric: string;

  title: string;
  message: string;

  /** İlgili gözlem ID'leri */
  relatedObservationIds: string[];

  /** Önerilen aksiyon */
  recommendation: string;

  acknowledged: boolean;
  timestamp: Date;
}

// ──────────────────────────────────────────────────────────────
// YAPILANDIRMA
// ──────────────────────────────────────────────────────────────

export interface CommercialLearningConfig {
  /** Kural oluşturmak için minimum örnek sayısı */
  minSamples: number;
  /** Sapma eşiği (%) — bu değerden küçük sapmalar yok sayılır */
  deviationThreshold: number;
  /** Tekrarlayan sapma uyarısı için minimum tekrar sayısı */
  recurringDeviationMinCount: number;
  /** Güven düşüşü uyarısı için eşik */
  confidenceDropThreshold: number;
  /** Maksimum hafıza boyutu (gözlem sayısı) */
  maxObservations: number;
}

const DEFAULT_CONFIG: CommercialLearningConfig = {
  minSamples: 10,
  deviationThreshold: 5,
  recurringDeviationMinCount: 3,
  confidenceDropThreshold: 0.15,
  maxObservations: 10000,
};

// ──────────────────────────────────────────────────────────────
// ANA MOTOR
// ──────────────────────────────────────────────────────────────

/**
 * Ticari Öğrenme Motoru
 *
 * - Mevcut LearningEngine'i wrap eder
 * - Sipariş gözlemlerini kaydeder, sapmaları hesaplar
 * - Marketplace/kategori bazlı öğrenilen bilgileri üretir
 * - Akıllı uyarılar oluşturur
 * - Tek siparişle kural DEĞİŞTİRmez (minSamples)
 * - Finansal veriyi sessizce DEĞİŞTİRMEZ
 */
export class CommercialLearningEngine {

  private config: CommercialLearningConfig;
  private learningEngine: LearningEngine;
  private persistenceEnabled: boolean;

  private observations: OrderObservation[] = [];
  private deviations: Deviation[] = [];
  private insights: Map<string, LearnedInsight> = new Map();
  private alerts: LearningAlert[] = [];

  constructor(
    learningEngine?: LearningEngine,
    config: Partial<CommercialLearningConfig> = {},
    options: { persistence?: boolean } = {}
  ) {
    this.learningEngine = learningEngine ?? new LearningEngine();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistenceEnabled = options.persistence !== false;
    if (this.persistenceEnabled) {
      this.restore();
    }
  }

  // ── Persistans ────────────────────────────────────────────

  private restore(): void {
    const state = loadLearningState();
    if (state) {
      this.observations = state.observations || [];
      this.deviations = state.deviations || [];
      this.insights = new Map(state.insights || []);
      this.alerts = state.alerts || [];
      console.log(`[learning] Restored: ${this.observations.length} observations, ${this.insights.size} insights, ${this.alerts.length} alerts`);
    } else {
      console.log('[learning] No persisted state found, starting fresh');
    }
  }

  private persist(): void {
    if (!this.persistenceEnabled) return;
    const state: PersistedLearningState = {
      observations: this.observations,
      deviations: this.deviations,
      insights: Array.from(this.insights.entries()),
      alerts: this.alerts,
      lastSaved: '',
      version: 1,
    };
    saveLearningState(state);
  }

  // ── Gözlem Kayıt ──────────────────────────────────────────

  /**
   * Sipariş gözlemini kaydeder, sapmaları hesaplar,
   * gerekirse öğrenilen bilgi ve uyarıları günceller.
   */
  recordObservation(observation: OrderObservation): {
    observation: OrderObservation;
    deviations: Deviation[];
    newInsights: LearnedInsight[];
    newAlerts: LearningAlert[];
  } {
    // Normalize: id/timestamp/source opsiyonel gelir
    const normalized: OrderObservation = {
      ...observation,
      id: observation.id ?? `obs-${observation.orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: observation.source ?? 'real',
      timestamp: observation.timestamp ? new Date(observation.timestamp) : new Date(),
    };

    // Hafıza limiti kontrolü
    if (this.observations.length >= this.config.maxObservations) {
      this.observations = this.observations.slice(-Math.floor(this.config.maxObservations * 0.8));
      const keptIds = new Set(this.observations.map(o => o.id));
      this.deviations = this.deviations.filter(d => keptIds.has(d.observationId));
    }

    this.observations.push(normalized);

    // Sapmaları hesapla
    const newDeviations = this.calculateDeviations(normalized);
    this.deviations.push(...newDeviations);

    // LearningEngine'e örnek ekle
    this.feedLearningEngine(normalized, newDeviations);

    // Öğrenilen bilgileri güncelle
    const newInsights = this.updateInsights(normalized, newDeviations);

    // Uyarıları kontrol et
    const newAlerts = this.checkAlerts(normalized, newDeviations);

    // Persist state to disk (survives PM2 restart)
    this.persist();

    return {
      observation: normalized,
      deviations: newDeviations,
      newInsights,
      newAlerts,
    };
  }

  // ── İzole Simülasyon ──────────────────────────────────────

  /**
   * Senaryoları ÜRETİM STATE'İNİ ETKİLEMEDEN çalıştırır.
   * Ayrı bir izole engine (persistans kapalı) kullanır; disk'e yazmaz,
   * gerçek observations/insights/alerts koleksiyonlarına dokunmaz.
   */
  simulate(scenarios: Array<{
    orderId?: string;
    marketplaceKey?: string;
    category?: string;
    expected: OrderObservation['expected'];
    actual: OrderObservation['actual'];
    orderTotal?: number;
  }>): {
    results: Array<{
      orderId: string;
      deviations: Deviation[];
      totalDeviation: number;
    }>;
    summary: ReturnType<CommercialLearningEngine['getStats']>;
  } {
    const isolated = new CommercialLearningEngine(
      new LearningEngine(),
      this.config,
      { persistence: false }
    );

    const results = scenarios.map((s, idx) => {
      const recorded = isolated.recordObservation({
        orderId: s.orderId || `sim-${Date.now()}-${idx}`,
        marketplaceKey: s.marketplaceKey || 'default',
        category: s.category,
        expected: s.expected,
        actual: s.actual,
        orderTotal: s.orderTotal || 0,
        source: 'simulation',
      });
      return {
        orderId: recorded.observation.orderId,
        deviations: recorded.deviations,
        totalDeviation:
          Math.round(
            recorded.deviations.reduce((sum, d) => sum + Math.abs(d.absoluteDiff), 0) * 100
          ) / 100,
      };
    });

    return { results, summary: isolated.getStats() };
  }

  // ── Sapma Hesaplama ───────────────────────────────────────

  /**
   * Tek bir gözlemin tüm metrikleri için sapmaları hesaplar.
   */
  calculateDeviations(observation: OrderObservation): Deviation[] {
    const metrics: Array<{
      key: 'commissionRate' | 'shippingCost' | 'returnRate' | 'discountRate' | 'advertisingCost';
      expected: number;
      actual: number;
    }> = [
      { key: 'commissionRate', expected: observation.expected.commissionRate, actual: observation.actual.commissionRate },
      { key: 'shippingCost', expected: observation.expected.shippingCost, actual: observation.actual.shippingCost },
      { key: 'returnRate', expected: observation.expected.returnRate, actual: observation.actual.returnRate },
      { key: 'discountRate', expected: observation.expected.discountRate, actual: observation.actual.discountRate },
      { key: 'advertisingCost', expected: observation.expected.advertisingCost, actual: observation.actual.advertisingCost },
    ];

    const deviations: Deviation[] = [];

    for (const m of metrics) {
      const absoluteDiff = m.actual - m.expected;
      const percentageDiff = m.expected !== 0
        ? Math.abs(absoluteDiff / Math.abs(m.expected)) * 100
        : (m.actual === 0 ? 0 : 100);

      // Eşiğin altındaki sapmaları yok say
      if (percentageDiff < this.config.deviationThreshold) {
        continue;
      }

      const direction: Deviation['direction'] = absoluteDiff > 0 ? 'over' : 'under';
      const severity = this.classifyDeviationSeverity(percentageDiff);

      deviations.push({
        id: `dev-${observation.id}-${m.key}`,
        observationId: observation.id ?? 'unknown',
        orderId: observation.orderId,
        marketplaceKey: observation.marketplaceKey,
        category: observation.category,
        source: observation.source ?? 'real',
        metric: m.key,
        expected: m.expected,
        actual: m.actual,
        absoluteDiff,
        percentageDiff,
        direction,
        severity,
        timestamp: observation.timestamp ?? new Date(),
      });
    }

    return deviations;
  }

  // ── Öğrenilen Bilgiler ────────────────────────────────────

  /**
   * Marketplace/kategori bazlı öğrenilen bilgileri döndürür.
   */
  getLearnedInsights(filters?: {
    marketplaceKey?: string;
    category?: string;
    metric?: string;
  }): LearnedInsight[] {
    let result = Array.from(this.insights.values());

    if (filters?.marketplaceKey) {
      result = result.filter(i => i.marketplaceKey === filters.marketplaceKey);
    }
    if (filters?.category) {
      result = result.filter(i => i.category === filters.category);
    }
    if (filters?.metric) {
      result = result.filter(i => i.metric === filters.metric);
    }

    return result.sort((a, b) => b.confidence - a.confidence);
  }

  // ── Uyarılar ──────────────────────────────────────────────

  /**
   * Akıllı uyarıları döndürür.
   */
  getAlerts(filters?: {
    severity?: LearningAlert['severity'];
    type?: LearningAlert['type'];
    marketplaceKey?: string;
    acknowledged?: boolean;
  }): LearningAlert[] {
    let result = [...this.alerts];

    if (filters?.severity) {
      result = result.filter(a => a.severity === filters.severity);
    }
    if (filters?.type) {
      result = result.filter(a => a.type === filters.type);
    }
    if (filters?.marketplaceKey) {
      result = result.filter(a => a.marketplaceKey === filters.marketplaceKey);
    }
    if (filters?.acknowledged !== undefined) {
      result = result.filter(a => a.acknowledged === filters.acknowledged);
    }

    return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Uyarıyı onaylandı olarak işaretle.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    this.persist();
    return true;
  }

  // ── Tahmin Doğruluğu ──────────────────────────────────────

  /**
   * Belirli bir metrik/marketplace/kategori için tahmin doğruluğunu hesaplar.
   * Dönüş: { accuracy, totalObservations, withinThreshold }
   */
  getPredictionAccuracy(filters?: {
    marketplaceKey?: string;
    category?: string;
    metric?: string;
  }): {
    accuracy: number;
    totalObservations: number;
    withinThreshold: number;
  } {
    // Filtreye uyan gözlemler (metrik gözlem seviyesinde filtrelenmez)
    const filteredObservations = this.observations.filter(o => {
      if (filters?.marketplaceKey && o.marketplaceKey !== filters.marketplaceKey) return false;
      if (filters?.category && o.category !== filters.category) return false;
      return true;
    });

    const totalObservations = filteredObservations.length;
    if (totalObservations === 0) {
      return { accuracy: 0, totalObservations: 0, withinThreshold: 0 };
    }

    // Sapması olan gözlemler (bu gözlemler "eşik dışı" sayılır)
    const allDeviations = this.getFilteredDeviations(filters);
    const obsWithDeviation = new Set(allDeviations.map(d => d.observationId));

    const withinThreshold = filteredObservations.filter(
      o => !obsWithDeviation.has(o.id ?? '')
    ).length;

    const accuracy = withinThreshold / totalObservations;

    return {
      accuracy: Math.round(accuracy * 1000) / 1000,
      totalObservations,
      withinThreshold,
    };
  }

  // ── Güvenli Öğrenilmiş Tahmin (Profit Engine Entegrasyonu) ─

  /**
   * Bir metrik için GÜVENLİ öğrenilmiş tahmin döndürür.
   *
   * Kural:
   * - Yeterli örnek yoksa (sampleCount < minSamples) veya güven düşükse
   *   useLearned = false → resmi/DB değeri kullanılmalı.
   * - Bu metot HİÇBİR finansal kaydı DEĞİŞTİRMEZ; sadece tavsiye döndürür.
   */
  getLearnedEstimate(
    marketplaceKey: string,
    metric: string,
    officialValue: number | null,
    category?: string
  ): {
    metric: string;
    marketplaceKey: string;
    category?: string;
    officialValue: number | null;
    learnedValue: number | null;
    sampleCount: number;
    confidence: number;
    status: LearnedInsight['status'] | 'none';
    useLearned: boolean;
    reason: string;
  } {
    const key = this.buildInsightKey(marketplaceKey, category, metric);
    const insight = this.insights.get(key);

    if (!insight) {
      return {
        metric, marketplaceKey, category,
        officialValue, learnedValue: null,
        sampleCount: 0, confidence: 0, status: 'none',
        useLearned: false,
        reason: 'Bu metrik için henüz gözlem yok. Resmi değer kullanılır.',
      };
    }

    const enoughSamples = insight.sampleCount >= this.config.minSamples;
    const enoughConfidence = insight.confidence >= 0.5;
    const useLearned = enoughSamples && enoughConfidence && insight.status !== 'emerging';

    let reason: string;
    if (!enoughSamples) {
      reason = `Yetersiz örnek (${insight.sampleCount}/${this.config.minSamples}). Resmi değer kullanılır.`;
    } else if (!enoughConfidence) {
      reason = `Güven düşük (${insight.confidence}). Resmi değer kullanılır.`;
    } else if (insight.status === 'emerging') {
      reason = 'Kural henüz olgunlaşmadı (emerging). Resmi değer kullanılır.';
    } else {
      reason = `Öğrenilmiş tahmin kullanılabilir (${insight.status}, ${insight.sampleCount} örnek, güven ${insight.confidence}). SADECE TAHMİN — resmi kayıt değişmez.`;
    }

    return {
      metric,
      marketplaceKey,
      category,
      officialValue,
      learnedValue: insight.learnedValue,
      sampleCount: insight.sampleCount,
      confidence: insight.confidence,
      status: insight.status,
      useLearned,
      reason,
    };
  }

  // ── İstatistikler ─────────────────────────────────────────

  /**
   * Genel istatistikleri döndürür.
   */
  getStats(): {
    totalObservations: number;
    totalDeviations: number;
    totalInsights: number;
    totalAlerts: number;
    unacknowledgedAlerts: number;
    avgConfidence: number;
    byMarketplace: Record<string, { observations: number; deviations: number; avgConfidence: number }>;
    byMetric: Record<string, { deviations: number; avgDeviationPercent: number }>;
    bySeverity: Record<string, number>;
    learningEngineStats: ReturnType<LearningEngine['getModelStats']>;
  } {
    const byMarketplace: Record<string, { observations: number; deviations: number; avgConfidence: number }> = {};
    const byMetric: Record<string, { deviations: number; avgDeviationPercent: number }> = {};
    const bySeverity: Record<string, number> = {};

    // Marketplace bazlı
    for (const obs of this.observations) {
      if (!byMarketplace[obs.marketplaceKey]) {
        byMarketplace[obs.marketplaceKey] = { observations: 0, deviations: 0, avgConfidence: 0 };
      }
      byMarketplace[obs.marketplaceKey].observations++;
    }

    for (const dev of this.deviations) {
      if (byMarketplace[dev.marketplaceKey]) {
        byMarketplace[dev.marketplaceKey].deviations++;
      }
      if (!byMetric[dev.metric]) {
        byMetric[dev.metric] = { deviations: 0, avgDeviationPercent: 0 };
      }
      byMetric[dev.metric].deviations++;
      byMetric[dev.metric].avgDeviationPercent += dev.percentageDiff;

      bySeverity[dev.severity] = (bySeverity[dev.severity] || 0) + 1;
    }

    // Ortalamaları hesapla
    for (const key of Object.keys(byMetric)) {
      if (byMetric[key].deviations > 0) {
        byMetric[key].avgDeviationPercent = Math.round(
          (byMetric[key].avgDeviationPercent / byMetric[key].deviations) * 100
        ) / 100;
      }
    }

    // Insight güven ortalaması
    const insightsArr = Array.from(this.insights.values());
    const avgConfidence = insightsArr.length > 0
      ? Math.round(
          (insightsArr.reduce((sum, i) => sum + i.confidence, 0) / insightsArr.length) * 1000
        ) / 1000
      : 0;

    // Marketplace güven ortalamaları
    for (const mpKey of Object.keys(byMarketplace)) {
      const mpInsights = insightsArr.filter(i => i.marketplaceKey === mpKey);
      byMarketplace[mpKey].avgConfidence = mpInsights.length > 0
        ? Math.round(
            (mpInsights.reduce((sum, i) => sum + i.confidence, 0) / mpInsights.length) * 1000
          ) / 1000
        : 0;
    }

    return {
      totalObservations: this.observations.length,
      totalDeviations: this.deviations.length,
      totalInsights: this.insights.size,
      totalAlerts: this.alerts.length,
      unacknowledgedAlerts: this.alerts.filter(a => !a.acknowledged).length,
      avgConfidence,
      byMarketplace,
      byMetric,
      bySeverity,
      learningEngineStats: this.learningEngine.getModelStats(),
    };
  }

  // ── Yardımcılar ───────────────────────────────────────────

  /**
   * Tüm gözlemleri döndürür.
   */
  getAllObservations(): OrderObservation[] {
    return [...this.observations];
  }

  /**
   * Tüm sapmaları döndürür.
   */
  getAllDeviations(): Deviation[] {
    return [...this.deviations];
  }

  /**
   * Belirli bir siparişin gözlemlerini döndürür.
   */
  getObservationsByOrder(orderId: string): OrderObservation[] {
    return this.observations.filter(o => o.orderId === orderId);
  }

  /**
   * Temizle (test/reset için).
   */
  clear(): void {
    this.observations = [];
    this.deviations = [];
    this.insights.clear();
    this.alerts = [];
    this.learningEngine.clearAllRules();
    this.persist();
  }

  // ── Özel metodlar ─────────────────────────────────────────

  private feedLearningEngine(observation: OrderObservation, deviations: Deviation[]): void {
    for (const dev of deviations) {
      const conditions: RuleCondition[] = [
        { field: 'marketplace', operator: 'eq', value: observation.marketplaceKey },
        { field: 'metric', operator: 'eq', value: dev.metric },
      ];

      if (observation.category) {
        conditions.push({ field: 'category', operator: 'eq', value: observation.category });
      }

      this.learningEngine.addSample(
        RuleType.CATEGORY_PATTERN,
        conditions,
        dev.actual,
        DataSource.LEARNED
      );
    }
  }

  private updateInsights(observation: OrderObservation, deviations: Deviation[]): LearnedInsight[] {
    const newInsights: LearnedInsight[] = [];

    for (const dev of deviations) {
      const insightKey = this.buildInsightKey(
        observation.marketplaceKey,
        observation.category,
        dev.metric
      );

      const existing = this.insights.get(insightKey);

      if (existing) {
        // Güncelle — ağırlıklı ortalama
        const totalCount = existing.sampleCount + 1;
        existing.learnedValue =
          (existing.learnedValue * existing.sampleCount + dev.actual) / totalCount;
        existing.sampleCount = totalCount;
        existing.lastSeen = observation.timestamp ?? new Date();
        existing.confidence = this.calculateConfidence(totalCount);

        // Durum güncelleme
        if (existing.officialValue !== null) {
          const deviationFromOfficial =
            Math.abs(existing.learnedValue - existing.officialValue) /
            Math.abs(existing.officialValue || 1) * 100;

          existing.deviationFromOfficial = Math.round(deviationFromOfficial * 100) / 100;

          if (deviationFromOfficial > this.config.deviationThreshold && existing.sampleCount >= this.config.minSamples) {
            existing.status = 'divergent';
          } else if (existing.sampleCount >= this.config.minSamples) {
            existing.status = 'confirmed';
          }
        }
      } else {
        const insight: LearnedInsight = {
          id: `insight-${insightKey}`,
          marketplaceKey: observation.marketplaceKey,
          category: observation.category,
          metric: dev.metric,
          officialValue: dev.expected,
          officialSource: 'system_default',
          learnedValue: dev.actual,
          deviationFromOfficial: dev.percentageDiff,
          sampleCount: 1,
          confidence: this.calculateConfidence(1),
          status: 'emerging',
          firstSeen: observation.timestamp ?? new Date(),
          lastSeen: observation.timestamp ?? new Date(),
        };
        this.insights.set(insightKey, insight);
        newInsights.push(insight);
      }
    }

    return newInsights;
  }

  private checkAlerts(observation: OrderObservation, deviations: Deviation[]): LearningAlert[] {
    const newAlerts: LearningAlert[] = [];

    // Tekrarlayan sapmaları kontrol et
    for (const dev of deviations) {
      const recentCount = this.deviations.filter(
        d =>
          d.marketplaceKey === dev.marketplaceKey &&
          d.metric === dev.metric &&
          d.direction === dev.direction &&
          Math.abs(d.timestamp.getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000 // son 30 gün
      ).length;

      if (recentCount >= this.config.recurringDeviationMinCount) {
        const existingKey = `${dev.marketplaceKey}:${dev.metric}:recurring_deviation`;
        const existingAlert = this.alerts.find(
          a => a.type === 'recurring_deviation' && a.metric === dev.metric && a.marketplaceKey === dev.marketplaceKey && !a.acknowledged
        );
        if (existingAlert) {
          existingAlert.severity = recentCount >= 5 ? 'critical' : 'warning';
          existingAlert.message = `${dev.marketplaceKey} marketplace'inde ${dev.metric} metriğinde ${recentCount} kez ${dev.direction === 'over' ? 'yukarı' : 'aşağı'} yönlü sapma tespit edildi.`;
          existingAlert.relatedObservationIds.push(observation.id ?? '');
          existingAlert.timestamp = new Date();
        } else {
          const alert: LearningAlert = {
            id: `alert-recurring-${dev.marketplaceKey}-${dev.metric}`,
            type: 'recurring_deviation',
            severity: recentCount >= 5 ? 'critical' : 'warning',
            marketplaceKey: dev.marketplaceKey,
            category: dev.category,
            metric: dev.metric,
            title: `Tekrarlayan sapma: ${dev.metric}`,
            message: `${dev.marketplaceKey} marketplace'inde ${dev.metric} metriğinde ${recentCount} kez ${dev.direction === 'over' ? 'yukarı' : 'aşağı'} yönlü sapma tespit edildi.`,
            relatedObservationIds: [observation.id ?? ''],
            recommendation: this.generateRecommendation(dev, recentCount),
            acknowledged: false,
            timestamp: new Date(),
          };
          this.alerts.push(alert);
        }
      }
    }

    // Çakışan kuralları kontrol et (farklı marketplace'lerden gelen insight'lar)
    if (observation.category) {
      const categoryInsights = this.getLearnedInsights({ category: observation.category });
      const metricsSeen = new Set<string>();

      for (const insight of categoryInsights) {
        if (metricsSeen.has(insight.metric)) continue;
        metricsSeen.add(insight.metric);

        const marketplaceValues = categoryInsights
          .filter(i => i.metric === insight.metric && i.sampleCount >= this.config.minSamples)
          .map(i => ({ marketplace: i.marketplaceKey, value: i.learnedValue }));

        if (marketplaceValues.length >= 2) {
          const values = marketplaceValues.map(mv => mv.value);
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const maxDev = Math.max(...values.map(v => Math.abs(v - avg) / (Math.abs(avg) || 1) * 100));

          if (maxDev > this.config.deviationThreshold * 2) {
            const alert: LearningAlert = {
              id: `alert-conflict-${Date.now()}-${insight.metric}`,
              type: 'rule_conflict',
              severity: 'warning',
              marketplaceKey: observation.marketplaceKey,
              category: observation.category,
              metric: insight.metric,
              title: `Pazar yeri farkı: ${insight.metric}`,
              message: `${observation.category} kategorisinde ${insight.metric} metriği için marketplace'ler arasında %${maxDev.toFixed(1)} fark var.`,
              relatedObservationIds: [],
              recommendation: 'Farklı marketplace politikalarını gözden geçirin.',
              acknowledged: false,
              timestamp: new Date(),
            };
            this.alerts.push(alert);
          }
        }
      }
    }

    return newAlerts;
  }

  private calculateConfidence(sampleCount: number): number {
    if (sampleCount < this.config.minSamples) {
      // minSamples'a ulaşana kadar lineer artış
      return Math.round((sampleCount / this.config.minSamples) * 0.5 * 1000) / 1000;
    }
    // minSamples sonrası asimptotik artış — max ~0.95
    const base = 0.5;
    const bonus = 0.45 * (1 - Math.exp(-(sampleCount - this.config.minSamples) / (this.config.minSamples * 2)));
    return Math.round((base + bonus) * 1000) / 1000;
  }

  private classifyDeviationSeverity(percentageDiff: number): Deviation['severity'] {
    if (percentageDiff > 100) return 'critical';
    if (percentageDiff > 50) return 'high';
    if (percentageDiff > 25) return 'medium';
    return 'low';
  }

  private buildInsightKey(marketplaceKey: string, category: string | undefined, metric: string): string {
    return `${marketplaceKey}:${category ?? 'all'}:${metric}`;
  }

  private generateRecommendation(dev: Deviation, count: number): string {
    if (count >= 5) {
      return `${dev.metric} metriğinde kalıcı bir sapma var. Resmi oranların güncellenip güncellenmediğini kontrol edin. Gerekirse manuel onay ile kural güncellemesi yapın.`;
    }
    if (dev.direction === 'over') {
      return `${dev.metric} beklenenden yüksek. Olası nedenleri inceleyin: ek komisyon, kargo farkı veya kampanya etkisi.`;
    }
    return `${dev.metric} beklenenden düşük. Olumlu bir sapma olabilir ancak kalıbı doğrulamak için daha fazla gözlem gerekir.`;
  }

  private getFilteredDeviations(filters?: {
    marketplaceKey?: string;
    category?: string;
    metric?: string;
  }): Deviation[] {
    let result = this.deviations;
    if (filters?.marketplaceKey) {
      result = result.filter(d => d.marketplaceKey === filters.marketplaceKey);
    }
    if (filters?.category) {
      result = result.filter(d => d.category === filters.category);
    }
    if (filters?.metric) {
      result = result.filter(d => d.metric === filters.metric);
    }
    return result;
  }
}

export default CommercialLearningEngine;
