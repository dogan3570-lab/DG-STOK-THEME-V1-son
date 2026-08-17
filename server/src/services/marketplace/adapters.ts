import type {
  AdapterRequest,
  DecryptedMarketplaceCredentials,
  MarketplaceAdapter,
  MarketplaceInventoryUpdatePayload,
  MarketplaceKey,
  MarketplaceListingPayload,
  MarketplaceSendResult,
  NormalizedProviderError,
} from './types.ts';
import { classifyHttpStatus } from './errors.ts';

/**
 * Ortak adapter iskeleti.
 * parseResponse ASLA sahte başarı üretmez: yalnızca gerçek 2xx yanıtı ve
 * yanıtta gerçek bir external listing id varsa ok:true döner.
 */
abstract class BaseAdapter implements MarketplaceAdapter {
  abstract readonly key: MarketplaceKey;
  abstract readonly displayName: string;
  /** Provider yanıtındaki external listing id alan adı. */
  protected abstract readonly listingIdField: string;

  abstract validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null;
  abstract buildRequest(
    cred: DecryptedMarketplaceCredentials,
    payload: MarketplaceListingPayload,
    apiUrl: string
  ): AdapterRequest;

  parseResponse(status: number, body: string): MarketplaceSendResult {
    if (status >= 200 && status < 300) {
      let externalListingId: string | null = null;
      try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const data = (json.data ?? json) as Record<string, unknown>;
        const id = data[this.listingIdField];
        if (typeof id === 'string' && id.trim()) externalListingId = id.trim();
        else if (typeof id === 'number' && Number.isFinite(id)) externalListingId = String(id);
      } catch {
        /* aşağıda PARSE_ERROR'a düşer */
      }

      if (!externalListingId) {
        return {
          ok: false,
          provider: this.key,
          externalListingId: null,
          listingUrl: null,
          externalRef: null,
          httpStatus: status,
          error: { code: 'PARSE_ERROR', message: 'Pazaryeri yanıtı ayrıştırılamadı', retryable: false, permanent: true, cooldownMs: null, httpStatus: status },
          configured: true,
        };
      }

      return {
        ok: true,
        provider: this.key,
        externalListingId,
        listingUrl: null,
        externalRef: externalListingId,
        httpStatus: status,
        error: null,
        configured: true,
      };
    }

    return {
      ok: false,
      provider: this.key,
      externalListingId: null,
      listingUrl: null,
      externalRef: null,
      httpStatus: status,
      error: classifyHttpStatus(status, null),
      configured: true,
    };
  }
}

