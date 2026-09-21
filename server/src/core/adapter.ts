// ============================================================
// PROFIT ENGINE - ADAPTER (BACKWARD COMPATIBILITY)
// ============================================================
// Bu adapter eski number-based API'yi yeni BigInt cents API'sine bağlar.
// Finansal hesaplamalarda FLOAT KULLANMAZ.
// Sadece giriş/çıkış dönüşümünde deterministic cents→BigInt kullanır.

import { 
  ProfitCalculator, 
  CommissionCalculator, 
  VatCalculator, 
  MarginCalculator,
  floatToCents,
  centsToFloat,
  serializeCents,
  parseFloatToCents,
  checkInt64Range,
  INT64_MAX,
  INT64_MIN,
  GOLDEN_TESTS_BIGINT,
  CALCULATOR_VERSION
} from './calculator';
import { 
  TestInput, 
  ProfitResult, 
  DataSource, 
  DataSourceInfo,
  TestInputBigInt,
  ProfitResultBigInt,
  CalculationLineageBigInt
} from '../shared/types';

/**
 * Eski number-based TestInput'u yeni BigInt cents TestInputBigInt'e dönüştürür.
 * Commercial rounding kullanarak deterministic cents dönüşümü yapar.
 */
export function toTestInputBigInt(input: TestInput): {
  grossSalesCents: bigint;
  discountCents: bigint;
  productCostCents: bigint;
  commissionCents: bigint;
  shippingCostCents: bigint;
  serviceFeeCents: bigint;
  stopajCents: bigint;
  advertisingCents: bigint;
  marketingCents: bigint;
  returnCostCents: bigint;
  otherExpensesCents: bigint;
  vatRate: number;
} {
  return {
    grossSalesCents: floatToCents(input.grossSales),
    discountCents: floatToCents(input.discount),
    productCostCents: floatToCents(input.productCost),
    commissionCents: floatToCents(input.commission),
    shippingCostCents: floatToCents(input.shippingCost),
    serviceFeeCents: floatToCents(input.serviceFee),
    stopajCents: floatToCents(input.stopaj),
    advertisingCents: floatToCents(input.advertising),
    marketingCents: floatToCents(input.marketing),
    returnCostCents: floatToCents(input.returnCost),
    otherExpensesCents: floatToCents(input.otherExpenses),
    vatRate: input.vatRate
  };
}

/**
 * Yeni BigInt cents ProfitResultBigInt'i eski number-based ProfitResult'a dönüştürür.
 * Sadece görüntüleme/serialization için float'a çevirir.
 * Hesaplama BIGINT'te yapılmıştır, sadece gösterim için float'a çevrilir.
 */
export function toProfitResult(resultBigInt: any): ProfitResult {
  return {
    grossSales: centsToFloat(resultBigInt.grossSalesCents),
    discount: centsToFloat(resultBigInt.discountCents),
    netSales: centsToFloat(resultBigInt.netSalesCents),
    productCost: centsToFloat(resultBigInt.productCostCents),
    commission: centsToFloat(resultBigInt.commissionCents),
    shippingCost: centsToFloat(resultBigInt.shippingCostCents),
    serviceFee: centsToFloat(resultBigInt.serviceFeeCents),
    stopaj: centsToFloat(resultBigInt.stopajCents),
    advertising: centsToFloat(resultBigInt.advertisingCents),
    marketing: centsToFloat(resultBigInt.marketingCents),
    returnCost: centsToFloat(resultBigInt.returnCostCents),
    otherExpenses: centsToFloat(resultBigInt.otherExpensesCents),
    vatPayable: resultBigInt.vatPayableCents !== null ? centsToFloat(resultBigInt.vatPayableCents) : 0,
    operationalProfit: centsToFloat(resultBigInt.operationalProfitCents),
    netProfit: centsToFloat(resultBigInt.netProfitCents),
    profitMargin: resultBigInt.profitMargin,
    roi: resultBigInt.roi,
    currency: resultBigInt.currency,
    calculationVersion: resultBigInt.calculationVersion,
    calculatedAt: resultBigInt.calculatedAt,
    source: resultBigInt.source,
    lineage: resultBigInt.lineage?.map((l: any) => ({
      field: l.field,
      value: typeof l.value === 'bigint' ? Number(l.value) / 100 : l.value,
      source: l.source,
      sourceId: l.sourceId,
      formula: l.formula,
      timestamp: l.timestamp,
      calculatorVersion: l.calculatorVersion
    })) || []
  };
}

/**
 * Adapter sınıfı - Eski API'yi yeni BigInt calculator'a bağlar.
 * Finansal hesaplamada FLOAT KULLANMAZ.
 * Sadece giriş/çıkış dönüşümünde deterministic cents→BigInt kullanır.
 */
