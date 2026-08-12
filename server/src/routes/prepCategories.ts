import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { matchCategoriesWithAI, type ProductForMatch, type CategoryCandidate } from '../services/aiGateway.ts';

const router = Router();

// ==================== LIST (PUBLIC) ====================
router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', message: 'Kategoriler alınamadı' } });
  }
});

// ==================== STATS ====================
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [totalXmlCategories, categorizedProducts, uncategorizedProducts, aiSuggested, manualMatched, errorCategories, totalSystemCategories] = await Promise.all([
      prisma.product.findMany({ where: { supplierCategory: { not: null } }, select: { supplierCategory: true }, distinct: ['supplierCategory'] }),
      prisma.product.count({ where: { categoryId: { not: null } } }),
      prisma.product.count({ where: { categoryId: null } }),
      prisma.product.count({ where: { aiSuggestedCategoryId: { not: null } } }),
      prisma.categoryMapping.count({ where: { source: 'manual' } }),
      prisma.product.count({ where: { errorMessage: { not: null }, categoryMatch: false } }),
      prisma.category.count(),
    ]);
    res.json({
      totalXmlCategories: totalXmlCategories.length,
      matchedCategories: categorizedProducts,
      unmatchedProducts: uncategorizedProducts,
      aiSuggested,
      manualMatched,
      errorCategories,
      totalCategories: totalSystemCategories,
    });
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category stats' } });
  }
});

// ==================== XML CATEGORIES (TREE) ====================
router.get('/xml-categories', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const where: any = { supplierCategory: { not: null } };
    if (search) where.supplierCategory = { contains: search };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const products = await prisma.product.findMany({
      where, select: { supplierCategory: true, xmlSourceId: true, xmlSource: { select: { name: true } } },
      distinct: ['supplierCategory'], orderBy: { supplierCategory: 'asc' },
    });

    const categories = products.map(p => ({ name: p.supplierCategory, sourceName: p.xmlSource?.name || 'Bilinmeyen', sourceId: p.xmlSourceId }));
    const tree: any[] = [];

    for (const cat of categories) {
      if (!cat.name) continue;
      const parts = cat.name.split('>').map((s: string) => s.trim()).filter(Boolean);
      let currentLevel = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const path = parts.slice(0, i + 1).join(' > ');
        let existing = currentLevel.find((n: any) => n.name === part);
        if (!existing) {
          existing = { name: part, fullPath: path, children: [], sourceName: cat.sourceName, sourceId: cat.sourceId, productCount: 0 };
          currentLevel.push(existing);
        }
        if (i === parts.length - 1) existing.productCount++;
        currentLevel = existing.children;
      }
    }
    res.json({ items: tree, flat: categories });
  } catch (error) {
    console.error('Error fetching XML categories:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch XML categories' } });
  }
});

// ==================== SYSTEM CATEGORIES (TREE) ====================
router.get('/tree', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const marketplaceId = req.query?.marketplaceId ? String(req.query.marketplaceId) : null;
    const where: any = {};
    if (search) where.name = { contains: search };

    let marketplaceCategoryIds: string[] | null = null;
    if (marketplaceId) {
      const mappings = await prisma.categoryMapping.findMany({ where: { marketplaceId }, select: { categoryId: true } });
      marketplaceCategoryIds = mappings.map(m => m.categoryId);
      if (marketplaceCategoryIds.length > 0) where.id = { in: marketplaceCategoryIds };
    }

    const allCategories = await prisma.category.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } });
    const buildTree = (parentId: string | null): any[] => allCategories.filter(c => c.parentId === parentId).map(c => ({ id: c.id, name: c.name, externalId: c.externalId, parentId: c.parentId, productCount: c._count.products, children: buildTree(c.id), createdAt: c.createdAt, updatedAt: c.updatedAt }));
    res.json({ items: buildTree(null), flat: allCategories });
  } catch (error) {
    console.error('Error fetching category tree:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category tree' } });
  }
});

// ==================== AI AUTO-MATCH (KURAL TABANLI EŞLEŞTİRME) ====================

