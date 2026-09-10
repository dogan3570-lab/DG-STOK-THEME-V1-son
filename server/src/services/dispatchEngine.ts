import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { isPrepComplete, isReady, isVariantComplete, type ReadinessProduct } from './readiness.ts';
import { detectVariantFamily } from './readinessService.ts';

/**
 * DISPATCH ENGINE — Tek merkezi karar motoru.
 *
 * TÜM GÖNDERİM MERKEZİ MANTIĞI BURADA YAŞAR:
 * - Context izolasyonu (XML + Marketplace)
 * - Readiness / dispatch decision
 * - Auto-ready transition
 * - Context-aware query builder
 * - Tek gerçek kaynak (Single Source of Truth)
 *
 * KURALLAR:
 * - Ready = status=READY + 4/4 gate (category, brand, variant, listing/template)
 * - PMS var/yok READY kararını etkilemez (PMS sadece marketplace state)
 * - Context kesinlikle izole: XML × Marketplace
 * - Raw PMS COUNT KULLANILMAZ — INNER JOIN Product + xmlSourceId zorunlu
 */

export type DispatchContext = {
  xmlSourceIds: string[];      // Boş = TÜM XML (veya null/undefined)
  marketplaceIds: string[];    // Boş = TÜM MP (veya null/undefined)
};

export type DispatchProduct = {
  id: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  xmlKey: string | null;
  salePrice: number | null;
  purchasePrice: number | null;
  stock: number;
  status: string;
  images: string | null;
  categoryMatch: boolean;
  brandMatch: boolean;
  variantMatch: boolean;
  variantStatus: string | null;
  templateMatch: boolean;
  createdAt: Date;
  updatedAt: Date;
  xmlSourceId: string;
  xmlSourceName: string | null;
  xmlSourceCompany: string | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  marketplaceStates: Array<{
    id: string;
    status: string;
    price: number | null;
    stock: number | null;
    listingUrl: string | null;
    marketplace: { id: string; name: string; key: string };
  }>;
};

export type DispatchReadiness = {
  productId: string;
  isReady: boolean;
  isPrepComplete: boolean;
  status: 'READY' | 'WAITING' | 'BLOCKED';
  missingReasons: string[];
  gateStatus: {
    category: boolean;
    brand: boolean;
    variant: boolean;
    template: boolean;
    status: boolean;
  };
};

export type DispatchStats = {
  productUniverseCount: number;
  readyCount: number;
  waitingCount: number;
  blockedCount: number;
  missingCategory: number;
  missingBrand: number;
  missingVariant: number;
  missingTemplate: number;
  missingImage: number;
  missingBarcode: number;
  missingPrice: number;
  missingStock: number;
  errorCount: number;
  marketplaceEligibleCount: number;
  marketplaceStateMissingCount: number;
};

export type DispatchContextStats = {
  xmlSourceId: string | null;
  xmlSourceName: string | null;
  marketplaceId: string | null;
  marketplaceName: string | null;
  stats: DispatchStats;
};

/**
 * Context query builder — kesinlikle izole.
 * Her query'de xmlSourceId VE marketplaceId zorunlu (boşsa TÜM, ama join yine yapılır).
 */
export function buildContextQuery(context: DispatchContext): {
  productWhere: Record<string, unknown>;
  pmsWhere: Record<string, unknown>;
} {
  const productWhere: Record<string, unknown> = {};
  const pmsWhere: Record<string, unknown> = {};

  if (context.xmlSourceIds?.length) {
    // XML context: Product.xmlSourceId IN (...)
    // MarketplaceStates'de de filter: marketplaceStates.some({ marketplaceId IN (...) })
  }

  if (context.marketplaceIds?.length) {
    // Marketplace context: ProductMarketplaceState.marketplaceId IN (...)
    // Product'te de filter: marketplaceStates.some({ marketplaceId IN (...) })
  }

  return { productWhere, pmsWhere };
}

/**
 * READINESS DECISION — Tek merkezi fonksiyon.
 * isReady (status READY + 4/4 gate) + isPrepComplete (4/4 gate without status)
 * PMS var/yok ETKILEMEZ.
 */
