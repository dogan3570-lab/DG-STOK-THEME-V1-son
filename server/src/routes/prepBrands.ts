import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';

const router = Router();

// ==================== HELPERS ====================
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

function normalizeBrandName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

async function createBrandLog(params: {
  action: string; xmlBrandName?: string; dgBrandId?: string; dgBrandName?: string;
  oldValue?: string; newValue?: string; prefixChanged?: boolean;
  productCount?: number; details?: string; actorUserId?: string;
}) {
  await prisma.brandLog.create({ data: params as any });
}

function applyPrefixFormat(format: string, brandName: string, title: string): string {
  return format.replace(/\{title\}/g, title).replace(/MARKA/g, brandName);
}

// ==================== XML BRANDS ====================
router.get('/xml-brands', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = req.query.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const search = String(req.query?.search ?? '').trim();
    const where: any = { xmlBrandName: { not: null } };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    if (search) where.xmlBrandName = { contains: search };
    const products = await prisma.product.findMany({ where, select: { xmlBrandName: true, xmlSourceId: true, xmlSource: { select: { name: true } } }, distinct: ['xmlBrandName'] });
    const items = products.filter(p => p.xmlBrandName).map(p => ({ name: p.xmlBrandName!, sourceName: p.xmlSource?.name || 'Bilinmeyen', sourceId: p.xmlSourceId }));
    res.json({ items });
  } catch (error) { console.error('[brands] GET xml-brands error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'XML markaları alınamadı' } }); }
});

// ==================== STATS ====================
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [totalSystemBrands, matchedProducts, unmatchedProducts, totalMappings, totalLogs] = await Promise.all([
      prisma.brand.count({ where: { isActive: true } }), prisma.product.count({ where: { brandMatch: true } }),
      prisma.product.count({ where: { brandMatch: false } }), prisma.brandMapping.count(), prisma.brandLog.count(),
    ]);
    const brandUsageCounts = await prisma.product.groupBy({ by: ['brandUsageType'], _count: { brandUsageType: true } });
    const usageMap: Record<string, number> = {};
    for (const u of brandUsageCounts) usageMap[u.brandUsageType] = u._count.brandUsageType;
    res.json({ totalSystemBrands, matchedProducts, unmatchedProducts, totalMappings, totalLogs,
      xmlBrandUsage: usageMap['XML_BRAND'] || 0, dgBrandUsage: usageMap['DG_BRAND'] || 0, customBrandUsage: usageMap['CUSTOM'] || 0,
      prefixEnabledCount: await prisma.product.count({ where: { prefixEnabled: true } }) });
  } catch (error) { console.error('[brands] GET stats error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'İstatistikler alınamadı' } }); }
});

// ==================== BRAND PRODUCTS ====================
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || '1'));
    const limit = parseInt(String(req.query.limit || '50'));
    const search = String(req.query.search || '').trim();
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const unbranded = req.query?.unbranded === 'true';
    const brandIdParam = req.query?.brandId ? String(req.query.brandId) : null;
    const brandNameParam = req.query?.brandName ? String(req.query.brandName) : null;
    const xmlBrandNameParam = req.query?.xmlBrandName ? String(req.query.xmlBrandName) : null;

    const where: any = {};
    if (unbranded) where.brandMatch = false;
    if (brandIdParam === 'not_null') where.brandId = { not: null };
    else if (brandIdParam) where.brandId = brandIdParam;
    if (xmlBrandNameParam) where.xmlBrandName = xmlBrandNameParam;
    else if (brandNameParam) where.xmlBrandName = brandNameParam;
    if (search) where.OR = [{ title: { contains: search } }, { xmlKey: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }];
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          xmlSource: { select: { id: true, name: true } },
          variants: { select: { id: true, name: true, value: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);
    res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('[brands] GET products error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch brand products' } });
  }
});

