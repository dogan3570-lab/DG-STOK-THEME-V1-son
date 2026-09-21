// ============================================================
// ORCHESTRATOR
// ============================================================

import { FinancialEventEngine, RawFinancialInput } from './financial-event';
import { NormalizationService, GenericMarketplaceNormalizer } from './normalization';
import { EconomicIdentityResolver } from './economic-identity';
import { CorrelationResolver } from './correlation';
import { IdempotencyStore } from './idempotency';
import { CogsService } from './cogs';
import { ReturnService } from './return';
import { SnapshotService, SnapshotInput } from './snapshot';
import { ProfitCalculator } from './calculator';
import { AIService } from './ai';
import { LearningFeedback } from './learning-feedback';
import { AnomalyDetector } from './engine/anomaly';
import { DataSource, DataSourceInfo, FinancialEvent, FinancialEventType, PeriodType } from '../shared/types';

function simpleUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class ProfitEngineOrchestrator {
  private eventEngine = new FinancialEventEngine();
  private normalization = new NormalizationService();
  private identityResolver = new EconomicIdentityResolver();
  private correlationResolver = new CorrelationResolver();
  private idempotency = new IdempotencyStore();
  private cogsService = new CogsService();
  private returnService = new ReturnService();
  private snapshotService = new SnapshotService();
  private anomalyDetector = new AnomalyDetector();
  
  private learningFeedback = new LearningFeedback();
  private aiService: AIService;
  private cumulativeNetProfitCents = 0n;

  constructor() {
    this.aiService = new AIService(this.learningFeedback);
    this.normalization.registerNormalizer('MARKETPLACE_API' as any, new GenericMarketplaceNormalizer());
  }

  getLearningFeedback(): LearningFeedback {
    return this.learningFeedback;
  }

  getSnapshot(id: string) {
    return this.snapshotService.getSnapshot(id);
  }

  async processFinancialEvent(raw: RawFinancialInput): Promise<{
    event: FinancialEvent;
    snapshotId: string;
    aiPrediction?: any;
    actualResult: any;
    learningUpdated: boolean;
    anomalyResult?: any;
  }> {
    // 1. Normalize
    const normalized = this.normalization.normalize(raw.source, raw);

    // 2. Process to FinancialEvent (includes identity, correlation, idempotency)
    const event = this.eventEngine.process(normalized, this.correlationResolver, this.identityResolver, this.idempotency);

    // 3. Record COGS / Return
    this.cogsService.recordCogs(event);
    this.returnService.recordReturn(event);

    // 4. Determine profit calculation inputs from event
    const profitInput = this.buildProfitInput(event);

    // 5. Deterministic profit calculation
    const sourceInfo: DataSourceInfo = {
      source: event.source,
      sourceId: event.sourceId,
      timestamp: event.eventDate,
      confidence: 1,
    };
    const profitResult = ProfitCalculator.calculate(profitInput, sourceInfo);

    // 6. Anomaly detection
    let anomalyResult = null;
    try {
      const expectedRate = 18; // default expected commission %
      const actualRate = (raw.metadata as any)?.commissionRate ?? expectedRate;
      anomalyResult = this.anomalyDetector.detectAllAnomalies(event.sourceId, event.marketplaceId || '', {
        commissionRate: expectedRate,
        actualCommissionRate: actualRate,
      });
    } catch {
      // anomaly detection failed -> ignore
    }

    // 8. AI Prediction (if available)
    let aiPrediction: any = null;
    try {
      aiPrediction = await this.aiService.predict(profitInput);
    } catch {
      // AI unavailable -> degraded
    }

    // 9. Create snapshot
    const snapshotInput = this.buildSnapshotInput(profitResult, 1, event);
    const snapshot = this.snapshotService.createSnapshot(snapshotInput);
    const snapshotId = snapshot.id;

    // 8. Actual result for learning (per-event profit, but cumulative for RETURN)
    const newCumulative = this.cumulativeNetProfitCents + profitResult.netProfitCents;
    const actualResult = {
      netProfitCents: event.eventType === FinancialEventType.RETURN ? newCumulative : profitResult.netProfitCents,
      operationalProfitCents: profitResult.operationalProfitCents,
    };
    // update cumulative for next events
    this.cumulativeNetProfitCents = newCumulative;

    // 9. Learning feedback
    let learningUpdated = false;
    if (aiPrediction) {
      const error = Number(actualResult.netProfitCents - (aiPrediction.netProfitCents || 0n));
      this.learningFeedback.recordOutcome({
        prediction: aiPrediction,
        actual: actualResult,
        error,
        timestamp: new Date(),
      });
      learningUpdated = true;
    }

    return { event, snapshotId, aiPrediction, actualResult, learningUpdated, anomalyResult };
  }

  private buildProfitInput(event: FinancialEvent) {
    const correlationId = (event.metadata?.correlation as string) || '';
    const productId = event.productId || '';
    console.log('[PROFIT DEBUG] eventType', event.eventType, 'productId', productId, 'correlationId', correlationId);
    // Determine COGS for SALE from recorded COGS service
    const cogsCents = event.eventType === FinancialEventType.SALE
      ? this.cogsService.getCogsForSale(productId, correlationId)
      : event.eventType === FinancialEventType.COGS ? event.amountCents : 0n;

    // Return cost from return service (simplified)
    const returnCostCents = event.eventType === FinancialEventType.RETURN ? event.amountCents : 0n;

    return {
      grossSalesCents: event.eventType === FinancialEventType.SALE ? event.amountCents : 0n,
      discountCents: event.eventType === FinancialEventType.DISCOUNT ? event.amountCents : 0n,
      productCostCents: cogsCents,
      commissionCents: event.eventType === FinancialEventType.COMMISSION ? event.amountCents : 0n,
      shippingCostCents: event.eventType === FinancialEventType.SHIPPING ? event.amountCents : 0n,
      serviceFeeCents: event.eventType === FinancialEventType.SERVICE_FEE ? event.amountCents : 0n,
      stopajCents: event.eventType === FinancialEventType.STOPAJ ? event.amountCents : 0n,
      advertisingCents: event.eventType === FinancialEventType.ADVERTISING ? event.amountCents : 0n,
      marketingCents: event.eventType === FinancialEventType.ADVERTISING ? event.amountCents : 0n,
      returnCostCents: event.eventType === FinancialEventType.RETURN ? event.amountCents : 0n,
      otherExpensesCents: 0n,
      vatRate: 20,
    };
  }

  private buildSnapshotInput(profitResult: any, eventCount: number, event: FinancialEvent): SnapshotInput {
    return {
      periodType: PeriodType.DAILY,
      periodStart: new Date(event.eventDate.getFullYear(), event.eventDate.getMonth(), event.eventDate.getDate()),
      periodEnd: new Date(event.eventDate.getFullYear(), event.eventDate.getMonth(), event.eventDate.getDate(), 23, 59, 59),
      grossSalesCents: profitResult.grossSalesCents,
      discountCents: profitResult.discountCents,
      netSalesCents: profitResult.netSalesCents,
      productCostCents: profitResult.productCostCents,
      commissionCents: profitResult.commissionCents,
      shippingCents: profitResult.shippingCostCents,
      serviceFeeCents: profitResult.serviceFeeCents,
      stopajCents: profitResult.stopajCents,
      advertisingCents: profitResult.advertisingCents,
      marketingCents: profitResult.marketingCents,
      returnCostCents: profitResult.returnCostCents,
      otherExpensesCents: profitResult.otherExpensesCents,
      totalExpensesCents: profitResult.productCostCents + profitResult.commissionCents + profitResult.shippingCostCents + profitResult.serviceFeeCents + profitResult.stopajCents + profitResult.advertisingCents + profitResult.marketingCents + profitResult.returnCostCents + profitResult.otherExpensesCents,
      vatRate: 20,
      vatBaseCents: profitResult.vatBaseCents,
      vatPayableCents: profitResult.vatPayableCents,
      operationalProfitCents: profitResult.operationalProfitCents,
      netProfitCents: profitResult.netProfitCents,
      profitMargin: profitResult.profitMargin,
      roi: profitResult.roi,
      calculationVersion: 'v2.0.0',
      calculationInputHash: simpleUuid(),
      eventCount: 1,
    };
  }
}