import { prisma } from '../../db/prisma.ts';
import { decryptCredential } from '../crypto.ts';
import { getAdapter } from './registry.ts';
import { requestWithBoundedRetry } from './httpClient.ts';
import { classifyHttpStatus, notConfiguredError, ssrfBlockedError } from './errors.ts';
import type {
  DecryptedMarketplaceCredentials,
  MarketplaceInventoryUpdatePayload,
  MarketplaceKey,
  MarketplaceListingPayload,
  MarketplaceSendResult,
  NormalizedProviderError,
} from './types.ts';

export interface MarketplaceApiCallInput {
  marketplaceId: string;
  payload: MarketplaceListingPayload;
}

function safeParse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  } catch {
    /* bozuk settings boş kabul edilir */
  }
  return {};
}

function unconfiguredResult(provider: string, error: NormalizedProviderError): MarketplaceSendResult {
  return {
    ok: false,
    provider: provider as MarketplaceSendResult['provider'],
    externalListingId: null,
    listingUrl: null,
    externalRef: null,
    httpStatus: null,
    error,
    configured: false,
  };
}

/**
 * Marketplace adapter üzerinden gerçek gönderim.
 *
 * GÜVENLİK SÖZLEŞMESİ:
 * - Credential yalnızca burada, istek anında decrypt edilir; hiçbir yere loglanmaz/dönmez.
 * - Sahte ACTIVE/SENT/listingId ÜRETİLMEZ. Başarı yalnızca adapter.parseResponse
 *   gerçek 2xx + gerçek external id doğruladığında döner.
 * - SSRF guard devreye girer; private/internal hedefler engellenir.
 * - Raw provider body hiçbir yere dönmez/loglanmaz.
 *
 * NOT: Bu servis henüz hiçbir route'a bağlanmamıştır (Gönderim Merkezi korunur).
 * Gerçek marketplace uçlarına canlı doğrulama: NOT VERIFIED.
 */
export interface MarketplaceInventoryUpdateResult {
  ok: boolean;
  provider: MarketplaceKey;
  httpStatus: number | null;
  error: NormalizedProviderError | null;
  configured: boolean;
}

function inventoryError(provider: string, error: NormalizedProviderError, configured: boolean): MarketplaceInventoryUpdateResult {
  return { ok: false, provider: provider as MarketplaceInventoryUpdateResult['provider'], httpStatus: null, error, configured };
}

/**
 * Stok otomasyonu satış aç/kapat — gerçek marketplace envanter güncellemesi.
 *
 * GÜVENLİK SÖZLEŞMESİ (sendListingToMarketplace ile aynı):
 * - Credential yalnızca istek anında decrypt edilir; loglanmaz.
 * - Sahte başarı YOK: yalnızca gerçek 2xx yanıt ok:true döner.
 * - Adapter envanter güncellemeyi desteklemiyorsa UNSUPPORTED döner (fail-closed).
 */
