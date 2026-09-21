// ============================================================
// PROFIT ENGINE - TÜM TİPLER
// ============================================================

// Kaynak öncelikleri
export enum DataSource {
  MARKETPLACE_API = 'MARKETPLACE_API',
  DG_STOK = 'DG_STOK',
  MANUAL = 'MANUAL',
  ESTIMATED = 'ESTIMATED',
  LEARNED = 'LEARNED',
  UNKNOWN = 'UNKNOWN'
}

// Kaynak bilgisi
export interface DataSourceInfo {
  source: DataSource;
  sourceId: string | null;
  timestamp: Date;
  confidence: number; // 0-1 arası
}

// ============================================================
// PARA MODELİ - BIGINT CENTS
// ============================================================

/**
 * Para birimi kuruş cinsinden (BigInt)
 * 1 TRY = 100 cents
 * Maksimum: 9223372036854775807 cents = 92,233,720,368,547,758.07 TRY
 */
export type MonetaryCents = bigint;

// Re-export money utilities from utils
export {
  floatToCents,
  centsToFloat,
  serializeCents,
  formatCents,
  checkInt64Range,
  INT64_MAX,
  INT64_MIN,
  parseFloatToCents,
  rateToBasisPoints,
  divRound,
  calculateMargin,
  calculateROI,
} from '../utils/money';

// ============================================================
// FINANCIAL EVENT TİPLERİ
// ============================================================

export enum FinancialDirection {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  METADATA = 'METADATA'
}

export enum FinancialEventType {
  // Gelir
  SALE = 'SALE',
  
  // Giderler - Marketplace kesintileri
  COMMISSION = 'COMMISSION',
  SHIPPING = 'SHIPPING',
  SERVICE_FEE = 'SERVICE_FEE',
  STOPAJ = 'STOPAJ',
  ADVERTISING = 'ADVERTISING',
  
  // Maliyet
  COGS = 'COGS',
  
  // İade / İptal
  REFUND = 'REFUND',
  RETURN = 'RETURN',
  STOCK_RETURN = 'STOCK_RETURN',
  RETURN_SHIPPING = 'RETURN_SHIPPING',
  
  // İndirim / Kampanya
  DISCOUNT = 'DISCOUNT',
  COUPON = 'COUPON',
  
  // Maliyet / Vergi - Tarihsel dondurma
  PRODUCT_COST = 'PRODUCT_COST',
  VAT = 'VAT',
  
  // Düzeltme
  ADJUSTMENT = 'ADJUSTMENT',
  
  // Diğer
  OTHER = 'OTHER'
}

// FinancialEvent - Ana finansal olay modeli
export interface FinancialEvent {
  id: string;
  
  // Canonical Economic Identity (Global Unique)
  economicIdentity: string;
  
  // Source Correlation
  source: DataSource;
  sourceId: string;              // Marketplace settlement/transaction ID
  sourceLineId: string;          // Marketplace satır ID'si (zorunlu)
  
  // Event Classification
  eventType: FinancialEventType;
  direction: FinancialDirection;
  
  // Amount (BigInt cents)
  amountCents: bigint;
  currency: string;
  
  // Context
  orderId?: string;
  orderItemId?: string;
  productId?: string;
  marketplaceId?: string;
  categoryIdSnapshot?: string;   // Denormalized historical
  brandIdSnapshot?: string;      // Denormalized historical
  
  // Timing
  eventDate: Date;               // Ekonomik olay tarihi
  createdAt: Date;
  
  // Metadata (VAT rate, base, etc.)
  metadata?: Record<string, unknown>;
}

// FinancialEvent oluşturma için input
export interface FinancialEventInput {
  economicIdentity: string;
  source: DataSource;
  sourceId: string;
  sourceLineId: string;
  eventType: FinancialEventType;
  direction: FinancialDirection;
  amountCents: bigint;
  currency?: string;
  orderId?: string;
  orderItemId?: string;
  productId?: string;
  marketplaceId?: string;
  categoryIdSnapshot?: string;
  brandIdSnapshot?: string;
  eventDate: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================
// FINANCIAL SNAPSHOT - DÖNEM ÖZETİ
// ============================================================

export enum PeriodType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY'
}

