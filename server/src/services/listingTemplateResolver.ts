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

// FIX(2M): Template cache — şablonlar nadiren değişir, 60s TTL ile N+1 önlenir
const TEMPLATE_CACHE_TTL = 60_000;
const _templateCache = new Map<string, { result: ResolvedListingTemplate; ts: number }>();

export function invalidateTemplateCache(): void {
  _templateCache.clear();
}

function cacheKey(input: ResolveListingTemplateInput): string {
  return `${input.marketplaceId}:${input.productId}:${input.categoryId ?? ''}:${input.brandId ?? ''}`;
}

export async function resolveListingTemplate(
  input: ResolveListingTemplateInput
): Promise<ResolvedListingTemplate> {
  if (!input.marketplaceId || !input.productId) {
    return { id: null, name: null, source: 'NO_TEMPLATE' };
  }

  const key = cacheKey(input);
  const cached = _templateCache.get(key);
  if (cached && Date.now() - cached.ts < TEMPLATE_CACHE_TTL) {
    return cached.result;
  }

  // 1. ÜRÜN BAZLI ŞABLON
  const productTemplate = await prisma.listingTemplate.findFirst({
    where: { marketplaceId: input.marketplaceId, productId: input.productId, active: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (productTemplate) {
    const result = { id: productTemplate.id, name: productTemplate.name, source: 'PRODUCT' as const };
    _templateCache.set(key, { result, ts: Date.now() });
    return result;
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
      const result = { id: categoryTemplate.id, name: categoryTemplate.name, source: 'CATEGORY' as const };
      _templateCache.set(key, { result, ts: Date.now() });
      return result;
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
    const result = { id: generalTemplate.id, name: generalTemplate.name, source: 'GENERAL' as const };
    _templateCache.set(key, { result, ts: Date.now() });
    return result;
  }

  // 4. ŞABLON YOK
  const noResult = { id: null, name: null, source: 'NO_TEMPLATE' as const };
  _templateCache.set(key, { result: noResult, ts: Date.now() });
  return noResult;
}

export function hasListingTemplate(resolved: ResolvedListingTemplate): boolean {
  return resolved.source !== 'NO_TEMPLATE' && resolved.id !== null;
}
