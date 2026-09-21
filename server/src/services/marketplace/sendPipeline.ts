import crypto from 'node:crypto';
import { prisma } from '../../db/prisma.ts';
import { isReady } from '../readiness.ts';
import { resolveListingTemplate, hasListingTemplate } from '../listingTemplateResolver.ts';
import { resolveListingPrice, parsePriceRangeRules } from '../listingPriceResolver.ts';
import { evaluateTrendyolSendGate } from '../sendReadiness.ts';
import { getPrepStockRange, isWithinPrepRange } from '../stockAutomation.ts';
import { sendListingToMarketplace } from './marketplaceApi.ts';
import { confirmLearningsForProduct } from '../attributeLearning.ts';
import type { MarketplaceListingPayload } from './types.ts';

export interface SendPipelineResult {
  productId: string;
  marketplaceId: string;
  ok: boolean;
  status: 'ACTIVE' | 'ERROR' | 'SENDING' | 'DUPLICATE' | 'NOT_CONFIGURED' | 'NOT_READY' | 'TEMPLATE_NOT_FOUND';
  duplicate: boolean;
  externalListingId: string | null;
  listingUrl: string | null;
  externalRef: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SendPipelineInput {
  productId: string;
  marketplaceId: string;
  xmlSourceId: string;
  payload?: any;
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
    listingUrl: null,
    externalRef: null,
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
    listingUrl: null,
    externalRef: null,
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
      xmlDimensionalWeight: true,
      manualDimensionalWeight: true,
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

    // Effective dimensional weight: manual > XML > null (Trendyol V2'de optional)
    const effectiveDimensionalWeight = product.manualDimensionalWeight ?? product.xmlDimensionalWeight ?? null;

    const productMainId = product.sku ?? product.barcode ?? `PROD-${product.id.slice(0, 8)}`;
    const listPrice = gate.listingPrice ?? product.purchasePrice ?? product.salePrice ?? 0;

    const basePayload = {
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
      productMainId: product.sku ?? product.barcode ?? `PROD-${product.id.slice(0, 8)}`,
      listPrice: Math.max(gate.listingPrice ?? 0, product.purchasePrice ?? product.salePrice ?? 0),
    };

    // dimensionalWeight sadece varsa gönder (Trendyol V2'de optional)
    if (effectiveDimensionalWeight !== null) {
      payload = { ...basePayload, dimensionalWeight: effectiveDimensionalWeight };
    } else {
      payload = basePayload;
    }
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
    const priceResult = resolveListingPrice(product.purchasePrice ?? product.salePrice, parsePriceRangeRules(templateRow?.priceRangeRules));
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
      ok: true,
      status: 'SENDING',
      duplicate: false,
      externalListingId: null,
      listingUrl: null,
      externalRef: result.batchRequestId,
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

    // ÖĞRENME: pazaryerinin gerçekten kabul ettiği (confirmed external id) eşleşmeleri
    // doğrulanmış öğrenme olarak işaretle. Hata gönderim sonucunu BOZMAZ.
    confirmLearningsForProduct(input.productId, marketplace.key).catch(() => null);

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
      listingUrl: result.listingUrl,
      externalRef: result.externalRef,
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
      listingUrl: null,
      externalRef: null,
      errorCode: err.code,
      errorMessage: err.message,
    };
}

/**
 * FIX(2M): Toplu gönderim — DB operasyonlarını toplu yapar.
 * Ürünleri, PMS'leri, template'leri ve category mapping'leri toplu yükler.
 * Marketplace API çağrısı yine ürün başına yapılır (API batch desteklemiyor).
 * DB operasyonlarını N*7 → ~5 bulk + N API'ye düşürür.
 */