router.post('/ai-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productIds, xmlSourceId } = req.body;
    const where: any = { categoryMatch: false };
    if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const totalCount = await prisma.product.count({ where });
    if (totalCount === 0) {
      return res.json({ matchedCount: 0, suggestedCount: 0, manualCount: 0, totalProducts: 0, message: 'Eşleştirilecek ürün bulunamadı', results: [] });
    }

    // Sistem kategorileri (tam eşleşme + normalize edilmiş eşleşme için)
    const systemCategories = await prisma.category.findMany();
    const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9ıİğĞüÜşŞöÖçÇ]/g, '').trim();

    // Hızlı tam eşleşme için normalized index
    const exactIndex: Record<string, { id: string; name: string }> = {};
    for (const cat of systemCategories) {
      const n = normalize(cat.name);
      if (n && !exactIndex[n]) exactIndex[n] = { id: cat.id, name: cat.name };
    }

    const findBest = (path: string, leaf: string): { id: string; name: string; score: number } | null => {
      const normPath = normalize(path);
      const normLeaf = normalize(leaf);
      if (exactIndex[normPath]) return { id: exactIndex[normPath].id, name: exactIndex[normPath].name, score: 100 };
      if (normLeaf && exactIndex[normLeaf]) return { id: exactIndex[normLeaf].id, name: exactIndex[normLeaf].name, score: 100 };

      let best: { id: string; name: string; score: number } | null = null;
      for (const cat of systemCategories) {
        const normCat = normalize(cat.name);
        if (!normCat) continue;
        if (normPath.includes(normCat) && (!best || best.score < 90)) { best = { id: cat.id, name: cat.name, score: 90 }; }
        else if (normLeaf.includes(normCat) && normCat.length > 2 && (!best || best.score < 75)) { best = { id: cat.id, name: cat.name, score: 75 }; }
        else if (normCat.includes(normLeaf) && normLeaf.length > 2 && (!best || best.score < 65)) { best = { id: cat.id, name: cat.name, score: 65 }; }
      }
      return best;
    };

    // Benzersiz XML kategori başına TEK kez eşleştirme yap, ürün sayısını grupla
    const distinctCats = await prisma.product.groupBy({
      by: ['supplierCategory'],
      where,
      _count: { id: true },
      _min: { xmlKey: true },
    });

    let matchedCount = 0;
    let suggestedCount = 0;
    let manualCount = 0;
    const matchResults: Array<{ productId: string; productName: string; suggestedCategory: string | null; confidence: number; reason: string }> = [];
    const toUpdate: Array<{ categoryId: string; score: number }> = [];

    for (const row of distinctCats) {
      const path = (row.supplierCategory || '').trim();
      if (!path) { manualCount += row._count.id; continue; }
      const leaf = path.split('>').map((s) => s.trim()).filter(Boolean).pop() || '';
      const best = findBest(path, leaf);

      if (best && best.score >= 75) {
        matchedCount += row._count.id;
        toUpdate.push({ categoryId: best.id, score: best.score });
        matchResults.push({ productId: row._min.xmlKey || '', productName: path, suggestedCategory: best.name, confidence: best.score, reason: 'kural_tabanli_eslesme' });
      } else if (best && best.score >= 50) {
        suggestedCount += row._count.id;
        matchResults.push({ productId: row._min.xmlKey || '', productName: path, suggestedCategory: best.name, confidence: best.score, reason: 'oneri' });
      } else {
        manualCount += row._count.id;
      }
    }

    // Uygula: her XML kategori için eşleşen ürünleri toplu güncelle
    const applyBatch = async (supplierCategory: string, categoryId: string, score: number) => {
      const productWhere: any = { supplierCategory, categoryMatch: false };
      if (Array.isArray(productIds) && productIds.length > 0) productWhere.id = { in: productIds };
      await prisma.product.updateMany({
        where: productWhere,
        data: { categoryId, categoryMatch: true, matchedBy: 'rule', lastMatchDate: new Date(), aiSuggestedCategoryId: categoryId, aiScore: score / 100 },
      });
    };

    let applied = 0;
    for (let i = 0; i < distinctCats.length; i++) {
      const row = distinctCats[i];
      const path = (row.supplierCategory || '').trim();
      const leaf = path.split('>').map((s) => s.trim()).filter(Boolean).pop() || '';
      const best = findBest(path, leaf);
      if (best && best.score >= 75) {
        await applyBatch(row.supplierCategory!, best.id, best.score);
        applied++;
      }
    }

    await prisma.auditLog.create({
      data: {
        action: 'RULE_CATEGORY_MATCH',
        entity: 'category',
        meta: JSON.stringify({ matchedCount, suggestedCount, manualCount, totalCount }),
        details: `Kural tabanlı ${matchedCount} ürün eşleştirildi, ${suggestedCount} öneri, ${manualCount} manuel inceleme`,
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({
      matchedCount,
      suggestedCount,
      manualCount,
      totalProducts: totalCount,
      message: `${matchedCount} ürün kural tabanlı eşleştirildi, ${suggestedCount} öneri, ${manualCount} manuel inceleme`,
      results: matchResults,
    });
  } catch (error) {
    console.error('Error rule matching categories:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to rule match categories' } });
  }
});

