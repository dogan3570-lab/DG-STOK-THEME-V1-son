// ============================================================
// PROFIT-V2 (VENDORED) — PERSISTENT LEARNING
// OFFICIAL/OBSERVED/LEARNED/ESTIMATE ayrımı; resmi kuralı değiştirmez.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  LearningMetricKey, LearningScope, Observation, ObservationInput, LearnedEstimate, ResolvedEstimate,
  EstimateStatus, PersistedLearningState, PersistedObservation, LEARNING_STATE_VERSION,
} from './types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const FILE_NAME = 'learning-state.json';

export const MIN_SAMPLES = 10;
export const CONFIDENCE_CONFIRM = 0.7;
export const OUTLIER_K = 3.5;
export const LEARNING_METHOD = 'median+mad';

export function resolveStateFile(): string {
  const o = process.env.DG_LEARNING_STATE_FILE;
  if (o && o.trim()) return o;
  return path.join(DEFAULT_DATA_DIR, FILE_NAME);
}

export function stableStringify(value: unknown): string { return JSON.stringify(sortDeep(value), null, 2); }
function sortDeep(v: any): any {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') { const o: Record<string, any> = {}; for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]); return o; }
  return v;
}
function ensureDir(f: string): void { const d = path.dirname(f); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function isValid(s: any): s is PersistedLearningState { return s && typeof s === 'object' && s.version === LEARNING_STATE_VERSION && Array.isArray(s.observations); }

export function saveState(state: PersistedLearningState): boolean {
  const file = resolveStateFile(); const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    ensureDir(file);
    fs.writeFileSync(tmp, stableStringify({ version: LEARNING_STATE_VERSION, savedAt: new Date().toISOString(), observations: state.observations }), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) { console.error('[profit-v2/learning] save failed:', e); try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ } return false; }
}
export function loadState(): PersistedLearningState | null {
  const file = resolveStateFile();
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8'); if (!raw.trim()) return null;
    const p = JSON.parse(raw);
    if (!isValid(p)) { quarantine(file, 'invalid-schema'); return null; }
    return p;
  } catch { try { quarantine(file, 'parse-error'); } catch { /* ignore */ } console.error('[profit-v2/learning] load failed, quarantined'); return null; }
}
function quarantine(file: string, reason: string): void { try { fs.renameSync(file, `${file}.corrupt-${Date.now()}-${reason}`); } catch { /* ignore */ } }
export function deleteState(): void { try { const f = resolveStateFile(); if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } }

function medianBigInt(values: bigint[]): bigint { if (!values.length) return 0n; const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); const n = s.length, m = Math.floor(n / 2); return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2n; }
function absB(v: bigint): bigint { return v < 0n ? -v : v; }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function round3(v: number): number { return Math.round(v * 1000) / 1000; }
function scopeKey(s: LearningScope): string { return `${s.marketplace}|${s.categoryId ?? '*'}|${s.productId ?? '*'}`; }
function normScope(i?: Partial<LearningScope>, fb = ''): LearningScope { return { marketplace: (i?.marketplace ?? fb) || '', categoryId: i?.categoryId ?? null, productId: i?.productId ?? null }; }
function toP(o: Observation): PersistedObservation { return { id: o.id, marketplace: o.marketplace, scope: { marketplace: o.scope.marketplace, categoryId: o.scope.categoryId ?? null, productId: o.scope.productId ?? null }, metric: o.metric, expectedCents: o.expectedCents.toString(), actualCents: o.actualCents.toString(), deviationCents: o.deviationCents.toString(), deviationPercent: o.deviationPercent, observedAt: o.observedAt, source: o.source, correlationId: o.correlationId ?? null, orderId: o.orderId ?? null, settlementId: o.settlementId ?? null }; }
function fromP(p: PersistedObservation): Observation { return Object.freeze({ id: p.id, marketplace: p.marketplace, scope: { marketplace: p.scope.marketplace, categoryId: p.scope.categoryId ?? null, productId: p.scope.productId ?? null }, metric: p.metric, expectedCents: BigInt(p.expectedCents), actualCents: BigInt(p.actualCents), deviationCents: BigInt(p.deviationCents), deviationPercent: p.deviationPercent, observedAt: p.observedAt, source: p.source, correlationId: p.correlationId ?? null, orderId: p.orderId ?? null, settlementId: p.settlementId ?? null }); }