export async function updateMarketplaceInventory(input: {
  marketplaceId: string;
  payload: MarketplaceInventoryUpdatePayload;
}): Promise<MarketplaceInventoryUpdateResult> {
  const mp = await prisma.marketplace.findUnique({ where: { id: input.marketplaceId } });
  const adapter = mp ? getAdapter(mp.key) : null;

  if (!mp || !adapter) {
    return inventoryError(mp?.key ?? 'tt', {
      code: 'MARKETPLACE_NOT_FOUND', message: 'Pazaryeri bulunamadı', retryable: false, permanent: true, cooldownMs: null, httpStatus: null,
    }, false);
  }

  if (!adapter.buildInventoryUpdateRequest) {
    return inventoryError(adapter.key, {
      code: 'UNSUPPORTED', message: 'Bu pazaryeri için satış aç/kapat desteklenmiyor', retryable: false, permanent: true, cooldownMs: null, httpStatus: null,
    }, true);
  }

  const settings = safeParse(mp.settings);
  const refreshTokenEnc = typeof settings.refreshTokenEnc === 'string' ? settings.refreshTokenEnc : null;
  const cred: DecryptedMarketplaceCredentials = {
    apiKey: mp.apiKey ? decryptCredential(mp.apiKey) : null,
    apiSecret: mp.apiSecret ? decryptCredential(mp.apiSecret) : null,
    refreshToken: refreshTokenEnc ? decryptCredential(refreshTokenEnc) : null,
    merchantId: mp.merchantId,
    sellerId: typeof settings.sellerId === 'string' ? settings.sellerId : null,
    storeId: mp.storeId,
  };

  const validationError = adapter.validateCredentials(cred);
  if (validationError) {
    return inventoryError(adapter.key, validationError, true);
  }

  if (!mp.apiUrl) {
    return inventoryError(adapter.key, notConfiguredError(), true);
  }

  const request = adapter.buildInventoryUpdateRequest(cred, input.payload, mp.apiUrl);
  if (!request) {
    return inventoryError(adapter.key, {
      code: 'UNSUPPORTED', message: 'Ürün envanter güncellemesi için gerekli alan eksik (ör. barkod)', retryable: false, permanent: true, cooldownMs: null, httpStatus: null,
    }, true);
  }

  try {
    const response = await requestWithBoundedRetry(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, provider: adapter.key, httpStatus: response.status, error: null, configured: true };
    }
    return inventoryError(adapter.key, classifyHttpStatus(response.status, null), true);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('SSRF_BLOCKED_')) {
      return inventoryError(adapter.key, ssrfBlockedError(e.message.slice('SSRF_BLOCKED_'.length)), true);
    }
    if (e instanceof Error && e.message === 'TIMEOUT') {
      return inventoryError(adapter.key, {
        code: 'TIMEOUT', message: 'Pazaryeri isteği zaman aşımına uğradı', retryable: false, permanent: false, cooldownMs: null, httpStatus: null,
      }, true);
    }
    return inventoryError(adapter.key, {
      code: 'NETWORK_ERROR', message: 'Pazaryerine ulaşılamadı', retryable: false, permanent: false, cooldownMs: null, httpStatus: null,
    }, true);
  }
}

export async function sendListingToMarketplace(input: MarketplaceApiCallInput): Promise<MarketplaceSendResult> {
  const mp = await prisma.marketplace.findUnique({ where: { id: input.marketplaceId } });
  const adapter = mp ? getAdapter(mp.key) : null;

  if (!mp || !adapter) {
    return unconfiguredResult(mp?.key ?? 'tt', {
      code: 'MARKETPLACE_NOT_FOUND',
      message: 'Pazaryeri bulunamadı',
      retryable: false,
      permanent: true,
      cooldownMs: null,
      httpStatus: null,
    });
  }

  const settings = safeParse(mp.settings);
  const refreshTokenEnc = typeof settings.refreshTokenEnc === 'string' ? settings.refreshTokenEnc : null;
  const cred: DecryptedMarketplaceCredentials = {
    apiKey: mp.apiKey ? decryptCredential(mp.apiKey) : null,
    apiSecret: mp.apiSecret ? decryptCredential(mp.apiSecret) : null,
    refreshToken: refreshTokenEnc ? decryptCredential(refreshTokenEnc) : null,
    merchantId: mp.merchantId,
    sellerId: typeof settings.sellerId === 'string' ? settings.sellerId : null,
    storeId: mp.storeId,
  };

  const validationError = adapter.validateCredentials(cred);
  if (validationError) {
    return unconfiguredResult(adapter.key, validationError);
  }

  if (!mp.apiUrl) {
    return unconfiguredResult(adapter.key, notConfiguredError());
  }

  const request = adapter.buildRequest(cred, input.payload, mp.apiUrl);

  try {
    const response = await requestWithBoundedRetry(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return adapter.parseResponse(response.status, response.body);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('SSRF_BLOCKED_')) {
      const reason = e.message.slice('SSRF_BLOCKED_'.length);
      return unconfiguredResult(adapter.key, ssrfBlockedError(reason));
    }
    if (e instanceof Error && e.message === 'TIMEOUT') {
      return unconfiguredResult(adapter.key, {
        code: 'TIMEOUT',
        message: 'Pazaryeri isteği zaman aşımına uğradı',
        retryable: false,
        permanent: false,
        cooldownMs: null,
        httpStatus: null,
      });
    }
    return unconfiguredResult(adapter.key, {
      code: 'NETWORK_ERROR',
      message: 'Pazaryerine ulaşılamadı',
      retryable: false,
      permanent: false,
      cooldownMs: null,
      httpStatus: null,
    });
  }
}
