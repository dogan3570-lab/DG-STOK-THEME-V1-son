// ============================================================
// PROFIT-V2 (VENDORED) — TÜM TİPLER
// Deterministic + Learning + Analytics + AI boundary.
// Finansal değerler BigInt cents. Missing data != 0.
// ============================================================

// ---------- Deterministic ----------
export enum FinSource {
  XML = 'XML', LISTING_TEMPLATE = 'LISTING_TEMPLATE', MARKETPLACE = 'MARKETPLACE',
  SHIPPING_TARIFF = 'SHIPPING_TARIFF', ORDER = 'ORDER', SETTLEMENT = 'SETTLEMENT',
  USER = 'USER', CALCULATED = 'CALCULATED', LEARNED = 'LEARNED', UNKNOWN = 'UNKNOWN',
}
export interface LineMeta { source: FinSource; sourceId?: string | null; ruleVersion?: string; effectiveDate?: string; confidence?: number; }
export interface FinLine { key: string; label: string; netCents: bigint; vatCents: bigint; grossCents: bigint; vatRate: number; inclusive: boolean; deductible: boolean; meta: LineMeta; }
export interface ExpenseInput { key: string; label: string; grossCents?: bigint; netCents?: bigint; inclusive?: boolean; vatRate?: number; deductible?: boolean; meta: LineMeta; }
export interface VatBreakdownLine { key: string; label: string; baseCents: bigint; vatCents: bigint; rate: number; direction: 'output' | 'input'; deductible: boolean; source: FinSource; }
export interface VatSummary { outputVatCents: bigint; inputVatCents: bigint; nonDeductibleVatCents: bigint; netVatPayableCents: bigint; vatCreditCents: bigint; lines: VatBreakdownLine[]; }
export interface WaterfallStep { key: string; label: string; amountCents: bigint; runningCents: bigint; source: FinSource; }
export interface ProfitCalculationInput {
  currency?: string; salePriceCents: bigint; saleVatInclusive?: boolean; saleVatRate: number; discountCents?: bigint;
  purchaseCostCents: bigint; purchaseVatRate: number; purchaseVatInclusive?: boolean; purchaseVatDeductible?: boolean;
  commissionCents: bigint; commissionVatRate: number; commissionVatInclusive?: boolean; commissionVatDeductible?: boolean;
  serviceFeeCents: bigint; serviceVatRate: number; serviceVatInclusive?: boolean; serviceVatDeductible?: boolean;
  shippingCents: bigint; shippingVatRate: number; shippingVatInclusive?: boolean; shippingVatDeductible?: boolean;
  withholdingCents: bigint; returnCostCents?: bigint; returnVatRate?: number; returnVatInclusive?: boolean; returnVatDeductible?: boolean;
  advertisingCents?: bigint; advertisingVatRate?: number; advertisingVatInclusive?: boolean; advertisingVatDeductible?: boolean;
  otherExpensesCents?: bigint; otherVatRate?: number; otherVatInclusive?: boolean; otherVatDeductible?: boolean;
  extraExpenses?: ExpenseInput[]; targetProfitCents?: bigint; meta?: Record<string, LineMeta>;
}
export interface ProfitCalculationResult {
  currency: string; sale: FinLine; discount: FinLine; expenses: FinLine[]; vat: VatSummary;
  netSalesCents: bigint; totalExpenseNetCents: bigint; nonDeductibleVatCents: bigint;
  netProfitCents: bigint; netMarginPercent: number; roiPercent: number;
  breakEvenPriceCents: bigint; targetProfitPriceCents: bigint | null;
  waterfall: WaterfallStep[]; calculationVersion: string; computedAt: string;
}