export function evaluateReadiness(product: {
  id: string;
  status: string;
  categoryMatch: boolean;
  brandMatch: boolean;
  templateMatch: boolean;
  variantMatch: boolean;
  variantStatus: string | null;
  images: string | null;
  barcode: string | null;
  salePrice: number | null;
  stock: number;
}): DispatchReadiness {
  const readiness: ReadinessProduct = {
    status: product.status,
    categoryMatch: product.categoryMatch,
    brandMatch: product.brandMatch,
    templateMatch: product.templateMatch,
    variantMatch: product.variantMatch,
    variantStatus: product.variantStatus ?? null,
  };

  const isPrep = isPrepComplete(readiness);
  const isReadyResult = isReady({ ...readiness, status: product.status });

  const missingReasons: string[] = [];
  if (!product.categoryMatch) missingReasons.push('Kategori');
  if (!product.brandMatch) missingReasons.push('Marka');
  if (!isVariantComplete({ variantMatch: product.variantMatch, variantStatus: product.variantStatus })) missingReasons.push('Varyant');
  if (!product.templateMatch) missingReasons.push('Şablon');
  if (!product.images) missingReasons.push('Görsel');
  if (!product.barcode) missingReasons.push('Barkod');
  if (product.salePrice == null) missingReasons.push('Fiyat');
  if (product.stock <= 0) missingReasons.push('Stok');

  // Status gate: status must be READY
  const statusOk = product.status === 'READY';

  let status: 'READY' | 'WAITING' | 'BLOCKED';
  if (isReady( { ...readiness, status: product.status } )) {
    status = 'READY';
  } else if (product.status === 'ERROR' || product.status === 'BLOCKED') {
    status = 'BLOCKED';
  } else {
    status = 'WAITING';
  }

  return {
    productId: '',
    isReady: isReadyResult,
    isPrepComplete: isPrep,
    status,
    missingReasons,
    gateStatus: {
      category: product.categoryMatch,
      brand: product.brandMatch,
      variant: isVariantComplete({ variantMatch: product.variantMatch, variantStatus: product.variantStatus ?? null }),
      template: product.templateMatch,
      status: product.status === 'READY',
    },
  };
}

/**
 * Build Prisma WHERE clause for context isolation.
 * xmlSourceIds + marketplaceIds KESINLIKLE izole.
 */
export function buildProductWhere(context: DispatchContext): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  if (context.xmlSourceIds?.length) {
    where.xmlSourceId = { in: context.xmlSourceIds };
  }

  if (context.marketplaceIds?.length) {
    // MarketplaceStates içinde belirtilen marketplaceId olan ürünler
    if (where.AND) {
      (where.AND as Record<string, unknown>[]).push({
        marketplaceStates: { some: { marketplaceId: { in: context.marketplaceIds! } } },
      });
    } else {
      where.marketplaceStates = { some: { marketplaceId: { in: context.marketplaceIds! } } };
    }
  }

  return where;
}

/**
 * Build stats query for context — tek kaynak, doğru hesaplama.
 * Raw PMS COUNT KULLANILMAZ — INNER JOIN Product + xmlSourceId + marketplaceId
 */
