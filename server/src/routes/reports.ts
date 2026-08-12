import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';

const router = Router();

// GET /reports/dashboard - Aggregated dashboard stats
router.get('/dashboard', requireAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalProducts,
      readyProducts,
      errorProducts,
      totalOrders,
      todayOrders,
      totalXmlSources,
      activeXmlSources,
      totalCategories,
      totalBrands,
      lowStockProducts,
      marketplaceCount,
      marketplaceStats,
      categoryStats,
      brandStats,
      statusCounts,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true } }),
      prisma.product.count({ where: { status: 'ERROR' } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.xmlSource.count(),
      prisma.xmlSource.count({ where: { active: true } }),
      prisma.category.count(),
      prisma.brand.count(),
      prisma.product.count({ where: { stock: { lte: 0 } } }),
      prisma.marketplace.count(),
      prisma.marketplace.findMany({ select: { id: true, name: true, key: true, apiStatus: true, active: true } }),
      prisma.category.findMany({ select: { id: true, name: true }, take: 10 }),
      prisma.brand.findMany({ select: { id: true, name: true }, take: 10 }),
      prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = row._count._all;
    }

    res.json({
      totalProducts,
      readyProducts,
      errorProducts,
      totalOrders,
      todayOrders,
      totalXmlSources,
      activeXmlSources,
      totalCategories,
      totalBrands,
      lowStockProducts,
      marketplaceCount,
      marketplaceStats,
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
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const [totalProducts, readyProducts, errorProducts, lowStock, missingCategory, missingBrand, missingTemplate, xmlSourceStats] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true } }),
      prisma.product.count({ where: { status: 'ERROR' } }),
      prisma.product.count({ where: { stock: { lte: 0 } } }),
      prisma.product.count({ where: { categoryMatch: false } }),
      prisma.product.count({ where: { brandMatch: false } }),
      prisma.product.count({ where: { templateMatch: false } }),
      prisma.xmlSource.findMany({
        select: { id: true, name: true, active: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const statusCounts = await prisma.product.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = row._count._all;
    }

    res.json({
      totalProducts,
      readyProducts,
      errorProducts,
      lowStock,
      missingCategory,
      missingBrand,
      missingTemplate,
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
