import { prisma } from '../db/prisma.ts';

/**
 * LISTING TEMPLATE RESOLVER — tek authoritative şablon çözümleyici.
 *
 * Kesin öncelik (rastgele seçim YASAK):
 *   1. ÜRÜN     → ListingTemplate where { marketplaceId, productId, active }
 *   2. KATEGORİ → ListingTemplate where { marketplaceId, categoryId, productId:null, brandId:null, active }
 *   3. GENEL    → ListingTemplate where { marketplaceId, productId:null, categoryId:null, brandId:null, active }
 *   4. NO_TEMPLATE
 *
 * Marketplace context ZORUNLUDUR: şablon yalnızca seçilen pazaryerine ait olmalıdır.
 * XML context ürün üzerinden doğal olarak sağlanır (productId/categoryId o XML'e aittir).
 * Schema değişikliği YOKTUR; ListingTemplate.productId/categoryId/brandId/marketplaceId mevcut alanlardır.
 */

export type ListingTemplateSource = 'PRODUCT' | 'CATEGORY' | 'GENERAL' | 'NO_TEMPLATE';

export interface ResolvedListingTemplate {
  id: string | null;
  name: string | null;
  source: ListingTemplateSource;
}

export interface ResolveListingTemplateInput {
  productId: string;
  categoryId?: string | null;
  brandId?: string | null;
  marketplaceId: string;
}

export async function resolveListingTemplate(
  input: ResolveListingTemplateInput
): Promise<ResolvedListingTemplate> {
  if (!input.marketplaceId || !input.productId) {
    return { id: null, name: null, source: 'NO_TEMPLATE' };
  }

  // 1. ÜRÜN BAZLI ŞABLON
  const productTemplate = await prisma.listingTemplate.findFirst({
    where: { marketplaceId: input.marketplaceId, productId: input.productId, active: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (productTemplate) {
    return { id: productTemplate.id, name: productTemplate.name, source: 'PRODUCT' };
  }

  // 2. KATEGORİ BAZLI ŞABLON
  if (input.categoryId) {
    const categoryTemplate = await prisma.listingTemplate.findFirst({
      where: {
        marketplaceId: input.marketplaceId,
        categoryId: input.categoryId,
        productId: null,
        brandId: null,
        active: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (categoryTemplate) {
      return { id: categoryTemplate.id, name: categoryTemplate.name, source: 'CATEGORY' };
    }
  }

  // 3. GENEL ŞABLON
  const generalTemplate = await prisma.listingTemplate.findFirst({
    where: {
      marketplaceId: input.marketplaceId,
      productId: null,
      categoryId: null,
      brandId: null,
      active: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (generalTemplate) {
    return { id: generalTemplate.id, name: generalTemplate.name, source: 'GENERAL' };
  }

  // 4. ŞABLON YOK
  return { id: null, name: null, source: 'NO_TEMPLATE' };
}

export function hasListingTemplate(resolved: ResolvedListingTemplate): boolean {
  return resolved.source !== 'NO_TEMPLATE' && resolved.id !== null;
}