// ==================== AUTO MATCH ALL (ARKA PLAN + PROGRESS) ====================
const autoMatchState: { running: boolean; status: string; processedProducts: number; totalProducts: number; matchedCount: number; lastError: string | null } = {
  running: false, status: 'idle', processedProducts: 0, totalProducts: 0, matchedCount: 0, lastError: null,
};

async function runAutoMatch() {
  try {
    autoMatchState.status = 'running';
    const systemCategories = await prisma.category.findMany();
    const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9ıİğĞüÜşŞöÖçÇ]/g, '').trim();
    const exactIndex: Record<string, { id: string; name: string }> = {};
    for (const cat of systemCategories) { const n = normalize(cat.name); if (n && !exactIndex[n]) exactIndex[n] = { id: cat.id, name: cat.name }; }

    const distinctCats = await prisma.product.groupBy({ by: ['supplierCategory'], where: { categoryMatch: false }, _count: { id: true } });
    autoMatchState.totalProducts = distinctCats.reduce((s, r) => s + r._count.id, 0);
    autoMatchState.processedProducts = 0;
    autoMatchState.matchedCount = 0;

    for (const row of distinctCats) {
      const path = (row.supplierCategory || '').trim();
      if (!path) { autoMatchState.processedProducts += row._count.id; continue; }
      const leaf = path.split('>').map((s) => s.trim()).filter(Boolean).pop() || '';
      const normPath = normalize(path);
      const normLeaf = normalize(leaf);
      let bestId: string | null = null;
      if (exactIndex[normPath]) bestId = exactIndex[normPath].id;
      else if (normLeaf && exactIndex[normLeaf]) bestId = exactIndex[normLeaf].id;
      if (bestId) {
        await prisma.product.updateMany({
          where: { supplierCategory: row.supplierCategory, categoryMatch: false },
          data: { categoryId: bestId, categoryMatch: true, matchedBy: 'auto', lastMatchDate: new Date(), aiSuggestedCategoryId: bestId, aiScore: 1.0 },
        });
        autoMatchState.matchedCount += row._count.id;
      }
      autoMatchState.processedProducts += row._count.id;
    }
    autoMatchState.status = 'completed';
  } catch (error) {
    autoMatchState.status = 'error';
    autoMatchState.lastError = String(error);
  } finally {
    autoMatchState.running = false;
  }
}

