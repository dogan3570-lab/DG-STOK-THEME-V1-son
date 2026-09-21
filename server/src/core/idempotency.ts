// ============================================================
// IDEMPOTENCY STORE
// ============================================================

export class IdempotencyStore {
  private processed = new Set<string>();

  isProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  markProcessed(key: string): void {
    this.processed.add(key);
  }

  // For testing / reset
  clear(): void {
    this.processed.clear();
  }
}