export class ProfitCalculatorAdapter {
  /**
   * Eski TestInput ile hesapla, eski ProfitResult döndür.
   * İçerde BigInt cents calculator kullanılır.
   */
  static calculate(input: TestInput, source: DataSourceInfo): ProfitResult {
    const inputBigInt = {
      grossSalesCents: floatToCents(input.grossSales),
      discountCents: floatToCents(input.discount),
      productCostCents: floatToCents(input.productCost),
      commissionCents: floatToCents(input.commission),
      shippingCostCents: floatToCents(input.shippingCost),
      serviceFeeCents: floatToCents(input.serviceFee),
      stopajCents: floatToCents(input.stopaj),
      advertisingCents: floatToCents(input.advertising),
      marketingCents: floatToCents(input.marketing),
      returnCostCents: floatToCents(input.returnCost),
      otherExpensesCents: floatToCents(input.otherExpenses),
      vatRate: input.vatRate
    };
    
    const sourceInfo = {
      source: source.source,
      sourceId: source.sourceId,
      timestamp: source.timestamp,
      confidence: source.confidence
    };
    
    // Gerçek BigInt calculator'ı kullan
    const resultBigInt = ProfitCalculator.calculate(inputBigInt, sourceInfo);
    return toProfitResult(resultBigInt);
  }
  
  /**
   * Basit hesaplama - eski API
   */
  static calculateSimple(
    grossSales: number,
    productCost: number,
    commission: number,
    shippingCost: number,
    otherCosts: number = 0
  ): { netProfit: number; profitMargin: number } {
    const result = ProfitCalculator.calculateSimple(
      floatToCents(grossSales),
      floatToCents(productCost),
      floatToCents(commission),
      floatToCents(shippingCost),
      floatToCents(otherCosts)
    );
    return {
      netProfit: centsToFloat(result.netProfitCents),
      profitMargin: result.profitMargin
    };
  }
}

/**
 * Komisyon hesaplayıcı adapter
 */
export class CommissionCalculatorAdapter {
  static calculate(amount: number, rate: number): number {
    const amountCents = floatToCents(amount);
    const resultCents = CommissionCalculator.calculate(amountCents, rate);
    return centsToFloat(resultCents);
  }
}

/**
 * KDV hesaplayıcı adapter
 */
export class VatCalculatorAdapter {
  static extractVat(inclusivePrice: number, vatRate: number): { netPrice: number; vatAmount: number } {
    const priceCents = floatToCents(inclusivePrice);
    const { netPriceCents, vatAmountCents } = VatCalculator.extractVat(priceCents, vatRate);
    return {
      netPrice: centsToFloat(netPriceCents),
      vatAmount: centsToFloat(vatAmountCents)
    };
  }
  
  static addVat(exclusivePrice: number, vatRate: number): { grossPrice: number; vatAmount: number } {
    const priceCents = floatToCents(exclusivePrice);
    const { grossPriceCents, vatAmountCents } = VatCalculator.addVat(priceCents, vatRate);
    return {
      grossPrice: centsToFloat(grossPriceCents),
      vatAmount: centsToFloat(vatAmountCents)
    };
  }
}

/**
 * Marj hesaplayıcı adapter
 */
export class MarginCalculatorAdapter {
  static calculateMargin(salePrice: number, cost: number): { margin: number; markup: number; grossProfit: number } {
    const saleCents = floatToCents(salePrice);
    const costCents = floatToCents(cost);
    const { margin, markup, grossProfitCents } = MarginCalculator.calculateMargin(saleCents, costCents);
    return {
      margin,
      markup,
      grossProfit: centsToFloat(grossProfitCents)
    };
  }
  
  static calculatePriceForMargin(cost: number, targetMargin: number, vatRate: number = 0): { priceExVat: number; priceIncVat: number } {
    const costCents = floatToCents(cost);
    const { priceExVatCents, priceIncVatCents } = MarginCalculator.calculatePriceForMargin(costCents, targetMargin, vatRate);
    return {
      priceExVat: centsToFloat(priceExVatCents),
      priceIncVat: centsToFloat(priceIncVatCents)
    };
  }
}

// Re-export gerçek calculator'lar (yeni API için)
export { 
  ProfitCalculator, 
  CommissionCalculator, 
  VatCalculator, 
  MarginCalculator,
  GOLDEN_TESTS_BIGINT as GOLDEN_TESTS,
  CALCULATOR_VERSION
} from './calculator';

export { 
  floatToCents,
  centsToFloat,
  serializeCents,
  parseFloatToCents,
  checkInt64Range,
  INT64_MAX,
  INT64_MIN
};