// ==================== SYSTEM BRANDS ====================
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const where: Record<string, unknown> = {};
    if (search) where.name = { contains: search };
    const brands = await prisma.brand.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { products: true, brandMappings: true } } } });
    res.json({ items: brands.map(b => ({ id: b.id, name: b.name, externalId: b.externalId, logo: b.logo, prefixEnabled: b.prefixEnabled, prefixFormat: b.prefixFormat, isActive: b.isActive, productCount: b._count.products, mappingCount: b._count.brandMappings, createdAt: b.createdAt, updatedAt: b.updatedAt })) });
  } catch (error) { console.error('[brands] GET error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Markalar alınamadı' } }); }
});

// ==================== MAPPINGS ====================
router.get('/mappings', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const dgBrandId = req.query?.dgBrandId ? String(req.query.dgBrandId) : null;
    const where: Record<string, unknown> = {};
    if (search) where.xmlBrandName = { contains: search };
    if (dgBrandId) where.dgBrandId = dgBrandId;
    const mappings = await prisma.brandMapping.findMany({ where, orderBy: { createdAt: 'desc' }, include: { dgBrand: { select: { id: true, name: true, logo: true } } } });
    res.json({ items: mappings.map(m => ({ id: m.id, xmlBrandName: m.xmlBrandName, dgBrandId: m.dgBrandId, dgBrandName: m.dgBrand.name, dgBrandLogo: m.dgBrand.logo, confidence: m.confidence, isAuto: m.isAuto, productCount: m.productCount, createdAt: m.createdAt })) });
  } catch (error) { console.error('[brands] GET mappings error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Eşleştirmeler alınamadı' } }); }
});

// ==================== LOGS ====================
router.get('/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 50)));
    const [items, total] = await Promise.all([
      prisma.brandLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.brandLog.count(),
    ]);
    res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error('[brands] GET logs error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Loglar alınamadı' } }); }
});

// ==================== DEFAULT BRAND ====================
router.get('/default-brand', requireAuth, async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'default_brand' } });
    return res.json({ ok: true, defaultBrand: setting?.value || 'DG STORE' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'DB_ERROR', message: 'Varsayılan marka alınamadı' } });
  }
});

router.put('/default-brand', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const { brand } = req.body;
    if (!brand || !brand.trim()) return res.status(400).json({ ok: false, error: 'brand zorunludur' });
    await prisma.setting.upsert({ where: { key: 'default_brand' }, update: { value: brand.trim() }, create: { key: 'default_brand', value: brand.trim() } });
    return res.json({ ok: true, defaultBrand: brand.trim() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'DB_ERROR', message: 'Varsayılan marka güncellenemedi' } });
  }
});

// ==================== CRUD ====================
router.post('/', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { name, externalId, logo, prefixEnabled, prefixFormat } = req.body;
    if (!name) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } });
    const brand = await prisma.brand.create({ data: { name: String(name).trim(), externalId: externalId || null, logo: logo || null, prefixEnabled: prefixEnabled || false, prefixFormat: prefixFormat || 'MARKA\u00ae {title}' } });
    await createBrandLog({ action: 'BRAND_CREATE', dgBrandId: brand.id, dgBrandName: brand.name, actorUserId: (req as AuthedRequest).actor?.userId });
    res.status(201).json({ item: brand });
  } catch (error) { console.error(error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Marka oluşturulamadı' } }); }
});

router.put('/:id', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, externalId, logo, prefixEnabled, prefixFormat, isActive } = req.body;
    const old = await prisma.brand.findUnique({ where: { id } });
    if (!old) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Marka bulunamadı' } });
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name; if (externalId !== undefined) data.externalId = externalId || null;
    if (logo !== undefined) data.logo = logo || null; if (prefixEnabled !== undefined) data.prefixEnabled = prefixEnabled;
    if (prefixFormat !== undefined) data.prefixFormat = prefixFormat; if (isActive !== undefined) data.isActive = isActive;
    const brand = await prisma.brand.update({ where: { id }, data });
    await createBrandLog({ action: 'BRAND_UPDATE', dgBrandId: id, dgBrandName: brand.name, oldValue: old.name, newValue: brand.name, details: JSON.stringify({ prefixChanged: old.prefixEnabled !== brand.prefixEnabled || old.prefixFormat !== brand.prefixFormat }), actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ item: brand });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: 'Marka güncellenemedi' } }); }
});

