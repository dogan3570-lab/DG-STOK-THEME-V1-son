// TASK314: Ürün yaşam döngüsü — manuel oluşturma + soft-delete tombstone.
// Migration YOK: silinme mevcut `status='DELETED'` alanı ile kalıcı hale getirilir.
// XML importer (xmlImport.ts) DELETED ürünü upsert etmez → kullanıcı sildiğinde geri gelmez.
import { prisma } from '../db/prisma.ts';
import { queueReconcileProductGates } from './readinessService.ts';
import { reconcileProductMarketplaceState } from './marketplaceReconcile.ts';
import { invalidateProductsStats } from './productsStatsCache.ts';
import { invalidateTitleIndex } from './titleSearchIndex.ts';
import crypto from 'node:crypto';

export const PRODUCT_STATUS_DELETED = 'DELETED';

export interface ManualProductInput {
  title: string;
  sku?: string | null;
  barcode?: string | null;
  brand?: string | null;
  category?: string | null;
  stock?: number;
  purchasePrice?: number | null;
  salePrice?: number | null;
  vatRate?: number | null;
  description?: string | null;
  source?: 'MANUAL' | 'EXCEL';
  actorUserId?: string | null;
}

export interface CreateOptions {
  /**
   * 'reject': aynı identity'de yaşayan ürün varsa 409 (MANUAL default).
   * 'upsert': yaşayan ürünün çekirdek verisi güncellenir; gate/pipeline durumu korunur (EXCEL).
   * Tombstone (DELETED) her iki modda da ASLA canlandırılmaz.
   */
  mode?: 'reject' | 'upsert';
}

function slugKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Ürün için kalıcı ve çakışmasız identity anahtarı. XML feed'leriyle asla çakışmaz. */
export function buildProductKey(source: 'MANUAL' | 'EXCEL', barcode?: string | null, sku?: string | null, title?: string | null): string {
  const base = (barcode || '').trim() || (sku || '').trim();
  if (base) return `${source}:${base.toUpperCase()}`;
  const t = (title || '').trim().toLowerCase();
  if (t) return `${source}:T-${crypto.createHash('sha1').update(t).digest('hex').slice(0, 16)}`;
  return `${source}:U-${crypto.randomUUID().slice(0, 8)}`;
}

export interface LifecycleResult { ok: boolean; status: number; body: Record<string, unknown>; }

