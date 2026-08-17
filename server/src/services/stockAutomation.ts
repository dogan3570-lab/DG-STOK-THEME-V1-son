import { prisma } from '../db/prisma.ts';
import { updateMarketplaceInventory } from './marketplace/marketplaceApi.ts';

/**
 * GLOBAL STOK OTOMASYONU — SATIŞ AÇ/KAPAT (histerezis).
 *
 * Bu modül yalnızca pazaryerindeki GERÇEK satış durumunu yönetir.
 * "Ürün Hazırlama Stok Aralığı" (prep range) ayrıdır: isWithinPrepRange().
 *
 * FAIL-CLOSED:
 * - Motor varsayılan olarak kapalıdır (enabled=false).
 * - Marketplace API başarısızsa DB durumu ASLA değiştirilmez (sahte KAPALI/AÇIK yok).
 * - Adapter desteklemiyorsa UNSUPPORTED döner; durum değişmez.
 */

export type SalesAction = 'CLOSE' | 'OPEN' | 'HOLD';
export type SalesState = 'OPEN' | 'CLOSED';

export interface StockAutomationConfig {
  enabled: boolean;
  closeAt: number;
  openAt: number;
  prepMin: number;
  prepMax: number;
}

export const STOCK_AUTO_KEYS = {
  enabled: 'stockAuto.enabled',
  closeAt: 'stockAuto.closeAt',
  openAt: 'stockAuto.openAt',
  prepMin: 'stockAuto.prepMin',
  prepMax: 'stockAuto.prepMax',
} as const;

export const DEFAULT_STOCK_AUTO_CONFIG: StockAutomationConfig = {
  enabled: false,
  closeAt: 3,
  openAt: 5,
  prepMin: 1,
  prepMax: 999999,
};

/**
 * SAF HİSTEREZİS MOTORU.
 *   stock <= closeAt            → CLOSE
 *   stock >= openAt             → OPEN
 *   closeAt < stock < openAt    → HOLD (mevcut durum korunur)
 * Aynı yönde tekrar işlem yapılmaz (3↔4 arasında sonsuz aç/kapat YOK).
 */
export function decideSalesAction(
  stock: number,
  closeAt: number,
  openAt: number,
  currentState: SalesState,
): SalesAction {
  if (stock <= closeAt) {
    return currentState === 'CLOSED' ? 'HOLD' : 'CLOSE';
  }
  if (stock >= openAt) {
    return currentState === 'OPEN' ? 'HOLD' : 'OPEN';
  }
  // closeAt < stock < openAt → mevcut durumu koru
  return 'HOLD';
}

/** Ürün Hazırlama Stok Aralığı (satış aç/kapat motorundan BAĞIMSIZ ayrı kural). */
export function isWithinPrepRange(stock: number, min: number, max: number): boolean {
  return stock >= min && stock <= max;
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export async function getStockAutomationConfig(): Promise<StockAutomationConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(STOCK_AUTO_KEYS) } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    enabled: map[STOCK_AUTO_KEYS.enabled] === 'true',
    closeAt: toInt(map[STOCK_AUTO_KEYS.closeAt], DEFAULT_STOCK_AUTO_CONFIG.closeAt),
    openAt: toInt(map[STOCK_AUTO_KEYS.openAt], DEFAULT_STOCK_AUTO_CONFIG.openAt),
    prepMin: toInt(map[STOCK_AUTO_KEYS.prepMin], DEFAULT_STOCK_AUTO_CONFIG.prepMin),
    prepMax: toInt(map[STOCK_AUTO_KEYS.prepMax], DEFAULT_STOCK_AUTO_CONFIG.prepMax),
  };
}

/** Hazırlama stok aralığı — send pipeline gate'i için hafif okuma. */
export async function getPrepStockRange(): Promise<{ min: number; max: number }> {
  const config = await getStockAutomationConfig();
  return { min: config.prepMin, max: config.prepMax };
}

