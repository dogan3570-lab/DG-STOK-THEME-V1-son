// ============================================================
// PROFIT ENGINE - HESAPLAMA MOTORLARI (BIGINT CENTS)
// ============================================================

import { 
  DataSource, 
  DataSourceInfo,
  floatToCents,
  centsToFloat,
  serializeCents,
  parseFloatToCents,
  checkInt64Range,
  INT64_MAX,
  INT64_MIN,
  rateToBasisPoints,
  divRound,
  calculateMargin,
  calculateROI
} from '../../shared/types';

export const CALCULATOR_VERSION = 'v2.0.0';

export function percentageOf(base: bigint, rate: number): bigint {
  if (rate === 0) return 0n;
  const rateBps = rateToBasisPoints(rate);
  // result = base * rateBps / 10000
  const product = base * rateBps;
  return product / 10000n;
}

// ============================================================
// KDV HESAPLAYICI (BIGINT)
// ============================================================

export class VatCalculator {
  static extractVat(inclusivePriceCents: bigint, vatRate: number): { netPriceCents: bigint; vatAmountCents: bigint } {
    if (inclusivePriceCents < 0n) {
      return { netPriceCents: -inclusivePriceCents, vatAmountCents: 0n };
    }
    if (vatRate <= 0) {
      return { netPriceCents: inclusivePriceCents, vatAmountCents: 0n };
    }
    if (inclusivePriceCents === 0n) {
      return { netPriceCents: 0n, vatAmountCents: 0n };
    }
    const rateBps = rateToBasisPoints(vatRate);
    const divisor = 10000n + rateBps;
    const netPriceCents = (inclusivePriceCents * 10000n) / divisor;
    const vatAmountCents = inclusivePriceCents - netPriceCents;
    return { netPriceCents, vatAmountCents };
  }

  static addVat(exclusivePriceCents: bigint, vatRate: number): { grossPriceCents: bigint; vatAmountCents: bigint } {
    if (exclusivePriceCents < 0n) {
      return { grossPriceCents: -exclusivePriceCents, vatAmountCents: 0n };
    }
    if (vatRate <= 0) {
      return { grossPriceCents: exclusivePriceCents, vatAmountCents: 0n };
    }
    if (exclusivePriceCents === 0n) {
      return { grossPriceCents: 0n, vatAmountCents: 0n };
    }
    const vatAmountCents = percentageOf(exclusivePriceCents, vatRate);
    const grossPriceCents = exclusivePriceCents + vatAmountCents;
    return { grossPriceCents, vatAmountCents };
  }
}

// ============================================================
// MARJ HESAPLAYICI (BIGINT)
// ============================================================

export class MarginCalculator {
  static calculateMargin(salePriceCents: bigint, costCents: bigint): {
    margin: number;
    markup: number;
    grossProfitCents: bigint;
  } {
    if (salePriceCents <= 0n) {
      return { margin: 0, markup: 0, grossProfitCents: 0n };
    }
    const grossProfitCents = salePriceCents - costCents;
    const margin = Number((grossProfitCents * 10000n) / salePriceCents) / 100;
    const markup = costCents > 0n ? Number((grossProfitCents * 10000n) / costCents) / 100 : 0;
    return { margin, markup, grossProfitCents };
  }

  static calculatePriceForMargin(costCents: bigint, targetMargin: number, vatRate: number = 0): {
    priceExVatCents: bigint;
    priceIncVatCents: bigint;
  } {
    if (costCents <= 0n || targetMargin < 0 || targetMargin >= 100) {
      return { priceExVatCents: 0n, priceIncVatCents: 0n };
    }
    const marginBps = rateToBasisPoints(targetMargin);
    // price_ex_vat = cost * 10000 / (10000 - marginBps) rounded
    const divisor = 10000n - marginBps;
    const priceExVat = divRound(costCents * 10000n, divisor);
    let priceIncVatCents = priceExVat;
    if (vatRate > 0) {
      const vatAmount = percentageOf(priceExVat, vatRate);
      priceIncVatCents = priceExVat + vatAmount;
    }
    return { priceExVatCents: priceExVat, priceIncVatCents: priceIncVatCents };
  }
}

// ============================================================
// KOMİSYON HESAPLAYICI (BIGINT)
// ============================================================

export class CommissionCalculator {
  static calculate(amountCents: bigint, rate: number): bigint {
    if (amountCents <= 0n || rate <= 0) return 0n;
    if (rate >= 100) return amountCents;
    return percentageOf(amountCents, rate);
  }
}

