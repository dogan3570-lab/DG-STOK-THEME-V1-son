// ============================================================
// LEARNING FEEDBACK LOOP
// ============================================================

export interface LearningOutcome {
  prediction: any;
  actual: { netProfitCents: bigint; operationalProfitCents: bigint };
  error: number; // in cents
  timestamp: Date;
}

export class LearningFeedback {
  private history: LearningOutcome[] = [];

  recordOutcome(outcome: LearningOutcome): void {
    this.history.push(outcome);
  }

  getHistory(): LearningOutcome[] {
    return [...this.history];
  }

  // Simple moving average error for confidence calibration
  getAverageError(): number {
    if (this.history.length === 0) return 0;
    const sum = this.history.reduce((s, o) => s + Math.abs(o.error), 0);
    return sum / this.history.length;
  }

  // Could be used to adjust AI confidence
  getCalibration(): { avgError: number; count: number } {
    return { avgError: this.getAverageError(), count: this.history.length };
  }
}