router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Marka bulunamadı' } });
    await prisma.product.updateMany({ where: { brandId: id }, data: { brandId: null, brandMatch: false } });
    await prisma.brandMapping.deleteMany({ where: { dgBrandId: id } });
    await prisma.brand.delete({ where: { id } });
    await createBrandLog({ action: 'BRAND_DELETE', dgBrandId: id, dgBrandName: brand.name, actorUserId: (req as AuthedRequest).actor?.userId });
    res.status(204).send();
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: 'Marka silinemedi' } }); }
});

// ==================== MATCH / UNMATCH ====================
router.post('/preview', requireAuth, async (req: Request, res: Response) => {
  try {
    const { xmlBrandName, dgBrandId, xmlSourceId, marketplaceKey } = req.body;
    if (!xmlBrandName || !dgBrandId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'xmlBrandName ve dgBrandId zorunludur' } });
    const dgBrand = await prisma.brand.findUnique({ where: { id: dgBrandId } });
    if (!dgBrand) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Marka bulunamadı' } });
    const where: any = { xmlBrandName };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    const count = await prisma.product.count({ where });
    const format = dgBrand.prefixFormat || 'MARKA\u00ae {title}';
    res.json({ count, brandName: dgBrand.name, xmlBrandName, marketplaceKey: marketplaceKey || null, format, preview: applyPrefixFormat(format, dgBrand.name, 'Örnek Ürün') });
  } catch (error) { console.error('[brands] POST preview error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Önizleme alınamadı' } }); }
});

router.post('/backfill-xml-brand', requireAuth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  try {
    const mappings = await prisma.brandMapping.findMany({ select: { xmlBrandName: true, dgBrandId: true } });
    const mappingByBrandId = new Map<string, string>();
    for (const m of mappings) {
      if (!mappingByBrandId.has(m.dgBrandId)) mappingByBrandId.set(m.dgBrandId, m.xmlBrandName);
    }
    let totalUpdated = 0;
    for (const [brandId, xmlName] of mappingByBrandId) {
      const r = await prisma.product.updateMany({ where: { xmlBrandName: null, brandId }, data: { xmlBrandName: xmlName } });
      totalUpdated += r.count;
    }
    const r2 = await prisma.product.updateMany({ where: { xmlBrandName: null }, data: { xmlBrandName: 'D&G' } });
    totalUpdated += r2.count;
    res.json({ updated: totalUpdated, message: totalUpdated + ' ürünün xmlBrandName alanı güncellendi' });
  } catch (error) { console.error('[brands] POST backfill error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Backfill başarısız' } }); }
});