router.post('/auto-match-all/start', requireAuth, async (req: Request, res: Response) => {
  try {
    if (autoMatchState.running) return res.status(409).json({ ok: false, message: 'Otomatik eşleştirme zaten çalışıyor', progress: autoMatchState });
    autoMatchState.running = true;
    autoMatchState.processedProducts = 0;
    autoMatchState.matchedCount = 0;
    autoMatchState.lastError = null;
    void runAutoMatch();
    return res.json({ ok: true, message: 'Otomatik eşleştirme başlatıldı', progress: { ...autoMatchState } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Otomatik eşleştirme başlatılamadı' } });
  }
});

router.get('/auto-match-all/progress', requireAuth, async (_req: Request, res: Response) => {
  return res.json({ status: autoMatchState.status, processedProducts: autoMatchState.processedProducts, totalProducts: autoMatchState.totalProducts, matchedCount: autoMatchState.matchedCount, lastError: autoMatchState.lastError });
});

// ==================== AI MATCH — GERÇEK AI İLE EŞLEŞTİRME ====================
const aiMatchState: {
  running: boolean; status: string; processedProducts: number; totalProducts: number;
  matchedCount: number; suggestedCount: number; manualCount: number;
  currentBatch: number; totalBatches: number; provider: string; model: string;
  lastError: string | null; startedAt: Date | null;
} = {
  running: false, status: 'idle', processedProducts: 0, totalProducts: 0,
  matchedCount: 0, suggestedCount: 0, manualCount: 0,
  currentBatch: 0, totalBatches: 0, provider: '', model: '',
  lastError: null, startedAt: null,
};

const BATCH_SIZE = 50;

async function runAiMatch(xmlSourceId: string | null, marketplaceId: string | null) {
  try {
    aiMatchState.status = 'running';
    aiMatchState.startedAt = new Date();

    // Fetch system categories
    const systemCategories = await prisma.category.findMany();
    const categories: CategoryCandidate[] = systemCategories.map(c => ({
      id: c.id,
      name: c.name,
      fullPath: c.name,
    }));

    if (categories.length === 0) {
      aiMatchState.status = 'error';
      aiMatchState.lastError = 'Sistem kategorisi bulunamadı';
      return;
    }

    // Fetch unmatched products
    const where: any = { categoryMatch: false, categoryId: null };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const unmatchedProducts = await prisma.product.findMany({
      where,
      select: {
        id: true, xmlKey: true, title: true, supplierCategory: true,
        xmlBrandName: true, description: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    aiMatchState.totalProducts = unmatchedProducts.length;
    aiMatchState.processedProducts = 0;
    aiMatchState.matchedCount = 0;
    aiMatchState.suggestedCount = 0;
    aiMatchState.manualCount = 0;

    if (unmatchedProducts.length === 0) {
      aiMatchState.status = 'completed';
      return;
    }

    // Marketplace name for context
    let marketplaceName: string | null = null;
    if (marketplaceId) {
      const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { name: true } });
      marketplaceName = mp?.name || null;
    }

    // Split into batches
    const batches: ProductForMatch[][] = [];
    for (let i = 0; i < unmatchedProducts.length; i += BATCH_SIZE) {
      batches.push(unmatchedProducts.slice(i, i + BATCH_SIZE));
    }

    aiMatchState.totalBatches = batches.length;
    aiMatchState.currentBatch = 0;

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      aiMatchState.currentBatch = bIdx + 1;

      // Call AI Gateway
      const aiResult = await matchCategoriesWithAI(batch, categories, marketplaceName);

      if (aiResult.ok && aiResult.matches.length > 0) {
        aiMatchState.provider = aiResult.provider;
        aiMatchState.model = aiResult.model;

        // Apply matches
        for (const match of aiResult.matches) {
          if (match.confidence >= 0.95) {
            // Auto-match
            await prisma.product.update({
              where: { id: match.productId },
              data: {
                categoryId: match.categoryId,
                categoryMatch: true,
                matchedBy: 'ai',
                lastMatchDate: new Date(),
                aiSuggestedCategoryId: match.categoryId,
                aiScore: match.confidence,
              },
            });
            aiMatchState.matchedCount++;
          } else if (match.confidence >= 0.85) {
            // Suggestion — mark as suggested but not matched
            await prisma.product.update({
              where: { id: match.productId },
              data: {
                aiSuggestedCategoryId: match.categoryId,
                aiScore: match.confidence,
                matchedBy: 'ai_suggestion',
              },
            });
            aiMatchState.suggestedCount++;
          } else {
            aiMatchState.manualCount++;
          }

          // Log decision
          try {
            await prisma.aIDecisionLog.create({
              data: {
                productId: match.productId,
                module: 'category',
                suggestion: match.categoryId,
                confidence: match.confidence,
                reason: match.reason,
                autoApplied: match.confidence >= 0.95,
              },
            });
          } catch { /* ignore log errors */ }

          aiMatchState.processedProducts++;
        }
      } else if (!aiResult.ok) {
        // AI failed — count remaining as manual
        aiMatchState.manualCount += batch.length;
        aiMatchState.processedProducts += batch.length;
        aiMatchState.lastError = aiResult.error || 'AI başarısız';

        // If no provider available, stop processing
        if (aiResult.errorCode === 'NO_PROVIDER' || aiResult.errorCode === 'INVALID_KEY') {
          aiMatchState.status = 'error';
          return;
        }
      } else {
        // AI returned no matches
        aiMatchState.manualCount += batch.length;
        aiMatchState.processedProducts += batch.length;
      }
    }

    aiMatchState.status = 'completed';

    await prisma.auditLog.create({
      data: {
        action: 'AI_CATEGORY_MATCH_V2',
        entity: 'category',
        meta: JSON.stringify({
          matched: aiMatchState.matchedCount,
          suggested: aiMatchState.suggestedCount,
          manual: aiMatchState.manualCount,
          total: aiMatchState.totalProducts,
          provider: aiMatchState.provider,
          model: aiMatchState.model,
          batches: aiMatchState.totalBatches,
        }),
        details: `AI v2: ${aiMatchState.matchedCount} eşleşti, ${aiMatchState.suggestedCount} öneri, ${aiMatchState.manualCount} manuel — ${aiMatchState.provider}/${aiMatchState.model}`,
        actorUserId: null,
      },
    });
  } catch (error) {
    aiMatchState.status = 'error';
    aiMatchState.lastError = String(error);
  } finally {
    aiMatchState.running = false;
  }
}

router.post('/ai-match-ai/start', requireAuth, async (req: Request, res: Response) => {
  try {
    if (aiMatchState.running) return res.status(409).json({ ok: false, message: 'AI eşleştirme zaten çalışıyor', progress: aiMatchState });

    const { xmlSourceId, marketplaceId } = req.body || {};

    aiMatchState.running = true;
    aiMatchState.status = 'starting';
    aiMatchState.processedProducts = 0;
    aiMatchState.totalProducts = 0;
    aiMatchState.matchedCount = 0;
    aiMatchState.suggestedCount = 0;
    aiMatchState.manualCount = 0;
    aiMatchState.currentBatch = 0;
    aiMatchState.totalBatches = 0;
    aiMatchState.provider = '';
    aiMatchState.model = '';
    aiMatchState.lastError = null;

    void runAiMatch(xmlSourceId || null, marketplaceId || null);
    return res.json({ ok: true, message: 'AI eşleştirme başlatıldı', progress: { ...aiMatchState } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'AI eşleştirme başlatılamadı' } });
  }
});

router.get('/ai-match-ai/progress', requireAuth, async (_req: Request, res: Response) => {
  return res.json({
    status: aiMatchState.status,
    processedProducts: aiMatchState.processedProducts,
    totalProducts: aiMatchState.totalProducts,
    matchedCount: aiMatchState.matchedCount,
    suggestedCount: aiMatchState.suggestedCount,
    manualCount: aiMatchState.manualCount,
    currentBatch: aiMatchState.currentBatch,
    totalBatches: aiMatchState.totalBatches,
    provider: aiMatchState.provider,
    model: aiMatchState.model,
    lastError: aiMatchState.lastError,
    percent: aiMatchState.totalProducts > 0 ? Math.round((aiMatchState.processedProducts / aiMatchState.totalProducts) * 100) : 0,
  });
});

// ==================== BULK OPERATIONS ====================
router.post('/bulk-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'matches array is required' } });

    let totalMatched = 0;
    const results: Array<{ xmlCategory: string; systemCategory: string; count: number }> = [];
    for (const match of matches) {
      const { xmlCategoryPath, systemCategoryId } = match;
      const products = await prisma.product.findMany({ where: { supplierCategory: xmlCategoryPath }, select: { id: true } });
      if (products.length > 0 && systemCategoryId) {
        const productIds = products.map(p => p.id);
        await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId: systemCategoryId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
        const systemCat = await prisma.category.findUnique({ where: { id: systemCategoryId } });
        totalMatched += products.length;
        results.push({ xmlCategory: xmlCategoryPath, systemCategory: systemCat?.name || 'Bilinmeyen', count: products.length });
      }
    }

    await prisma.auditLog.create({ data: { action: 'BULK_CATEGORY_MATCH', entity: 'category', meta: JSON.stringify({ totalMatched, categoryCount: results.length }), details: `Toplu eşleştirme: ${totalMatched} ürün, ${results.length} kategori`, actorUserId: (req as any).actor?.userId || null } });
    res.json({ matchedCount: totalMatched, results, message: `${totalMatched} ürün toplu olarak eşleştirildi` });
  } catch (error) {
    console.error('Error bulk matching categories:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to bulk match categories' } });
  }
});

