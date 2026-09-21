// ============================================================
// NORMALIZATION
// ============================================================

import { RawFinancialInput, FinancialEventEngine } from './financial-event';
import { DataSource } from '../shared/types';

export interface MarketplaceNormalizer {
  normalize(raw: unknown): RawFinancialInput;
}

export class NormalizationService {
  private normalizers = new Map<DataSource, MarketplaceNormalizer>();

  constructor() {
    // Register default normalizers
    this.registerNormalizer(DataSource.MARKETPLACE_API, new GenericMarketplaceNormalizer());
    // Register additional source normalizers for multi-source support
    this.registerNormalizer('SOURCE_A' as DataSource, new SourceANormalizer());
    this.registerNormalizer('SOURCE_B' as DataSource, new SourceBNormalizer());
  }

  registerNormalizer(source: DataSource, normalizer: MarketplaceNormalizer) {
    this.normalizers.set(source, normalizer);
  }

  normalize(source: DataSource, raw: unknown): RawFinancialInput {
    const normalizer = this.normalizers.get(source);
    if (!normalizer) {
      throw new Error(`No normalizer registered for source: ${source}`);
    }
    return normalizer.normalize(raw);
  }
}

// Example normalizer for a generic marketplace JSON
export class GenericMarketplaceNormalizer implements MarketplaceNormalizer {
  normalize(raw: unknown): RawFinancialInput {
    const data = raw as any;
    if (!data) throw new Error('Empty raw data');
    return {
      source: DataSource.MARKETPLACE_API,
      sourceId: data.sourceId || data.id || data.event_id,
      type: this.mapType(data.type),
      timestamp: new Date(data.timestamp || data.created_at),
      amount: Number(data.amount),
      currency: data.currency || 'TRY',
      quantity: data.quantity || data.qty,
      productId: data.product_id || data.productId,
      orderId: data.order_id || data.orderId,
      orderItemId: data.order_item_id,
      marketplaceId: data.marketplace_id || data.marketplaceId,
      metadata: data.metadata || data.extra || data.meta,
    };
  }

  private mapType(t: string): any {
    const map: Record<string, any> = {
      sale: 'SALE',
      return: 'RETURN',
      cogs: 'COGS',
      commission: 'COMMISSION',
      vat: 'VAT',
      shipping: 'SHIPPING',
      discount: 'DISCOUNT',
      refund: 'REFUND',
      adjustment: 'ADJUSTMENT',
    };
    const key = (t || '').toLowerCase();
    return map[key] || 'OTHER';
  }
}

export class SourceANormalizer implements MarketplaceNormalizer {
  normalize(raw: unknown): RawFinancialInput {
    const data = raw as any;
    if (!data) throw new Error('Empty raw data');
    return {
      source: DataSource.MARKETPLACE_API,
      sourceId: data.id || data.event_id,
      type: this.mapType(data.type),
      timestamp: new Date(data.timestamp || data.created_at),
      amount: Number(data.amount),
      currency: data.currency || 'TRY',
      quantity: data.quantity || data.qty,
      productId: data.product_id,
      orderId: data.order_id,
      orderItemId: data.order_item_id,
      marketplaceId: data.marketplace_id,
      metadata: data,
    };
  }

  private mapType(t: string): any {
    const map: Record<string, any> = {
      sale: 'SALE',
      return: 'RETURN',
      cogs: 'COGS',
      commission: 'COMMISSION',
      vat: 'VAT',
      shipping: 'SHIPPING',
      discount: 'DISCOUNT',
      refund: 'REFUND',
      adjustment: 'ADJUSTMENT',
    };
    const key = (t || '').toLowerCase();
    return map[key] || 'OTHER';
  }
}

export class SourceBNormalizer implements MarketplaceNormalizer {
  normalize(raw: unknown): RawFinancialInput {
    const data = raw as any;
    if (!data) throw new Error('Empty raw data');
    return {
      source: DataSource.MARKETPLACE_API,
      sourceId: data.sourceId || data.id || data.event_id,
      type: this.mapType(data.type),
      timestamp: new Date(data.timestamp || data.created_at),
      amount: Number(data.amount),
      currency: data.currency || 'TRY',
      quantity: data.quantity || data.qty,
      productId: data.product_id,
      orderId: data.order_id,
      orderItemId: data.order_item_id,
      marketplaceId: data.marketplace_id,
      metadata: data,
    };
  }

  private mapType(t: string): any {
    const map: Record<string, any> = {
      sale: 'SALE',
      return: 'RETURN',
      cogs: 'COGS',
      commission: 'COMMISSION',
      vat: 'VAT',
      shipping: 'SHIPPING',
      discount: 'DISCOUNT',
      refund: 'REFUND',
      adjustment: 'ADJUSTMENT',
    };
    const key = (t || '').toLowerCase();
    return map[key] || 'OTHER';
  }
}