// ---------- Rules ----------
export interface CategoryCommissionOverride { categoryId: string; commissionRate: number; effectiveFrom?: string; effectiveTo?: string; }
export interface MarketplaceRule {
  marketplaceKey: string; name: string; ruleVersion: string; effectiveFrom: string; effectiveTo?: string | null;
  commissionRate: number; commissionVatRate: number; commissionVatInclusive: boolean;
  serviceFeeCents: bigint; serviceVatRate: number; serviceVatInclusive: boolean;
  shippingVatRate: number; shippingVatInclusive: boolean; withholdingRate: number;
  categoryOverrides?: CategoryCommissionOverride[];
}
export interface ResolvedMarketplaceRule { rule: MarketplaceRule; commissionRate: number; usedCategoryOverride: boolean; }
export interface ShippingBracket { maxDesi: number; priceCents: bigint; }
export interface ShippingTariff { tariffKey: string; marketplaceKey: string; carrier: string; ruleVersion: string; effectiveFrom: string; effectiveTo?: string | null; vatRate: number; brackets: ShippingBracket[]; }
export interface ResolvedShipping { priceCents: bigint; bracketMaxDesi: number; tariff: ShippingTariff; }

// ---------- Learning ----------
export type LearningMetricKey = 'commission' | 'shipping' | 'serviceFee' | 'withholding' | 'returnCost';
export interface LearningScope { marketplace: string; categoryId?: string | null; productId?: string | null; }
export type ObservationSource = 'ORDER' | 'SETTLEMENT' | 'MARKETPLACE' | 'RETURN' | 'MANUAL' | 'TEST_DATA';
export interface Observation {
  readonly id: string; readonly marketplace: string; readonly scope: LearningScope; readonly metric: LearningMetricKey;
  readonly expectedCents: bigint; readonly actualCents: bigint; readonly deviationCents: bigint; readonly deviationPercent: number;
  readonly observedAt: string; readonly source: ObservationSource;
  readonly correlationId?: string | null; readonly orderId?: string | null; readonly settlementId?: string | null;
}
export interface ObservationInput { id?: string; marketplace: string; scope?: Partial<LearningScope>; metric: LearningMetricKey; expectedCents: bigint; actualCents: bigint; observedAt?: string; source?: ObservationSource; correlationId?: string | null; orderId?: string | null; settlementId?: string | null; }
export type EstimateStatus = 'LOW_CONFIDENCE' | 'EMERGING' | 'CONFIRMED' | 'NO_DATA';
export interface LearnedEstimate { metric: LearningMetricKey; scope: LearningScope; learnedValueCents: bigint; sampleCount: number; effectiveSampleCount: number; confidence: number; status: EstimateStatus; method: string; lastObservedAt: string | null; }
export interface ResolvedEstimate { metric: LearningMetricKey; scope: LearningScope; officialValueCents: bigint | null; learnedValueCents: bigint | null; suggestedValueCents: bigint | null; sampleCount: number; confidence: number; status: EstimateStatus; useOfficial: boolean; reason: string; }
export interface PersistedObservation { id: string; marketplace: string; scope: { marketplace: string; categoryId: string | null; productId: string | null }; metric: LearningMetricKey; expectedCents: string; actualCents: string; deviationCents: string; deviationPercent: number; observedAt: string; source: ObservationSource; correlationId: string | null; orderId: string | null; settlementId: string | null; }
export interface PersistedLearningState { version: number; savedAt: string; observations: PersistedObservation[]; }
export const LEARNING_STATE_VERSION = 1;