// Sentinel değerler (NULL yerine)
export const SCOPE_ALL = '__ALL__';

export interface FinancialSnapshot {
  id: string;
  
  // Period
  periodType: PeriodType;
  periodStart: Date;
  periodEnd: Date;
  
  // Scope Identity
  marketplaceId: string;         // default: SCOPE_ALL
  categoryIdSnapshot: string;    // default: SCOPE_ALL
  brandIdSnapshot: string;       // default: SCOPE_ALL
  productId: string;             // default: SCOPE_ALL
  
  // Revision
  revision: number;              // 1, 2, 3...
  previousSnapshotId?: string;   // Zincir: rev n → rev n+1
  
  // GİRDİLER (TÜM HESAPLAMA GİRDİLERİ - yeniden üretilebilirlik için)
  grossSalesCents: bigint;
  discountCents: bigint;
  netSalesCents: bigint;
  productCostCents: bigint;
  commissionCents: bigint;
  shippingCents: bigint;
  serviceFeeCents: bigint;
  stopajCents: bigint;
  advertisingCents: bigint;
  marketingCents: bigint;
  returnCostCents: bigint;
  otherExpensesCents: bigint;
  totalExpensesCents: bigint;
  
  // KDV
  vatRate: number;               // Oran (örn. 20)
  vatBaseCents: bigint;          // Matrah
  vatPayableCents: bigint | null; // null = UNVERIFIED
  
  // SONUÇ
  operationalProfitCents: bigint;
  netProfitCents: bigint;
  profitMargin: number;          // yüzde (float)
  roi: number;                   // yüzde (float)
  
  // METADATA
  calculationVersion: string;
  calculationInputHash: string;  // SHA-256
  eventCount: number;
  
  createdAt: Date;
}

// Snapshot oluşturma için input
export interface FinancialSnapshotInput {
  periodType: PeriodType;
  periodStart: Date;
  periodEnd: Date;
  marketplaceId?: string;
  categoryIdSnapshot?: string;
  brandIdSnapshot?: string;
  productId?: string;
  revision?: number;
  previousSnapshotId?: string;
  
  // Tüm girdiler (cents)
  grossSalesCents: bigint;
  discountCents: bigint;
  netSalesCents: bigint;
  productCostCents: bigint;
  commissionCents: bigint;
  shippingCents: bigint;
  serviceFeeCents: bigint;
  stopajCents: bigint;
  advertisingCents: bigint;
  marketingCents: bigint;
  returnCostCents: bigint;
  otherExpensesCents: bigint;
  totalExpensesCents: bigint;
  
  // KDV
  vatRate: number;
  vatBaseCents: bigint;
  vatPayableCents: bigint | null;
  
  // Sonuç
  operationalProfitCents: bigint;
  netProfitCents: bigint;
  profitMargin: number;
  roi: number;
  
  calculationVersion: string;
  calculationInputHash: string;
  eventCount: number;
}

// ============================================================
// ECONOMIC IDENTITY & CORRELATION
// ============================================================

// Economic Identity formatları
export const EconomicIdentityPrefix = {
  SALE: 'SALE',
  COMMISSION: 'COMMISSION',
  SHIPPING: 'SHIPPING',
  REFUND: 'REFUND',
  STOCK_RETURN: 'STOCK_RETURN',
  RETURN_SHIPPING: 'RETURN_SHIPPING',
  PRODUCT_COST: 'PRODUCT_COST',
  VAT: 'VAT',
  DISCOUNT: 'DISCOUNT',
  COUPON: 'COUPON',
  ADJUSTMENT: 'ADJUSTMENT'
} as const;

