import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { READY_FILTER } from '../services/readiness.ts';
import { countOperationalMarketplaces, getOperationalMarketplaces } from '../services/marketplaceTruth.ts';

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

    // Phase 1: Heavy product counts — single raw SQL (was 7 parallel counts)
    const productStats = await prisma.$queryRaw<Record<string, bigint>[]>`
      SELECT
        COUNT(*) as "totalProducts",
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as "lowStockProducts",
        SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as "errorProducts",
        SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "readyProducts"
      FROM Product
      WHERE status != 'DELETED'
    `;
    const pRow = productStats[0] || {};

    // Phase 2: Light table counts — sequential (was 8 parallel counts, now safe)
    const totalOrders = await prisma.order.count();
    const totalMarketplaces = await countOperationalMarketplaces();
    const totalXmlSources = await prisma.xmlSource.count();
    const activeXmlSources = await prisma.xmlSource.count({ where: { active: true } });
    const passiveXmlSources = await prisma.xmlSource.count({ where: { active: false } });
    const todayOrders = await prisma.order.count({ where: { createdAt: { gte: todayStart } } });
    const xmlSourcesWithError = await prisma.xmlSource.count({ where: { connectionStatus: 'error' } });
    const todayXmlUpdates = await prisma.xmlImportRun.count({ where: { startedAt: { gte: todayStart }, status: { not: 'running' } } });
    const brandCount = await prisma.brand.count();
    const categoryCount = await prisma.category.count();
    const variantCount = await prisma.variant.count();

    const operationalMps = await getOperationalMarketplaces();

    const data = {
      totalProducts: Number(pRow.totalProducts ?? 0),
      totalOrders,
      totalMarketplaces,
      operationalMarketplaces: operationalMps.map(m => ({ id: m.id, key: m.key, name: m.name })),
      totalXmlSources,
      activeXmlSources,
      passiveXmlSources,
      xmlSourcesWithError,
      todayXmlUpdates,
      lowStockProducts: Number(pRow.lowStockProducts ?? 0),
      errorProducts: Number(pRow.errorProducts ?? 0),
      readyProducts: Number(pRow.readyProducts ?? 0),
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
