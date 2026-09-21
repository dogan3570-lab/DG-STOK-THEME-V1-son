// ============================================================
// PROFIT-V2 (VENDORED) — AI BOUNDARY
// AI yalnızca yorum üretir; finansal sayı üretemez/değiştiremez.
// ============================================================

import {
  AggregateResult, AnalyticsMetricKey, AiInsight, AiInsightKind, AiSeverity, AiProvider, AiResult,
  FinancialFacts, MetricFact, RatioFact, LearningFact,
} from './types.ts';

export function formatCentsString(v: string | null): string {
  if (v === null) return 'VERİ YOK';
  const n = Number(v) / 100;
  if (!Number.isFinite(n)) return 'VERİ YOK';
  return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
}
export function renderInsight(text: string, facts: FinancialFacts): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, key) => {
    const m = facts.metrics.find(x => x.key === key);
    if (m) return formatCentsString(m.valueCents);
    const r = facts.ratios.find(x => x.key === key);
    if (r) return r.value === null ? 'VERİ YOK' : '%' + r.value.toFixed(2);
    const l = facts.learning.find(x => x.metric === key);
    if (l) return formatCentsString(l.learnedValueCents);
    return 'VERİ YOK';
  });
}

const CENTS_KEYS: AnalyticsMetricKey[] = ['revenue', 'discount', 'netSales', 'purchaseCost', 'commission', 'commissionVat', 'shipping', 'shippingVat', 'serviceFee', 'serviceFeeVat', 'withholding', 'returnCost', 'advertising', 'otherExpenses', 'inputVat', 'netVat', 'netProfit'];
export interface LearningEstimateInput { metric: string; officialValueCents: bigint | null; observedValueCents: bigint | null; learnedValueCents: bigint | null; confidence: number; sampleCount: number; status: string; }
export function buildFinancialFacts(agg: AggregateResult, learning: LearningEstimateInput[] = []): FinancialFacts {
  const metrics: MetricFact[] = CENTS_KEYS.map(k => { const v = agg.metrics[k]; return { key: k, valueCents: v.valueCents === null ? null : v.valueCents.toString(), status: v.status }; });
  const ratios: RatioFact[] = [
    { key: 'margin', value: agg.margin.value, status: agg.margin.status },
    { key: 'roi', value: agg.roi.value, status: agg.roi.status },
    { key: 'returnRate', value: agg.returnRate.value, status: agg.returnRate.status },
  ];
  const learningFacts: LearningFact[] = learning.map(l => ({ metric: l.metric, officialValueCents: l.officialValueCents === null ? null : l.officialValueCents.toString(), observedValueCents: l.observedValueCents === null ? null : l.observedValueCents.toString(), learnedValueCents: l.learnedValueCents === null ? null : l.learnedValueCents.toString(), confidence: l.confidence, sampleCount: l.sampleCount, status: l.status }));
  const notes: string[] = ['OFFICIAL (resmi kural) ≠ OBSERVED (gerçekleşen) ≠ LEARNED (türetilen) ≠ ESTIMATE (öneri).'];
  if (agg.dataQuality !== 'complete') notes.push('Veri kalitesi: ' + agg.dataQuality + '. Eksik alanlar VERİ YOK olarak işaretlenir.');
  return { period: `${agg.start} .. ${agg.end}`, marketplace: agg.filters.marketplace ?? null, timeZone: agg.timeZone, orderCount: agg.orderCount, returnCount: agg.returnCount, dataQuality: agg.dataQuality, metrics, ratios, learning: learningFacts, notes };
}