// Source Correlation Modeli
export interface EventSourceCorrelation {
  id: string;
  economicIdentity: string;      // Canonical economic identity
  primarySource: DataSource;
  primarySourceId: string;
  correlatedSources: CorrelatedSource[];  // Diğer kaynaklar
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface CorrelatedSource {
  source: DataSource;
  sourceId: string;
  amountCents?: bigint;
  correlatedAt: Date;
}

// ============================================================
// VAT MODELİ
// ============================================================

export interface VatStatus {
  isInclusive: boolean | null;   // true=dahil, false=hariç, null=BELİRSİZ
  source: DataSource;
  confidence: number;
  rate: number;                  // KDV oranı (örn. 20)
}

export interface VatBreakdown {
  vatRate: number;               // Oran (örn. 20)
  vatBaseCents: bigint;          // Matrah
  vatPayableCents: bigint | null; // Gerçek VAT varsa tutar, yoksa null
  vatSource: DataSource;         // Kaynağı
  isEstimated: boolean;          // true = tahmini, false = gerçek
}

// ============================================================
// SNAPSHOT HASH INPUT
// ============================================================

export interface SerializedEvent {
  id: string;
  eventType: string;
  direction: FinancialDirection;
  amountCents: string;           // bigint.toString()
  currency: string;
  source: string;
  sourceId: string;
  sourceLineId: string;
  orderId: string | null;
  orderItemId: string | null;
  productId: string | null;
  marketplaceId: string | null;
  categoryIdSnapshot: string | null;
  brandIdSnapshot: string | null;
  eventDate: string;             // ISO 8601 UTC
}

export interface SnapshotHashInput {
  periodType: string;
  periodStart: string;           // ISO 8601 UTC
  periodEnd: string;
  marketplaceId: string;
  categoryIdSnapshot: string;
  brandIdSnapshot: string;
  productId: string;
  calculationVersion: string;
  events: SerializedEvent[];     // eventDate ASC, id ASC
}

// ============================================================
// SOURCE PRIORITY MATRİSİ
// ============================================================

export type FinancialField = 
  | 'grossSales' 
  | 'discount' 
  | 'productCost' 
  | 'commission' 
  | 'shipping' 
  | 'returnCost' 
  | 'advertising' 
  | 'serviceFee' 
  | 'stopaj' 
  | 'vatRate' 
  | 'vatPayable' 
  | 'otherExpenses';

export interface FieldSourcePriority {
  field: FinancialField;
  priority: DataSource[];  // En yüksekten en düşüğe
}

// ============================================================
// CORRELATION MODELİ
// ============================================================

export interface EventSourceCorrelationRecord {
  id: string;
  economicIdentity: string;
  primarySource: DataSource;
  primarySourceId: string;
  correlatedSources: CorrelatedSource[];
  resolved: boolean;
  resolvedAt?: Date;
  createdAt: Date;
}

// ============================================================
// HESAPLAMA INPUT/OUTPUT (GÜNCELLENMIŞ - BIGINT)
// ============================================================

export interface TestInputBigInt {
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
}

export interface ProfitResultBigInt {
  // GİRDİLER
  grossSalesCents: bigint;
  discountCents: bigint;
  netSalesCents: bigint;
  
  // GİDERLER
  productCostCents: bigint;
  commissionCents: bigint;
  shippingCostCents: bigint;
  serviceFeeCents: bigint;
  stopajCents: bigint;
  advertisingCents: bigint;
  marketingCents: bigint;
  returnCostCents: bigint;
  otherExpensesCents: bigint;
  
  // VERGİ
  vatPayableCents: bigint | null;  // null = UNVERIFIED
  vatRate: number;
  vatBaseCents: bigint;
  
  // SONUÇ
  operationalProfitCents: bigint;
  netProfitCents: bigint;
  
  // ORANLAR
  profitMargin: number;  // yüzde (float)
  roi: number;           // yüzde (float)
  