router.post('/match', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlBrandName, dgBrandId, xmlSourceId, marketplaceKey } = req.body;
    if (!xmlBrandName || !dgBrandId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'xmlBrandName ve dgBrandId zorunludur' } });
    const dgBrand = await prisma.brand.findUnique({ where: { id: dgBrandId } });
    if (!dgBrand) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Marka bulunamadı' } });
    await prisma.brandMapping.upsert({ where: { xmlBrandName }, update: { dgBrandId, isAuto: false, marketplaceKey: marketplaceKey || null }, create: { xmlBrandName, dgBrandId, isAuto: false, marketplaceKey: marketplaceKey || null } });
    const where: any = { xmlBrandName };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    const format = dgBrand.prefixFormat || 'MARKA\u00ae {title}';
    const prefixLabel = dgBrand.name + ' \u00ae ';
    const now = new Date().toISOString();
    await prisma.product.updateMany({ where, data: { brandId: dgBrandId, brandMatch: true, matchedBy: 'manual', lastMatchDate: new Date(), brandUsageType: 'DG_BRAND', prefixEnabled: true } });
    const products = await prisma.product.findMany({ where, select: { id: true, title: true, originalTitle: true } });
    const updates: { id: string; newTitle: string; origTitle: string }[] = [];
    for (const p of products) {
      const rawTitle = p.originalTitle || p.title || '';
      let cleanTitle = rawTitle;
      const match = cleanTitle.match(/^[A-Za-z\u00c0-\u024f\u0130\u0131\s]+ \u00ae /);
      if (match) cleanTitle = cleanTitle.substring(match[0].length);
      const newTitle = applyPrefixFormat(format, dgBrand.name, cleanTitle);
      updates.push({ id: p.id, newTitle, origTitle: p.originalTitle || p.title || '' });
    }
    for (let i = 0; i < updates.length; i += 1000) {
      const batch = updates.slice(i, i + 1000);
      const stmts = batch.map(u => prisma.$executeRawUnsafe('UPDATE Product SET title = ?, computedTitle = ?, originalTitle = ? WHERE id = ?', u.newTitle, u.newTitle, u.origTitle, u.id));
      await prisma.$transaction(stmts);
    }
    const productCount = await prisma.product.count({ where: { xmlBrandName } });
    await prisma.brandMapping.update({ where: { xmlBrandName }, data: { productCount } }).catch(() => null);
    await createBrandLog({ action: 'BRAND_MATCH', xmlBrandName, dgBrandId, dgBrandName: dgBrand.name, productCount: updates.length, actorUserId: (req as AuthedRequest).actor?.userId, details: JSON.stringify({ xmlSourceId: xmlSourceId || null, marketplaceKey: marketplaceKey || null }) });
    res.json({ matchedCount: updates.length, message: updates.length + ' ürün "' + dgBrand.name + '" markasına eşleştirildi' });
  } catch (error) { console.error('[brands] POST match error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Eşleştirme başarısız' } }); }
});

router.post('/unmatch', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { xmlBrandName, productIds } = req.body;
    const where: any = {};
    if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    else if (xmlBrandName) where.xmlBrandName = xmlBrandName;
    else return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'xmlBrandName veya productIds zorunludur' } });
    const result = await prisma.product.updateMany({ where, data: { brandId: null, brandMatch: false, brandUsageType: 'XML_BRAND' } });
    await createBrandLog({ action: 'BRAND_UNMATCH', xmlBrandName, productCount: result.count, actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ unmatchedCount: result.count, message: `${result.count} \u00fcr\u00fcn\u00fcn e\u015fle\u015ftirmesi kald\u0131r\u0131ld\u0131` });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: 'E\u015fle\u015ftirme kald\u0131r\u0131lamad\u0131' } }); }
});

router.post('/bulk-match', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'matches array required' } });
    let totalMatched = 0;
    const results: Array<{ xmlBrandName: string; dgBrandName: string; count: number }> = [];
    for (const match of matches) {
      const { xmlBrandName, dgBrandId } = match;
      const dgBrand = await prisma.brand.findUnique({ where: { id: dgBrandId } });
      if (!dgBrand) continue;
      await prisma.brandMapping.upsert({ where: { xmlBrandName }, update: { dgBrandId, isAuto: false }, create: { xmlBrandName, dgBrandId, isAuto: false } });
      const result = await prisma.product.updateMany({ where: { xmlBrandName }, data: { brandId: dgBrandId, brandMatch: true, matchedBy: 'bulk', lastMatchDate: new Date(), brandUsageType: 'DG_BRAND' } });
      const productCount = await prisma.product.count({ where: { brandId: dgBrandId } });
      await prisma.brandMapping.update({ where: { xmlBrandName }, data: { productCount } }).catch(() => null);
      totalMatched += result.count; results.push({ xmlBrandName, dgBrandName: dgBrand.name, count: result.count });
    }
    await createBrandLog({ action: 'BULK_CHANGE', productCount: totalMatched, details: JSON.stringify(results), actorUserId: (req as AuthedRequest).actor?.userId });

    res.json({ matchedCount: totalMatched, results, message: `${totalMatched} \u00fcr\u00fcn toplu e\u015fle\u015ftirildi` });
  } catch (error) { console.error('[brands] POST bulk-match error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Toplu e\u015fle\u015ftirme ba\u015far\u0131s\u0131z' } }); }
});

