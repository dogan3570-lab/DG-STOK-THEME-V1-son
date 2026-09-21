// ============================================================
// ANOMALİ TESPİT MOTORU
// ============================================================

import { 
  Anomaly, 
  AnomalyType, 
  AnomalySeverity,
  ProfitResult,
  CommissionRate
} from '../../shared/types';

export interface AnomalyConfig {
  commissionTolerance: number; // yüzde (örn: 5 = %5 tolerans)
  shippingTolerance: number;
  returnTolerance: number;
  discountTolerance: number;
  minSampleCount: number;
}

const DEFAULT_CONFIG: AnomalyConfig = {
  commissionTolerance: 5, // %5 tolerans
  shippingTolerance: 10, // %10 tolerans
  returnTolerance: 15, // %15 tolerans
  discountTolerance: 20, // %20 tolerans
  minSampleCount: 5 // en az 5 örnek
};

/**
 * Anomali tespit motoru
 */
export class AnomalyDetector {
  
  private config: AnomalyConfig;
  private historicalData: Map<string, number[]> = new Map();
  
  constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Komisyon anomalisi kontrol et
   */
  detectCommissionAnomaly(
    expectedRate: number,
    actualRate: number,
    orderId: string,
    marketplaceKey: string
  ): Anomaly | null {
    const difference = actualRate - expectedRate;
    const percentageDiff = expectedRate > 0 ? Math.abs(difference / expectedRate) * 100 : 0;
    
    // Tolerans kontrolü (mutlak fark)
    if (Math.abs(difference) < this.config.commissionTolerance) {
      return null;
    }
    
    // Severity belirleme
    const severity = this.getSeverity(percentageDiff);
    
    return {
      id: `anomaly-commission-${Date.now()}`,
      type: AnomalyType.COMMISSION,
      severity,
      expected: expectedRate,
      actual: actualRate,
      difference,
      percentageDiff,
      source: 'AnomalyDetector',
      orderId,
      marketplaceKey,
      date: new Date(),
      details: `Beklenen komisyon: %${expectedRate.toFixed(2)}, Gerçek: %${actualRate.toFixed(2)}, Fark: %${difference.toFixed(2)}`,
      resolved: false
    };
  }
  
  /**
   * Kargo anomalisi kontrol et
   */
  detectShippingAnomaly(
    expectedCost: number,
    actualCost: number,
    orderId: string,
    marketplaceKey: string
  ): Anomaly | null {
    const difference = actualCost - expectedCost;
    const percentageDiff = expectedCost > 0 ? Math.abs(difference / expectedCost) * 100 : 0;
    
    if (Math.abs(difference) < this.config.shippingTolerance) {
      return null;
    }
    
    const severity = this.getSeverity(percentageDiff);
    
    return {
      id: `anomaly-shipping-${Date.now()}`,
      type: AnomalyType.SHIPPING,
      severity,
      expected: expectedCost,
      actual: actualCost,
      difference,
      percentageDiff,
      source: 'AnomalyDetector',
      orderId,
      marketplaceKey,
      date: new Date(),
      details: `Beklenen kargo: ${expectedCost.toFixed(2)} TL, Gerçek: ${actualCost.toFixed(2)} TL, Fark: ${difference.toFixed(2)} TL`,
      resolved: false
    };
  }
  
  /**
   * İade anomalisi kontrol et
   */
  detectReturnAnomaly(
    expectedReturnRate: number,
    actualReturnRate: number,
    productId: string,
    marketplaceKey: string
  ): Anomaly | null {
    const difference = actualReturnRate - expectedReturnRate;
    const percentageDiff = expectedReturnRate > 0 ? Math.abs(difference / expectedReturnRate) * 100 : 0;
    
    if (Math.abs(difference) < this.config.returnTolerance) {
      return null;
    }
    
    const severity = this.getSeverity(percentageDiff);
    
    return {
      id: `anomaly-return-${Date.now()}`,
      type: AnomalyType.RETURN,
      severity,
      expected: expectedReturnRate,
      actual: actualReturnRate,
      difference,
      percentageDiff,
      source: 'AnomalyDetector',
      sourceId: productId,
      marketplaceKey,
      date: new Date(),
      details: `Beklenen iade oranı: %${expectedReturnRate.toFixed(2)}, Gerçek: %${actualReturnRate.toFixed(2)}, Fark: %${difference.toFixed(2)}`,
      resolved: false
    };
  }
  
