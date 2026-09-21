// ============================================================
// HISTORICAL SNAPSHOT
// ============================================================

import { FinancialSnapshot, PeriodType, DataSource } from '../shared/types';

function simpleUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface SnapshotInput {
  periodType: PeriodType;
  periodStart: Date;
  periodEnd: Date;
  marketplaceId?: string;
  categoryIdSnapshot?: string;
  brandIdSnapshot?: string;
  productId?: string;
  // financial aggregates
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
  vatRate: number;
  vatBaseCents: bigint;
  vatPayableCents: bigint | null;
  operationalProfitCents: bigint;
  netProfitCents: bigint;
  profitMargin: number;
  roi: number;
  calculationVersion: string;
  calculationInputHash: string;
  eventCount: number;
}

export class SnapshotService {
  private snapshots = new Map<string, FinancialSnapshot>(); // key: snapshot id

  createSnapshot(input: SnapshotInput, previousSnapshotId?: string): FinancialSnapshot {
    const snapshot: FinancialSnapshot = {
      id: simpleUuid(),
      periodType: input.periodType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      marketplaceId: input.marketplaceId || '__ALL__',
      categoryIdSnapshot: input.categoryIdSnapshot || '__ALL__',
      brandIdSnapshot: input.brandIdSnapshot || '__ALL__',
      productId: input.productId || '__ALL__',
      revision: previousSnapshotId ? (this.snapshots.get(previousSnapshotId)?.revision || 0) + 1 : 1,
      previousSnapshotId,
      grossSalesCents: input.grossSalesCents,
      discountCents: input.discountCents,
      netSalesCents: input.netSalesCents,
      productCostCents: input.productCostCents,
      commissionCents: input.commissionCents,
      shippingCents: input.shippingCents,
      serviceFeeCents: input.serviceFeeCents,
      stopajCents: input.stopajCents,
      advertisingCents: input.advertisingCents,
      marketingCents: input.marketingCents,
      returnCostCents: input.returnCostCents,
      otherExpensesCents: input.otherExpensesCents,
      totalExpensesCents: input.totalExpensesCents,
      vatRate: input.vatRate,
      vatBaseCents: input.vatBaseCents,
      vatPayableCents: input.vatPayableCents,
      operationalProfitCents: input.operationalProfitCents,
      netProfitCents: input.netProfitCents,
      profitMargin: input.profitMargin,
      roi: input.roi,
      calculationVersion: input.calculationVersion,
      calculationInputHash: input.calculationInputHash,
      eventCount: input.eventCount,
      createdAt: new Date(),
    };
    Object.freeze(snapshot);
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  getSnapshot(id: string): FinancialSnapshot | undefined {
    return this.snapshots.get(id);
  }

  // Verify immutability: snapshot data should never change after creation
  verifyImmutability(id: string, original: FinancialSnapshot): boolean {
    const current = this.snapshots.get(id);
    if (!current) return false;
    // shallow compare relevant fields
    return current.netProfitCents === original.netProfitCents &&
           current.operationalProfitCents === original.operationalProfitCents &&
           current.grossSalesCents === original.grossSalesCents;
  }
}