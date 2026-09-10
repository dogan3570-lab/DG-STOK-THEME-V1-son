import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { getOperationalMarketplaces, countOperationalMarketplaces } from '../services/marketplaceTruth.ts';

const router = Router();

// GET /reports/dashboard - Aggregated dashboard stats
// FIX(2M): 5 ayrı product.count() → tek raw SQL (5 tablo taraması → 1)
router.get('/dashboard', requireAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [productStats, lightCounts] = await Promise.all([
      prisma.$queryRaw<Record<string, bigint>[]>`
        SELECT
          COUNT(*) as "totalProducts",
          SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "readyProducts",
          SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as "errorProducts",
          SUM(CASE WHEN stock <= 0 AND status != 'DELETED' THEN 1 ELSE 0 END) as "lowStockProducts"
        FROM Product
        WHERE status != 'DELETED'
      `,
      Promise.all([
        prisma.order.count(),
        prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.xmlSource.count(),
        prisma.xmlSource.count({ where: { active: true } }),
        prisma.category.count(),
        prisma.brand.count(),
        countOperationalMarketplaces(),
        getOperationalMarketplaces(),
        prisma.category.findMany({ select: { id: true, name: true }, take: 10 }),
        prisma.brand.findMany({ select: { id: true, name: true }, take: 10 }),
        prisma.product.groupBy({ by: ['status'], _count: { _all: true }, where: { status: { not: 'DELETED' } } }),
      ]),
    ]);

    const pRow = productStats[0] || {};
    const [totalOrders, todayOrders, totalXmlSources, activeXmlSources, totalCategories, totalBrands, marketplaceCount, operationalMarketplaces, categoryStats, brandStats, statusCountsRaw] = lightCounts;

    const statusMap: Record<string, number> = {};
    for (const row of statusCountsRaw) {
      statusMap[row.status] = row._count._all;
    }

    res.json({
      totalProducts: Number(pRow.totalProducts ?? 0),
      readyProducts: Number(pRow.readyProducts ?? 0),
      errorProducts: Number(pRow.errorProducts ?? 0),
      totalOrders,
      todayOrders,
      totalXmlSources,
      activeXmlSources,
      totalCategories,
      totalBrands,
      lowStockProducts: Number(pRow.lowStockProducts ?? 0),
      marketplaceCount,
      marketplaceStats: operationalMarketplaces.map(m => ({ id: m.id, name: m.name, key: m.key, apiStatus: m.apiStatus, active: true })),
      topCategories: categoryStats,
      topBrands: brandStats,
      statusCounts: statusMap,
    });
  } catch (error) {
    console.error('Error fetching report dashboard:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch report data' } });
  }
});

// GET /reports/products - Product reports
// FIX(2M): 8 ayrı product.count() → tek raw SQL (tek tablo taraması)
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const [productStats, xmlSourceStats] = await Promise.all([
      prisma.$queryRaw<Record<string, bigint>[]>`
        SELECT
          COUNT(*) as "totalProducts",
          SUM(CASE WHEN status = 'READY' AND categoryMatch = 1 AND brandMatch = 1 AND templateMatch = 1 AND (variantMatch = 1 OR variantStatus = 'NOT_REQUIRED') THEN 1 ELSE 0 END) as "readyProducts",
          SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as "errorProducts",
          SUM(CASE WHEN stock <= 0 AND status != 'DELETED' THEN 1 ELSE 0 END) as "lowStock",
          SUM(CASE WHEN categoryMatch = 0 AND status != 'DELETED' THEN 1 ELSE 0 END) as "missingCategory",
          SUM(CASE WHEN brandMatch = 0 AND status != 'DELETED' THEN 1 ELSE 0 END) as "missingBrand",
          SUM(CASE WHEN templateMatch = 0 AND status != 'DELETED' THEN 1 ELSE 0 END) as "missingTemplate",
          SUM(CASE WHEN status != 'DELETED' THEN 1 ELSE 0 END) as "totalNotDeleted"
        FROM Product
      `,
      prisma.xmlSource.findMany({
        select: { id: true, name: true, active: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const pRow = productStats[0] || {};

    const statusCounts = await prisma.product.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = row._count._all;
    }

    res.json({
      totalProducts: Number(pRow.totalNotDeleted ?? 0),
      readyProducts: Number(pRow.readyProducts ?? 0),
      errorProducts: Number(pRow.errorProducts ?? 0),
      lowStock: Number(pRow.lowStock ?? 0),
      missingCategory: Number(pRow.missingCategory ?? 0),
      missingBrand: Number(pRow.missingBrand ?? 0),
      missingTemplate: Number(pRow.missingTemplate ?? 0),
      xmlSources: xmlSourceStats,
      statusCounts: statusMap,
    });
  } catch (error) {
    console.error('Error fetching product reports:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch product reports' } });
  }
});

// GET /reports/orders - Order reports
router.get('/orders', requireAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalOrders, todayOrders, weekOrders, statusCounts, channelCounts] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.order.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.order.groupBy({ by: ['channel'], _count: { _all: true } }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = row._count._all;
    }
    const channelMap: Record<string, number> = {};
    for (const row of channelCounts) {
      channelMap[row.channel] = row._count._all;
    }

    res.json({ totalOrders, todayOrders, weekOrders, statusCounts: statusMap, channelCounts: channelMap });
  } catch (error) {
    console.error('Error fetching order reports:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch order reports' } });
  }
});

export default router;
