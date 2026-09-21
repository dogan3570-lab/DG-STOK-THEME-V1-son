// ============================================================
// ÖĞRENEN SİSTEM MOTORU
// ============================================================

import { 
  LearnedRule, 
  RuleType, 
  RuleCondition,
  DataSource 
} from '../../shared/types';

export interface LearningConfig {
  minConfidence: number; // Minimum güven seviyesi (0-1)
  minSamples: number; // Öğrenme için minimum örnek sayısı
  maxAge: number; // Gün cinsinden maksimum kural yaşı
  backtestThreshold: number; // Geriye dönük test eşiği
}

const DEFAULT_CONFIG: LearningConfig = {
  minConfidence: 0.7,
  minSamples: 10,
  maxAge: 90, // 90 gün
  backtestThreshold: 0.8 // %80 doğruluk gerekli
};

/**
 * Öğrenme Motoru
 * AI model tahminleri YAPMAZ, sadece gerçek veriden öğrenir
 */
export class LearningEngine {
  
  private config: LearningConfig;
  private rules: Map<string, LearnedRule> = new Map();
  private historicalSamples: Map<string, any[]> = new Map();
  
  constructor(config: Partial<LearningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Yeni veri noktası ekle
   */
  addSample(
    type: RuleType,
    conditions: RuleCondition[],
    result: number,
    source: DataSource
  ): void {
    const ruleId = this.generateRuleId(type, conditions);
    
    // Örnekleri sakla
    if (!this.historicalSamples.has(ruleId)) {
      this.historicalSamples.set(ruleId, []);
    }
    
    this.historicalSamples.get(ruleId)!.push({
      conditions,
      result,
      source,
      timestamp: new Date()
    });
    
    // Yeterli örnek varsa kural güncelle
    const samples = this.historicalSamples.get(ruleId)!;
    if (samples.length >= this.config.minSamples) {
      this.updateRule(ruleId, type, conditions, samples);
    }
  }
  
  /**
   * Kural güncelle (yeni öğrenilen değer)
   */
  private updateRule(
    ruleId: string,
    type: RuleType,
    conditions: RuleCondition[],
    samples: any[]
  ): void {
    const existingRule = this.rules.get(ruleId);
    
    // Ortalama hesapla
    const avgResult = samples.reduce((sum, s) => sum + s.result, 0) / samples.length;
    
    // Güven skoru hesapla (standart sapma ile)
    const variance = samples.reduce((sum, s) => {
      const diff = s.result - avgResult;
      return sum + (diff * diff);
    }, 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    
    // Varyasyon katsayısı (CV) ne kadar düşükse güven o kadar yüksek
    const cv = avgResult !== 0 ? Math.abs(stdDev / avgResult) : 1;
    const confidence = Math.max(0, Math.min(1, 1 - cv));
    
    const newRule: LearnedRule = {
      ruleId,
      type,
      source: DataSource.LEARNED,
      conditions,
      result: avgResult,
      sampleCount: samples.length,
      firstSeen: existingRule?.firstSeen || new Date(),
      lastSeen: new Date(),
      confidence,
      previousValue: existingRule?.result,
      newValue: avgResult,
      verified: false,
      active: true
    };
    
    // Yeni kural güven eşiğini geçiyorsa kaydet
    if (confidence >= this.config.minConfidence) {
      this.rules.set(ruleId, newRule);
    }
  }
  
  /**
   * Kural ID oluştur
   */
  private generateRuleId(type: RuleType, conditions: RuleCondition[]): string {
    const conditionStr = conditions
      .map(c => `${c.field}-${c.operator}-${c.value}`)
      .join('|');
    return `${type}:${conditionStr}`;
  }
  
  /**
   * Kural sorgula
   */
  getRule(type: RuleType, conditions: RuleCondition[]): LearnedRule | null {
    const ruleId = this.generateRuleId(type, conditions);
    return this.rules.get(ruleId) || null;
  }
  
  /**
   * Tüm kuralları getir
   */
  getAllRules(): LearnedRule[] {
    return Array.from(this.rules.values());
  }
  
  /**
   * Aktif kuralları getir
   */
  getActiveRules(): LearnedRule[] {
    return this.getAllRules().filter(r => r.active);
  }
  
  /**
   * Belirli tipe ait kuralları getir
   */
  getRulesByType(type: RuleType): LearnedRule[] {
    return this.getAllRules().filter(r => r.type === type);
  }
  
  /**
   * Kural doğrula (gerçek veri ile test et)
   */
  verifyRule(ruleId: string, actualValue: number): {
    verified: boolean;
    accuracy: number;
    isReliable: boolean;
  } {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return { verified: false, accuracy: 0, isReliable: false };
    }
    
    const tolerance = 0.1; // %10 tolerans
    const diff = Math.abs(actualValue - rule.result);
    const diffPercent = rule.result !== 0 ? diff / Math.abs(rule.result) : 0;
    
    const accuracy = diffPercent <= tolerance ? 1 - diffPercent : 0;
    const isReliable = accuracy >= this.config.backtestThreshold;
    
    // Doğrulama sonucunu kaydet
    rule.verified = isReliable;
    
    return { verified: isReliable, accuracy, isReliable };
  }
  
  /**
   * Yeni öğrenme eski sistemi bozuyor mu kontrol et
   */
  checkRegression(
    ruleId: string,
    historicalResults: number[]
  ): {
    hasRegression: boolean;
    oldAccuracy: number;
    newAccuracy: number;
    shouldRevert: boolean;
  } {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.previousValue) {
      return { hasRegression: false, oldAccuracy: 0, newAccuracy: 0, shouldRevert: false };
    }
    
    const tolerance = 0.1;
    
    // Eski kural doğruluğu
    const oldDiff = historicalResults.map(v => {
      const diff = Math.abs(v - rule.previousValue!);
      const diffPercent = rule.previousValue! !== 0 ? diff / Math.abs(rule.previousValue!) : 0;
      return diffPercent <= tolerance ? 1 : 0;
    });
    const oldAccuracy = oldDiff.reduce((a: number, b: number) => a + b, 0) / historicalResults.length;
    
    // Yeni kural doğruluğu
    const newDiff = historicalResults.map(v => {
      const diff = Math.abs(v - rule.result);
      const diffPercent = rule.result !== 0 ? diff / Math.abs(rule.result) : 0;
      return diffPercent <= tolerance ? 1 : 0;
    });
    const newAccuracy = newDiff.reduce((a: number, b: number) => a + b, 0) / historicalResults.length;
    
    const hasRegression = newAccuracy < oldAccuracy;
    const regressionThreshold = 0.05; // %5 düşüş = regresyon
    
    return {
      hasRegression,
      oldAccuracy,
      newAccuracy,
      shouldRevert: hasRegression && (oldAccuracy - newAccuracy) > regressionThreshold
    };
  }
  
