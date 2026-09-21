// ============================================================
// ECONOMIC IDENTITY RESOLVER
// ============================================================

import { FinancialEventType, DataSource } from '../shared/types';

export class EconomicIdentityResolver {
  resolve(eventType: FinancialEventType, raw: any): string {
    const prefix = this.prefixForType(eventType);
    const keyParts = [
      prefix,
      raw.orderId || 'no-order',
      raw.productId || 'no-product',
      raw.marketplaceId || 'no-marketplace',
    ];
    return keyParts.join(':');
  }

  private prefixForType(type: FinancialEventType): string {
    const map: Record<any, string> = {
      SALE: 'REVENUE',
      RETURN: 'REVENUE_REVERSAL',
      REFUND: 'REFUND',
      COGS: 'COST',
      COMMISSION: 'MARKETPLACE_COST',
      VAT: 'TAX',
      SHIPPING: 'LOGISTICS_COST',
      DISCOUNT: 'REVENUE_ADJUSTMENT',
      ADJUSTMENT: 'ADJUSTMENT',
      STOPAJ: 'TAX',
      ADVERTISING: 'MARKETING_COST',
      OTHER: 'OTHER',
    };
    return map[type] || 'UNKNOWN';
  }
}

// Helper to build identity string
function prefixParts(prefix: string) {
  return (parts: string[]) => `${prefix}:${parts.join(':')}`;
}