export async function sendBatchProductsToMarketplace(
  inputs: SendPipelineInput[],
  concurrency = 5
): Promise<SendPipelineResult[]> {
  if (inputs.length === 0) return [];

  const marketplaceId = inputs[0].marketplaceId;
  const productIds = inputs.map(i => i.productId);

  // Toplu yükleme — N+1 kaldırıldı
  const [marketplace, products, existingPmsStates, prepRange] = await Promise.all([
    prisma.marketplace.findUnique({
      where: { id: marketplaceId },
      select: { id: true, key: true, name: true, active: true },
    }),
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true, xmlSourceId: true, status: true, title: true, description: true,
        barcode: true, sku: true, salePrice: true, purchasePrice: true, stock: true,
        vatRate: true, images: true, categoryMatch: true, brandMatch: true,
        templateMatch: true, variantMatch: true, variantStatus: true, categoryId: true,
        brand: { select: { name: true, externalId: true } },
      },
    }),
    prisma.productMarketplaceState.findMany({
      where: { productId: { in: productIds }, marketplaceId },
      select: { id: true, productId: true, status: true },
    }),
    getPrepStockRange(),
  ]);

  if (!marketplace) {
    return inputs.map(i => errorResult(i, 'MARKETPLACE_NOT_FOUND', 'Pazaryeri bulunamadı'));
  }

  const productMap = new Map(products.map(p => [p.id, p]));
  const pmsMap = new Map(existingPmsStates.map(s => [s.productId, s]));

  // Category mapping'leri toplu yükle
  const categoryIds = [...new Set(products.filter(p => p.categoryId).map(p => p.categoryId as string))];
  const categoryMappings = await prisma.categoryMapping.findMany({
    where: { categoryId: { in: categoryIds }, marketplaceId, active: true },
    select: { categoryId: true, externalId: true },
  });
  const categoryMappingMap = new Map(categoryMappings.map(m => [m.categoryId, m.externalId]));

  // Sonuçları parallel processing ile hesapla
  const results: SendPipelineResult[] = [];
  const chunks: SendPipelineInput[][] = [];
  for (let i = 0; i < inputs.length; i += concurrency) {
    chunks.push(inputs.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(async (input): Promise<SendPipelineResult> => {
      const product = productMap.get(input.productId);
      if (!product) return errorResult(input, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı');
      if (product.xmlSourceId !== input.xmlSourceId) {
        return errorResult(input, 'WRONG_XML_CONTEXT', 'Ürün bu XML kaynağına ait değil');
      }
      if (!isWithinPrepRange(product.stock, prepRange.min, prepRange.max)) {
        return errorResult(input, 'STOCK_OUT_OF_PREP_RANGE', `Stok hazırlama aralığı dışında`);
      }

      // PMS claim — mevcut PMS varsa onu kullan, yoksa oluştur
      const existingPms = pmsMap.get(input.productId);
      let stateId: string;
      let stateStatus: string;

      if (existingPms) {
        if (existingPms.status === 'ACTIVE' || existingPms.status === 'SENDING') {
          return { productId: input.productId, marketplaceId, ok: false, status: existingPms.status as any, duplicate: true, externalListingId: null, listingUrl: null, externalRef: null, errorCode: 'DUPLICATE', errorMessage: `Zaten ${existingPms.status}` };
        }
        const claim = await prisma.productMarketplaceState.updateMany({
          where: { id: existingPms.id, status: { notIn: ['SENDING', 'ACTIVE'] } },
          data: { status: 'SENDING', lastActionAt: new Date(), errorMessage: null },
        });
        if (claim.count === 0) {
          return { productId: input.productId, marketplaceId, ok: false, status: 'SENDING', duplicate: true, externalListingId: null, listingUrl: null, externalRef: null, errorCode: 'DUPLICATE', errorMessage: 'SENDING' };
        }
        stateId = existingPms.id;
        stateStatus = 'SENDING';
      } else {
        try {
          const created = await prisma.productMarketplaceState.create({
            data: { productId: input.productId, marketplaceId, status: 'SENDING', lastActionAt: new Date() },
            select: { id: true },
          });
          stateId = created.id;
          stateStatus = 'SENDING';
        } catch (e: any) {
          if (e?.code === 'P2002') {
            return { productId: input.productId, marketplaceId, ok: false, status: 'SENDING', duplicate: true, externalListingId: null, listingUrl: null, externalRef: null, errorCode: 'DUPLICATE', errorMessage: 'P2002' };
          }
          throw e;
        }
      }

      // Payload oluştur (cache'lenmiş mapping ile)
      const categoryExternalId = product.categoryId ? (categoryMappingMap.get(product.categoryId) ?? null) : null;
      const resolvedTemplate = await resolveListingTemplate({
        productId: product.id, categoryId: product.categoryId, marketplaceId,
      });

      if (!hasListingTemplate(resolvedTemplate)) {
        await prisma.productMarketplaceState.update({ where: { id: stateId }, data: { status: 'ERROR', errorMessage: 'TEMPLATE_NOT_FOUND', lastActionAt: new Date() } });
        return { productId: input.productId, marketplaceId, ok: false, status: 'TEMPLATE_NOT_FOUND', duplicate: false, externalListingId: null, listingUrl: null, externalRef: null, errorCode: 'TEMPLATE_NOT_FOUND', errorMessage: 'Şablon bulunamadı' };
      }

      const payload: MarketplaceListingPayload = {
        barcode: product.barcode, sku: product.sku, title: product.title ?? '',
        description: product.description ?? '', price: product.purchasePrice ?? product.salePrice ?? 0,
        stock: product.stock, vatRate: product.vatRate, categoryExternalId,
        brandName: product.brand?.name ?? null,
        images: product.images ? product.images.split(',').map(s => s.trim()).filter(Boolean) : [],
      };

      // API çağrısı
      const apiResult = await sendListingToMarketplace({ marketplaceId, payload });

      if (apiResult.ok && apiResult.batchRequestId) {
        await prisma.productMarketplaceState.update({ where: { id: stateId }, data: { status: 'SENDING', externalRef: apiResult.batchRequestId, errorMessage: 'APPROVAL_PENDING', lastActionAt: new Date() } });
        // APPROVAL_PENDING = Trendyol batch KABUL EDİLDİ (batchRequestId alındı). Gönderim BAŞARILI;
        // ürün onay kuyruğunda. `ok:true` ile job failedCount yerine successfulCount'a yazılır.
        return { productId: input.productId, marketplaceId, ok: true, status: 'SENDING', duplicate: false, externalListingId: null, listingUrl: null, externalRef: apiResult.batchRequestId, errorCode: 'APPROVAL_PENDING', errorMessage: 'Kuyruğa alındı' };
      }
      if (apiResult.ok && apiResult.externalListingId) {
        await prisma.productMarketplaceState.update({ where: { id: stateId }, data: { status: 'ACTIVE', listingId: apiResult.externalListingId, externalRef: apiResult.externalRef ?? apiResult.externalListingId, listingUrl: apiResult.listingUrl, price: payload.price, stock: payload.stock, errorMessage: null, lastActionAt: new Date() } });
        return { productId: input.productId, marketplaceId, ok: true, status: 'ACTIVE', duplicate: false, externalListingId: apiResult.externalListingId, listingUrl: apiResult.listingUrl, externalRef: apiResult.externalRef, errorCode: null, errorMessage: null };
      }

      const err = apiResult.error ?? { code: 'PROVIDER_ERROR', message: 'Pazaryeri hatası' };
      await prisma.productMarketplaceState.update({ where: { id: stateId }, data: { status: 'ERROR', errorMessage: `${err.code}: ${err.message}`, lastActionAt: new Date() } });
      return { productId: input.productId, marketplaceId, ok: false, status: 'ERROR', duplicate: false, externalListingId: null, listingUrl: null, externalRef: null, errorCode: err.code, errorMessage: err.message };
    }));
    results.push(...chunkResults);
  }

  return results;
}
