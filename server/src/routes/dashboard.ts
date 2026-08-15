import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { READY_FILTER } from '../services/readiness.ts';

const router = Router();

let dashboardStatsCache: { data: any; timestamp: number } | null = null;
const DASHBOARD_STATS_CACHE_TTL = 30_000; // 30 saniye

export function invalidateDashboardStatsCache() {
  dashboardStatsCache = null;
}

// GET /dashboard/stats - Cached real DB KPI'ları
router.get('/stats', requireAuth, async (_req, res) => {
  try {
    if (dashboardStatsCache && Date.now() - dashboardStatsCache.timestamp < DASHBOARD_STATS_CACHE_TTL) {
      return res.json(dashboardStatsCache.data);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [totalProducts, totalOrders, totalMarketplaces, totalXmlSources, activeXmlSources, passiveXmlSources, lowStockProducts, errorProducts, todayOrders, xmlSourcesWithError, todayXmlUpdates, readyProducts, brandCount, categoryCount, variantCount] = await Promise.all([
      prisma.product.count(),
      prisma.order.count(),
      prisma.marketplace.count(),
      prisma.xmlSource.count(),
      prisma.xmlSource.count({ where: { active: true } }),
      prisma.xmlSource.count({ where: { active: false } }),
      prisma.product.count({ where: { stock: { lte: 0 } } }),
      prisma.product.count({ where: { status: 'ERROR' } }),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.xmlSource.count({ where: { connectionStatus: 'error' } }),
      prisma.xmlImportRun.count({ where: { startedAt: { gte: todayStart }, status: { not: 'running' } } }),
      prisma.product.count({ where: READY_FILTER }),
      prisma.brand.count(),
      prisma.category.count(),
      prisma.variant.count(),
    ]);

    const data = {
      totalProducts,
      totalOrders,
      totalMarketplaces,
      totalXmlSources,
      activeXmlSources,
      passiveXmlSources,
      xmlSourcesWithError,
      todayXmlUpdates,
      lowStockProducts,
      errorProducts,
      readyProducts,
      todayOrders,
      brandCount,
      categoryCount,
      variantCount,
    };

    dashboardStatsCache = { data, timestamp: Date.now() };

    return res.json(data);
  } catch (error) {
    console.error('[routes][db]', error);
    return res.status(503).json({
      ok: false,
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Database is not reachable.',
      },
    });
  }
});

export default router;
