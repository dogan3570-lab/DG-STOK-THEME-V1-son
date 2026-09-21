// ============================================================
// RETURN SERVICE
// ============================================================

import { FinancialEvent, FinancialEventType } from '../shared/types';

export interface ReturnRecord {
  originalSaleId: string;
  amountCents: bigint;
  refundCents: bigint;
  eventId: string;
  correlationId: string;
}

export class ReturnService {
  private returns = new Map<string, ReturnRecord>(); // key: event.id

  recordReturn(event: FinancialEvent): void {
    if (event.eventType !== FinancialEventType.RETURN && event.eventType !== FinancialEventType.REFUND) return;
    const rec: ReturnRecord = {
      originalSaleId: event.metadata?.original_sale_id as string || 'unknown',
      amountCents: event.amountCents,
      refundCents: event.amountCents, // assume full refund
      eventId: event.id,
      correlationId: event.metadata?.correlation as string,
    };
    this.returns.set(event.id, rec);
  }

  getReturn(eventId: string): ReturnRecord | undefined {
    return this.returns.get(eventId);
  }

  // Compute net impact for a sale (revenue reversal)
  getReturnImpactForSale(saleId: string): bigint {
    let total = 0n;
    for (const rec of this.returns.values()) {
      if (rec.originalSaleId === saleId) {
        total += rec.refundCents;
      }
    }
    return total;
  }
}