  /**
   * Regresyon tespit edilirse geri al
   */
  revertRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.previousValue) {
      return false;
    }
    
    rule.result = rule.previousValue;
    rule.previousValue = undefined;
    rule.newValue = undefined;
    rule.lastSeen = new Date();
    
    return true;
  }
  
  /**
   * Model güven istatistikleri
   */
  getModelStats(): {
    totalRules: number;
    activeRules: number;
    avgConfidence: number;
    byType: Record<RuleType, number>;
    verifiedRules: number;
    lastUpdated: Date;
  } {
    const rules = this.getAllRules();
    
    const byType: Record<RuleType, number> = {
      [RuleType.COMMISSION_RATE]: 0,
      [RuleType.SHIPPING_COST]: 0,
      [RuleType.RETURN_RATE]: 0,
      [RuleType.DISCOUNT_BEHAVIOR]: 0,
      [RuleType.ADVERTISING_COST]: 0,
      [RuleType.CATEGORY_PATTERN]: 0
    };
    
    let totalConfidence = 0;
    rules.forEach(r => {
      byType[r.type]++;
      totalConfidence += r.confidence;
    });
    
    return {
      totalRules: rules.length,
      activeRules: rules.filter(r => r.active).length,
      avgConfidence: rules.length > 0 ? totalConfidence / rules.length : 0,
      byType,
      verifiedRules: rules.filter(r => r.verified).length,
      lastUpdated: new Date()
    };
  }
  
  /**
   * Kuralı sil
   */
  deleteRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }
  
  /**
   * Tüm kuralları temizle
   */
  clearAllRules(): void {
    this.rules.clear();
    this.historicalSamples.clear();
  }
}

export default LearningEngine;
