import { Router } from 'express';
import type { Response, Request } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';
import { isMarketplaceOperational } from '../services/marketplaceTruth.ts';
import xmlSourcesRoutes from './xmlSources.ts';
import dashboardRoutes from './dashboard.ts';
import productsRoutes from './products.ts';
import prepCategoriesRoutes from './prepCategories.ts';
import prepBrandsRoutes from './prepBrands.ts';
import prepVariantsRoutes from './prepVariants.ts';
import prepListingsRoutes from './prepListings.ts';
import listingV2Routes from './listingV2.ts';
import readyToShipRoutes from './readyToShip.ts';
import ordersRoutes from './orders.ts';
import reportsRoutes from './reports.ts';
import settingsRoutes from './settings.ts';
import marketplaceManageRoutes from './marketplaceManage.ts';
import marketplaceSendRoutes from './marketplaceSend.ts';
import aiSettingsRoutes from './aiSettings.ts';
import trendyolMappingRoutes from './trendyolMapping.ts';
import stockAutomationRoutes from './stockAutomation.ts';
import categoryMatchEngineRoutes from './categoryMatchEngine.ts';
import categoryCoreV2Routes from './categoryCoreV2.ts';
import financeRoutes from './finance.ts';
import usersRoutes from './users.ts';
import auditLogsRoutes from './auditLogs.ts';
import notificationsRoutes from './notifications.ts';
import missingFieldsRoutes from './missingFields.ts';
import profitEngineRoutes from './profitEngine.ts';
import profitV2Routes from './profitV2.ts';
import financeCenterRoutes from './financeCenter.ts';
import { fetchXmlFromUrl, importXmlProducts } from '../services/xmlImport.ts';

export const router = Router();

export function attachRoutes(app: import('express').Express) {
  app.use('/', router);
}

function handleDbError(res: Response, error: unknown) {
  console.error('[routes][db]', error);
  return res.status(503).json({
    ok: false,
    error: {
      code: 'DB_UNAVAILABLE',
      message: 'Database is not reachable.',
    },
  });
}

// ==================== ROUTE GRUPLARI ====================
router.use('/xml-sources', xmlSourcesRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/products', productsRoutes);
router.use('/categories', prepCategoriesRoutes);
router.use('/brands', prepBrandsRoutes);
router.use('/variants', prepVariantsRoutes);
router.use('/listings', prepListingsRoutes);
router.use('/listing-v2', listingV2Routes);
router.use('/ready-to-ship', readyToShipRoutes);
router.use('/orders', ordersRoutes);
router.use('/reports', reportsRoutes);
router.use('/settings', settingsRoutes);
router.use('/marketplace-manage', marketplaceManageRoutes);
router.use('/marketplace-send', marketplaceSendRoutes);
router.use('/ai-settings', aiSettingsRoutes);
router.use('/trendyol-mapping', trendyolMappingRoutes);
router.use('/stock-automation', stockAutomationRoutes);
router.use('/category-engine', categoryMatchEngineRoutes);
router.use('/category-core-v2', categoryCoreV2Routes);
router.use('/finance', financeRoutes);
router.use('/users', usersRoutes);
router.use('/audit-logs', auditLogsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/missing-fields', missingFieldsRoutes);
router.use('/profit-engine', profitEngineRoutes);
router.use('/profit-v2', profitV2Routes);
router.use('/finance-center', financeCenterRoutes);

// ==================== MARKETPLACES ====================
// Auth + ADMIN rolü gerekli; credential alanları (apiKey, apiSecret, merchantId, storeId) ASLA döndürülmez
router.get('/marketplaces', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const items = await prisma.marketplace.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        key: true,
        name: true,
        apiUrl: true,
        apiStatus: true,
        active: true,
        apiKey: true,
        apiSecret: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // Include operational flag (computed server-side, credentials stripped from response)
    const result = items.map(({ apiKey, apiSecret, ...rest }) => ({
      ...rest,
      operational: isMarketplaceOperational({ active: rest.active, apiKey, apiSecret, apiUrl: rest.apiUrl }),
    }));
    return res.json({ items: result });
  } catch (error) {
    return handleDbError(res, error);
  }
});

// ==================== XML IMPORT ====================
router.post('/xml/import', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req, res) => {
  const xml = typeof req.body?.xml === 'string' ? req.body.xml : '';
  const xmlUrl = typeof req.body?.xmlUrl === 'string' ? req.body.xmlUrl.trim() : '';
  const sourceName = typeof req.body?.sourceName === 'string' ? req.body.sourceName.trim() : '';

  let payload = xml;

  // XML doğrulaması importXmlProducts içindeki parseXmlDocument ile yapılır.
  if (xml && !xml.trim()) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'xml body boş olamaz' } });
  }

  if (!payload.trim() && xmlUrl) {
    try {
      payload = await fetchXmlFromUrl(xmlUrl);
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'XML_FETCH_FAILED',
          message: error instanceof Error ? error.message : 'XML URL okunamadı',
        },
      });
    }
  }

  if (!payload.trim()) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'xml body zorunludur' } });
  }

  try {
    const result = await importXmlProducts(payload, {
      actorUserId: (req as AuthedRequest).actor?.userId ?? null,
      sourceName: sourceName || null,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: {
        code: 'IMPORT_FAILED',
        message: error instanceof Error ? error.message : 'XML import başarısız oldu',
      },
    });
  }
});

// ==================== NAV BADGES ====================
router.get('/nav-badges', requireAuth, async (_req, res) => {
  try {
    const [pendingOrders, unreadNotifications] = await Promise.all([
      prisma.order.count({ where: { status: { in: ['new', 'pending', 'processing'] } } }),
      prisma.notification.count({ where: { read: false } }),
    ]);
    res.json({ pendingOrders, unreadNotifications });
  } catch (error) {
    console.error('[nav-badges]', error);
    res.json({ pendingOrders: 0, unreadNotifications: 0 });
  }
});

// ==================== NOTIFICATIONS ====================
router.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;
    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.notification.count(),
      prisma.notification.count({ where: { read: false } }),
    ]);
    res.json({ items, total, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('[notifications]', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Bildirimler yüklenemedi' } });
  }
});

router.put('/notifications/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await prisma.notification.update({ where: { id }, data: { read: true } });
    const unreadCount = await prisma.notification.count({ where: { read: false } });
    res.json({ ok: true, unreadCount });
  } catch (error) {
    console.error('[notifications read]', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Bildirim okunamadı' } });
  }
});

router.put('/notifications/read-all', requireAuth, async (_req: Request, res: Response) => {
  try {
    await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    res.json({ ok: true, unreadCount: 0 });
  } catch (error) {
    console.error('[notifications read-all]', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Bildirimler okunamadı' } });
  }
});

// ==================== SYSTEM HEALTH ====================
router.get('/system/health', async (_req, res) => {
  try {
    const [dbOk, marketplacesOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      prisma.marketplace.count().then(() => true).catch(() => false),
    ]);

    const health = {
      database: dbOk ? 'OK' : 'ERROR',
      marketplaces: marketplacesOk ? 'OK' : 'ERROR',
      xml: true ? 'OK' : 'ERROR',
      status: dbOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch {
    res.status(503).json({
      database: 'ERROR',
      marketplaces: 'UNKNOWN',
      xml: 'UNKNOWN',
      status: 'down',
      timestamp: new Date().toISOString(),
    });
  }
});