// ==================== AI MATCH (KURAL TABANLI) ====================
router.post('/ai-match', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body;
    const where: any = { brandMatch: false };
    if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };

    const systemBrands = await prisma.brand.findMany({ where: { isActive: true } });
    const exactIndex: Record<string, { id: string; name: string }> = {};
    for (const b of systemBrands) { const n = normalizeBrandName(b.name); if (n) exactIndex[n] = { id: b.id, name: b.name }; }

    const findBest = (xmlName: string): { id: string; name: string; score: number } | null => {
      const normXml = normalizeBrandName(xmlName);
      if (!normXml) return null;
      if (exactIndex[normXml]) return { id: exactIndex[normXml].id, name: exactIndex[normXml].name, score: 100 };
      let best: { id: string; name: string; score: number } | null = null;
      for (const brand of systemBrands) {
        const normSys = normalizeBrandName(brand.name);
        if (!normSys) continue;
        const maxLen = Math.max(normXml.length, normSys.length);
        const sim = maxLen > 0 ? 1 - levenshtein(normXml, normSys) / maxLen : 0;
        if (sim >= 0.85 && (!best || sim > best.score)) best = { id: brand.id, name: brand.name, score: Math.round(sim * 100) };
        else if (normXml.includes(normSys) && normSys.length > 2 && (!best || best.score < 80)) best = { id: brand.id, name: brand.name, score: 80 };
        else if (normSys.includes(normXml) && normXml.length > 2 && (!best || best.score < 70)) best = { id: brand.id, name: brand.name, score: 70 };
      }
      return best;
    };

    // XML marka başına TEK kez eşleştirme (ürün bazlı değil)
    const distinctBrands = await prisma.product.groupBy({
      by: ['xmlBrandName'],
      where: { ...where, xmlBrandName: { not: null } },
      _count: { id: true },
    });
    const brandRows = distinctBrands.map(d => ({ xmlBrandName: d.xmlBrandName!, count: d._count.id }));

    let matchedCount = 0;
    let suggestedCount = 0;
    let manualCount = 0;
    const results: Array<{ xmlBrandName: string; count: number; suggestedBrand: string | null; confidence: number }> = [];
    const toUpdate: Array<{ xmlBrandName: string; brandId: string; score: number; count: number }> = [];

    for (const row of brandRows) {
      const best = findBest(row.xmlBrandName);
      results.push({ xmlBrandName: row.xmlBrandName, count: row.count, suggestedBrand: best?.name || null, confidence: best?.score || 0 });
      if (best && best.score >= 80) {
        matchedCount += row.count;
        toUpdate.push({ xmlBrandName: row.xmlBrandName, brandId: best.id, score: best.score, count: row.count });
      } else if (best && best.score >= 60) {
        suggestedCount += row.count;
      } else {
        manualCount += row.count;
      }
    }

    // Toplu uygula: her XML marka için updateMany (bir kez)
    for (const m of toUpdate) {
      await prisma.brandMapping.upsert({ where: { xmlBrandName: m.xmlBrandName }, update: { dgBrandId: m.brandId, confidence: m.score || null, isAuto: true }, create: { xmlBrandName: m.xmlBrandName, dgBrandId: m.brandId, confidence: m.score || null, isAuto: true } }).catch(() => null);
      const productWhere: any = { xmlBrandName: m.xmlBrandName };
      if (Array.isArray(productIds) && productIds.length > 0) productWhere.id = { in: productIds };
      await prisma.product.updateMany({ where: productWhere, data: { brandId: m.brandId, brandMatch: true, matchedBy: 'ai', lastMatchDate: new Date(), brandUsageType: 'DG_BRAND' } });
      await prisma.brandMapping.update({ where: { xmlBrandName: m.xmlBrandName }, data: { productCount: m.count } }).catch(() => null);
    }

    await createBrandLog({ action: 'AI_MATCH', productCount: matchedCount, details: JSON.stringify({ matchedCount, suggestedCount, manualCount, totalScanned: distinctBrands.length }), actorUserId: (req as AuthedRequest).actor?.userId });

    res.json({ matchedCount, suggestedCount, manualCount, totalProducts: distinctBrands.length, message: `${matchedCount} ürün otomatik eşleştirildi, ${suggestedCount} öneri, ${manualCount} manuel inceleme`, results });
  } catch (error) {
    console.error('[brands] POST ai-match error:', error);
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Otomatik eşleştirme başarısız' } });
  }
});