export async function createManualOrExcelProduct(input: ManualProductInput, opts?: CreateOptions): Promise<LifecycleResult> {
  const mode = opts?.mode ?? 'reject';
  const title = String(input.title ?? '').trim();
  if (!title) return { ok: false, status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Ürün adı zorunludur' } } };
  if (title.length > 500) return { ok: false, status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Ürün adı çok uzun (maks 500)' } } };

  const source = input.source === 'EXCEL' ? 'EXCEL' : 'MANUAL';
  const barcode = input.barcode ? String(input.barcode).trim() : null;
  const sku = input.sku ? String(input.sku).trim() : null;

  // Duplicate koruması: aynı identity ile YAŞAYAN (silinmemiş) ürün varsa reject.
  const xmlKey = buildProductKey(source, barcode, sku, title);
  const existing = await prisma.product.findUnique({ where: { xmlKey }, select: { id: true, status: true } });
  if (existing && existing.status !== PRODUCT_STATUS_DELETED) {
    // Upsert modu: mevcut ürünün çekirdek verisi güncellenir; gate/pipeline ilerlemesi KORUNUR
    if (mode === 'upsert') {
      const stockU = Number.isFinite(input.stock) ? Math.trunc(Number(input.stock)) : undefined;
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          title,
          ...(sku != null ? { sku } : {}),
          ...(barcode != null ? { barcode } : {}),
          ...(stockU !== undefined ? { stock: stockU } : {}),
          ...(input.purchasePrice != null && Number.isFinite(Number(input.purchasePrice)) ? { purchasePrice: Number(input.purchasePrice) } : {}),
          ...(input.salePrice != null && Number.isFinite(Number(input.salePrice)) ? { salePrice: Number(input.salePrice) } : {}),
          ...(input.description ? { description: String(input.description).trim() } : {}),
          ...(input.brand ? { customBrandName: String(input.brand).trim(), xmlBrandName: String(input.brand).trim() } : {}),
        },
      });
      invalidateProductsStats();
      invalidateTitleIndex().catch(() => null);
      return { ok: true, status: 200, body: { item: { id: existing.id }, updated: true } };
    }
    return { ok: false, status: 409, body: { error: { code: 'DUPLICATE', message: 'Aynı barkod/SKU ile kayıtlı bir ürün zaten var', existingProductId: existing.id } } };
  }

  // Tombstone canlandırma YASAK: silinmiş ürünün xmlKey'i tekrar kullanılmaz.
  if (existing && existing.status === PRODUCT_STATUS_DELETED) {
    return { ok: false, status: 409, body: { error: { code: 'DELETED_TOMBSTONE', message: 'Bu ürün daha önce kalıcı olarak silindi; aynı kimlikle yeniden eklenemez', existingProductId: existing.id } } };
  }

  // SKU/barcode benzersizliği (xmlKey dışında da çift kayıt engeli)
  if (barcode || sku) {
    const clash = await prisma.product.findFirst({
      where: {
        ...(existing ? { id: { not: existing.id } } : {}),
        status: { not: PRODUCT_STATUS_DELETED },
        OR: [...(barcode ? [{ barcode }] : []), ...(sku ? [{ sku }] : [])],
      },
      select: { id: true, barcode: true, sku: true },
    });
    if (clash) {
      const bcClash = !!barcode && clash.barcode === barcode;
      const skuClash = !!sku && clash.sku === sku;
      if (bcClash || skuClash) {
        return { ok: false, status: 409, body: { error: { code: 'DUPLICATE', message: 'Aynı barkod veya SKU başka bir üründe kayıtlı', existingProductId: clash.id } } };
      }
    }
  }

  const stock = Number.isFinite(input.stock) ? Math.trunc(Number(input.stock)) : 0;
  const purchasePrice = input.purchasePrice != null && Number.isFinite(Number(input.purchasePrice)) ? Number(input.purchasePrice) : null;
  const salePrice = input.salePrice != null && Number.isFinite(Number(input.salePrice)) ? Number(input.salePrice) : null;
  const vatRate = input.vatRate != null && Number.isFinite(Number(input.vatRate)) ? Number(input.vatRate) : null;
  const brand = input.brand ? String(input.brand).trim() : null;
  const category = input.category ? String(input.category).trim() : null;

  // Canonical gate semantiği (XML import ile aynı mimari):
  // - Marka verildiyse brandMatch=true (XML_BRAND kullanımı gibi), yoksa prep-brands kuyruğuna düşer
  // - Kategori ASLA otomatik eşleşmez: categoryMatch=false + supplierCategory → prep-categories
  // - Manuel/Excel tekil üründe varyant yapısı yoktur → NOT_REQUIRED
  // - Şablon global çözümlenir → templateMatch=true
  const created = await prisma.product.create({
    data: {
      xmlKey,
      title,
      sku,
      barcode,
      stock,
      minStock: 0,
      purchasePrice,
      salePrice,
      vatRate,
      description: input.description ? String(input.description).trim() : null,
      customBrandName: brand,
      xmlBrandName: brand,
      supplierCategory: category,
      categoryMatch: false,
      categoryId: null,
      brandMatch: !!brand,
      variantMatch: false,
      variantStatus: 'NOT_REQUIRED',
      templateMatch: true,
      status: 'XML',
      matchedBy: brand ? 'manual' : null,
      lastMatchDate: brand ? new Date() : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'PRODUCT_CREATE',
      entity: 'Product',
      entityId: created.id,
      actorUserId: input.actorUserId ?? null,
      success: true,
      details: `${source} ürünü oluşturuldu: ${title} (xmlKey=${xmlKey})`,
    },
  }).catch(() => null);

  // Canonical zincir: PMS bağla + readiness reconcile + stats cache temizle
  const activeMps = await prisma.marketplace.findMany({ where: { active: true }, select: { id: true } });
  for (const mp of activeMps) reconcileProductMarketplaceState(created.id, mp.id).catch(() => null);
  queueReconcileProductGates(created.id);
  invalidateProductsStats();
  invalidateTitleIndex().catch(() => null);

  return { ok: true, status: 201, body: { item: created } };
}

export async function softDeleteProduct(id: string, actorUserId?: string | null): Promise<LifecycleResult> {
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, title: true, status: true, xmlKey: true } });
  if (!product) return { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } } };
  if (product.status === PRODUCT_STATUS_DELETED) {
    return { ok: false, status: 409, body: { error: { code: 'ALREADY_DELETED', message: 'Ürün zaten silinmiş' } } };
  }
  await prisma.product.update({ where: { id }, data: { status: PRODUCT_STATUS_DELETED } });
  await prisma.auditLog.create({
    data: {
      action: 'PRODUCT_DELETE',
      entity: 'Product',
      entityId: id,
      actorUserId: actorUserId ?? null,
      success: true,
      details: `Ürün kalıcı olarak silindi (soft-delete/tombstone): ${product.title} (xmlKey=${product.xmlKey})`,
    },
  }).catch(() => null);
  invalidateProductsStats();
  invalidateTitleIndex().catch(() => null);
  return { ok: true, status: 200, body: { deleted: true, productId: id } };
}
