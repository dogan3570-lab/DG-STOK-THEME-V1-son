import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { invalidateDashboardStatsCache } from './dashboard.ts';
import { fetchXmlFromUrl, importXmlProducts, parseXmlImportPayload, cancelSync, isSyncLocked } from '../services/xmlImport.ts';

const router = Router();

// GET /xml-sources - List all XML sources (suppliers) with stats
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const sources = await prisma.xmlSource.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const items = await Promise.all(sources.map(async (source) => {
      const productCount = await prisma.product.count({
        where: { xmlSourceId: source.id },
      });

      const lastRun = await prisma.xmlImportRun.findFirst({
        where: { sourceId: source.id },
        orderBy: { startedAt: 'desc' },
        select: {
          status: true,
          newProducts: true,
          updatedProducts: true,
          failedProducts: true,
          durationMs: true,
          finishedAt: true,
          startedAt: true,
        },
      });

      return {
        id: source.id,
        name: source.name,
        company: source.company,
        sourceType: source.sourceType,
        url: source.url,
        username: source.username,
        currency: source.currency,
        vatRate: source.vatRate,
        active: source.active,
        connectionStatus: source.connectionStatus,
        scheduleIntervalMinutes: source.scheduleIntervalMinutes,
        lastRunAt: source.lastRunAt,
        lastSuccessAt: source.lastSuccessAt,
        lastError: source.lastError,
        purchasePriceVatStatus: source.purchasePriceVatStatus,
        purchasePriceField: source.purchasePriceField,
        productCount,
        lastRunStatus: lastRun?.status ?? null,
        lastRunDurationMs: lastRun?.durationMs ?? null,
        lastNewProducts: lastRun?.newProducts ?? 0,
        lastUpdatedProducts: lastRun?.updatedProducts ?? 0,
        lastFailedProducts: lastRun?.failedProducts ?? 0,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      };
    }));

    res.json({ items });
  } catch (error) {
    console.error('Error fetching XML sources:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch XML sources' } });
  }
});

// GET /xml-sources/:id - Get single XML source with full details
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.xmlSource.findUnique({
      where: { id },
      include: {
        importRuns: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!source) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML source not found' } });
    }

    const { password, ...safeSource } = source;
    void password;
    res.json(safeSource);
  } catch (error) {
    console.error('Error fetching XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch XML source' } });
  }
});

// POST /xml-sources - Create new XML source (supplier)
router.post('/', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const {
      name, company, sourceType, url, username, password,
      currency, vatRate, active, scheduleIntervalMinutes, cronExpression,
      purchasePriceVatStatus, purchasePriceField,
      updateStock, updatePrice, updateImages
    } = req.body;

    if (!name || !sourceType) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name and sourceType are required' } });
    }

    const source = await prisma.xmlSource.create({
      data: {
        name,
        company: company || null,
        sourceType,
        url: url || null,
        username: username || null,
        password: password || null,
        currency: currency || 'TRY',
        vatRate: vatRate != null ? Number(vatRate) : 20,
        active: active !== false,
        scheduleIntervalMinutes: scheduleIntervalMinutes || 60,
        cronExpression: cronExpression || null,
        purchasePriceVatStatus: purchasePriceVatStatus || 'dahil',
        purchasePriceField: purchasePriceField || null,
        updateStock: updateStock !== false,
        updatePrice: updatePrice !== false,
        updateImages: updateImages !== false,
        connectionStatus: url ? 'unknown' : 'connected',
      },
    });

    invalidateDashboardStatsCache();

    res.status(201).json(source);
  } catch (error) {
    console.error('Error creating XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create XML source' } });
  }
});

// PUT /xml-sources/:id - Update XML source
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const {
      name, company, sourceType, url, username, password,
      currency, vatRate, active, scheduleIntervalMinutes, cronExpression,
      purchasePriceVatStatus, purchasePriceField,
      updateStock, updatePrice, updateImages,
      fieldMapping, pricingRules
    } = req.body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (company !== undefined) data.company = company;
    if (sourceType !== undefined) data.sourceType = sourceType;
    if (url !== undefined) data.url = url;
    if (username !== undefined) data.username = username;
    if (password !== undefined) data.password = password;
    if (currency !== undefined) data.currency = currency;
    if (vatRate !== undefined) data.vatRate = Number(vatRate);
    if (active !== undefined) data.active = active;
    if (scheduleIntervalMinutes !== undefined) data.scheduleIntervalMinutes = scheduleIntervalMinutes;
    if (cronExpression !== undefined) data.cronExpression = cronExpression;
    if (purchasePriceVatStatus !== undefined) data.purchasePriceVatStatus = purchasePriceVatStatus;
    if (purchasePriceField !== undefined) data.purchasePriceField = purchasePriceField;
    if (updateStock !== undefined) data.updateStock = updateStock;
    if (updatePrice !== undefined) data.updatePrice = updatePrice;
    if (updateImages !== undefined) data.updateImages = updateImages;
    if (fieldMapping !== undefined) data.fieldMapping = typeof fieldMapping === 'string' ? fieldMapping : JSON.stringify(fieldMapping);
    if (pricingRules !== undefined) data.pricingRules = typeof pricingRules === 'string' ? pricingRules : JSON.stringify(pricingRules);

    const source = await prisma.xmlSource.update({
      where: { id },
      data,
    });

    invalidateDashboardStatsCache();

    res.json(source);
  } catch (error) {
    console.error('Error updating XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update XML source' } });
  }
});

