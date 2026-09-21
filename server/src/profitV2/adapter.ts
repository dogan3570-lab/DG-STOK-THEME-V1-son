// ============================================================
// PROFIT-V2 (VENDORED) — DG-STOK DB ADAPTER (READ-ONLY)
// Gerçek veriyi AnalyticsRecord'a çevirir. Olmayan finansal alan UYDURULMAZ.
// ============================================================

import { prisma } from '../db/prisma.ts';
import { AnalyticsRecord } from './types.ts';

/**
 * Siparişlerden gözlem üretir. Sadece GERÇEK alanlar kullanılır:
 * - revenue: Order.total (bilinir)
 * - purchaseCost / commission / shipping / service / withholding / return: DB'de YOK -> UNKNOWN (null)
 * - VAT oranı bilinmiyor -> saleVatRate null (net değerler hesaplanamaz)
 */
export async function loadOrderRecords(): Promise<AnalyticsRecord[]> {
  const orders = await prisma.order.findMany({
    select: { id: true, orderNo: true, status: true, total: true, createdAt: true, marketplace: { select: { key: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  return orders.map((o): AnalyticsRecord => ({
    id: `order-${o.id}`,
    orderId: o.orderNo,
    marketplace: o.marketplace?.key ?? 'unknown',
    categoryId: null,
    productId: `order:${o.id}`,
    productName: null,
    sku: null,
    barcode: null,
    occurredAt: o.createdAt.toISOString(),
    currency: 'TRY',
    isReturn: o.status === 'returned' || o.status === 'cancelled',
    isSimulation: false,
    returnsTracked: true,
    salePriceCents: BigInt(Math.round((o.total ?? 0) * 100)),
    saleVatRate: null,          // KDV oranı DB'de yok -> VERİ YOK (net hesaplanamaz)
    saleVatInclusive: true,
    discountCents: 0n,
    purchaseCostCents: null,    // maliyet DB'de yok (purchasePrice tümü null)
    purchaseVatRate: null,
    commissionCents: null,      // sipariş bazlı gerçek komisyon yok
    commissionVatRate: null,
    serviceFeeCents: null,
    serviceVatRate: null,
    withholdingCents: null,
    shippingCents: null,
    shippingVatRate: null,
    returnCostCents: null,
    advertisingCents: null,
    otherExpensesCents: null,
  }));
}

export interface CatalogRow {
  productId: string;
  productName: string | null;
  sku: string | null;
  barcode: string | null;
  salePrice: number | null;
  hasPurchasePrice: boolean;
  status: string;
}

/** Ürün kataloğu arama (ad/SKU/barkod). Read-only. Kâr VERİ YOK (maliyet/satış actual yok). */
export async function searchCatalog(query: string | null, page: number, pageSize: number): Promise<{ items: CatalogRow[]; total: number; page: number; pageSize: number }> {
  const q = (query ?? '').trim();
  const where = q
    ? { OR: [{ title: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] }
    : {};
  const sp = Math.max(1, Math.floor(page) || 1);
  const ss = Math.max(1, Math.min(100, Math.floor(pageSize) || 20));
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, select: { id: true, title: true, sku: true, barcode: true, salePrice: true, purchasePrice: true, status: true }, orderBy: { updatedAt: 'desc' }, skip: (sp - 1) * ss, take: ss }),
    prisma.product.count({ where }),
  ]);
  return {
    items: rows.map(r => ({ productId: r.id, productName: r.title, sku: r.sku, barcode: r.barcode, salePrice: r.salePrice, hasPurchasePrice: r.purchasePrice != null, status: r.status })),
    total, page: sp, pageSize: ss,
  };
}

/** Aktif pazaryerleri (izolasyon gösterimi için; sipariş olmasa da liste döner). */
export async function listMarketplaceKeys(): Promise<string[]> {
  const mps = await prisma.marketplace.findMany({ select: { key: true }, orderBy: { key: 'asc' } });
  return mps.map(m => m.key);
}

/** Gerçek veri kapsamı raporu (VERİ YOK gerekçeleri). */
export async function dataCoverage(): Promise<{ orders: number; products: number; withPurchasePrice: number; marketplaces: string[]; gaps: string[] }> {
  const [orders, products, withPurchasePrice, mps] = await Promise.all([
    prisma.order.count(),
    prisma.product.count(),
    prisma.product.count({ where: { purchasePrice: { not: null } } }),
    prisma.marketplace.findMany({ select: { key: true }, orderBy: { key: 'asc' } }),
  ]);
  const gaps: string[] = [];
  if (orders === 0) gaps.push('Order kaydı yok — gerçek satış/kâr hesaplanamaz (VERİ YOK).');
  if (withPurchasePrice === 0) gaps.push('purchasePrice boş — maliyet ve net kâr hesaplanamaz.');
  gaps.push('Sipariş bazlı gerçek komisyon/kargo/iade tutarı DB\'de tutulmuyor.');
  return { orders, products, withPurchasePrice, marketplaces: mps.map(m => m.key), gaps };
}
