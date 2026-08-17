export type MarketplaceKey = 'tt' | 'he' | 'n11' | 'amazon' | 'pazarama';

export interface DecryptedMarketplaceCredentials {
  apiKey: string | null;
  apiSecret: string | null;
  refreshToken: string | null;
  merchantId: string | null;
  sellerId: string | null;
  storeId: string | null;
}

export interface NormalizedProviderError {
  code: string;
  message: string;
  retryable: boolean;
  permanent: boolean;
  cooldownMs: number | null;
  httpStatus: number | null;
}

/**
 * Trendyol V2 resmi şeması: images elemanı `{url}`; attributes elemanı
 * `{attributeId, attributeValueIds[] | attributeValue}`. (developers.trendyol.com)
 */
export interface TrendyolProductImage {
  url: string;
}

export interface TrendyolProductAttribute {
  attributeId: number;
  attributeValueIds?: number[];
  attributeValue?: string;
}

export interface MarketplaceListingPayload {
  barcode: string | null;
  sku: string | null;
  title: string;
  description: string;
  price: number;
  stock: number;
  vatRate: number | null;
  categoryExternalId: string | null;
  brandName: string | null;
  images: string[];
  /** Trendyol V2 resmi alanları — diğer adapter'lar kullanmaz. */
  brandId?: number | null;
  categoryId?: number | null;
  quantity?: number;
  stockCode?: string | null;
  dimensionalWeight?: number | null;
  listPrice?: number | null;
  productMainId?: string | null;
  attributes?: TrendyolProductAttribute[];
}

/**
 * Stok otomasyonu için envanter güncelleme payload'u.
 * stock=0 satışı kapatır; stock>0 satışı açar. Fiyat opsiyoneldir.
 */
export interface MarketplaceInventoryUpdatePayload {
  barcode: string | null;
  sku: string | null;
  stock: number;
  price: number | null;
}

export interface MarketplaceSendResult {
  ok: boolean;
  provider: MarketplaceKey;
  externalListingId: string | null;
  listingUrl: string | null;
  externalRef: string | null;
  httpStatus: number | null;
  error: NormalizedProviderError | null;
  configured: boolean;
  /** Trendyol async POST yanıtındaki batchRequestId. listingId DEĞİLDİR. */
  batchRequestId?: string | null;
}

export interface AdapterRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MarketplaceAdapter {
  readonly key: MarketplaceKey;
  readonly displayName: string;
  /** Eksik/yanlış credential durumunda normalize edilmiş hata döner; yoksa null. */
  validateCredentials(cred: DecryptedMarketplaceCredentials): NormalizedProviderError | null;
  buildRequest(
    cred: DecryptedMarketplaceCredentials,
    payload: MarketplaceListingPayload,
    apiUrl: string
  ): AdapterRequest;
  parseResponse(status: number, body: string): MarketplaceSendResult;
  /**
   * Stok otomasyonu için envanter (satış aç/kapat) isteği üretir.
   * Adapter desteklemiyorsa null döner (fail-closed: sahte işlem YOK).
   */
  buildInventoryUpdateRequest?(
    cred: DecryptedMarketplaceCredentials,
    payload: MarketplaceInventoryUpdatePayload,
    apiUrl: string
  ): AdapterRequest | null;
}
