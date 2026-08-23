import { prisma } from '../db/prisma.ts';
import { sendProductToMarketplace as sendPipelineSend, type SendPipelineInput, type SendPipelineResult } from './marketplace/sendPipeline.ts';
import { decryptCredential } from './crypto.ts';

/**
 * MARKETPLACE ADAPTER — Dispatch Engine için marketplace API wrapper.
 *
 * KURALLAR:
 * - Mevcut sendPipeline'i wrap eder, dispatch engine için clean interface sağlar
 * - Her marketplace kendi adapter'ını kullanır (registry pattern)
 * - Credential handling, SSRF guard, retry logic sendPipeline'de zaten var
 * - Dispatch engine bu adapter'ı kullanır
 */

export type AdapterSendInput = {
  marketplaceId: string;
  productId: string;
  payload: any;
};

export type AdapterSendResult = {
  ok: boolean;
  status: 'SENDING' | 'ACTIVE' | 'ERROR' | 'NOT_CONFIGURED' | 'DUPLICATE' | 'NOT_READY' | 'TEMPLATE_NOT_FOUND';
  externalListingId: string | null;
  listingUrl: string | null;
  externalRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  configured: boolean;
};

export type AdapterInventoryInput = {
  marketplaceId: string;
  productId: string;
  payload: any;
};

export type AdapterInventoryResult = {
  ok: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  configured: boolean;
};

/**
 * Tek gönderim — sendPipeline kullanarak.
 */
export async function sendProductToMarketplace(input: {
  marketplaceId: string;
  productId: string;
  payload: any;
  xmlSourceId: string;
}): Promise<{
  ok: boolean;
  status: 'SENDING' | 'ACTIVE' | 'ERROR' | 'NOT_CONFIGURED' | 'DUPLICATE' | 'NOT_READY' | 'TEMPLATE_NOT_FOUND';
  externalListingId: string | null;
  listingUrl: string | null;
  externalRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  configured: boolean;
}> {
  const { sendProductToMarketplace: sendPipelineSend } = await import('./marketplace/sendPipeline.ts');

  const pipelineInput = {
    marketplaceId: input.marketplaceId,
    productId: input.productId,
    xmlSourceId: input.xmlSourceId,
    payload: input.payload,
  };

  const result: SendPipelineResult = await sendPipelineSend(pipelineInput);

  return {
    ok: result.ok,
    status: result.status,
    externalListingId: result.externalListingId ?? null,
    listingUrl: result.listingUrl ?? null,
    externalRef: result.externalRef ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    httpStatus: null,
    configured: result.status !== 'NOT_CONFIGURED',
  };
}

/**
 * Toplu gönderim — concurrency kontrolü ile.
 */