  // DETAY
  currency: string;
  calculationVersion: string;
  calculatedAt: Date;
  source: DataSourceInfo;
  lineage: CalculationLineageBigInt[];
}

export interface CalculationLineageBigInt {
  field: string;
  value: string;  // bigint.toString()
  source: DataSource;
  sourceId: string | null;
  formula?: string;
  timestamp: Date;
  calculatorVersion: string;
}

// ============================================================
// MEVCUT TİPLER (GERİYE UYUMLULUK İÇİN)
// ============================================================

// Para birimi
export interface Currency {
  code: string; // TRY, USD, EUR
  symbol: string;
  exchangeRate: number;
  updatedAt: Date;
}

// Fiyat bilgisi
export interface PriceInfo {
  purchasePrice: number;
  purchasePriceVat: number;
  listPrice: number;
  salePrice: number;
  discount: number;
  currency: string;
  source: DataSourceInfo;
}

// Sipariş bilgisi
export interface Order {
  id: string;
  orderNo: string;
  channel: string;
  marketplaceId: string;
  marketplaceKey: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  status: OrderStatus;
  total: number;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
}

export enum OrderStatus {
  NEW = 'new',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned'
}

// Sipariş kalemi
export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  purchasePrice: number;
  commission: number;
  shippingCost: number;
  serviceFee: number;
  vatAmount: number;
  returnAmount: number;
  netProfit: number;
}

// Komisyon oranı
export interface CommissionRate {
  marketplaceKey: string;
  categoryId: string;
  categoryName: string;
  rate: number; // yüzde
  minAmount: number;
  maxAmount: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  source: DataSourceInfo;
}

// Kargo bilgisi
export interface ShippingCost {
  marketplaceKey: string;
  baseCost: number;
  additionalItemCost: number;
  freeShippingThreshold: number;
  weightBased: boolean;
  maxWeight: number;
  costPerKg: number;
  source: DataSourceInfo;
}

// İade bilgisi
export interface ReturnInfo {
  orderId: string;
  orderItemId: string;
  quantity: number;
  amount: number;
  reason: string;
  status: ReturnStatus;
  createdAt: Date;
  processedAt?: Date;
}

export enum ReturnStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  RECEIVED = 'received',
  REFUNDED = 'refunded'
}

// Vergi bilgisi
export interface VatInfo {
  rate: number; // yüzde (KDV oranı)
  amount: number;
  included: boolean;
  type: VatType;
}

export enum VatType {
  KDV = 'KDV',
  OTV = 'OTV',
  STOPAJ = 'STOPAJ',
  DAMGA = 'DAMGA'
}

// Reklam gideri
export interface AdvertisingCost {
  campaignId: string;
  campaignName: string;
  marketplaceKey: string;
  amount: number;
  currency: string;
  impressions: number;
  clicks: number;
  orders: number;
  spendDate: Date;
  source: DataSourceInfo;
}

// Harcama bilgisi
export interface Expense {
  id: string;
  type: ExpenseType;
  amount: number;
  currency: string;
  description: string;
  category: string;
  date: Date;
  source: DataSourceInfo;
}

export enum ExpenseType {
  SHIPPING = 'SHIPPING',
  COMMISSION = 'COMMISSION',
  SERVICE_FEE = 'SERVICE_FEE',
  ADVERTISING = 'ADVERTISING',
  RETURN = 'RETURN',
  PACKAGING = 'PACKAGING',
  PROCESSING = 'PROCESSING',
  OTHER = 'OTHER'
}

// Kâr/Zarar hesaplama sonucu (ESKİ - NUMBER BASED)
export interface ProfitResult {
  // GİRDİLER
  grossSales: number;
  discount: number;
  netSales: number;
  
  // GİDERLER
  productCost: number;
  commission: number;
  shippingCost: number;
  serviceFee: number;
  stopaj: number;
  advertising: number;
  marketing: number;
  returnCost: number;
  otherExpenses: number;
  
  // VERGİ
  vatPayable: number;
  
  // SONUÇ
  operationalProfit: number;
  netProfit: number;
  
  // ORANLAR
  profitMargin: number; // yüzde
  roi: number; // yatırım getirisi
  
  // DETAY
  currency: string;
  calculationVersion: string;
  calculatedAt: Date;
  source: DataSourceInfo;
  lineage: CalculationLineage[];
}