// ==================== LIST ALL CATEGORIES ====================
router.get('/all', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const parentId = req.query?.parentId ? String(req.query.parentId) : null;
    const where: Record<string, unknown> = {};
    if (search) where.name = { contains: search };
    if (parentId !== undefined) where.parentId = parentId || null;
    const categories = await prisma.category.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { products: true, children: true } } } });
    res.json({ items: categories.map((cat: any) => ({ id: cat.id, name: cat.name, externalId: cat.externalId, parentId: cat.parentId, productCount: cat._count.products, childCount: cat._count.children, createdAt: cat.createdAt, updatedAt: cat.updatedAt })) });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch categories' } });
  }
});

// ==================== CATEGORIZED PRODUCTS ====================
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page || '1'));
    const limit = parseInt(String(req.query.limit || '50'));
    const search = String(req.query.search || '').trim();
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const uncategorized = req.query?.uncategorized === 'true';
    const categoryIdParam = req.query?.categoryId ? String(req.query.categoryId) : null;
    const status = req.query?.status ? String(req.query.status) : null;

    const where: any = {};
    if (uncategorized) where.categoryId = null;
    if (categoryIdParam === 'not_null') { where.categoryId = { not: null }; }
    else if (categoryIdParam) { where.categoryId = categoryIdParam; }

    if (status) {
      switch (status) {
        case 'XML': where.categoryMatch = false; where.categoryId = null; break;
        case 'DRAFT': where.categoryMatch = false; where.categoryId = { not: null }; break;
        case 'READY': where.categoryMatch = true; break;
        case 'ERROR': where.errorMessage = { not: null }; break;
      }
    }

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
    console.error('Error fetching category products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category products' } });
  }
});