// ---------- Analytics ----------
export type PeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';
export type AStatus = 'KNOWN' | 'UNKNOWN' | 'PARTIAL' | 'INSUFFICIENT_DATA';
export type DataQuality = 'complete' | 'partial' | 'missing' | 'insufficient_sample';
export interface MetricVal { valueCents: bigint | null; status: AStatus; dataQuality: DataQuality; }
export interface RatioVal { value: number | null; status: AStatus; dataQuality: DataQuality; }
export interface AnalyticsRecord {
  id: string; orderId: string; marketplace: string; categoryId?: string | null; productId: string;
  productName?: string | null; sku?: string | null; barcode?: string | null; occurredAt: string; currency?: string;
  isReturn?: boolean; isSimulation?: boolean; returnsTracked?: boolean;
  salePriceCents?: bigint | null; saleVatRate?: number | null; saleVatInclusive?: boolean; discountCents?: bigint | null;
  purchaseCostCents?: bigint | null; purchaseVatRate?: number | null; purchaseVatInclusive?: boolean; purchaseVatDeductible?: boolean;
  commissionCents?: bigint | null; commissionVatRate?: number | null; commissionVatInclusive?: boolean;
  serviceFeeCents?: bigint | null; serviceVatRate?: number | null; serviceVatInclusive?: boolean;
  withholdingCents?: bigint | null;
  shippingCents?: bigint | null; shippingVatRate?: number | null; shippingVatInclusive?: boolean;
  returnCostCents?: bigint | null; returnVatRate?: number | null;
  advertisingCents?: bigint | null; advertisingVatRate?: number | null;
  otherExpensesCents?: bigint | null; otherVatRate?: number | null;
  learning?: { metric: string; officialValueCents?: bigint | null; learnedValueCents?: bigint | null; confidence?: number; sampleCount?: number };
}
export interface AggregateFilters { period: PeriodType; start: string; end: string; timeZone: string; marketplace?: string; categoryId?: string | null; productId?: string | null; includeSimulation?: boolean; }
export type AnalyticsMetricKey = 'revenue' | 'discount' | 'netSales' | 'purchaseCost' | 'commission' | 'commissionVat' | 'shipping' | 'shippingVat' | 'serviceFee' | 'serviceFeeVat' | 'withholding' | 'returnCost' | 'advertising' | 'otherExpenses' | 'inputVat' | 'netVat' | 'netProfit';
export interface AggregateResult {
  period: PeriodType; start: string; end: string; timeZone: string;
  filters: { marketplace?: string; categoryId?: string | null; productId?: string | null };
  recordCount: number; orderCount: number; returnCount: number;
  metrics: Record<AnalyticsMetricKey, MetricVal>; margin: RatioVal; roi: RatioVal; returnRate: RatioVal;
  dataQuality: DataQuality;
  learning: Array<{ metric: string; officialValueCents: bigint | null; learnedValueCents: bigint | null; confidence: number; sampleCount: number }>;
}
export interface BucketedPoint { key: string; start: string; end: string; metric: MetricVal; }
export interface ComparisonResult { current: AggregateResult; previous: AggregateResult | null; delta: { revenueCents: bigint | null; netProfitCents: bigint | null; orderCount: number | null }; hasPrevious: boolean; }
export interface ProductSummaryRow { productId: string; productName: string | null; sku: string | null; barcode: string | null; orderCount: number; returnCount: number; aggregate: AggregateResult; }

// ---------- AI ----------
export interface MetricFact { key: string; valueCents: string | null; status: string; }
export interface RatioFact { key: string; value: number | null; status: string; }
export interface LearningFact { metric: string; officialValueCents: string | null; observedValueCents: string | null; learnedValueCents: string | null; confidence: number; sampleCount: number; status: string; }
export interface FinancialFacts { period: string; marketplace: string | null; timeZone: string; orderCount: number; returnCount: number; dataQuality: string; metrics: MetricFact[]; ratios: RatioFact[]; learning: LearningFact[]; notes: string[]; }
export type AiInsightKind = 'summary' | 'trend' | 'anomaly' | 'data_gap' | 'learning_suggestion';
export type AiSeverity = 'info' | 'warn' | 'critical';
export interface AiInsight { id: string; kind: AiInsightKind; severity: AiSeverity; text: string; references: string[]; }
export interface AiResult { ok: boolean; provider: string; insights: AiInsight[]; rejectedCount: number; usedFallback: boolean; error?: string; }
export interface AiProvider { readonly name: string; generate(facts: FinancialFacts, opts?: { timeoutMs?: number }): Promise<AiInsight[]>; }