// DELETE /xml-sources/:id - Delete XML source (products kept, xmlSourceId cleared)
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    await prisma.xmlImportItemResult.deleteMany({
      where: { importRun: { sourceId: id } },
    });
    await prisma.xmlImportRun.deleteMany({ where: { sourceId: id } });

    await prisma.product.updateMany({
      where: { xmlSourceId: id },
      data: { xmlSourceId: null },
    });

    await prisma.xmlSource.delete({ where: { id } });

    invalidateDashboardStatsCache();

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete XML source' } });
  }
});

// POST /xml-sources/:id/test - Test XML connection
router.post('/:id/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.xmlSource.findUnique({ where: { id } });

    if (!source) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML source not found' } });
    }

    if (!source.url) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Source URL is required for testing' } });
    }

    invalidateDashboardStatsCache();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(source.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: source.username ? {
          'Authorization': 'Basic ' + Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')
        } : undefined,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = await response.text();
        const hasContent = text.trim().length > 0;
        const hasXmlTags = text.includes('<') && text.includes('>');

        await prisma.xmlSource.update({
          where: { id },
          data: {
            connectionStatus: hasContent && hasXmlTags ? 'connected' : 'error',
            lastError: hasContent && hasXmlTags ? null : 'XML içeriği bulunamadı veya geçersiz XML formatı'
          },
        });

        res.json({
          ok: true,
          status: 'connected',
          message: hasContent && hasXmlTags ? 'Bağlantı başarılı, XML içeriği geçerli' : 'Bağlantı başarılı ancak XML içeriği sorunlu',
          contentLength: text.length,
        });
      } else if (response.status === 401 || response.status === 403) {
        await prisma.xmlSource.update({
          where: { id },
          data: { connectionStatus: 'auth_error', lastError: 'Kimlik doğrulama hatası' },
        });
        res.json({ ok: false, status: 'auth_error', message: 'Kimlik doğrulama hatası' });
      } else {
        await prisma.xmlSource.update({
          where: { id },
          data: { connectionStatus: 'error', lastError: `HTTP ${response.status}` },
        });
        res.json({ ok: false, status: 'error', message: `HTTP ${response.status} hatası` });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Bağlantı hatası';
      const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout');

      await prisma.xmlSource.update({
        where: { id },
        data: {
          connectionStatus: isTimeout ? 'timeout' : 'error',
          lastError: isTimeout ? 'Zaman aşımı (15sn)' : errorMessage
        },
      });

      res.json({
        ok: false,
        status: isTimeout ? 'timeout' : 'error',
        message: isTimeout ? 'Zaman aşımı' : errorMessage
      });
    }
  } catch (error) {
    console.error('Error testing XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to test XML source' } });
  }
});

// POST /xml-sources/:id/analyze - Detailed XML analysis
router.post('/:id/analyze', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.xmlSource.findUnique({ where: { id } });

    if (!source) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML source not found' } });
    }

    if (!source.url) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Source URL is required for analysis' } });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(source.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: source.username ? {
          'Authorization': 'Basic ' + Buffer.from(`${source.username}:${source.password || ''}`).toString('base64')
        } : undefined,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(400).json({ ok: false, message: `HTTP ${response.status} hatası` });
      }

      const text = await response.text();
      const contentLength = text.length;
      const encoding = detectEncoding(text);

      const products = parseXmlImportPayload(text);

      const categorySet = new Set<string>();
      const brandSet = new Set<string>();
      const variantCounts: Record<string, number> = {};
      let imageCount = 0;
      let hasXmlKey = 0;

      for (const product of products) {
        if (product.xmlKey) hasXmlKey++;

        const parts = [product.topCategory, product.mainCategory, product.subCategory, product.category].filter(Boolean);
        if (parts.length > 0) categorySet.add(parts.join(' > '));

        if (product.brand) brandSet.add(product.brand);

        if (product.sku?.includes('-')) {
          variantCounts['SKU-tabanlı'] = (variantCounts['SKU-tabanlı'] || 0) + 1;
        }

        if (product.images) {
          imageCount += product.images.split(',').filter(Boolean).length;
        }
      }

      const imageUrls = products.flatMap(p => p.images ? p.images.split(',').filter(Boolean) : []);
      const validUrls = imageUrls.filter(u => u.startsWith('https'));
      const httpUrls = imageUrls.filter(u => u.startsWith('http://'));
      const invalidUrls = imageUrls.filter(u => !u.startsWith('http'));

      const totalTags = (text.match(/<[^>]+>/g) || []).length;
      const hasCDATA = text.includes('<![CDATA[');
      const hasHtmlEntities = /&[a-z]+;/i.test(text);
      const productTagCount = (text.match(/<(product|item)\b[^>]*>/gi) || []).length;

      res.json({
        ok: true,
        analysis: {
          contentLength,
          contentLengthFormatted: formatFileSize(contentLength),
          encoding,
          totalTags,
          hasCDATA,
          hasHtmlEntities,
          validXml: true,

          totalProducts: products.length,
          productTagsFound: productTagCount,
          productsWithXmlKey: hasXmlKey,
          productsWithoutXmlKey: products.length - hasXmlKey,

          uniqueCategories: categorySet.size,
          categoryList: Array.from(categorySet).slice(0, 20),
          uniqueBrands: brandSet.size,
          brandList: Array.from(brandSet).slice(0, 20),
          variantSummary: Object.keys(variantCounts).length > 0 ? variantCounts : 'Varyant bulunamadı',

          totalImages: imageCount,
          uniqueImageUrls: imageUrls.length,
          httpsUrls: validUrls.length,
          httpUrls: httpUrls.length,
          invalidUrls: invalidUrls.length,
        },
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        message: 'XML analiz edilemedi',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    console.error('Error analyzing XML source:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to analyze XML source' } });
  }
});