// ============================================================
// KÂR/ZARAR HESAPLAYICI (BIGINT)
// ============================================================

export class ProfitCalculator {
  static calculate(
    input: {
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
    },
    source: DataSourceInfo
  ): {
    grossSalesCents: bigint;
    discountCents: bigint;
    netSalesCents: bigint;
    productCostCents: bigint;
    commissionCents: bigint;
    shippingCostCents: bigint;
    serviceFeeCents: bigint;
    stopajCents: bigint;
    advertisingCents: bigint;
    marketingCents: bigint;
    returnCostCents: bigint;
    otherExpensesCents: bigint;
    vatPayableCents: bigint | null;
    vatRate: number;
    vatBaseCents: bigint;
    operationalProfitCents: bigint;
    netProfitCents: bigint;
    profitMargin: number;
    roi: number;
    currency: string;
    calculationVersion: string;
    calculatedAt: Date;
    source: DataSourceInfo;
    lineage: Array<{ field: string; value: string; source: DataSource; sourceId: string | null; formula?: string; timestamp: Date; calculatorVersion: string }>;
  } {
    const grossSalesCents = input.grossSalesCents < 0n ? 0n : input.grossSalesCents;
    const discountCents = input.discountCents < 0n ? 0n : input.discountCents;
    const clampedDiscountCents = discountCents > grossSalesCents ? grossSalesCents : discountCents;
    const netSalesCents = grossSalesCents - clampedDiscountCents;

    const totalExpensesCents =
      (input.productCostCents < 0n ? 0n : input.productCostCents) +
      (input.commissionCents < 0n ? 0n : input.commissionCents) +
      (input.shippingCostCents < 0n ? 0n : input.shippingCostCents) +
      (input.serviceFeeCents < 0n ? 0n : input.serviceFeeCents) +
      (input.stopajCents < 0n ? 0n : input.stopajCents) +
      (input.advertisingCents < 0n ? 0n : input.advertisingCents) +
      (input.marketingCents < 0n ? 0n : input.marketingCents) +
      (input.returnCostCents < 0n ? 0n : input.returnCostCents) +
      (input.otherExpensesCents < 0n ? 0n : input.otherExpensesCents);

    const operationalProfitCents = netSalesCents - totalExpensesCents;

    const vatRate = input.vatRate || 0;
    let vatPayableCents: bigint = 0n;
    let vatBaseCents = 0n;
    if (netSalesCents > 0n && vatRate > 0) {
      vatBaseCents = netSalesCents;
      vatPayableCents = percentageOf(netSalesCents, vatRate);
    }

    const netProfitCents = operationalProfitCents - vatPayableCents;

    const profitMargin = netSalesCents > 0n ? calculateROI(netProfitCents, netSalesCents) : 0;
    const productCostNonNeg = input.productCostCents < 0n ? 0n : input.productCostCents;
    const roi = productCostNonNeg > 0n ? calculateROI(netProfitCents, productCostNonNeg) : 0;

    const lineage = [
      { field: 'grossSalesCents', value: grossSalesCents.toString(), source: source.source, sourceId: source.sourceId, formula: 'input.grossSalesCents', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
      { field: 'discountCents', value: discountCents.toString(), source: source.source, sourceId: source.sourceId, formula: 'input.discountCents', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
      { field: 'netSalesCents', value: netSalesCents.toString(), source: source.source, sourceId: source.sourceId, formula: 'grossSalesCents - discountCents', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
      { field: 'operationalProfitCents', value: operationalProfitCents.toString(), source: source.source, sourceId: source.sourceId, formula: 'netSalesCents - totalExpenses', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
      { field: 'vatPayableCents', value: (vatPayableCents || 0n).toString(), source: source.source, sourceId: source.sourceId, formula: 'netSalesCents * vatRate / 100', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
      { field: 'netProfitCents', value: netProfitCents.toString(), source: source.source, sourceId: source.sourceId, formula: 'operationalProfitCents - vatPayableCents', timestamp: source.timestamp, calculatorVersion: CALCULATOR_VERSION },
    ];

    return {
      grossSalesCents,
      discountCents,
      netSalesCents,
      productCostCents: input.productCostCents,
      commissionCents: input.commissionCents,
      shippingCostCents: input.shippingCostCents,
      serviceFeeCents: input.serviceFeeCents,
      stopajCents: input.stopajCents,
      advertisingCents: input.advertisingCents,
      marketingCents: input.marketingCents,
      returnCostCents: input.returnCostCents,
      otherExpensesCents: input.otherExpensesCents,
      vatPayableCents,
      vatRate,
      vatBaseCents,
      operationalProfitCents,
      netProfitCents,
      profitMargin,
      roi,
      currency: 'TRY',
      calculationVersion: CALCULATOR_VERSION,
      calculatedAt: source.timestamp,
      source,
      lineage,
    };
  }

  static calculateSimple(
    grossSalesCents: bigint,
    productCostCents: bigint,
    commissionCents: bigint,
    shippingCostCents: bigint,
    otherCostsCents: bigint = 0n
  ): { netProfitCents: bigint; profitMargin: number } {
    const discountCents = 0n;
    const netSalesCents = grossSalesCents - discountCents;
    const totalExpensesCents = productCostCents + commissionCents + shippingCostCents + otherCostsCents;
    const netProfitCents = netSalesCents - totalExpensesCents;
    const profitMargin = calculateROI(netProfitCents, netSalesCents);
    return { netProfitCents, profitMargin };
  }
}

// ============================================================
// ALTIN TEST SENARYOLARI (BIGINT)
// ============================================================

export interface GoldenTestScenario {
  id: string;
  name: string;
  input: {
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
  };
  expected: {
    netProfitCents: bigint;
    operationalProfitCents: bigint;
    vatPayableCents: bigint;
    netSalesCents: bigint;
  };
}

export const GOLDEN_TESTS_BIGINT: GoldenTestScenario[] = [
  {
    id: 'golden-001',
    name: 'Basit Kar Senaryosu',
    input: {
      grossSalesCents: 100000n, discountCents: 0n, productCostCents: 50000n,
      commissionCents: 15000n, shippingCostCents: 6000n, serviceFeeCents: 1000n,
      stopajCents: 0n, advertisingCents: 0n, marketingCents: 0n,
      returnCostCents: 0n, otherExpensesCents: 4000n, vatRate: 20
    },
    expected: { netProfitCents: 4000n, operationalProfitCents: 24000n, vatPayableCents: 20000n, netSalesCents: 100000n }
  },
  {
    id: 'golden-002',
    name: 'Zarar Senaryosu',
    input: {
      grossSalesCents: 50000n, discountCents: 5000n, productCostCents: 40000n,
      commissionCents: 10000n, shippingCostCents: 3000n, serviceFeeCents: 500n,
      stopajCents: 0n, advertisingCents: 2000n, marketingCents: 1000n,
      returnCostCents: 0n, otherExpensesCents: 0n, vatRate: 20
    },
    expected: { netProfitCents: -20500n, operationalProfitCents: -11500n, vatPayableCents: 9000n, netSalesCents: 45000n }
  },
  {
    id: 'golden-003',
    name: 'Sıfır Maliyet Testi',
    input: {
      grossSalesCents: 10000n, discountCents: 0n, productCostCents: 0n,
      commissionCents: 1000n, shippingCostCents: 500n, serviceFeeCents: 0n,
      stopajCents: 0n, advertisingCents: 0n, marketingCents: 0n,
      returnCostCents: 0n, otherExpensesCents: 0n, vatRate: 20
    },
    expected: { netProfitCents: 6500n, operationalProfitCents: 8500n, vatPayableCents: 2000n, netSalesCents: 10000n }
  },
  {
    id: 'golden-004',
    name: 'Sıfır Satış Testi',
    input: {
      grossSalesCents: 0n, discountCents: 0n, productCostCents: 10000n,
      commissionCents: 0n, shippingCostCents: 0n, serviceFeeCents: 0n,
      stopajCents: 0n, advertisingCents: 0n, marketingCents: 0n,
      returnCostCents: 0n, otherExpensesCents: 0n, vatRate: 20
    },
    expected: { netProfitCents: -10000n, operationalProfitCents: -10000n, vatPayableCents: 0n, netSalesCents: 0n }
  }
];

// ============================================================
// EXPORTS — Yardımcı fonksiyonlar (class/const zaten export ediliyor)
// ============================================================

export {
  floatToCents,
  centsToFloat,
  serializeCents,
  parseFloatToCents,
  checkInt64Range,
  INT64_MAX,
  INT64_MIN,
  rateToBasisPoints,
  divRound,
  calculateMargin,
  calculateROI
};
