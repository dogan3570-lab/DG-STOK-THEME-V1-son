/**
 * ERROR TAXONOMY — Category Core Pipeline
 *
 * Tüm hata türlerini birbirinden kesin olarak ayırır.
 * manualCount++ altında ezilmez.
 *
 * KURALLAR:
 *  - Schema değişikliği YOK
 *  - DB write YOK
 *  - Sadece runtime object / structured log
 */

// ==================== RESPONSE TEXT EXTRACTION ====================

/**
 * FIX(RT-ACC): LLM yanıt metnini tüm bilinen taşıyıcı alanlardan çıkarır.
 * Reasoning modelleri content:'' + reasoning_content/reasoning doldurabilir;
 * boş content çalışan modeli "ölü/boş" sanmamak için gerekli.
 * OpenAI chat formatı + delta stream formatı + output array formatı desteklenir.
 */
export function extractResponseText(data: any): string {
  const msg = data?.choices?.[0]?.message;
  const delta = data?.choices?.[0]?.delta;
  const candidates = [
    msg?.content,
    typeof msg?.content === 'object' && msg?.content !== null ? (msg.content.text ?? '') : undefined,
    msg?.reasoning_content,
    msg?.reasoning,
    data?.output_text,
    Array.isArray(data?.output)
      ? data.output.map((o: any) => o?.content?.map((c: any) => c?.text ?? '').join('')).join('')
      : undefined,
    delta?.content,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return '';
}

// ==================== ERROR STATUS TYPES ====================

export type ErrorStatus =
  | 'SUCCESS'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'PROVIDER_4XX'
  | 'PROVIDER_5XX'
  | 'PROVIDER_UNAVAILABLE'
  | 'EMPTY_RESPONSE'
  | 'MALFORMED_RESPONSE'
  | 'PARSE_ERROR'
  | 'SCHEMA_ERROR'
  | 'NO_CANDIDATE'
  | 'CANDIDATE_PRESENT'
  | 'AI_LOW_CONFIDENCE'
  | 'AI_INVALID_CATEGORY'
  | 'AI_DECISION_FAILURE'
  | 'VERIFICATION_FAIL'
  | 'VERIFICATION_ERROR'
  | 'VERIFICATION_EMPTY'
  | 'MAPPING_MISSING'
  | 'MAPPING_INACTIVE'
  | 'MAPPING_EXTERNAL_ID_MISSING'
  | 'NO_PROVIDER'
  | 'NO_KEY'
  | 'UNKNOWN';

// ==================== ERROR STAGE TYPES ====================

export type ErrorStage =
  | 'CANDIDATE'
  | 'AI_MATCH'
  | 'PARSER'
  | 'VERIFICATION'
  | 'MAPPING'
  | 'PROVIDER';

// ==================== ERROR SEMANTICS ====================

export type ErrorSemantics =
  | 'INFRA_FAILURE'        // Provider/altyapı hatası
  | 'AI_DECISION_FAILURE'  // AI karar veremedi
  | 'VERIFICATION_FAILURE' // Verification reddetti
  | 'CANDIDATE_FAILURE'    // Aday listesi yetersiz
  | 'DATA_FAILURE'         // Veri eksik/yanlış
  | 'SUCCESS';             // Başarılı

// ==================== STRUCTURED ERROR RESULT ====================

export interface StructuredErrorResult {
  status: ErrorStatus;
  stage: ErrorStage;
  semantics: ErrorSemantics;
  productId: string;
  batchId?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  retryCount?: number;
  timestamp: string;
  details?: string;
}

// ==================== BATCH ERROR SUMMARY ====================

export interface BatchErrorSummary {
  batchId: string;
  totalProducts: number;
  successCount: number;
  errorCount: number;
  errors: StructuredErrorResult[];
  errorBreakdown: Record<ErrorStatus, number>;
  semanticBreakdown: Record<ErrorSemantics, number>;
}

// ==================== ERROR CLASSIFIER ====================

/**
 * AI yanıtını error status'e çevirir.
 * parseAndValidateMatches sonrası boş dönerse → EMPTY_RESPONSE veya MALFORMED_RESPONSE
 */
export function classifyAiResponse(
  content: string | null,
  productId: string,
  model: string,
  provider: string
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (content === null || content === undefined) {
    return { status: 'EMPTY_RESPONSE', stage: 'AI_MATCH', semantics: 'INFRA_FAILURE' };
  }
  if (content.trim() === '') {
    return { status: 'EMPTY_RESPONSE', stage: 'AI_MATCH', semantics: 'INFRA_FAILURE' };
  }
  if (content === '[]' || content === '{}' || content === 'null') {
    return { status: 'EMPTY_RESPONSE', stage: 'AI_MATCH', semantics: 'INFRA_FAILURE' };
  }
  // JSON parse edilebilir mi?
  try {
    const cleaned = content.trim().startsWith('```')
      ? content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      : content;
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { status: 'MALFORMED_RESPONSE', stage: 'PARSER', semantics: 'INFRA_FAILURE' };
    }
    JSON.parse(jsonMatch[0]);
    // JSON geçerli ama parsing sonucu boş olabilir
    return { status: 'SUCCESS', stage: 'AI_MATCH', semantics: 'SUCCESS' };
  } catch {
    return { status: 'PARSE_ERROR', stage: 'PARSER', semantics: 'INFRA_FAILURE' };
  }
}