function detectEncoding(text: string): string {
  if (text.startsWith('\uFEFF')) return 'UTF-8 BOM';
  const encodingMatch = text.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  if (encodingMatch) return encodingMatch[1];
  try {
    Buffer.from(text, 'utf-8');
    return 'UTF-8';
  } catch {
    return 'Unknown';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function runSyncInBackground(sourceId: string, sourceUrl: string, sourceName: string) {
  try {
    console.log(`[Background Sync] Starting for ${sourceName}...`);
    const xmlContent = await fetchXmlFromUrl(sourceUrl);
    const result = await importXmlProducts(xmlContent, {
      sourceId,
      sourceName,
    });
    console.log(`[Background Sync] Completed for ${sourceName}: ${result.importedCount} imported, ${result.updatedCount} updated`);
  } catch (error) {
    console.error(`[Background Sync] Error for ${sourceName}:`, error);
  }
}

// POST /xml-sources/:id/sync - Manual sync trigger (runs in background)
router.post('/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.xmlSource.findUnique({ where: { id } });

    if (!source) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML source not found' } });
    }

    if (!source.url) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Source URL is required for sync' } });
    }

    runSyncInBackground(source.id, source.url, source.name).catch(console.error);

    res.json({
      message: 'Sync started in background',
      sourceId: source.id,
      status: 'running',
    });
  } catch (error) {
    console.error('Error triggering sync:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Failed to trigger sync' } });
  }
});

// POST /xml-sources/sync-all - Batch sync all active XML sources
router.post('/sync-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const activeSources = await prisma.xmlSource.findMany({
      where: { active: true, url: { not: null } },
      select: { id: true, name: true, url: true },
    });

    if (activeSources.length === 0) {
      return res.json({ message: 'Aktif XML kaynağı bulunamadı', total: 0, started: 0 });
    }

    let startedCount = 0;
    for (const source of activeSources) {
      if (source.url) {
        runSyncInBackground(source.id, source.url, source.name).catch(console.error);
        startedCount++;
      }
    }

    res.json({
      message: `${startedCount}/${activeSources.length} aktif XML kaynağı için sync başlatıldı`,
      total: activeSources.length,
      started: startedCount,
    });
  } catch (error) {
    console.error('Error triggering batch sync:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to trigger batch sync' } });
  }
});

// POST /xml-sources/:id/cancel - Cancel a running sync
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const source = await prisma.xmlSource.findUnique({ where: { id } });

    if (!source) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML source not found' } });
    }

    if (!isSyncLocked(id)) {
      return res.json({ message: 'Bu kaynak için aktif bir senkronizasyon bulunamadı', cancelled: false });
    }

    const cancelled = cancelSync(id);
    await prisma.xmlImportRun.updateMany({
      where: { sourceId: id, status: 'running' },
      data: { status: 'cancelled', finishedAt: new Date() },
    });

    res.json({
      message: cancelled ? 'Senkronizasyon iptal edildi' : 'İptal başarısız',
      cancelled,
    });
  } catch (error) {
    console.error('Error cancelling sync:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel sync' } });
  }
});

// GET /xml-sources/:id/history - Get sync history
router.get('/:id/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { limit = 20 } = req.query;

    const runs = await prisma.xmlImportRun.findMany({
      where: { sourceId: id },
      orderBy: { startedAt: 'desc' },
      take: Number(limit),
    });

    res.json({ items: runs });
  } catch (error) {
    console.error('Error fetching sync history:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sync history' } });
  }
});

// GET /xml-sources/:id/products - Get products imported from a specific XML source
router.get('/:id/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const search = String(req.query?.search ?? '').trim();
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(req.query?.limit ?? 50)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      xmlSourceId: id,
    };

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { xmlKey: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          variants: { select: { id: true, name: true, value: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const source = await prisma.xmlSource.findUnique({
      where: { id },
      select: { name: true, lastRunAt: true, lastSuccessAt: true },
    });

    res.json({
      items,
      source,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching source products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch source products' } });
  }
});

export default router;
