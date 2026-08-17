/**
 * TRENDYOL RUNTIME 4/4 SEND GATE — eski import flag'lerine (categoryMatch,
 * brandMatch, templateMatch, variantMatch) GÜVENMEZ.
 *
 * Her gate gerçek DB mapping + gerçek Trendyol catalog response'u ile
 * runtime'da doğrulanır. Adımlar SIRAYLA ve kısa devre ile değerlendirilir:
 * bir gate FAIL olursa sonraki adımlar çalışmaz ve provider'a istek GİTMEZ.
 */
import { prisma } from '../db/prisma.ts';
import { resolveListingTemplate, hasListingTemplate, type ResolvedListingTemplate } from './listingTemplateResolver.ts';
import { resolveListingPrice, parsePriceRangeRules } from './listingPriceResolver.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './trendyolCatalog.ts';
import { resolveTrendyolAttributes, type TrendyolPayloadAttribute } from './trendyolVariantResolver.ts';

export interface GateStep {
  status: 'PASS' | 'FAIL';
  reasonCode: string | null;
  reasonMessage: string | null;
}

export interface TrendyolSendGateResult {
  ok: boolean;
  categoryId: number | null;
  brandId: number | null;
  listingPrice: number | null;
  attributes: TrendyolPayloadAttribute[];
  template: ResolvedListingTemplate | null;
  steps: {
    category: GateStep;
    brand: GateStep;
    variant: GateStep;
    listing: GateStep;
    price: GateStep;
  };
  firstFailureCode: string | null;
  firstFailureMessage: string | null;
}

export interface EvaluateSendGateInput {
  productId: string;
  marketplaceId: string;
  xmlSourceId: string;
}

/** Trendyol numeric ID güvenli çözümleme: yalnızca pozitif integer kabul edilir. */
export function parsePositiveInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const PASS: GateStep = { status: 'PASS', reasonCode: null, reasonMessage: null };
const SKIPPED: GateStep = { status: 'FAIL', reasonCode: 'SKIPPED', reasonMessage: 'Önceki gate başarısız' };

function failStep(code: string, message: string): GateStep {
  return { status: 'FAIL', reasonCode: code, reasonMessage: message };
}

function failedResult(
  code: string,
  message: string,
  steps: TrendyolSendGateResult['steps']
): TrendyolSendGateResult {
  return {
    ok: false,
    categoryId: null,
    brandId: null,
    listingPrice: null,
    attributes: [],
    template: null,
    steps,
    firstFailureCode: code,
    firstFailureMessage: message,
  };
}