export class LearningStore {
  private observations: Observation[] = [];
  private readonly persistenceEnabled: boolean;
  private readonly minSamples: number;
  private counter = 0;
  constructor(options: { persistence?: boolean; minSamples?: number } = {}) {
    this.persistenceEnabled = options.persistence !== false;
    this.minSamples = options.minSamples ?? MIN_SAMPLES;
    if (this.persistenceEnabled) this.restore();
  }
  private restore(): void { const s = loadState(); this.observations = s ? s.observations.map(fromP) : []; }
  save(): boolean { if (!this.persistenceEnabled) return false; return saveState({ version: LEARNING_STATE_VERSION, savedAt: new Date().toISOString(), observations: this.observations.map(toP) }); }
  addObservation(input: ObservationInput): { added: boolean; duplicate: boolean; observation: Observation | null } {
    const scope = normScope(input.scope, input.marketplace);
    const id = input.id ?? `obs-${Date.now()}-${process.pid}-${++this.counter}`;
    if (this.observations.some(o => o.id === id)) return { added: false, duplicate: true, observation: null };
    if (input.correlationId && this.observations.some(o => o.metric === input.metric && o.correlationId === input.correlationId && scopeKey(o.scope) === scopeKey(scope))) return { added: false, duplicate: true, observation: null };
    const dev = input.actualCents - input.expectedCents;
    const devPct = input.expectedCents !== 0n ? Number((absB(dev) * 10000n) / absB(input.expectedCents)) / 100 : (input.actualCents === 0n ? 0 : 100);
    const obs: Observation = Object.freeze({ id, marketplace: input.marketplace, scope, metric: input.metric, expectedCents: input.expectedCents, actualCents: input.actualCents, deviationCents: dev, deviationPercent: devPct, observedAt: input.observedAt ?? new Date().toISOString(), source: input.source ?? 'MANUAL', correlationId: input.correlationId ?? null, orderId: input.orderId ?? null, settlementId: input.settlementId ?? null });
    this.observations = [...this.observations, obs];
    if (this.persistenceEnabled) this.save();
    return { added: true, duplicate: false, observation: obs };
  }
  getObservations(filter?: { marketplace?: string; metric?: LearningMetricKey }): Observation[] {
    return this.observations.filter(o => (!filter?.marketplace || o.marketplace === filter.marketplace) && (!filter?.metric || o.metric === filter.metric));
  }
  count(): number { return this.observations.length; }
  clear(): void { this.observations = []; if (this.persistenceEnabled) this.save(); }
  estimate(metric: LearningMetricKey, scopeInput: LearningScope): LearnedEstimate {
    const scope = normScope(scopeInput, scopeInput.marketplace);
    const matching = this.observations.filter(o => o.metric === metric && scopeKey(o.scope) === scopeKey(scope));
    if (!matching.length) return { metric, scope, learnedValueCents: 0n, sampleCount: 0, effectiveSampleCount: 0, confidence: 0, status: 'NO_DATA', method: LEARNING_METHOD, lastObservedAt: null };
    const values = matching.map(o => o.actualCents);
    const med = medianBigInt(values);
    const mad = medianBigInt(values.map(v => absB(v - med)));
    const threshold = (mad * BigInt(Math.round(OUTLIER_K * 10))) / 10n;
    const kept = mad === 0n ? values : values.filter(v => absB(v - med) <= threshold);
    const eff = kept.length;
    const sampleFactor = eff >= this.minSamples ? 0.5 + 0.5 * Math.min(1, (eff - this.minSamples) / this.minSamples) : (eff / this.minSamples) * 0.5;
    const cv = med !== 0n ? Number((1483n * mad) / absB(med)) / 1000 : 0;
    const confidence = round3(clamp01(sampleFactor * clamp01(1 - cv)));
    const status: EstimateStatus = eff < this.minSamples ? 'LOW_CONFIDENCE' : confidence >= CONFIDENCE_CONFIRM ? 'CONFIRMED' : 'EMERGING';
    const lastObservedAt = matching.map(o => o.observedAt).sort().slice(-1)[0] ?? null;
    return { metric, scope, learnedValueCents: medianBigInt(kept), sampleCount: matching.length, effectiveSampleCount: eff, confidence, status, method: LEARNING_METHOD, lastObservedAt };
  }
  resolve(metric: LearningMetricKey, scope: LearningScope, officialValueCents: bigint | null): ResolvedEstimate {
    const est = this.estimate(metric, scope);
    const hasData = est.status !== 'NO_DATA';
    const high = est.status === 'CONFIRMED' && est.confidence >= CONFIDENCE_CONFIRM;
    const useOfficial = !high;
    const reason = est.status === 'NO_DATA' ? 'Gözlem yok. Resmi kural kullanılır.'
      : est.status === 'LOW_CONFIDENCE' ? `Yetersiz örnek (${est.effectiveSampleCount}/${this.minSamples}). Resmi kural kullanılır.`
      : !high ? `Güven yetersiz (${est.confidence}). Resmi kural kullanılır.`
      : `Önerilen learned estimate (${est.effectiveSampleCount} örnek, güven ${est.confidence}). Resmi kural DEĞİŞMEZ; yalnızca öneri.`;
    return { metric, scope: normScope(scope, scope.marketplace), officialValueCents, learnedValueCents: hasData ? est.learnedValueCents : null, suggestedValueCents: hasData ? est.learnedValueCents : null, sampleCount: est.sampleCount, confidence: est.confidence, status: est.status, useOfficial, reason };
  }
}
