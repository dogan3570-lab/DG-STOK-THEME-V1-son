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
// FIX(2M): prepRange cache — ayarlardan nadiren değişir, 30s TTL
let _prepRangeCache: { min: number; max: number } | null = null;
let _prepRangeTs = 0;
const PREP_RANGE_CACHE_TTL = 30_000;

export async function getPrepStockRange(): Promise<{ min: number; max: number }> {
  if (_prepRangeCache && Date.now() - _prepRangeTs < PREP_RANGE_CACHE_TTL) {
    return _prepRangeCache;
  }
  const config = await getStockAutomationConfig();
  _prepRangeCache = { min: config.prepMin, max: config.prepMax };
  _prepRangeTs = Date.now();
  return _prepRangeCache;
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
 * FIX(2M): Cursor-based batch processing — tüm state'leri RAM'e almaz.
 * Her batch 500 kaydı işler, ürünleri ayrı sorgu ile yükler.
 * Piyasa API çağrıları concurrency=5 ile sınırlıdır.
 */
const STOCK_BATCH_SIZE = 500;
const STOCK_API_CONCURRENCY = 5;

export async function runStockAutomation(): Promise<StockAutomationRunStats> {
  const config = await getStockAutomationConfig();
  const stats: StockAutomationRunStats = { scanned: 0, closed: 0, opened: 0, skipped: 0, errors: 0, actions: [] };

  if (!config.enabled) {
    return stats;
  }

  let cursor: string | undefined;

  while (true) {
    // Cursor-based: her seferinde 500 state yükle (RAM bounded)
    const states = await prisma.productMarketplaceState.findMany({
      where: {
        status: { in: ['ACTIVE', 'SENDING', 'CLOSED'] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, productId: true, marketplaceId: true, status: true },
      orderBy: { id: 'asc' },
      take: STOCK_BATCH_SIZE,
    });

    if (states.length === 0) break;

    // Batch product fetch (N+1 kaldırıldı)
    const productIds = [...new Set(states.map(s => s.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, stock: true, barcode: true, sku: true, salePrice: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    // API çağrılarını concurrency ile sınırla
    const pendingActions: Array<Promise<void>> = [];
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

      const actionPromise = (async () => {
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
          return;
        }

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
      })();

      pendingActions.push(actionPromise);

      // Concurrency limit
      if (pendingActions.length >= STOCK_API_CONCURRENCY) {
        await Promise.race(pendingActions);
        // Tamamlananları temizle
        for (let i = pendingActions.length - 1; i >= 0; i--) {
          const settled = await Promise.race([pendingActions[i].then(() => true).catch(() => true)]);
          if (settled) pendingActions.splice(i, 1);
        }
      }
    }

    // Kalanları bekle
    if (pendingActions.length > 0) {
      await Promise.allSettled(pendingActions);
    }

    cursor = states[states.length - 1].id;
    if (states.length < STOCK_BATCH_SIZE) break;
  }

  return stats;
}
