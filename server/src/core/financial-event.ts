// ============================================================
// FINANCIAL EVENT ENGINE
// ============================================================

import { FinancialEvent, FinancialEventType, FinancialDirection, DataSource, DataSourceInfo } from '../shared/types';
import { CorrelationResolver } from './correlation';
import { EconomicIdentityResolver } from './economic-identity';
import { IdempotencyStore } from './idempotency';

function simpleUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface RawFinancialInput {
  source: DataSource;
  sourceId: string;
  type: FinancialEventType;
  timestamp: Date;
  amount: number; // TL
  currency?: string;
  quantity?: number;
  productId?: string;
  orderId?: string;
  orderItemId?: string;
  marketplaceId?: string;
  metadata?: Record<string, unknown>;
}

export class FinancialEventEngine {
  private processedEventIds = new Set<string>();

  /**
   * Process raw input into a canonical FinancialEvent.
   * Validates, normalizes, assigns economic identity and correlation.
   */
  process(raw: RawFinancialInput, correlationResolver: CorrelationResolver, identityResolver: EconomicIdentityResolver, idempotency: IdempotencyStore): FinancialEvent {
    // Idempotency check
    const eventKey = `${raw.source}:${raw.sourceId}:${raw.type}`;
    if (idempotency.isProcessed(eventKey)) {
      throw new Error(`Duplicate event detected: ${eventKey}`);
    }

    // Validate
    if (!Number.isFinite(raw.amount)) {
      throw new Error('Invalid amount');
    }

    // Normalize amount to cents (BigInt)
    const amountCents = this.toCents(raw.amount);
    const currency = raw.currency || 'TRY';

    // Economic identity
    const economicIdentity = identityResolver.resolve(raw.type, raw);

    // Correlation
    const correlation = correlationResolver.resolve(raw, economicIdentity);

    // Build FinancialEvent
    const event: FinancialEvent = {
      id: simpleUuid(),
      economicIdentity,
      source: raw.source,
      sourceId: raw.sourceId,
      sourceLineId: raw.sourceId, // using sourceId as line id for simplicity
      eventType: raw.type,
      direction: this.directionForType(raw.type),
      amountCents,
      currency,
      orderId: raw.orderId,
      orderItemId: raw.orderItemId,
      productId: raw.productId,
      marketplaceId: raw.marketplaceId,
      categoryIdSnapshot: undefined,
      brandIdSnapshot: undefined,
      eventDate: raw.timestamp,
      createdAt: new Date(),
      metadata: {
        ...raw.metadata,
        correlation,
        lineage: [{
          step: 'normalization',
          timestamp: new Date(),
        }],
      },
    };

    // Mark processed
    idempotency.markProcessed(eventKey);
    return event;
  }

  private toCents(amount: number): bigint {
    // Use shared money utility (imported from shared/utils/money)
    // For simplicity inline commercial rounding using string method
    const str = amount.toString();
    const isNeg = amount < 0;
    const abs = isNeg ? str.slice(1) : str;
    const [intPart, decPart = ''] = abs.split('.');
    const padded = (decPart + '000').slice(0, 3);
    const cents = parseInt(intPart || '0') * 100 + parseInt(padded.slice(0, 2));
    const rounded = cents + (parseInt(padded[2] || '0') >= 5 ? 1 : 0);
    return BigInt((isNeg ? -1 : 1) * rounded);
  }

  private directionForType(type: FinancialEventType): FinancialDirection {
    const incomeTypes = new Set([FinancialEventType.SALE]);
    const expenseTypes = new Set([
      FinancialEventType.COMMISSION,
      FinancialEventType.SHIPPING,
      FinancialEventType.SERVICE_FEE,
      FinancialEventType.STOPAJ,
      FinancialEventType.ADVERTISING,
      FinancialEventType.COGS,
      FinancialEventType.RETURN,
      FinancialEventType.REFUND,
      FinancialEventType.DISCOUNT,
      FinancialEventType.ADJUSTMENT,
    ]);
    if (incomeTypes.has(type)) return FinancialDirection.INCOME;
    if (expenseTypes.has(type)) return FinancialDirection.EXPENSE;
    return FinancialDirection.METADATA;
  }
}