export async function evaluateTrendyolSendGate(input: EvaluateSendGateInput): Promise<TrendyolSendGateResult> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true,
      xmlSourceId: true,
      purchasePrice: true,
      salePrice: true,
      title: true,
      description: true,
      barcode: true,
      sku: true,
      stock: true,
      vatRate: true,
      images: true,
      categoryId: true,
      brand: { select: { id: true, name: true, externalId: true } },
      variants: { select: { name: true, value: true } },
    },
  });

  if (!product) {
    return failedResult('PRODUCT_NOT_FOUND', 'Ürün bulunamadı', { category: SKIPPED, brand: SKIPPED, variant: SKIPPED, listing: SKIPPED, price: SKIPPED });
  }

  if (product.xmlSourceId !== input.xmlSourceId) {
    return failedResult('WRONG_XML_CONTEXT', 'Ürün bu XML kaynağına ait değil', { category: SKIPPED, brand: SKIPPED, variant: SKIPPED, listing: SKIPPED, price: SKIPPED });
  }

  // 1) CATEGORY — gerçek CategoryMapping.externalId (numeric) zorunlu
  let categoryId: number | null = null;
  if (product.categoryId) {
    const mapping = await prisma.categoryMapping.findFirst({
      where: { categoryId: product.categoryId, marketplaceId: input.marketplaceId, active: true },
      select: { externalId: true },
      orderBy: { createdAt: 'desc' },
    });
    categoryId = parsePositiveInt(mapping?.externalId ?? null);
  }
  if (categoryId === null) {
    return failedResult('CATEGORY_MAPPING_NOT_FOUND', 'Trendyol kategori mapping bulunamadı veya geçersiz (numeric categoryId gerekli)', {
      category: failStep('CATEGORY_MAPPING_NOT_FOUND', 'Trendyol kategori mapping bulunamadı veya geçersiz (numeric categoryId gerekli)'),
      brand: SKIPPED,
      variant: SKIPPED,
      listing: SKIPPED,
      price: SKIPPED,
    });
  }

  // 2) BRAND — gerçek Brand.externalId (numeric) zorunlu
  const brandId = parsePositiveInt(product.brand?.externalId ?? null);
  if (brandId === null) {
    return failedResult('BRAND_MAPPING_NOT_FOUND', 'Trendyol marka mapping bulunamadı veya geçersiz (numeric brandId gerekli)', {
      category: PASS,
      brand: failStep('BRAND_MAPPING_NOT_FOUND', 'Trendyol marka mapping bulunamadı veya geçersiz (numeric brandId gerekli)'),
      variant: SKIPPED,
      listing: SKIPPED,
      price: SKIPPED,
    });
  }

  // 3) VARIANT / ATTRIBUTE — gerçek Trendyol attribute + value whitelist
  let attributes: TrendyolPayloadAttribute[] = [];
  const attrDefs = await fetchTrendyolCategoryAttributes(categoryId);
  if (!Array.isArray(attrDefs) || attrDefs.length === 0) {
    // Fail-closed: boş/hatalı catalog response doğrulanamaz.
    return failedResult('VARIANT_ATTRIBUTE_NOT_FOUND', 'Trendyol kategori özellikleri alınamadı veya boş (NOT VERIFIED)', {
      category: PASS,
      brand: PASS,
      variant: failStep('VARIANT_ATTRIBUTE_NOT_FOUND', 'Trendyol kategori özellikleri alınamadı veya boş (NOT VERIFIED)'),
      listing: SKIPPED,
      price: SKIPPED,
    });
  }

  const relevant = attrDefs.filter((a) => a.varianter || a.slicer).slice(0, 30);
  const valuesByAttribute = new Map<number, { attributeValueId: number; attributeValue: string }[]>();
  for (const attr of relevant) {
    const values = await fetchTrendyolAttributeValues(categoryId, attr.attribute.id);
    valuesByAttribute.set(attr.attribute.id, values);
  }
  const variants = product.variants.map((v) => ({ name: v.name, value: v.value }));
  const resolution = resolveTrendyolAttributes(attrDefs, valuesByAttribute, variants);
  if (resolution.status === 'REQUIRED_ATTRIBUTE_MISSING') {
    const names = resolution.requiredMissing.map((m) => m.attributeName).join(', ');
    return failedResult('REQUIRED_ATTRIBUTE_MISSING', `Zorunlu Trendyol özellikleri eksik: ${names || 'bilinmiyor'}`, {
      category: PASS,
      brand: PASS,
      variant: failStep('REQUIRED_ATTRIBUTE_MISSING', `Zorunlu Trendyol özellikleri eksik: ${names || 'bilinmiyor'}`),
      listing: SKIPPED,
      price: SKIPPED,
    });
  }
  if (resolution.status !== 'OK') {
    const detail = resolution.missing.map((m) => `${m.xmlVariantName}=${m.xmlVariantValue}(${m.reason})`).join('; ');
    return failedResult('VARIANT_ATTRIBUTE_NOT_FOUND', `XML varyantları Trendyol attribute/value whitelist'inde bulunamadı: ${detail || 'bilinmiyor'}`, {
      category: PASS,
      brand: PASS,
      variant: failStep('VARIANT_ATTRIBUTE_NOT_FOUND', `XML varyantları Trendyol attribute/value whitelist'inde bulunamadı: ${detail || 'bilinmiyor'}`),
      listing: SKIPPED,
      price: SKIPPED,
    });
  }
  attributes = resolution.attributes;

  // 4) LISTING — ÜRÜN > KATEGORİ > GENEL > NO_TEMPLATE (marketplace context zorunlu)
  const template = await resolveListingTemplate({
    productId: product.id,
    categoryId: product.categoryId,
    marketplaceId: input.marketplaceId,
  });
  if (!hasListingTemplate(template)) {
    return failedResult('TEMPLATE_NOT_FOUND', 'Bu ürün için geçerli listing şablonu bulunamadı', {
      category: PASS,
      brand: PASS,
      variant: PASS,
      listing: failStep('TEMPLATE_NOT_FOUND', 'Bu ürün için geçerli listing şablonu bulunamadı'),
      price: SKIPPED,
    });
  }

  // 5) PRICE — KDV dahil XML alış fiyatı + şablon fiyat kuralı (fail-closed)
  const templateRow = await prisma.listingTemplate.findUnique({
    where: { id: template.id as string },
    select: { priceRangeRules: true },
  });
  const priceResult = resolveListingPrice(product.purchasePrice, parsePriceRangeRules(templateRow?.priceRangeRules ?? null));
  if (priceResult.status !== 'OK') {
    return failedResult(priceResult.status, priceResult.reason ?? 'Listing fiyatı hesaplanamadı', {
      category: PASS,
      brand: PASS,
      variant: PASS,
      listing: PASS,
      price: failStep(priceResult.status, priceResult.reason ?? 'Listing fiyatı hesaplanamadı'),
    });
  }

  return {
    ok: true,
    categoryId,
    brandId,
    listingPrice: priceResult.listingPrice,
    attributes,
    template,
    steps: { category: PASS, brand: PASS, variant: PASS, listing: PASS, price: PASS },
    firstFailureCode: null,
    firstFailureMessage: null,
  };
}
