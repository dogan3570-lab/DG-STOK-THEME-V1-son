import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.ts';
import { isReady } from '../readiness.ts';
import { resolveListingTemplate, hasListingTemplate } from '../listingTemplateResolver.ts';
import { resolveListingPrice, parsePriceRangeRules } from '../listingPriceResolver.ts';
import { evaluateTrendyolSendGate } from '../sendReadiness.ts';
import { getPrepStockRange, isWithinPrepRange } from '../stockAutomation.ts';
import { sendListingToMarketplace } from './marketplaceApi.ts';
import type { MarketplaceListingPayload } from './types.ts';

export interface SendPipelineResult {
  productId: string;
  marketplaceId: string;
  ok: boolean;
  status: 'ACTIVE' | 'ERROR' | 'SENDING' | 'DUPLICATE';
  duplicate: boolean;
  externalListingId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SendPipelineInput {
  productId: string;
  marketplaceId: string;
  xmlSourceId: string;
}

function safeHashRef(value: string | null): string {
  if (!value) return 'none';
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function errorResult(input: SendPipelineInput, code: string, message: string): SendPipelineResult {
  return {
    productId: input.productId,
    marketplaceId: input.marketplaceId,
    ok: false,
    status: 'ERROR',
    duplicate: false,
    externalListingId: null,
    errorCode: code,
    errorMessage: message,
  };
}

function duplicateResult(input: SendPipelineInput, status: 'ACTIVE' | 'SENDING'): SendPipelineResult {
  return {
    productId: input.productId,
    marketplaceId: input.marketplaceId,
    ok: false,
    status: 'DUPLICATE',
    duplicate: true,
    externalListingId: null,
    errorCode: 'DUPLICATE',
    errorMessage: status === 'ACTIVE' ? 'Ürün zaten bu pazaryerinde aktif' : 'Ürün şu anda gönderiliyor',
  };
}

/**
 * Gerçek marketplace gönderim lifecycle'ı.
 *
 * - Backend authoritative 4/4 READY doğrulaması (frontend'e güvenilmez)
 * - XML context doğrulaması
 * - credential decrypt yalnızca adapter içinde, istek anında
 * - SSRF guard + bounded retry (marketplaceApi/httpClient katmanında)
 * - yalnızca gerçek 2xx + gerçek external id → ACTIVE (sahte başarı YOK)
 * - idempotency: unique(productId, marketplaceId) + SENDING slot + P2002 yakalama
 */
export async function sendProductToMarketplace(input: SendPipelineInput): Promise<SendPipelineResult> {
  const startedAt = Date.now();

  const marketplace = await prisma.marketplace.findUnique({
    where: { id: input.marketplaceId },
    select: { id: true, key: true, name: true, active: true },
  });
  if (!marketplace) {
    return errorResult(input, 'MARKETPLACE_NOT_FOUND', 'Pazaryeri bulunamadı');
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      xmlSourceId: true,
      status: true,
      title: true,
      description: true,
      barcode: true,
      sku: true,
      salePrice: true,
      purchasePrice: true,
      stock: true,
      vatRate: true,
      images: true,
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantMatch: true,
      variantStatus: true,
      categoryId: true,
      brand: { select: { name: true, externalId: true } },
    },
  });