  /**
   * Fiyat anomalisi kontrol et
   */
  detectPriceAnomaly(
    expectedPrice: number,
    actualPrice: number,
    productId: string
  ): Anomaly | null {
    const difference = actualPrice - expectedPrice;
    const percentageDiff = expectedPrice > 0 ? Math.abs(difference / expectedPrice) * 100 : 0;
    
    // %50 den fazla fark = anomali
    if (percentageDiff <= 50) {
      return null;
    }
    
    const severity = this.getSeverity(percentageDiff);
    
    return {
      id: `anomaly-price-${Date.now()}`,
      type: AnomalyType.PRICING,
      severity,
      expected: expectedPrice,
      actual: actualPrice,
      difference,
      percentageDiff,
      source: 'AnomalyDetector',
      sourceId: productId,
      date: new Date(),
      details: `Beklenen fiyat: ${expectedPrice.toFixed(2)} TL, Gerçek: ${actualPrice.toFixed(2)} TL, Fark: %${percentageDiff.toFixed(2)}`,
      resolved: false
    };
  }
  
  /**
   * Kâr anomalisi kontrol et (beklenen kâr ile gerçek kâr arasında ciddi fark)
   */
  detectProfitAnomaly(
    expectedProfit: number,
    actualProfit: number,
    orderId: string
  ): Anomaly | null {
    const difference = actualProfit - expectedProfit;
    const percentageDiff = Math.abs(expectedProfit) > 0 
      ? Math.abs(difference / Math.abs(expectedProfit)) * 100 
      : 0;
    
    // %100 den fazla fark = anomali
    if (percentageDiff <= 100) {
      return null;
    }
    
    const severity = this.getSeverity(percentageDiff);
    
    return {
      id: `anomaly-profit-${Date.now()}`,
      type: AnomalyType.SALES,
      severity,
      expected: expectedProfit,
      actual: actualProfit,
      difference,
      percentageDiff,
      source: 'AnomalyDetector',
      orderId,
      date: new Date(),
      details: `Beklenen kâr: ${expectedProfit.toFixed(2)} TL, Gerçek: ${actualProfit.toFixed(2)} TL`,
      resolved: false
    };
  }
  
  /**
   * Toplu anomali kontrolü
   */
  detectAllAnomalies(
    orderId: string,
    marketplaceKey: string,
    expected: {
      commissionRate?: number;
      actualCommissionRate?: number;
      shippingCost?: number;
      actualShippingCost?: number;
      returnRate?: number;
      actualReturnRate?: number;
      price?: number;
      actualPrice?: number;
      profit?: number;
      actualProfit?: number;
    }
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    
    if (expected.commissionRate !== undefined && expected.actualCommissionRate !== undefined) {
      const anomaly = this.detectCommissionAnomaly(
        expected.commissionRate,
        expected.actualCommissionRate,
        orderId,
        marketplaceKey
      );
      if (anomaly) anomalies.push(anomaly);
    }
    
    if (expected.shippingCost !== undefined && expected.actualShippingCost !== undefined) {
      const anomaly = this.detectShippingAnomaly(
        expected.shippingCost,
        expected.actualShippingCost,
        orderId,
        marketplaceKey
      );
      if (anomaly) anomalies.push(anomaly);
    }
    
    return anomalies;
  }
  
  /**
   * Severity belirleme
   */
  private getSeverity(percentageDiff: number): AnomalySeverity {
    if (percentageDiff > 100) return AnomalySeverity.CRITICAL;
    if (percentageDiff > 50) return AnomalySeverity.HIGH;
    if (percentageDiff > 25) return AnomalySeverity.MEDIUM;
    return AnomalySeverity.LOW;
  }
  
  /**
   * Anomalileri raporla
   */
  generateAnomalyReport(anomalies: Anomaly[]): {
    total: number;
    byType: Record<AnomalyType, number>;
    bySeverity: Record<AnomalySeverity, number>;
    critical: Anomaly[];
    unresolved: Anomaly[];
  } {
    const byType: Record<AnomalyType, number> = {
      [AnomalyType.COMMISSION]: 0,
      [AnomalyType.SHIPPING]: 0,
      [AnomalyType.RETURN]: 0,
      [AnomalyType.DISCOUNT]: 0,
      [AnomalyType.SALES]: 0,
      [AnomalyType.COST]: 0,
      [AnomalyType.PRICING]: 0
    };
    
    const bySeverity: Record<AnomalySeverity, number> = {
      [AnomalySeverity.LOW]: 0,
      [AnomalySeverity.MEDIUM]: 0,
      [AnomalySeverity.HIGH]: 0,
      [AnomalySeverity.CRITICAL]: 0
    };
    
    anomalies.forEach(a => {
      byType[a.type]++;
      bySeverity[a.severity]++;
    });
    
    return {
      total: anomalies.length,
      byType,
      bySeverity,
      critical: anomalies.filter(a => a.severity === AnomalySeverity.CRITICAL),
      unresolved: anomalies.filter(a => !a.resolved)
    };
  }
}

export default AnomalyDetector;