export interface CalculationLineage {
  field: string;
  value: number;
  source: DataSource;
  sourceId: string | null;
  formula?: string;
  timestamp: Date;
  calculatorVersion: string;
}

// Anomali bilgisi
export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  expected: number;
  actual: number;
  difference: number;
  percentageDiff: number;
  source: string;
  sourceId?: string;
  orderId?: string;
  marketplaceKey?: string;
  date: Date;
  details: string;
  resolved: boolean;
  resolvedAt?: Date;
}

export enum AnomalyType {
  COMMISSION = 'COMMISSION',
  SHIPPING = 'SHIPPING',
  RETURN = 'RETURN',
  DISCOUNT = 'DISCOUNT',
  SALES = 'SALES',
  COST = 'COST',
  PRICING = 'PRICING'
}

export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Öğrenilen kural
export interface LearnedRule {
  ruleId: string;
  type: RuleType;
  source: DataSource;
  conditions: RuleCondition[];
  result: number;
  sampleCount: number;
  firstSeen: Date;
  lastSeen: Date;
  confidence: number;
  previousValue?: number;
  newValue?: number;
  verified: boolean;
  active: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
  value: string | number;
}

export enum RuleType {
  COMMISSION_RATE = 'COMMISSION_RATE',
  SHIPPING_COST = 'SHIPPING_COST',
  RETURN_RATE = 'RETURN_RATE',
  DISCOUNT_BEHAVIOR = 'DISCOUNT_BEHAVIOR',
  ADVERTISING_COST = 'ADVERTISING_COST',
  CATEGORY_PATTERN = 'CATEGORY_PATTERN'
}

// Zaman dilimi
export interface TimePeriod {
  type: PeriodType;
  startDate: Date;
  endDate: Date;
  label: string;
}

// Özet bilgi
export interface Summary {
  period: TimePeriod;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  profitMargin: number;
  orderCount: number;
  productCount: number;
  returnCount: number;
  returnRate: number;
  avgOrderValue: number;
  topMarketplace: string;
  topCategory: string;
}

// Filtreler
export interface ProfitFilters {
  marketplace?: string;
  category?: string;
  brand?: string;
  product?: string;
  dateFrom?: Date;
  dateTo?: Date;
  period?: PeriodType;
}

// Test senaryosu
export interface TestScenario {
  id: string;
  name: string;
  type: TestType;
  input: TestInput;
  expectedOutput: ProfitResult;
  actualOutput?: ProfitResult;
  passed?: boolean;
  error?: string;
}

export interface TestInput {
  grossSales: number;
  discount: number;
  productCost: number;
  commission: number;
  shippingCost: number;
  serviceFee: number;
  stopaj: number;
  advertising: number;
  marketing: number;
  returnCost: number;
  otherExpenses: number;
  vatRate: number;
}

export enum TestType {
  UNIT = 'unit',
  INTEGRATION = 'integration',
  API = 'api',
  CALCULATION = 'calculation',
  REGRESSION = 'regression',
  STRESS = 'stress',
  BOUNDARY = 'boundary',
  CURRENCY = 'currency',
  VAT = 'vat',
  COMMISSION = 'commission',
  RETURN = 'return',
  DISCOUNT = 'discount',
  NEGATIVE_PROFIT = 'negative_profit',
  ZERO_COST = 'zero_cost',
  ZERO_SALE = 'zero_sale',
  LARGE_ORDER = 'large_order',
  FUZZ = 'fuzz'
}

// API yanıtı
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
  duration: number;
}

// Dashboard özet
export interface DashboardSummary {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalLoss: number;
  profitMargin: number;
  orderCount: number;
  topMarketplace: string;
  topProducts: ProductProfitability[];
  dailyTrend: DailyTrend[];
  anomalyCount: number;
  lastUpdated: Date;
}

export interface ProductProfitability {
  productId: string;
  sku: string;
  title: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orderCount: number;
}

export interface DailyTrend {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  orderCount: number;
}