// ==================== PREFIX ====================
router.post('/prefix/preview', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productIds, brandId, prefixFormat } = req.body;
    if (!productIds || !Array.isArray(productIds)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds array required' } });
    const brand = brandId ? await prisma.brand.findUnique({ where: { id: brandId } }) : null;
    const format = prefixFormat || brand?.prefixFormat || 'MARKA\u00ae {title}';
    const brandName = brand?.name || 'MARKA';
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, originalTitle: true } });
    const previews = products.map(p => ({ id: p.id, originalTitle: p.originalTitle || p.title || '', computedTitle: applyPrefixFormat(format, brandName, p.originalTitle || p.title || '') }));
    res.json({ previews, count: previews.length, format, brandName });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: '\u00d6nizleme al\u0131namad\u0131' } }); }
});

router.post('/prefix/apply', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds, brandId, prefixFormat, allProducts } = req.body;
    const where: any = {};
    if (!allProducts) { if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds }; else return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds veya allProducts gereklidir' } }); }
    const brand = brandId ? await prisma.brand.findUnique({ where: { id: brandId } }) : null;
    const format = prefixFormat || brand?.prefixFormat || 'MARKA\u00ae {title}';
    const brandName = brand?.name || 'MARKA';
    const products = await prisma.product.findMany({ where, select: { id: true, title: true, originalTitle: true } });
    let updatedCount = 0;
    for (const p of products) {
      const orig = p.originalTitle || p.title || '';
      await prisma.product.update({ where: { id: p.id }, data: { originalTitle: orig, computedTitle: applyPrefixFormat(format, brandName, orig), prefixEnabled: true, title: applyPrefixFormat(format, brandName, orig) } });
      updatedCount++;
    }
    await createBrandLog({ action: 'PREFIX_APPLY', dgBrandId: brandId, dgBrandName: brandName, prefixChanged: true, productCount: updatedCount, details: JSON.stringify({ format, allProducts: !!allProducts }), actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ updatedCount, message: `${updatedCount} \u00fcr\u00fcne "${format}" format\u0131 uyguland\u0131` });
  } catch (error) { console.error('[brands] POST prefix/apply error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: '\u00d6n ek uygulanamad\u0131' } }); }
});

