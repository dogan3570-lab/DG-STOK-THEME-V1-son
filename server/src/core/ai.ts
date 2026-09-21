// ============================================================
// AI SERVICE (stub with fallback)
// ============================================================

export interface AIPrediction {
  netProfitCents?: bigint;
  operationalProfitCents?: bigint;
  commissionCents?: bigint;
  cogsCents?: bigint;
  confidence: number; // 0-1
  model: string;
  features?: Record<string, unknown>;
  timestamp: Date;
}

import { LearningFeedback } from './learning-feedback';

export class AIService {
  private available = true;
  private learningFeedback?: LearningFeedback;

  constructor(learningFeedback?: LearningFeedback) {
    this.learningFeedback = learningFeedback;
  }

  async predict(input: any): Promise<AIPrediction> {
    if (!this.available) throw new Error('AI unavailable');

    // Simple deterministic heuristic prediction (placeholder for real ML model)
    const gross = BigInt(input.grossSalesCents || 0);
    const cost = BigInt(input.productCostCents || 0);
    const commission = BigInt(input.commissionCents || 0);
    let predictedNet = gross - cost - commission;

    // Apply learning feedback if available
    if (this.learningFeedback) {
      const avgError = this.learningFeedback.getAverageError(); // in cents (number)
      if (avgError !== 0) {
        const errorCents = BigInt(Math.round(avgError));
        predictedNet = predictedNet - errorCents;
      }
    }

    return {
      netProfitCents: predictedNet,
      operationalProfitCents: predictedNet,
      confidence: 0.75,
      model: 'heuristic-v1',
      features: { gross: input.grossSalesCents, cost: input.productCostCents, commission: input.commissionCents },
      timestamp: new Date(),
    };
  }

  setAvailability(avail: boolean) {
    this.available = avail;
  }

  isAvailable(): boolean {
    return this.available;
  }
}