// ==================== MATCH / UNMATCH ====================
router.post('/match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, productIds } = req.body;
    if (!categoryId || !Array.isArray(productIds) || productIds.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'categoryId and productIds array are required' } });
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kategori bulunamadı' } });
    const result = await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });

    await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: categoryId, details: `${result.count} ürün "${category.name}" kategorisine eşleştirildi`, actorUserId: (req as any).actor?.userId || null } });
    res.json({ matchedCount: result.count, message: `${result.count} ürün eşleştirildi` });
  } catch (error) {
    console.error('Error matching products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to match products' } });
  }
});

router.post('/unmatch', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'productIds array is required' } });
    const result = await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId: null, categoryMatch: false } });

    await prisma.auditLog.create({ data: { action: 'CATEGORY_UNMATCH', entity: 'category', details: `${result.count} ürünün kategori eşleştirmesi kaldırıldı`, actorUserId: (req as any).actor?.userId || null } });
    res.json({ unmatchedCount: result.count, message: `${result.count} ürünün eşleştirmesi kaldırıldı` });
  } catch (error) {
    console.error('Error unmatching products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to unmatch products' } });
  }
});

// ==================== CREATE CATEGORY ====================
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, externalId, parentId } = req.body;
    if (!name) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Name is required' } });
    const category = await prisma.category.create({ data: { name: String(name).trim(), externalId: externalId || null, parentId: parentId || null } });
    await prisma.auditLog.create({ data: { action: 'CATEGORY_CREATE', entity: 'category', entityId: category.id, details: `"${category.name}" kategorisi oluşturuldu`, actorUserId: (req as any).actor?.userId || null } });
    res.status(201).json({ item: category });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create category' } });
  }
});