router.post('/prefix/remove', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds, allProducts } = req.body;
    const where: any = { prefixEnabled: true };
    if (!allProducts && Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    const products = await prisma.product.findMany({ where, select: { id: true, originalTitle: true, title: true } });
    let updatedCount = 0;
    for (const p of products) {
      const orig = p.originalTitle || p.title || '';
      await prisma.product.update({ where: { id: p.id }, data: { title: orig, computedTitle: null, prefixEnabled: false } });
      updatedCount++;
    }
    await createBrandLog({ action: 'PREFIX_REMOVE', prefixChanged: true, productCount: updatedCount, details: JSON.stringify({ allProducts: !!allProducts }), actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ updatedCount, message: `${updatedCount} \u00fcr\u00fcnden \u00f6n ek kald\u0131r\u0131ld\u0131` });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: '\u00d6n ek kald\u0131r\u0131lamad\u0131' } }); }
});

// ==================== USAGE TYPE ====================
router.post('/use-xml-brand', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds, allProducts } = req.body;
    const where: any = {};
    if (!allProducts && Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    const result = await prisma.product.updateMany({ where, data: { brandUsageType: 'XML_BRAND', brandMatch: false, brandId: null } });
    await createBrandLog({ action: 'BULK_CHANGE', productCount: result.count, details: JSON.stringify({ usageType: 'XML_BRAND', allProducts: !!allProducts }), actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ updatedCount: result.count, message: `${result.count} \u00fcr\u00fcn XML markas\u0131 kullanacak \u015fekilde ayarland\u0131` });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: '\u0130\u015flem ba\u015far\u0131s\u0131z' } }); }
});

router.post('/use-dg-brand', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: Request, res: Response) => {
  try {
    const { productIds, allProducts } = req.body;
    const where: any = {};
    if (!allProducts && Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    const result = await prisma.product.updateMany({ where, data: { brandUsageType: 'DG_BRAND', brandMatch: true } });
    await createBrandLog({ action: 'BULK_CHANGE', productCount: result.count, details: JSON.stringify({ usageType: 'DG_BRAND', allProducts: !!allProducts }), actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ updatedCount: result.count, message: `${result.count} \u00fcr\u00fcn DG STOK markas\u0131 kullanacak \u015fekilde ayarland\u0131` });
  } catch (error) { res.status(500).json({ error: { code: 'DB_ERROR', message: '\u0130\u015flem ba\u015far\u0131s\u0131z' } }); }
});

// ==================== UNDO ====================
router.post('/undo/:logId', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const logId = String(req.params.logId);
    const log = await prisma.brandLog.findUnique({ where: { id: logId } });
    if (!log) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Log bulunamad\u0131' } });
    let undoneCount = 0;
    switch (log.action) {
      case 'BRAND_MATCH': case 'BULK_CHANGE':
        if (log.dgBrandId) { const result = await prisma.product.updateMany({ where: { brandId: log.dgBrandId }, data: { brandId: null, brandMatch: false, brandUsageType: 'XML_BRAND' } }); undoneCount = result.count; } break;
      case 'PREFIX_APPLY':
        await prisma.product.updateMany({ where: { prefixEnabled: true }, data: { computedTitle: null, prefixEnabled: false } });
        const products = await prisma.product.findMany({ where: { originalTitle: { not: null } }, select: { id: true, originalTitle: true } });
        for (const p of products) { if (p.originalTitle) await prisma.product.update({ where: { id: p.id }, data: { title: p.originalTitle } }); } undoneCount = products.length; break;
      case 'AI_MATCH': const result = await prisma.product.updateMany({ where: { matchedBy: 'ai' }, data: { brandId: null, brandMatch: false, matchedBy: null } }); undoneCount = result.count; break;
    }
    await createBrandLog({ action: 'UNDO', details: JSON.stringify({ originalLogId: logId, originalAction: log.action }), productCount: undoneCount, actorUserId: (req as AuthedRequest).actor?.userId });
    res.json({ undoneCount, message: `Geri alma i\u015flemi tamamland\u0131: ${undoneCount} kay\u0131t etkilendi` });
  } catch (error) { console.error('[brands] POST undo error:', error); res.status(500).json({ error: { code: 'DB_ERROR', message: 'Geri alma ba\u015far\u0131s\u0131z' } }); }
});

export default router;