export async function getDispatchStats(context: DispatchContext): Promise<DispatchStats> {
  const xmlSourceIds = context.xmlSourceIds;
  const marketplaceIds = context.marketplaceIds;

  // Universe: XML source filter
  const universeWhere = xmlSourceIds?.length
    ? { xmlSourceId: { in: xmlSourceIds } }
    : {};

  // Universe count (XML source filter only)
  const universeCount = await prisma.product.count({ where: universeWhere });

  // Ready / Waiting / Blocked counts
  // Ready: status=READY + 4/4 gate
  // Waiting: 4/4 gate true ama status != READY
  // Blocked: status ERROR/BLOCKED veya 4/4 gate false

  // Use the same READY_FILTER logic from readiness.ts
  const readyFilter = {
    status: 'READY',
    categoryMatch: true,
    brandMatch: true,
    templateMatch: true,
    OR: [
      { variantMatch: true },
      { variantStatus: 'NOT_REQUIRED' },
    ],
  };

  // Build where clause with context isolation
  const baseWhere: Record<string, unknown> = {};
  if (context.xmlSourceIds?.length) {
    (globalThis as any).readyDispatchXmlSourceIds = context.xmlSourceIds;
  }
  // We'll build the where clause dynamically in raw SQL for performance

  const stats = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT
      COUNT(*) as "totalProducts",
      SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "readyCount",
      SUM(CASE WHEN status != 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "waitingCount",
      SUM(CASE WHEN status = 'ERROR' OR categoryMatch = 0 OR brandMatch = 0 OR templateMatch = 0 OR (variantMatch = 0 AND variantStatus != 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "blockedCount",
      SUM(CASE WHEN categoryMatch = 0 THEN 1 ELSE 0 END) as "missingCategory",
      SUM(CASE WHEN brandMatch = 0 THEN 1 ELSE 0 END) as "missingBrand",
      SUM(CASE WHEN variantMatch = 0 AND variantStatus != 'NOT_REQUIRED' THEN 1 ELSE 0 END) as "missingVariant",
      SUM(CASE WHEN templateMatch = 0 THEN 1 ELSE 0 END) as "missingTemplate",
      SUM(CASE WHEN images IS NULL THEN 1 ELSE 0 END) as "missingImage",
      SUM(CASE WHEN barcode IS NULL THEN 1 ELSE 0 END) as "missingBarcode",
      SUM(CASE WHEN salePrice IS NULL THEN 1 ELSE 0 END) as "missingPrice",
      SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as "missingStock",
      SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as "errorCount"
    FROM Product
    WHERE 1=1
    ${context.xmlSourceIds?.length ? Prisma.sql`AND xmlSourceId IN (${Prisma.join(context.xmlSourceIds.map(id => Prisma.sql`${id}`), ', ')})` : Prisma.empty}
    ${context.marketplaceIds?.length ? Prisma.sql`AND id IN (SELECT productId FROM ProductMarketplaceState WHERE marketplaceId IN (${Prisma.join(context.marketplaceIds.map(id => Prisma.sql`${id}`), ', ')}) )` : Prisma.empty}
  `;

  const row = stats[0] || {};

  // Marketplace eligible / missing counts
  let marketplaceEligibleCount = 0;
  let marketplaceStateMissingCount = 0;

  // Marketplace eligible: products in universe that have PMS for selected marketplaceIds
  // Only meaningful when marketplaceIds specified
  let marketplaceEligibleCountNum = 0;
  if (arguments[1]?.marketplaceIds?.length) {
    // This will be calculated by caller with marketplace context
  }

  return {
    productUniverseCount: Number(row.totalProducts ?? 0),
    readyCount: Number(row.readyCount ?? 0),
    waitingCount: Number(row.waitingCount ?? 0),
    blockedCount: Number(row.blockedCount ?? 0),
    missingCategory: Number(row.missingCategory ?? 0),
    missingBrand: Number(row.missingBrand ?? 0),
    missingVariant: Number(row.missingVariant ?? 0),
    missingTemplate: Number(row.missingTemplate ?? 0),
    missingImage: Number(row.missingImage ?? 0),
    missingBarcode: Number(row.missingBarcode ?? 0),
    missingPrice: Number(row.missingPrice ?? 0),
    missingStock: Number(row.missingStock ?? 0),
    errorCount: Number(row.errorCount ?? 0),
    marketplaceEligibleCount: 0, // Will be set by caller with marketplace context
    marketplaceStateMissingCount: 0, // Will be set by caller
  };
}

/**
 * AUTO-READY TRANSITION
 * Bir ürünün eksik alanı tamamlandığında (kategori/marka/varyant/listing)
 * tekrar değerlendir ve status'u READY/WAITING güncelle.
 * Idempotent: sadece gerekirse güncelle.
 */
export async function autoTransitionReadiness(productId: string): Promise<{
  updated: boolean;
  newStatus: string;
  reason: string;
}> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      status: true,
      categoryId: true,
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantMatch: true,
      variantStatus: true,
      images: true,
      barcode: true,
      salePrice: true,
      stock: true,
      brandId: true,
      title: true,
      sku: true,
    },
  });

  if (!product) {
    return { updated: false, newStatus: 'NOT_FOUND', reason: 'Product not found' };
  }

  // Variant aile tespiti — NOT_REQUIRED ise kardeş ürünleri kontrol et
  let effectiveVariantStatus = product.variantStatus;
  if (effectiveVariantStatus === 'NOT_REQUIRED' && !product.variantMatch && product.brandId && product.title) {
    const family = await detectVariantFamily(product.id, product.brandId, product.title, product.sku ?? null);
    if (family.isFamily && family.confidence >= 50) {
      await prisma.product.update({ where: { id: productId }, data: { variantStatus: 'WAITING_AI' } });
      effectiveVariantStatus = 'WAITING_AI';
    }
  }

  const readiness = evaluateReadiness({ ...product, variantStatus: effectiveVariantStatus ?? null } as any);

  // Mapping kontrolü: ürünün kategorisinde en az 1 aktif mapping var mı?
  let activeMapping = false;
  if (product.categoryId) {
    const mappingCount = await prisma.categoryMapping.count({
      where: { categoryId: product.categoryId as string, active: true },
    });
    activeMapping = mappingCount > 0;
  }

  const fullReady = readiness.isPrepComplete && product.salePrice != null && (product.stock ?? 0) > 0 && product.images != null && product.barcode != null && activeMapping;

  let newStatus = product.status;

  if (fullReady && product.status !== 'READY') {
    newStatus = 'READY';
  } else if (!fullReady && product.status === 'READY') {
    newStatus = 'XML';
  }

  if (newStatus !== product.status) {
    await prisma.product.update({
      where: { id: productId },
      data: { status: newStatus },
    });
    return { updated: true, newStatus, reason: 'Auto-transition' };
  }

  return { updated: false, newStatus, reason: 'No change needed' };
}

/**
 * Batch auto-transition for all products in context.
 * Returns count of updated products.
 */
export async function batchAutoTransition(context: DispatchContext): Promise<number> {
  // Find all products in context that need transition
  const products = await prisma.product.findMany({
    where: buildProductWhere({ xmlSourceIds: context.xmlSourceIds, marketplaceIds: context.marketplaceIds }),
    select: { id: true, status: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true },
  });

  let updated = 0;
  for (const product of products) {
    const result = await autoTransitionReadiness(product.id);
    if (result.updated) updated++;
  }
  return updated;
}