export async function sendBatchToMarketplace(input: {
  marketplaceId: string;
  productIds: string[];
  xmlSourceIds: string[];
  payloadBuilder: (productId: string) => any;
  concurrency?: number;
}): Promise<Array<{
  productId: string;
  ok: boolean;
  status: string;
  externalListingId: string | null;
  errorMessage: string | null;
}>> {
  const { sendProductToMarketplace: sendPipelineSend } = await import('./marketplace/sendPipeline.ts');

  const concurrency = input.concurrency || 5;
  type BatchResult = {
    productId: string;
    ok: boolean;
    status: 'SENDING' | 'ACTIVE' | 'ERROR' | 'NOT_CONFIGURED' | 'DUPLICATE' | 'NOT_READY' | 'TEMPLATE_NOT_FOUND';
    externalListingId: string | null;
    errorMessage: string | null;
  };

const results: BatchResult[] = [];

  const chunkSize = input.concurrency || 5;
  for (let i = 0; i < input.productIds.length; i += chunkSize) {
    const chunk = input.productIds.slice(i, i + chunkSize);
    const xmlSourceId = input.xmlSourceIds[i] || input.xmlSourceIds[0];
    const promises = chunk.map(async (productId): Promise<BatchResult> => {
      try {
        const result = await sendProductToMarketplace({
          marketplaceId: input.marketplaceId,
          productId,
          xmlSourceId: xmlSourceId,
          payload: input.payloadBuilder(productId),
        });
        return {
          productId,
          ok: result.ok,
          status: result.status,
          externalListingId: result.externalListingId,
          errorMessage: result.errorMessage,
        };
      } catch (e) {
        return {
          productId: input.productIds[i],
          ok: false,
          status: 'ERROR' as const,
          externalListingId: null,
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
        };
      }
    });

    const chunkResults: BatchResult[] = await Promise.all(promises);
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Envanter güncelleme (stok/fiyat) — marketplace adapter ile.
 */
export async function updateMarketplaceProductInventory(input: {
  marketplaceId: string;
  productId: string;
  payload: any;
}): Promise<{
  ok: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  configured: boolean;
}> {
  // Import dynamically to avoid circular dependency
  const { updateMarketplaceInventory } = await import('./marketplace/marketplaceApi.ts');

  const result = await updateMarketplaceInventory({
    marketplaceId: input.marketplaceId,
    payload: input.payload,
  });

  return {
    ok: result.ok,
    httpStatus: result.httpStatus,
    errorCode: result.error?.code ?? null,
    errorMessage: result.error?.message ?? null,
    configured: result.configured,
  };
}

/**
 * Marketplace adapter sağlık kontrolü.
 */
export async function checkMarketplaceHealth(marketplaceId: string): Promise<{
  marketplaceId: string;
  healthy: boolean;
  message: string;
  configured: boolean;
}> {
  const mp = await prisma.marketplace.findUnique({
    where: { id: marketplaceId },
    select: { id: true, key: true, name: true, active: true, apiUrl: true, apiKey: true, apiSecret: true, settings: true, merchantId: true, storeId: true },
  });

  if (!mp) {
    return { marketplaceId, healthy: false, message: 'Marketplace not found', configured: false };
  }

  if (!mp.active) {
    return { marketplaceId, healthy: false, message: 'Marketplace inactive', configured: false };
  }

  if (!mp.apiUrl || !mp.apiKey || !mp.apiSecret) {
    return { marketplaceId, healthy: false, message: 'Missing configuration', configured: false };
  }

  const { getAdapter } = await import('./marketplace/registry.ts');
  const adapter = getAdapter(mp.key);

  if (!adapter) {
    return { marketplaceId, healthy: false, message: 'No adapter found', configured: false };
  }

  const settings = mp.settings ? JSON.parse(mp.settings) : {};
  const refreshTokenEnc = typeof settings.refreshTokenEnc === 'string' ? settings.refreshTokenEnc : null;

  const cred = {
    apiKey: mp.apiKey ? decryptCredential(mp.apiKey) : null,
    apiSecret: mp.apiSecret ? decryptCredential(mp.apiSecret) : null,
    refreshToken: mp.settings ? (() => {
      const s = mp.settings ? JSON.parse(mp.settings) : {};
      return typeof s.refreshTokenEnc === 'string' ? s.refreshTokenEnc : null;
    })() : null,
    merchantId: mp.merchantId,
    sellerId: typeof (mp.settings ? JSON.parse(mp.settings) : {}).sellerId === 'string' ? (mp.settings ? JSON.parse(mp.settings) : {}).sellerId : null,
    storeId: mp.storeId,
  };

  const validationError = adapter.validateCredentials({
    apiKey: mp.apiKey ? decryptCredential(mp.apiKey) : null,
    apiSecret: mp.apiSecret ? decryptCredential(mp.apiSecret) : null,
    refreshToken: mp.settings ? (() => {
      const s = JSON.parse(mp.settings);
      return typeof s.refreshTokenEnc === 'string' ? s.refreshTokenEnc : null;
    })() : null,
    merchantId: mp.merchantId,
    sellerId: typeof (mp.settings ? JSON.parse(mp.settings) : {}).sellerId === 'string' ? (mp.settings ? JSON.parse(mp.settings) : {}).sellerId : null,
    storeId: mp.storeId,
  });

  if (validationError) {
    return { marketplaceId, healthy: false, message: validationError.message, configured: true };
  }

  return { marketplaceId, healthy: true, message: 'OK', configured: true };
}