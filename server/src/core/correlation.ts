// ============================================================
// CORRELATION RESOLVER
// ============================================================

import { FinancialEventType, DataSource } from '../shared/types';

export interface CorrelationContext {
  orderId?: string;
  productId?: string;
  marketplaceId?: string;
  settlementId?: string;
  returnId?: string;
  commissionId?: string;
}

export class CorrelationResolver {
  private cache = new Map<string, string>();

  resolve(raw: any, economicIdentity: string): string {
    const ctx: CorrelationContext = {
      orderId: raw.orderId,
      productId: raw.productId,
      marketplaceId: raw.marketplaceId,
      settlementId: raw.metadata?.settlement_id,
      returnId: raw.metadata?.return_id,
      commissionId: raw.metadata?.commission_id,
    };

    const key = this.buildKey(ctx);
    if (this.cache.has(key)) return this.cache.get(key)!;

    // deterministic correlation id: hash of key
    const correlationId = `corr:${this.simpleHash(key)}`;
    this.cache.set(key, correlationId);
    return correlationId;
  }

  private buildKey(ctx: CorrelationContext): string {
    return [
      ctx.orderId || 'no-order',
      ctx.productId || 'no-product',
      ctx.marketplaceId || 'no-marketplace',
      ctx.settlementId || 'no-settlement',
      ctx.returnId || 'no-return',
      ctx.commissionId || 'no-commission',
    ].join('|');
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}