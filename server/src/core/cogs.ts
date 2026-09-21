// ============================================================
// COGS SERVICE
// ============================================================

import { FinancialEvent, FinancialEventType } from '../shared/types';

export interface CogsRecord {
  productId: string;
  amountCents: bigint;
  source: string;
  eventId: string;
  correlationId: string;
}

export class CogsService {
  private records = new Map<string, CogsRecord[]>(); // key: productId

  recordCogs(event: FinancialEvent): void {
    if (event.eventType !== FinancialEventType.COGS) return;
    const rec: CogsRecord = {
      productId: event.productId || 'unknown',
      amountCents: event.amountCents,
      source: event.source,
      eventId: event.id,
      correlationId: event.metadata?.correlation as string,
    };
    const arr = this.records.get(rec.productId) || [];
    arr.push(rec);
    this.records.set(rec.productId, arr);
  }

  getCogsForProduct(productId: string): CogsRecord[] {
    return this.records.get(productId) || [];
  }

  // Calculate total COGS for a sale event (simplistic: match by productId and correlation)
  getCogsForSale(productId: string, correlationId?: string): bigint {
    const recs = this.records.get(productId) || [];
    console.log('[COGS DEBUG] getCogsForSale productId', productId, 'records', recs.map(r=>r.amountCents.toString()));
    return recs.reduce((sum, r) => sum + r.amountCents, 0n);
  }
}