function missing(field: string): NormalizedProviderError {
  return { code: 'CREDENTIAL_ERROR', message: `Eksik pazaryeri bilgisi: ${field}`, retryable: false, permanent: true, cooldownMs: null, httpStatus: null };
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

function jsonBody(payload: MarketplaceListingPayload): string {
  return JSON.stringify({
    barcode: payload.barcode,
    sku: payload.sku,
    title: payload.title,
    description: payload.description,
    price: payload.price,
    stock: payload.stock,
    vatRate: payload.vatRate,
    categoryExternalId: payload.categoryExternalId,
    brandName: payload.brandName,
    images: payload.images,
  });
}

/**
 * Trendyol resmi V2 sözleşmesi (developers.trendyol.com).
 * PROD base: https://apigw.trendyol.com/integration
 * STAGE base: https://stageapigw.trendyol.com/integration
 * DB'deki eski/yanlış apiUrl değerine güvenilmez; yalnızca "stage" işareti ortam seçimi için kullanılır.
 */
const TRENDYOL_PROD_BASE = 'https://apigw.trendyol.com/integration';
const TRENDYOL_STAGE_BASE = 'https://stageapigw.trendyol.com/integration';

function trendyolBaseUrl(apiUrl: string): string {
  return /stage/i.test(apiUrl) ? TRENDYOL_STAGE_BASE : TRENDYOL_PROD_BASE;
}

/** Trendyol V2 `items[]` elemanını resmi alan adlarıyla üretir. SAHTE alan/ID üretilmez. */
function buildTrendyolItem(payload: MarketplaceListingPayload): Record<string, unknown> {
  const images = (payload.images ?? []).slice(0, 8).map((url) => ({ url }));
  const attributes = Array.isArray(payload.attributes) ? payload.attributes : [];
  return {
    barcode: payload.barcode ?? '',
    title: payload.title ?? '',
    productMainId: payload.productMainId ?? payload.sku ?? payload.barcode ?? '',
    brandId: payload.brandId,
    categoryId: payload.categoryId,
    quantity: payload.quantity ?? payload.stock,
    stockCode: payload.stockCode ?? payload.sku ?? '',
    dimensionalWeight: payload.dimensionalWeight,
    description: payload.description ?? '',
    listPrice: payload.listPrice,
    salePrice: payload.price,
    vatRate: payload.vatRate,
    images,
    attributes,
  };
}

class TrendyolAdapter extends BaseAdapter {
  readonly key = 'tt' as const;
  readonly displayName = 'Trendyol';
  protected readonly listingIdField = 'batchRequestId';

  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null {
    if (!cred.apiKey) return missing('API Key');
    if (!cred.apiSecret) return missing('API Secret');
    if (!cred.sellerId) return missing('Satıcı ID');
    if (!/^\d+$/.test(String(cred.sellerId).trim())) {
      return { code: 'CREDENTIAL_ERROR', message: 'Satıcı ID sayısal olmalıdır', retryable: false, permanent: true, cooldownMs: null, httpStatus: null };
    }
    return null;
  }

  buildRequest(cred: DecryptedMarketplaceCredentials, payload: MarketplaceListingPayload, apiUrl: string): AdapterRequest {
    const sellerId = String(cred.sellerId ?? '').trim();
    return {
      url: `${trendyolBaseUrl(apiUrl)}/product/sellers/${sellerId}/v2/products`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cred.apiKey ?? '', cred.apiSecret ?? ''),
        'User-Agent': `${sellerId} - SelfIntegration`,
      },
      body: JSON.stringify({ items: [buildTrendyolItem(payload)] }),
    };
  }

  /**
   * Stok otomasyonu satış aç/kapat: Trendyol price-and-inventory (senkron 2xx).
   * quantity=0 satışı kapatır (stok tükenmiş), quantity>0 satışı açar.
   */
  buildInventoryUpdateRequest(
    cred: DecryptedMarketplaceCredentials,
    payload: MarketplaceInventoryUpdatePayload,
    apiUrl: string
  ): AdapterRequest | null {
    const sellerId = String(cred.sellerId ?? '').trim();
    const barcode = payload.barcode ?? '';
    if (!barcode) return null; // barkodsuz envanter güncellemesi desteklenmez (fail-closed)
    return {
      url: `${trendyolBaseUrl(apiUrl)}/product/sellers/${sellerId}/products/price-and-inventory`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cred.apiKey ?? '', cred.apiSecret ?? ''),
        'User-Agent': `${sellerId} - SelfIntegration`,
      },
      body: JSON.stringify({
        items: [{
          barcode,
          quantity: Math.max(0, Math.floor(payload.stock)),
          ...(payload.price !== null && Number.isFinite(payload.price) ? { salePrice: payload.price } : {}),
        }],
      }),
    };
  }

  /**
   * Resmi POST yanıtı yalnızca `{batchRequestId}` döner. Bu bir listing/product ID
   * DEĞİLDİR; externalListingId null kalır. Gerçek external ID yalnızca onaylı ürün
   * filtre servisinden (contentId/variantId) doğrulanınca yazılabilir.
   */
  override parseResponse(status: number, body: string): MarketplaceSendResult {
    if (status >= 200 && status < 300) {
      let batchRequestId: string | null = null;
      try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const data = (json.data ?? json) as Record<string, unknown>;
        const v = data.batchRequestId;
        if (typeof v === 'string' && v.trim()) batchRequestId = v.trim();
      } catch {
        /* PARSE_ERROR'a düşer */
      }

      if (!batchRequestId) {
        return {
          ok: false,
          provider: this.key,
          externalListingId: null,
          listingUrl: null,
          externalRef: null,
          httpStatus: status,
          error: { code: 'PARSE_ERROR', message: 'Pazaryeri yanıtı ayrıştırılamadı (batchRequestId yok)', retryable: false, permanent: true, cooldownMs: null, httpStatus: status },
          configured: true,
          batchRequestId: null,
        };
      }

      return {
        ok: true,
        provider: this.key,
        externalListingId: null,
        listingUrl: null,
        externalRef: batchRequestId,
        httpStatus: status,
        error: null,
        configured: true,
        batchRequestId,
      };
    }

    return {
      ok: false,
      provider: this.key,
      externalListingId: null,
      listingUrl: null,
      externalRef: null,
      httpStatus: status,
      error: classifyHttpStatus(status, null),
      configured: true,
      batchRequestId: null,
    };
  }
}