// ==================== MAPPINGS ====================
router.get('/mappings', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplaceId = req.query?.marketplaceId ? String(req.query.marketplaceId) : null;
    const source = req.query?.source ? String(req.query.source) : null;
    const where: Record<string, unknown> = {};
    if (marketplaceId) where.marketplaceId = marketplaceId;
    if (source) where.source = source;
    const mappings = await prisma.categoryMapping.findMany({ where, include: { category: { select: { id: true, name: true, parentId: true } }, marketplace: { select: { id: true, name: true, key: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({ items: mappings });
  } catch (error) {
    console.error('Error fetching mappings:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch mappings' } });
  }
});

router.post('/mappings', requireAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, marketplaceId, externalId, externalName, externalPath, source, confidence } = req.body;
    if (!categoryId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'categoryId is required' } });
    const mapping = await prisma.categoryMapping.create({ data: { categoryId, marketplaceId: marketplaceId || null, externalId: externalId || null, externalName: externalName || null, externalPath: externalPath || null, source: source || 'manual', confidence: confidence || null } });
    res.status(201).json(mapping);
  } catch (error) {
    console.error('Error creating mapping:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create mapping' } });
  }
});

router.put('/mappings/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { externalId, externalName, externalPath, active, confidence } = req.body;
    const data: Record<string, unknown> = {};
    if (externalId !== undefined) data.externalId = externalId;
    if (externalName !== undefined) data.externalName = externalName;
    if (externalPath !== undefined) data.externalPath = externalPath;
    if (active !== undefined) data.active = active;
    if (confidence !== undefined) data.confidence = confidence;
    const mapping = await prisma.categoryMapping.update({ where: { id }, data });
    res.json(mapping);
  } catch (error) {
    console.error('Error updating mapping:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update mapping' } });
  }
});

router.delete('/mappings/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.categoryMapping.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting mapping:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete mapping' } });
  }
});

// ==================== LOGS ====================
router.get('/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 50)));
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where: { entity: 'category' }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { actorUser: { select: { email: true, name: true } } } }),
      prisma.auditLog.count({ where: { entity: 'category' } }),
    ]);
    res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Error fetching category logs:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category logs' } });
  }
});

// ==================== CATEGORY MOVE ====================
router.put('/:id/move', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { newParentId } = req.body;
    if (newParentId === id) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Bir kategori kendi altına taşınamaz' } });
    const category = await prisma.category.update({ where: { id }, data: { parentId: newParentId || null } });
    res.json({ item: category });
  } catch (error) {
    console.error('Error moving category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to move category' } });
  }
});

// ==================== UPDATE / DELETE CATEGORY (must be last) ====================
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, externalId, parentId } = req.body;
    const oldCategory = await prisma.category.findUnique({ where: { id } });
    const category = await prisma.category.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(externalId !== undefined ? { externalId: externalId || null } : {}), ...(parentId !== undefined ? { parentId: parentId || null } : {}) } });
    await prisma.auditLog.create({ data: { action: 'CATEGORY_UPDATE', entity: 'category', entityId: id, details: `"${oldCategory?.name}" → "${category.name}" olarak güncellendi`, actorUserId: (req as any).actor?.userId || null } });
    res.json({ item: category });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update category' } });
  }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const category = await prisma.category.findUnique({ where: { id } });
    await prisma.category.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null, categoryMatch: false } });
    await prisma.categoryMapping.deleteMany({ where: { categoryId: id } });
    await prisma.category.delete({ where: { id } });
    await prisma.auditLog.create({ data: { action: 'CATEGORY_DELETE', entity: 'category', entityId: id, details: `"${category?.name}" kategorisi silindi`, actorUserId: (req as any).actor?.userId || null } });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete category' } });
  }
});

export default router;