export interface StockAutomationRunStats {
  scanned: number;
  closed: number;
  opened: number;
  skipped: number;
  errors: number;
  actions: Array<{
    productId: string;
    marketplaceId: string;
    action: 'CLOSED' | 'OPENED';
    ok: boolean;
    code: string | null;
  }>;
}

/** Pazaryeri state'inden satış durumunu çıkarır. */
function salesStateFromStatus(status: string | null | undefined): SalesState {
  return status === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

/**
 * Global stok otomasyonunu çalıştırır.
 * Yalnızca pazaryerine gönderilmiş ürünler (ProductMarketplaceState kaydı olan)
 * değerlendirilir. Gerçek marketplace API 2xx doğrulanmadan DB durumu değişmez.
 */
export async function runStockAutomation(): Promise<StockAutomationRunStats> {
  const config = await getStockAutomationConfig();
  const stats: StockAutomationRunStats = { scanned: 0, closed: 0, opened: 0, skipped: 0, errors: 0, actions: [] };

  if (!config.enabled) {
    return stats;
  }

  const states = await prisma.productMarketplaceState.findMany({
    where: { status: { in: ['ACTIVE', 'SENDING', 'CLOSED'] } },
    select: { id: true, productId: true, marketplaceId: true, status: true },
    orderBy: { lastActionAt: 'asc' },
  });

  const products = await prisma.product.findMany({
    where: { id: { in: states.map((s) => s.productId) } },
    select: { id: true, stock: true, barcode: true, sku: true, salePrice: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const state of states) {
    stats.scanned++;
    const product = productMap.get(state.productId);
    if (!product || product.stock == null) {
      stats.skipped++;
      continue;
    }
    const stock = product.stock;
    const currentState = salesStateFromStatus(state.status);
    const action = decideSalesAction(stock, config.closeAt, config.openAt, currentState);

    if (action === 'HOLD') {
      stats.skipped++;
      continue;
    }

    // Gerçek marketplace API çağrısı. Hata halinde DB durumu DEĞİŞMEZ.
    const result = await updateMarketplaceInventory({
      marketplaceId: state.marketplaceId,
      payload: {
        barcode: product.barcode ?? null,
        sku: product.sku ?? null,
        stock: action === 'CLOSE' ? 0 : stock,
        price: product.salePrice ?? null,
      },
    });

    if (!result.ok) {
      stats.errors++;
      stats.actions.push({
        productId: state.productId,
        marketplaceId: state.marketplaceId,
        action: action === 'CLOSE' ? 'CLOSED' : 'OPENED',
        ok: false,
        code: result.error?.code ?? 'PROVIDER_ERROR',
      });

      await prisma.auditLog.create({
        data: {
          action: action === 'CLOSE' ? 'STOCK_AUTO_CLOSE_FAILED' : 'STOCK_AUTO_OPEN_FAILED',
          entity: 'StockAutomation',
          entityId: state.id,
          meta: JSON.stringify({ productId: state.productId, marketplaceId: state.marketplaceId, stock, code: result.error?.code ?? null }),
          success: false,
        },
      });
      continue;
    }

    // API 2xx doğrulandı → DB durumu/log güncelle
    const newStatus = action === 'CLOSE' ? 'CLOSED' : 'ACTIVE';
    await prisma.productMarketplaceState.update({
      where: { id: state.id },
      data: { status: newStatus, stock: action === 'CLOSE' ? 0 : stock, lastActionAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        action: action === 'CLOSE' ? 'STOCK_AUTO_CLOSE' : 'STOCK_AUTO_OPEN',
        entity: 'StockAutomation',
        entityId: state.id,
        meta: JSON.stringify({ productId: state.productId, marketplaceId: state.marketplaceId, stock }),
        success: true,
      },
    });

    if (action === 'CLOSE') stats.closed++; else stats.opened++;
    stats.actions.push({
      productId: state.productId,
      marketplaceId: state.marketplaceId,
      action: action === 'CLOSE' ? 'CLOSED' : 'OPENED',
      ok: true,
      code: null,
    });
  }

  return stats;
}