const KINDS: AiInsightKind[] = ['summary', 'trend', 'anomaly', 'data_gap', 'learning_suggestion'];
const SEVERITIES: AiSeverity[] = ['info', 'warn', 'critical'];
const FINANCIAL_KEY_RE = /(cents|amount|revenue|cost|commission|vat|profit|roi|margin|price|withholding|shipping|discount)/i;
export function containsFinancialNumber(text: string): boolean { if (/\d/.test(text)) return true; if (/[₺$€£]/.test(text)) return true; if (/%\s*\d/.test(text)) return true; return false; }
export function validateInsight(raw: any, facts: FinancialFacts): { valid: boolean; reason?: string } {
  if (!raw || typeof raw !== 'object') return { valid: false, reason: 'malformed: obje değil' };
  if (typeof raw.id !== 'string' || !raw.id) return { valid: false, reason: 'malformed: id yok' };
  if (!KINDS.includes(raw.kind)) return { valid: false, reason: 'malformed: kind geçersiz' };
  if (!SEVERITIES.includes(raw.severity)) return { valid: false, reason: 'malformed: severity geçersiz' };
  if (typeof raw.text !== 'string' || !raw.text.trim()) return { valid: false, reason: 'malformed: text yok' };
  if (!Array.isArray(raw.references)) return { valid: false, reason: 'malformed: references dizi değil' };
  for (const key of Object.keys(raw)) if (FINANCIAL_KEY_RE.test(key)) return { valid: false, reason: `finansal alan yazımı reddedildi: ${key}` };
  if (containsFinancialNumber(raw.text)) return { valid: false, reason: 'halüsinasyon: metinde finansal sayı var (placeholder kullanılmalı)' };
  const known = new Set([...facts.metrics.map(m => m.key), ...facts.ratios.map(r => r.key), ...facts.learning.map(l => l.metric)]);
  for (const ref of raw.references) if (typeof ref !== 'string' || !known.has(ref)) return { valid: false, reason: `bilinmeyen referans: ${String(ref)}` };
  return { valid: true };
}
export function guardInsights(rawList: any, facts: FinancialFacts): { insights: AiInsight[]; rejectedCount: number; reasons: string[] } {
  if (!Array.isArray(rawList)) return { insights: [], rejectedCount: 0, reasons: ['malformed: dizi değil'] };
  const insights: AiInsight[] = []; const reasons: string[] = []; let rejected = 0;
  for (const raw of rawList) { const v = validateInsight(raw, facts); if (v.valid) insights.push({ id: raw.id, kind: raw.kind, severity: raw.severity, text: raw.text, references: raw.references }); else { rejected++; reasons.push(v.reason || 'geçersiz'); } }
  return { insights, rejectedCount: rejected, reasons };
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  constructor(private opts: { mode?: 'ok' | 'throw' | 'timeout' | 'empty' | 'malformed' | 'hallucinate' } = {}) {}
  async generate(facts: FinancialFacts, opts?: { timeoutMs?: number }): Promise<AiInsight[]> {
    const mode = this.opts.mode ?? 'ok';
    if (mode === 'throw') throw new Error('mock provider failure');
    if (mode === 'timeout') { await new Promise(r => setTimeout(r, (opts?.timeoutMs ?? 1000) + 500)); return []; }
    if (mode === 'empty') return [];
    if (mode === 'malformed') return [{ id: 'x' } as any];
    if (mode === 'hallucinate') return [{ id: 'h', kind: 'summary', severity: 'info', text: 'Net kâr 12345 TL ve marj %40 görünüyor.', references: ['netProfit'] }];
    const out: AiInsight[] = [];
    for (const m of facts.metrics) if (m.valueCents === null) out.push({ id: 'gap-' + m.key, kind: 'data_gap', severity: 'warn', text: `{{${m.key}}} için veri eksik; ilgili finansal sonuç hesaplanamıyor (VERİ YOK).`, references: [m.key] });
    out.push({ id: 'summary', kind: 'summary', severity: 'info', text: 'Bu dönem ciro {{revenue}}, net kâr {{netProfit}}, marj {{margin}}, ROI {{roi}} olarak deterministic motor tarafından hesaplandı.', references: ['revenue', 'netProfit', 'margin', 'roi'] });
    for (const l of facts.learning) {
      if (l.status === 'CONFIRMED') out.push({ id: 'learn-' + l.metric, kind: 'learning_suggestion', severity: 'info', text: `{{${l.metric}}} için öğrenilmiş tahmin mevcut (yalnızca öneri); resmi kural değişmez.`, references: [l.metric] });
      else if (l.status === 'LOW_CONFIDENCE') out.push({ id: 'learn-low-' + l.metric, kind: 'learning_suggestion', severity: 'warn', text: `{{${l.metric}}} için yetersiz örnek; resmi kural kullanılıyor.`, references: [l.metric] });
    }
    return out;
  }
}

export class AiAnalysisService {
  constructor(private provider: AiProvider = new MockAiProvider()) {}
  private static fallback(): AiInsight { return { id: 'ai-fallback', kind: 'summary', severity: 'info', text: 'AI yorumu kullanılamıyor; deterministic finansal sonuçlar geçerlidir.', references: [] }; }
  async analyze(facts: FinancialFacts, opts: { timeoutMs?: number } = {}): Promise<AiResult> {
    const name = this.provider.name; const timeoutMs = opts.timeoutMs ?? 4000;
    let raw: any = null, err: string | undefined;
    try { let t: NodeJS.Timeout | null = null; const to = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('AI_TIMEOUT')), timeoutMs); }); raw = await Promise.race([this.provider.generate(facts, { timeoutMs }), to]); if (t) clearTimeout(t); }
    catch (e) { err = e instanceof Error ? e.message : String(e); }
    if (err) return { ok: false, provider: name, insights: [AiAnalysisService.fallback()], rejectedCount: 0, usedFallback: true, error: err };
    const g = guardInsights(raw, facts);
    if (!g.insights.length) return { ok: false, provider: name, insights: [AiAnalysisService.fallback()], rejectedCount: g.rejectedCount, usedFallback: true, error: g.reasons[0] || 'AI boş/geçersiz çıktı' };
    return { ok: true, provider: name, insights: g.insights, rejectedCount: g.rejectedCount, usedFallback: false };
  }
}
