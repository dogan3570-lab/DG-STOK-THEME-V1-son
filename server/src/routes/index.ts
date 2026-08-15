import { Router } from 'express';
import type { Response, Request } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';
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
import aiSettingsRoutes from './aiSettings.ts';
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
router.use('/ai-settings', aiSettingsRoutes);

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
        createdAt: true,
        updatedAt: true,
      },
    });
    return res.json({ items });
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
