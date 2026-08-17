import type { NormalizedProviderError } from './types.ts';

/**
 * Provider HTTP durumunu normalize, stabilize ve güvenli (raw body içermeyen)
 * bir hata sözleşmesine çevirir.
 *
 * Retry politikası:
 * - 400/422 validation → permanent, retry YOK
 * - 401/403 credential  → permanent, retry YOK
 * - 404 resource        → permanent, retry YOK
 * - 409 duplicate       → permanent, retry YOK
 * - 429 cooldown        → retryable (bounded, Retry-After değerlendirilir)
 * - 5xx                 → retryable (bounded, exponential backoff)
 */
export function classifyHttpStatus(status: number, retryAfterSeconds: number | null): NormalizedProviderError {
  if (status === 400 || status === 422) {
    return { code: 'VALIDATION_ERROR', message: 'Pazaryeri isteği geçersiz', retryable: false, permanent: true, cooldownMs: null, httpStatus: status };
  }
  if (status === 401 || status === 403) {
    return { code: 'CREDENTIAL_ERROR', message: 'Pazaryeri kimlik bilgisi hatası', retryable: false, permanent: true, cooldownMs: null, httpStatus: status };
  }
  if (status === 404) {
    return { code: 'RESOURCE_NOT_FOUND', message: 'Pazaryeri kaynağı bulunamadı', retryable: false, permanent: true, cooldownMs: null, httpStatus: status };
  }
  if (status === 409) {
    return { code: 'DUPLICATE', message: 'Kayıt zaten mevcut', retryable: false, permanent: true, cooldownMs: null, httpStatus: status };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMIT',
      message: 'Pazaryeri istek limiti aşıldı',
      retryable: true,
      permanent: false,
      cooldownMs: retryAfterSeconds ? retryAfterSeconds * 1000 : null,
      httpStatus: status,
    };
  }
  if (status >= 500) {
    return { code: 'PROVIDER_ERROR', message: 'Pazaryeri sunucu hatası', retryable: true, permanent: false, cooldownMs: null, httpStatus: status };
  }
  return { code: 'PROVIDER_ERROR', message: 'Pazaryeri beklenmeyen hata', retryable: false, permanent: true, cooldownMs: null, httpStatus: status };
}

export function timeoutError(): NormalizedProviderError {
  return { code: 'TIMEOUT', message: 'Pazaryeri isteği zaman aşımına uğradı', retryable: true, permanent: false, cooldownMs: null, httpStatus: null };
}

export function networkError(): NormalizedProviderError {
  return { code: 'NETWORK_ERROR', message: 'Pazaryerine ulaşılamadı', retryable: true, permanent: false, cooldownMs: null, httpStatus: null };
}

export function ssrfBlockedError(reason: string): NormalizedProviderError {
  return { code: 'SSRF_BLOCKED', message: `Hedef adres güvenlik nedeniyle engellendi (${reason})`, retryable: false, permanent: true, cooldownMs: null, httpStatus: null };
}

export function notConfiguredError(): NormalizedProviderError {
  return { code: 'NOT_CONFIGURED', message: 'Pazaryeri yapılandırılmamış', retryable: false, permanent: true, cooldownMs: null, httpStatus: null };
}

/** Trendyol numeric category/brand/attribute mapping eksik veya geçersiz. Sahte ID ÜRETİLMEZ. */
export function mappingNotFoundError(what: string): NormalizedProviderError {
  return {
    code: 'MAPPING_NOT_FOUND',
    message: `Pazaryeri mapping bulunamadı veya geçersiz: ${what}`,
    retryable: false,
    permanent: true,
    cooldownMs: null,
    httpStatus: null,
  };
}

/** Zorunlu ürün verisi (desi, listPrice vb.) sistemde mevcut değil. 0/tahmin ÜRETİLMEZ. */
export function dataMissingError(what: string): NormalizedProviderError {
  return {
    code: 'DATA_MISSING',
    message: `Zorunlu ürün verisi eksik: ${what}`,
    retryable: false,
    permanent: true,
    cooldownMs: null,
    httpStatus: null,
  };
}

/** Trendyol batch kuyruğa alındı; ürün onay/batch işlemi devam ediyor (ACTIVE DEĞİL). */
export function approvalPendingError(): NormalizedProviderError {
  return {
    code: 'APPROVAL_PENDING',
    message: 'Ürün Trendyol kuyruğuna alındı; onay/batch işlemi devam ediyor',
    retryable: true,
    permanent: false,
    cooldownMs: null,
    httpStatus: null,
  };
}