/**
 * AI kararını error status'e çevirir.
 * decision=NO_SAFE_MATCH veya confidence < threshold ise → AI_DECISION_FAILURE
 */
export function classifyAiDecision(
  decision: 'MATCH' | 'NO_SAFE_MATCH' | undefined,
  confidence: number,
  categoryId: string | null,
  validCategoryIds: Set<string>,
  productId: string
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (decision === 'NO_SAFE_MATCH') {
    return { status: 'AI_DECISION_FAILURE', stage: 'AI_MATCH', semantics: 'AI_DECISION_FAILURE' };
  }
  if (!categoryId) {
    return { status: 'AI_DECISION_FAILURE', stage: 'AI_MATCH', semantics: 'AI_DECISION_FAILURE' };
  }
  if (!validCategoryIds.has(categoryId)) {
    return { status: 'AI_INVALID_CATEGORY', stage: 'AI_MATCH', semantics: 'AI_DECISION_FAILURE' };
  }
  if (confidence < 0.85) {
    return { status: 'AI_LOW_CONFIDENCE', stage: 'AI_MATCH', semantics: 'AI_DECISION_FAILURE' };
  }
  if (confidence < 0.95) {
    return { status: 'AI_LOW_CONFIDENCE', stage: 'AI_MATCH', semantics: 'AI_DECISION_FAILURE' };
  }
  return { status: 'SUCCESS', stage: 'AI_MATCH', semantics: 'SUCCESS' };
}

/**
 * Verification sonucunu error status'e çevirir.
 */
export function classifyVerification(
  verdict: boolean,
  verificationConfidence: number,
  productId: string
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (!verdict) {
    return { status: 'VERIFICATION_FAIL', stage: 'VERIFICATION', semantics: 'VERIFICATION_FAILURE' };
  }
  if (verificationConfidence < 0.9) {
    return { status: 'VERIFICATION_FAIL', stage: 'VERIFICATION', semantics: 'VERIFICATION_FAILURE' };
  }
  return { status: 'SUCCESS', stage: 'VERIFICATION', semantics: 'SUCCESS' };
}

/**
 * Provider hatasını error status'e çevirir.
 */
export function classifyProviderError(
  errorCode: string | undefined,
  errorMsg: string | undefined
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (!errorCode) {
    return { status: 'UNKNOWN', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
  }
  switch (errorCode) {
    case 'RATE_LIMIT':
      return { status: 'RATE_LIMIT', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'TIMEOUT':
      return { status: 'TIMEOUT', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'SERVER_ERROR':
      return { status: 'PROVIDER_5XX', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'INVALID_KEY':
    case 'FORBIDDEN':
      return { status: 'PROVIDER_4XX', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'MODEL_NOT_FOUND':
    case 'MODEL_DEPRECATED':
    case 'UNSUPPORTED_MODEL':
      return { status: 'PROVIDER_UNAVAILABLE', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'NO_KEY':
      return { status: 'NO_KEY', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    case 'NO_AI_PROVIDER_AVAILABLE':
    case 'NO_MODEL_AVAILABLE':
      return { status: 'NO_PROVIDER', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
    default:
      return { status: 'UNKNOWN', stage: 'PROVIDER', semantics: 'INFRA_FAILURE' };
  }
}

/**
 * Mapping hatasını error status'e çevirir.
 */
export function classifyMappingError(
  categoryId: string | null,
  mappingExists: boolean,
  mappingActive: boolean,
  externalId: string | null
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (!categoryId) {
    return { status: 'MAPPING_MISSING', stage: 'MAPPING', semantics: 'DATA_FAILURE' };
  }
  if (!mappingExists) {
    return { status: 'MAPPING_MISSING', stage: 'MAPPING', semantics: 'DATA_FAILURE' };
  }
  if (!mappingActive) {
    return { status: 'MAPPING_INACTIVE', stage: 'MAPPING', semantics: 'DATA_FAILURE' };
  }
  if (externalId === null) {
    return { status: 'MAPPING_EXTERNAL_ID_MISSING', stage: 'MAPPING', semantics: 'DATA_FAILURE' };
  }
  return { status: 'SUCCESS', stage: 'MAPPING', semantics: 'SUCCESS' };
}

/**
 * Candidate sayısını error status'e çevirir.
 */
export function classifyCandidateResult(
  candidateCount: number,
  productId: string
): { status: ErrorStatus; stage: ErrorStage; semantics: ErrorSemantics } {
  if (candidateCount === 0) {
    return { status: 'NO_CANDIDATE', stage: 'CANDIDATE', semantics: 'CANDIDATE_FAILURE' };
  }
  return { status: 'CANDIDATE_PRESENT', stage: 'CANDIDATE', semantics: 'SUCCESS' };
}