  if (!product) {
    return errorResult(input, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı');
  }

  // Context isolation: yanlış XML context reddedilir
  if (product.xmlSourceId !== input.xmlSourceId) {
    return errorResult(input, 'WRONG_XML_CONTEXT', 'Ürün bu XML kaynağına ait değil');
  }

  // ÜRÜN HAZIRLAMA STOK ARALIĞI (satış aç/kapat motorundan BAĞIMSIZ ayrı gate)
  const prepRange = await getPrepStockRange();
  if (!isWithinPrepRange(product.stock, prepRange.min, prepRange.max)) {
    return errorResult(
      input,
      'STOCK_OUT_OF_PREP_RANGE',
      `Ürün stoğu hazırlama aralığı dışında (${prepRange.min}-${prepRange.max})`
    );
  }

  let payload: MarketplaceListingPayload;

  // Trendyol (tt): gerçek runtime 4/4 gate — kategori/brand/attribute mapping +
  // listing template + fiyat kuralı gerçek catalog/DB doğrulamasından geçer.
  // İmport'tan gelen sahte flag'lere (categoryMatch vs.) GÜVENİLMEZ.
  if (marketplace.key === 'tt') {
    const gate = await evaluateTrendyolSendGate({ productId: input.productId, marketplaceId: input.marketplaceId, xmlSourceId: input.xmlSourceId });
    if (!gate.ok) {
      return errorResult(input, gate.firstFailureCode ?? 'NOT_READY', gate.firstFailureMessage ?? 'Ürün 4/4 gönderime hazır değil');
    }

    payload = {
      barcode: product.barcode,
      sku: product.sku,
      title: product.title ?? '',
      description: product.description ?? '',
      price: gate.listingPrice ?? 0,
      stock: product.stock,
      vatRate: product.vatRate,
      categoryExternalId: gate.categoryId !== null ? String(gate.categoryId) : null,
      brandName: product.brand?.name ?? null,
      images: product.images ? product.images.split(',').map((s) => s.trim()).filter(Boolean) : [],
      brandId: gate.brandId,
      categoryId: gate.categoryId,
      attributes: gate.attributes,
    };
  } else {
    // Diğer pazaryerleri: mevcut backend authoritative akış korunur.
    const ready = isReady({
      status: product.status,
      categoryMatch: product.categoryMatch,
      brandMatch: product.brandMatch,
      templateMatch: product.templateMatch,
      variantMatch: product.variantMatch,
      variantStatus: product.variantStatus,
    });
    if (!ready) {
      return errorResult(input, 'NOT_READY', 'Ürün 4/4 gönderime hazır değil');
    }

    let categoryExternalId: string | null = null;
    if (product.categoryId) {
      const mapping = await prisma.categoryMapping.findFirst({
        where: { categoryId: product.categoryId, marketplaceId: input.marketplaceId, active: true },
        select: { externalId: true },
        orderBy: { createdAt: 'desc' },
      });
      categoryExternalId = mapping?.externalId ?? null;
    }

    const resolvedTemplate = await resolveListingTemplate({
      productId: product.id,
      categoryId: product.categoryId,
      marketplaceId: input.marketplaceId,
    });
    if (!hasListingTemplate(resolvedTemplate)) {
      return errorResult(input, 'TEMPLATE_NOT_FOUND', 'Bu ürün için geçerli listing şablonu bulunamadı');
    }

    const templateRow = await prisma.listingTemplate.findUnique({
      where: { id: resolvedTemplate.id as string },
      select: { priceRangeRules: true },
    });
    const priceResult = resolveListingPrice(product.purchasePrice, parsePriceRangeRules(templateRow?.priceRangeRules));
    if (priceResult.status !== 'OK') {
      return errorResult(input, priceResult.status, priceResult.reason ?? 'Listing fiyatı hesaplanamadı');
    }

    payload = {
      barcode: product.barcode,
      sku: product.sku,
      title: product.title ?? '',
      description: product.description ?? '',
      price: priceResult.listingPrice ?? 0,
      stock: product.stock,
      vatRate: product.vatRate,
      categoryExternalId,
      brandName: product.brand?.name ?? null,
      images: product.images ? product.images.split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
  }

  // Idempotency + concurrency: slot atomik get-or-create (PENDING marker ile)
  const now = new Date();
  let state: { id: string; status: string };
  try {
    state = await prisma.productMarketplaceState.upsert({
      where: { productId_marketplaceId: { productId: input.productId, marketplaceId: input.marketplaceId } },
      update: {},
      create: { productId: input.productId, marketplaceId: input.marketplaceId, status: 'PENDING', lastActionAt: now },
      select: { id: true, status: true },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // concurrent insert yarışı — diğer istek slot'u aldı
      return duplicateResult(input, 'SENDING');
    }
    throw e;
  }

  if (state.status === 'ACTIVE' || state.status === 'SENDING') {
    return duplicateResult(input, state.status as 'ACTIVE' | 'SENDING');
  }

  // Atomik claim: yalnızca tek istek PENDING/ERROR/NOT_CONFIGURED → SENDING geçirebilir
  const claim = await prisma.productMarketplaceState.updateMany({
    where: { id: state.id, status: { notIn: ['SENDING', 'ACTIVE'] } },
    data: { status: 'SENDING', lastActionAt: now, errorMessage: null },
  });
  if (claim.count === 0) {
    // başka istek claim etti — duplicate
    return duplicateResult(input, 'SENDING');
  }

  const result = await sendListingToMarketplace({ marketplaceId: input.marketplaceId, payload });

  const durationMs = Date.now() - startedAt;

  // Trendyol async: POST başarısı yalnızca batchRequestId döner. Bu bir listing ID
  // DEĞİLDİR. ACTIVE, gerçek external ID (onaylı ürün contentId/variantId) doğrulanmadan
  // ASLA üretilmez. Kuyruk durumu SENDING olarak kalır.
  if (result.ok && result.batchRequestId) {
    await prisma.productMarketplaceState.update({
      where: { id: state.id },
      data: {
        status: 'SENDING',
        externalRef: result.batchRequestId,
        errorMessage: 'APPROVAL_PENDING: Trendyol batch kuyruğunda',
        lastActionAt: new Date(),
      },
    });

    console.log(
      `[send] queued marketplace=${marketplace.key} productId=${input.productId} ` +
      `batchHash=${safeHashRef(result.batchRequestId)} durationMs=${durationMs}`
    );

    return {
      productId: input.productId,
      marketplaceId: input.marketplaceId,
      ok: false,
      status: 'SENDING',
      duplicate: false,
      externalListingId: null,
      errorCode: 'APPROVAL_PENDING',
      errorMessage: 'Ürün Trendyol kuyruğuna alındı; gerçek external ID doğrulanmadan ACTIVE üretilmez',
    };
  }

  if (result.ok && result.externalListingId) {
    await prisma.productMarketplaceState.update({
      where: { id: state.id },
      data: {
        status: 'ACTIVE',
        listingId: result.externalListingId,
        externalRef: result.externalRef ?? result.externalListingId,
        listingUrl: result.listingUrl,
        price: payload.price,
        stock: payload.stock,
        errorMessage: null,
        lastActionAt: new Date(),
      },
    });

    // Gözlemlenebilirlik: gerçek external id ASLA loglanmaz — yalnızca hash
    console.log(
      `[send] ok marketplace=${marketplace.key} productId=${input.productId} status=ACTIVE ` +
      `extRefHash=${safeHashRef(result.externalListingId)} durationMs=${durationMs}`
    );

    return {
      productId: input.productId,
      marketplaceId: input.marketplaceId,
      ok: true,
      status: 'ACTIVE',
      duplicate: false,
      externalListingId: result.externalListingId,
      errorCode: null,
      errorMessage: null,
    };
  }

  const err = result.error ?? { code: 'PROVIDER_ERROR', message: 'Pazaryeri hatası' };
  await prisma.productMarketplaceState.update({
    where: { id: state.id },
    data: { status: 'ERROR', errorMessage: `${err.code}: ${err.message}`, lastActionAt: new Date() },
  });

  // Güvenli log: raw body/credential YOK, yalnızca normalize kod
  console.log(
    `[send] fail marketplace=${marketplace.key} productId=${input.productId} status=ERROR ` +
    `code=${err.code} durationMs=${durationMs}`
  );

  return {
    productId: input.productId,
    marketplaceId: input.marketplaceId,
    ok: false,
    status: 'ERROR',
    duplicate: false,
    externalListingId: null,
    errorCode: err.code,
    errorMessage: err.message,
  };
}
