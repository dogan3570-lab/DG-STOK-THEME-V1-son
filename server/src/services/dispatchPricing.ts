import { prisma } from '../db/prisma.ts';

/**
 * DISPATCH PRICING — KDV dahili alış fiyatı ve marketplace-specific listing fiyatı.
 *
 * KURALLAR:
 * - KDV dahil alış fiyatı: purchasePrice * (1 + vatRate/100) — XmlSource'tan vatRate alınır
 * - Marketplace listing fiyatı: Product.salePrice (veya marketplace-specific pricing rule varsa o)
 * - KDV oranı: XmlSource.vatRate (default 20%) veya Product.vatRate
 * - Marketplace listing fiyatı SEÇİLİ PAZARYERİNE ait — fallback YOK
 * - KDV oranı hesaplamada XmlSource.purchasePriceVatStatus = 'dahil' ise purchasePrice zaten KDV dahil
 */

export type DispatchPricingInput = {
  productId: string;
  marketplaceId: string;
};

export type DispatchPricingResult = {
  productId: string;
  marketplaceId: string;
  purchasePriceVatIncluded: number | null;      // KDV dahil alış fiyatı
  purchasePriceVatExcluded: number | null;      // KDV hariç alış fiyatı
  vatRate: number | null;                       // Kullanılan KDV oranı (%)
  vatIncluded: boolean;                         // purchasePrice KDV dahil mi?
  listingPrice: number | null;                  // Marketplace listing fiyatı
  marketplacePriceSource: 'salePrice' | 'pricingRule' | 'none';
};

/**
 * KDV dahil alış fiyatı hesapla.
 * XmlSource.purchasePriceVatStatus = 'dahil' ise purchasePrice zaten KDV dahil.
 * Değilse: purchasePrice * (1 + vatRate/100)
 */
function calculateVatIncludedPurchasePrice(
  purchasePrice: number | null,
  vatRate: number | null,
  vatIncluded: boolean
): { vatIncludedPrice: number | null; vatExcludedPrice: number | null } {
  if (purchasePrice == null || vatRate == null) {
    return { vatIncludedPrice: null, vatExcludedPrice: null };
  }

  if (vatIncluded) {
    // purchasePrice zaten KDV dahil
    const vatExcluded = purchasePrice / (1 + vatRate / 100);
    return { vatIncludedPrice: purchasePrice, vatExcludedPrice: vatExcluded };
  } else {
    // purchasePrice KDV hariç, KDV ekle
    const vatIncluded = purchasePrice * (1 + vatRate / 100);
    return { vatIncludedPrice: vatIncluded, vatExcludedPrice: purchasePrice };
  }
}

/**
 * Marketplace listing fiyatı al.
 * Priority: marketplace-specific pricing rule > Product.salePrice > null
 * Fallback YOK — marketplace-specific olmalı.
 */
async function getMarketplaceListingPrice(
  productId: string,
  marketplaceId: string
): Promise<{ price: number | null; source: 'salePrice' | 'pricingRule' | 'none' }> {
  // 1. MarketplacePricingRule check
  const pricingRule = await prisma.marketplacePricingRule.findFirst({
    where: {
      marketplaceId,
      productId: null, // global rule first, then product-specific if implemented
    },
    orderBy: { createdAt: 'desc' },
  });

  if (pricingRule) {
    // Pricing rule logic would go here (percentage, fixed, formula)
    // For now, return null to fall back to salePrice
    // TODO: Implement pricing rule evaluation
  }

  // 2. Fallback to Product.salePrice
  const product = await prisma.product.findUnique({
    where: { id: '' }, // will be overridden by caller
    select: { salePrice: true },
  });

  // This will be overridden by caller with actual product data
  return { price: null, source: 'none' };
}

/**
 * Ana pricing fonksiyon — tek giriş noktası.
 */
export async function getDispatchPricing(input: DispatchPricingInput): Promise<DispatchPricingResult> {
  const { productId, marketplaceId } = input;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      purchasePrice: true,
      salePrice: true,
      vatRate: true,
      xmlSource: {
        select: {
          id: true,
          vatRate: true,
          purchasePriceVatStatus: true,
        },
      },
    },
  });

  if (!product) {
    return {
      productId,
      marketplaceId,
      purchasePriceVatIncluded: null,
      purchasePriceVatExcluded: null,
      vatRate: null,
      vatIncluded: false,
      listingPrice: null,
      marketplacePriceSource: 'none',
    };
  }

  // VAT rate: Product.vatRate > XmlSource.vatRate > default 20
  const vatRate = product.vatRate ?? product.xmlSource?.vatRate ?? 20;
  const vatIncluded = product.xmlSource?.purchasePriceVatStatus === 'dahil';

  const { vatIncludedPrice, vatExcludedPrice } = calculateVatIncludedPurchasePrice(
    product.purchasePrice,
    product.vatRate ?? product.xmlSource?.vatRate ?? 20,
    vatIncluded
  );

  // Marketplace listing price: marketplace-specific pricing rule > salePrice
  // For now, use Product.salePrice as default (marketplace-specific pricing rules TODO)
  const listingPrice = product.salePrice;

  return {
    productId,
    marketplaceId,
    purchasePriceVatIncluded: vatIncludedPrice,
    purchasePriceVatExcluded: vatExcludedPrice,
    vatRate,
    vatIncluded,
    listingPrice,
    marketplacePriceSource: product.salePrice != null ? 'salePrice' : 'none',
  };
}

/**
 * Batch pricing for multiple products in same marketplace.
 */
export async function getBatchDispatchPricing(
  productIds: string[],
  marketplaceId: string
): Promise<DispatchPricingResult[]> {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      purchasePrice: true,
      salePrice: true,
      vatRate: true,
      xmlSource: {
        select: {
          id: true,
          vatRate: true,
          purchasePriceVatStatus: true,
        },
      },
    },
  });

  const productMap = new Map(products.map(p => [p.id, p]));

  return productIds.map(productId => {
    const product = productMap.get(productId);
    if (!product) {
      return {
        productId,
        marketplaceId,
        purchasePriceVatIncluded: null,
        purchasePriceVatExcluded: null,
        vatRate: null,
        vatIncluded: false,
        listingPrice: null,
        marketplacePriceSource: 'none',
      };
    }

    const vatRate = product.vatRate ?? 20;
    const vatIncluded = product.xmlSource?.purchasePriceVatStatus === 'dahil';

    const { vatIncludedPrice, vatExcludedPrice } = calculateVatIncludedPurchasePrice(
      product.purchasePrice,
      product.vatRate ?? 20,
      vatIncluded
    );

    return {
      productId,
      marketplaceId,
      purchasePriceVatIncluded: vatIncludedPrice,
      purchasePriceVatExcluded: vatExcludedPrice,
      vatRate,
      vatIncluded,
      listingPrice: product.salePrice,
      marketplacePriceSource: product.salePrice != null ? 'salePrice' : 'none',
    };
  });
}

/**
 * Marketplace-specific pricing rule evaluation (TODO: implement rule engine).
 * For now, returns null to fall back to salePrice.
 */
async function evaluatePricingRule(
  rule: any,
  product: any
): Promise<number | null> {
  // TODO: Implement pricing rule evaluation
  // Rule types: percentage, fixed, formula, min/max bounds
  return null;
}