class HepsiburadaAdapter extends BaseAdapter {
  readonly key = 'he' as const;
  readonly displayName = 'Hepsiburada';
  protected readonly listingIdField = 'listingId';

  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null {
    if (!cred.apiKey) return missing('API Key');
    if (!cred.apiSecret) return missing('API Secret');
    if (!cred.merchantId) return missing('Merchant ID');
    return null;
  }

  buildRequest(cred: DecryptedMarketplaceCredentials, payload: MarketplaceListingPayload, apiUrl: string): AdapterRequest {
    return {
      url: `${apiUrl.replace(/\/+$/, '')}/listing/merchantid/${cred.merchantId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cred.apiKey ?? '', cred.apiSecret ?? ''),
      },
      body: jsonBody(payload),
    };
  }
}

class N11Adapter extends BaseAdapter {
  readonly key = 'n11' as const;
  readonly displayName = 'n11';
  protected readonly listingIdField = 'productSellerCode';

  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null {
    if (!cred.apiKey) return missing('API Key');
    if (!cred.apiSecret) return missing('API Secret');
    return null;
  }

  buildRequest(cred: DecryptedMarketplaceCredentials, payload: MarketplaceListingPayload, apiUrl: string): AdapterRequest {
    return {
      url: `${apiUrl.replace(/\/+$/, '')}/product`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cred.apiKey ?? '',
        'x-api-secret': cred.apiSecret ?? '',
      },
      body: jsonBody(payload),
    };
  }
}

class AmazonTrAdapter extends BaseAdapter {
  readonly key = 'amazon' as const;
  readonly displayName = 'Amazon.com.tr';
  protected readonly listingIdField = 'sku';

  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null {
    if (!cred.apiKey) return missing('Client ID');
    if (!cred.apiSecret) return missing('Client Secret');
    if (!cred.refreshToken) return missing('Refresh Token');
    if (!cred.storeId) return missing('Marketplace ID');
    return null;
  }

  buildRequest(cred: DecryptedMarketplaceCredentials, payload: MarketplaceListingPayload, apiUrl: string): AdapterRequest {
    return {
      url: `${apiUrl.replace(/\/+$/, '')}/listings/2021-08-01/items/${cred.sellerId ?? 'default'}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-amz-access-token': cred.refreshToken ?? '',
      },
      body: jsonBody(payload),
    };
  }
}

class PazaramaAdapter extends BaseAdapter {
  readonly key = 'pazarama' as const;
  readonly displayName = 'Pazarama';
  protected readonly listingIdField = 'productId';

  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null {
    if (!cred.apiKey) return missing('API Key');
    if (!cred.apiSecret) return missing('API Secret');
    if (!cred.sellerId) return missing('Satıcı ID');
    return null;
  }

  buildRequest(cred: DecryptedMarketplaceCredentials, payload: MarketplaceListingPayload, apiUrl: string): AdapterRequest {
    return {
      url: `${apiUrl.replace(/\/+$/, '')}/product`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cred.apiKey ?? '', cred.apiSecret ?? ''),
      },
      body: jsonBody(payload),
    };
  }
}

export const trendyolAdapter = new TrendyolAdapter();
export const hepsiburadaAdapter = new HepsiburadaAdapter();
export const n11Adapter = new N11Adapter();
export const amazonTrAdapter = new AmazonTrAdapter();
export const pazaramaAdapter = new PazaramaAdapter();
