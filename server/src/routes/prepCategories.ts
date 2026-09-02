import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth } from '../auth/authMiddleware.ts';
import { matchCategoriesWithAI, type ProductForMatch, type CategoryCandidate } from '../services/aiGateway.ts';
import { normalizeName } from '../services/categoryBrandMapper.ts';
import { loadTrendyolTree, invalidateTrendyolTreeCache, classifyByRule, buildAiCandidates, verifyHighConfidence } from '../services/categoryMatchEngine.ts';
import { verifyCategorySafety, type SafetyGateInput, buildCategoryAuditMeta } from '../services/categorySafetyGate.ts';
import { resolveCategoryCandidates, resolveCategoryCandidatesBatch, normalizeProductCore } from '../services/categoryCanonical.ts';
import {reconcileReadiness, reconcileProductGates, queueReconcileProductGates} from '../services/readinessService.ts';
import { invalidateProductsStatsCache } from './products.ts';
import { deriveState, isAiEligible, computeEligibility, type ProductState } from '../services/categoryStateMachine.ts';
import {
  classifyProviderError,
  classifyAiDecision,
  classifyVerification,
  classifyMappingError,
  classifyCandidateResult,
  type ErrorStatus,
  type ErrorSemantics,
  type StructuredErrorResult,
} from '../services/errorTaxonomy.ts';

const router = Router();

// Query parametresi çiftlenirse (array) ilk değeri güvenle alır
function readQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  return value ? String(value) : null;
}

// ==================== LIST (AUTH REQUIRED) ====================
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = readQueryValue(req.query?.xmlSourceId);

    // CONTEXT-001: xmlSourceId verildiyse o kaynağa ait ürünlerin kategorilerini döndür
    if (xmlSourceId) {
      const productCategories = await prisma.product.findMany({
        where: { xmlSourceId, categoryId: { not: null } },
        select: { categoryId: true },
        distinct: ['categoryId'],
      });
      const categoryIds = productCategories.map((p) => p.categoryId).filter((id): id is string => Boolean(id));
      const items = await prisma.category.findMany({ where: { id: { in: categoryIds } }, orderBy: { name: 'asc' } });
      return res.json({ items });
    }

    const items = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', message: 'Kategoriler alınamadı' } });
  }
});

// ==================== STATS (CANONICAL KPI SOURCE — TASK312-R2) ====================
// TEK HESAPLAMA KURALI: her kavram icin tek tanim; UI bu endpoint'i tuketmek zorunda.
//
// CANONICAL KPI SOZLESMESI:
//   TOTAL_PRODUCTS         : Product.count(where)                          — kapsam icindeki tum urunler
//   MATCHED                : categoryMatch == true                         — kategori eslesti bayragi (eslesme kaniti)
//   AI_SUGGESTED           : aiSuggestedCategoryId != null AND !categoryMatch — AI onerdi AMA eslesmedi
//   AI_MATCHED             : categoryMatch == true AND matchedBy == 'ai'   — AI eslesti + verify gate PASS
//   MANUAL_MATCHED         : categoryMatch == true AND matchedBy == 'manual'
//   ACTIVE_TRENDYOL_MAPPED : categoryMatch == true AND Product.categoryId icin
//                            aktif+externalId'li CategoryMapping (marketplaceId) VAR — OPERATIONAL MATCH
//   UNMATCHED              : categoryMatch == false
//   BLOCKED_CATEGORY       : categoryMatch == true ANCAK operational match YOK (semantic gap -> gönderime engel)
//   READY_FOR_SEND         : status == 'READY'                             — tum gate'ler + mapping OK
// NOT: Product.categoryId != "eslesen kategori"; categoryMatch=true != "gonderilebilir";
//      CategoryMapping != Product.categoryId. Operational match yalnizca ACTIVE_TRENDYOL_MAPPED'dir.
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const xmlSourceId = readQueryValue(req.query?.xmlSourceId);
    // TASK317 FIX: kategori kovaları silinmiş (DELETED tombstone) ürünleri saymaz — Product Pool gerçeğiyle birebir
    const where: Record<string, unknown> = { status: { not: 'DELETED' } };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    // Operational marketplace (default: Trendyol)
    let mpId = readQueryValue(req.query?.marketplaceId);
    if (!mpId) {
      const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
      mpId = ttMp?.id ?? null;
    }

    const [totalXmlCategories, totalProducts, matched, unmatched, aiSuggested, aiMatched, manualMatched, errorCategories, totalSystemCategories, manualReview, integrityReview, insufficientInput, staleUnmatched] = await Promise.all([
      prisma.product.findMany({ where: { ...where, supplierCategory: { not: null } }, select: { supplierCategory: true }, distinct: ['supplierCategory'] }),
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, categoryMatch: true } }),
      prisma.product.count({ where: { ...where, categoryMatch: false } }),
      // TASK316 FIX: categoryId!=null olanlar state machine'e gore INTEGRITY_REVIEW'dir;
      // AI_SUGGESTED sadece gercek bekleyen onerileri sayar (frontend liste mantigiyla birebir).
      prisma.product.count({ where: { ...where, categoryMatch: false, categoryId: null, aiSuggestedCategoryId: { not: null } } }),
      prisma.product.count({ where: { ...where, categoryMatch: true, matchedBy: 'ai' } }),
      prisma.product.count({ where: { ...where, categoryMatch: true, matchedBy: 'manual' } }),
      prisma.product.count({ where: { ...where, errorMessage: { not: null }, categoryMatch: false } }),
      prisma.category.count(),
      // State machine populations (categoryStateMachine.deriveState ile birebir)
      prisma.product.count({ where: { ...where, categoryMatch: false, matchedBy: null, categoryId: null, supplierCategory: { not: '' } } }),
      prisma.product.count({ where: { ...where, categoryMatch: false, categoryId: { not: null } } }),
      prisma.product.count({ where: { ...where, categoryMatch: false, matchedBy: null, categoryId: null, OR: [{ supplierCategory: null }, { supplierCategory: '' }] } }),
      prisma.product.count({ where: { ...where, categoryMatch: false, matchedBy: { not: null } } }),
    ]);

    // Operational mapping: eslesmis urunlerin categoryId'leri icin aktif CategoryMapping var mi?
    const catGroups = await prisma.product.groupBy({
      by: ['categoryId'],
      where: { ...where, categoryMatch: true, categoryId: { not: null } },
      _count: { id: true },
    });
    const groupCatIds = catGroups.map(g => g.categoryId as string);
    const activeMappings = mpId && groupCatIds.length > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: groupCatIds }, marketplaceId: mpId, active: true, externalId: { not: null } },
      select: { categoryId: true },
    }) : [];
    const opMappedSet = new Set(activeMappings.map(m => m.categoryId));
    let operationallyMapped = 0;
    let blockedCategory = 0;
    for (const g of catGroups) {
      if (opMappedSet.has(g.categoryId as string)) operationallyMapped += g._count.id;
      else blockedCategory += g._count.id;
    }

    const readyForSend = await prisma.product.count({ where: { ...where, status: 'READY', categoryMatch: true } });

    res.json({
      // ---- LEGACY KEYS (geriye donuk uyumluluk; artik canonical tanima bagli) ----
      totalXmlCategories: totalXmlCategories.length,
      matchedCategories: matched,
      unmatchedProducts: unmatched,
      aiSuggested,
      manualMatched,
      errorCategories,
      totalCategories: totalSystemCategories,
      // ---- CANONICAL KPIs ----
      TOTAL_PRODUCTS: totalProducts,
      MATCHED: matched,
      AI_SUGGESTED: aiSuggested,
      AI_MATCHED: aiMatched,
      MANUAL_MATCHED: manualMatched,
      OTHER_MATCHED: matched - aiMatched - manualMatched,
      UNMATCHED: unmatched,
      ACTIVE_TRENDYOL_MAPPED: operationallyMapped,
      BLOCKED_CATEGORY: blockedCategory,
      READY_FOR_SEND: readyForSend,
      MANUAL_REVIEW: manualReview,
      INTEGRITY_REVIEW: integrityReview,
      INSUFFICIENT_INPUT: insufficientInput,
      STALE_UNMATCHED: staleUnmatched,
      MARKETPLACE_ID: mpId,
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
    const xmlSourceId = readQueryValue(req.query?.xmlSourceId);
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
// TASK322: 2.5s'lik tree sorgusu cache'lenir; kategori mutasyonlarında temizlenir
const _treeRouteCache: { at: number; payload: any; json: string | null } = { at: 0, payload: null, json: null };
const TREE_ROUTE_TTL = 60000;

router.get('/tree', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    // TASK322: cache ÖNCE kontrol — pahalı sorgu yalnızca cache boş/ttl dışıyken çalışır
    if (!search && _treeRouteCache.payload && _treeRouteCache.json && Date.now() - _treeRouteCache.at < TREE_ROUTE_TTL) {
      res.type('application/json').send(_treeRouteCache.json);
      return;
    }
    // KATEGORİ AĞACI TEK PAYLAŞIMLI HİYERARŞİDİR: marketplaceId ile filtrelenmez.
    // (Önceki davranış tt seçiliyken tree'yi 23 map edilmiş kategoriye indiriyor,
    //  hem picker'ı boş gösteriyor hem flatMap path çözümlemesini kırıyordu.)
    const where: any = {};
    if (search) where.name = { contains: search };

    const allCategories = await prisma.category.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } });

    // KATEGORİ AĞACI — HİBRİT:
    // 1) parentId dolu GERÇEK Trendyol hiyerarşisi (3867 kategori, 16 root, 3361 leaf).
    // 2) parentId null + ">>>" isimli LOKAL XML kategorileri (virtual ağaç, schema değişikliği YOK).
    // Ara (virtual) düğümler virtual:true ile işaretlenir ve gerçek id taşımaz.
    function buildDashTree(categories: typeof allCategories): any[] {
      const roots: any[] = [];
      const indexByPath = new Map<string, any>();

      const ensurePath = (segments: string[], leaf: (typeof allCategories)[number]) => {
        let current = roots;
        let path = '';
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i].trim();
          if (!seg) continue;
          path = path ? `${path}>>>${seg}` : seg;
          const isLeaf = i === segments.length - 1;
          let node = indexByPath.get(path);
          if (!node) {
            node = {
              id: isLeaf ? leaf.id : `virtual:${path}`,
              name: seg,
              externalId: isLeaf ? leaf.externalId : null,
              parentId: isLeaf ? leaf.parentId : null,
              productCount: isLeaf ? leaf._count.products : 0,
              children: [],
              virtual: !isLeaf,
            };
            if (isLeaf) {
              node.createdAt = leaf.createdAt;
              node.updatedAt = leaf.updatedAt;
            }
            indexByPath.set(path, node);
            current.push(node);
          } else if (isLeaf) {
            node.id = leaf.id;
            node.externalId = leaf.externalId;
            node.parentId = leaf.parentId;
            node.productCount = leaf._count.products;
            node.virtual = false;
            node.createdAt = leaf.createdAt;
            node.updatedAt = leaf.updatedAt;
          }
          current = node.children;
        }
      };

      for (const c of categories) ensurePath(c.name.split('>>>').map((s: string) => s.trim()).filter(Boolean), c);

      const sumProducts = (nodes: any[]): number => nodes.reduce((s, n) => s + (n.children.length > 0 ? sumProducts(n.children) : n.productCount), 0);
      for (const r of roots) {
        if (r.virtual) r.productCount = sumProducts([r]);
      }
      return roots;
    }

    function buildCategoryTree(categories: typeof allCategories): any[] {
      const childMap = new Map<string, any[]>();
      for (const c of categories) {
        if (!c.parentId) continue;
        const arr = childMap.get(c.parentId) || [];
        arr.push(c);
        childMap.set(c.parentId, arr);
      }
      const toNode = (c: any): any => ({
        id: c.id,
        name: c.name,
        externalId: c.externalId,
        parentId: c.parentId,
        productCount: c._count?.products ?? 0,
        children: (childMap.get(c.id) || []).map(toNode),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });

      const dashIds = new Set(categories.filter(c => !c.parentId && c.name.includes('>>>')).map(c => c.id));
      const roots = categories.filter(c => !c.parentId && !dashIds.has(c.id)).map(toNode);
      roots.push(...buildDashTree(categories.filter(c => dashIds.has(c.id))));

      const sortRec = (nodes: any[]) => {
        nodes.sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'));
        nodes.forEach((n) => sortRec(n.children));
      };
      sortRec(roots);
      return roots;
    }

    const payload = { items: buildCategoryTree(allCategories), flat: allCategories };
    if (!search) {
      _treeRouteCache.payload = payload;
      _treeRouteCache.json = JSON.stringify(payload);
      _treeRouteCache.at = Date.now();
    }
    res.json(payload);
  } catch (error) {
    console.error('Error fetching category tree:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category tree' } });
  }
});

// ==================== CANONICAL CATEGORY MATCH (KURAL TABANLI EŞLEŞTİRME) ====================

router.post('/ai-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productIds, xmlSourceId } = req.body;

    // RULE 6 + RULE 10: AI eligibility gate
    const where: any = {
      categoryMatch: false,
      matchedBy: null,
      supplierCategory: { not: '' },
      categoryId: null,
    };
    if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const totalCount = await prisma.product.count({ where });
    if (totalCount === 0) {
      return res.json({ matchedCount: 0, suggestedCount: 0, manualCount: 0, totalProducts: 0, message: 'Eslestirilecek urun bulunamadi', results: [] });
    }

    const tree = await loadTrendyolTree();
    if (tree.leaves.length === 0) {
      return res.json({ matchedCount: 0, suggestedCount: 0, manualCount: 0, totalProducts: 0, message: 'Trendyol kategori agaci bos', results: [] });
    }

    const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
    const marketplaceId = ttMp?.id ?? null;

    // CATEGORY CORE V2 GUARD: PRODUCT-LEVEL ONLY.
    // ESKI (YASAK): groupBy(supplierCategory) -> tek karar -> updateMany N urune.
    // YENI: HER URUN kendi title/supplierCategory verisiyle AYRI degerlendirilir;
    // mutation where:{id:productId}. Ayni kategoriye gitseler bile karar granularitesi urundur.
    const products = await prisma.product.findMany({
      where,
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, categoryId: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    });

    let matchedCount = 0;
    let manualCount = 0;
    const matchResults: Array<{ productId: string; productName: string; suggestedCategory: string | null; confidence: number; reason: string }> = [];

    for (const p of products) {
      // URUN BASINA bagimsiz candidate resolution (grup cache'i YASAK - kaldirildi)
      const result = resolveCategoryCandidates(
        { id: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName },
        tree,
        marketplaceId,
      );

      let mappingVerified = false;
      if (result.topCandidate && marketplaceId) {
        const mapping = await prisma.categoryMapping.findFirst({
          where: { categoryId: result.topCandidate.id, marketplaceId, active: true, externalId: { not: null } },
          select: { id: true },
        }).catch(() => null);
        mappingVerified = !!mapping;
      }

      const finalConfidence = mappingVerified ? result.confidence : Math.min(result.confidence, 0.6);

      if (finalConfidence >= 0.7 && result.topCandidate && mappingVerified) {
        // P0: SafetyGate kontrolü — /ai-match route'unda tek kapı
        const safetyLeaf = tree.leafById.get(result.topCandidate.id);
        if (safetyLeaf) {
          const safetyInput: SafetyGateInput = {
            productId: p.id,
            title: p.title,
            supplierCategory: p.supplierCategory,
            currentCategoryId: p.categoryId ?? null,
            currentCategoryName: null,
            currentCategoryPath: p.categoryId ? tree.leafById.get(p.categoryId)?.fullPath ?? null : null,
            selectedCategoryId: result.topCandidate.id,
            selectedCategoryName: safetyLeaf.name,
            selectedCategoryPath: safetyLeaf.fullPath,
            selectedCategoryExternalId: safetyLeaf.externalId,
            candidates: result.candidates.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score ?? 0 })),
            aiConfidence: finalConfidence,
            verifierVerdict: true,
            verifierConfidence: 1.0,
            margin: 0.5,
            tree,
            isDeterministic: true,
            decisionMethod: 'RULE_CANONICAL_SAFE',
          };
          const safety = verifyCategorySafety(safetyInput);
          if (!safety.passed) {
            manualCount++;
            continue;
          }
        }
        // PRODUCT-LEVEL mutation (tek invariant: where:{id})
        await prisma.product.update({
          where: { id: p.id },
          data: { categoryId: result.topCandidate.id, categoryMatch: true, matchedBy: 'auto', lastMatchDate: new Date(), aiSuggestedCategoryId: result.topCandidate.id, aiScore: finalConfidence },
        });
        queueReconcileProductGates(p.id);
        // P0: Standart audit log — /ai-match per-product
        await prisma.auditLog.create({
          data: {
            action: 'CATEGORY_CORE_V2_DECISION',
            entity: 'product',
            entityId: p.id,
            meta: buildCategoryAuditMeta({
              productId: p.id,
              decisionMethod: 'RULE_CANONICAL_SAFE',
              decisionScope: 'PRODUCT',
              oldCategoryId: p.categoryId,
              newCategoryId: result.topCandidate.id,
              supplierCategory: p.supplierCategory,
              selectedCategory: result.topCandidate.name,
              candidate: result.topCandidate.name,
              aiConfidence: finalConfidence,
              verifierResult: 'DETERMINISTIC',
              verifierConfidence: 1.0,
              margin: 0.5,
              safetyGateResult: 'PASS',
              reason: result.method,
            }),
            details: 'V2(ai-match) ' + result.method + ' -> ' + result.topCandidate.name,
          },
        }).catch(() => null);
        matchedCount++;
        matchResults.push({ productId: p.id, productName: p.title || p.xmlKey || '', suggestedCategory: result.topCandidate.name, confidence: finalConfidence, reason: result.method });
      } else {
        manualCount++;
      }
    }
    invalidateProductsStatsCache();

    await prisma.auditLog.create({
      data: {
        action: 'CANONICAL_CATEGORY_MATCH',
        entity: 'category',
        meta: JSON.stringify({ matchedCount, suggestedCount: 0, manualCount, totalCount: products.length, treeLeafCount: tree.leaves.length, granularity: 'PRODUCT' }),
        details: 'Canonical(V2 product-level): ' + matchedCount + ' urun eslestirildi, ' + manualCount + ' manuel - ' + tree.leaves.length + ' leaf',
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({
      matchedCount,
      suggestedCount: 0,
      manualCount,
      totalProducts: products.length,
      message: matchedCount + ' urun eslestirildi, ' + manualCount + ' manuel inceleme',
      results: matchResults,
    });
  } catch (error) {
    console.error('Error canonical category matching:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to match categories' } });
  }

});

// ==================== AUTO MATCH ALL (ARKA PLAN + PROGRESS) ====================
const autoMatchState: { running: boolean; status: string; processedProducts: number; totalProducts: number; matchedCount: number; lastError: string | null } = {
  running: false, status: 'idle', processedProducts: 0, totalProducts: 0, matchedCount: 0, lastError: null,
};

async function runAutoMatch(xmlSourceId: string | null = null) {
  try {
    autoMatchState.status = 'running';

    // CATEGORY CORE V2: PRODUCT-LEVEL ONLY.
    // ESKI (YASAK): groupBy(supplierCategory) -> tek karar -> updateMany N ürüne.
    // YENİ: her ürün kendi verisiyle ayrı karar alır; mutation where:{id:productId}.
    const { runCategoryCoreV2 } = await import('../services/categoryCoreV2.ts');
    const whereV2: any = { categoryMatch: false, status: { not: 'DELETED' } };
    if (xmlSourceId) whereV2.xmlSourceId = xmlSourceId;
    autoMatchState.totalProducts = await prisma.product.count({ where: whereV2 });
    autoMatchState.processedProducts = 0;
    autoMatchState.matchedCount = 0;

    // Ürün bazlı V2 çalıştırması (V2 ağacı kendi yükler ve leaf doğrulaması yapar)
    const result = await runCategoryCoreV2({
      xmlSourceId: xmlSourceId || null,
      limit: 20000,
      apply: true,
      aiLimit: Number(process.env.CATEGORY_AI_LIMIT ?? 25),
      includeMatched: false,
    });
    autoMatchState.processedProducts = result.totalEvaluated;
    autoMatchState.matchedCount = result.productMutations;
    if (autoMatchState.matchedCount > 0) invalidateProductsStatsCache();
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
    const { xmlSourceId } = (req.body || {}) as { xmlSourceId?: string };
    void runAutoMatch(xmlSourceId || null);
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
  errorBreakdown: Record<ErrorStatus, number>;
  semanticBreakdown: Record<ErrorSemantics, number>;
  productErrors: StructuredErrorResult[];
} = {
  running: false, status: 'idle', processedProducts: 0, totalProducts: 0,
  matchedCount: 0, suggestedCount: 0, manualCount: 0,
  currentBatch: 0, totalBatches: 0, provider: '', model: '',
  lastError: null, startedAt: null,
  errorBreakdown: {} as Record<ErrorStatus, number>,
  semanticBreakdown: {} as Record<ErrorSemantics, number>,
  productErrors: [],
};

const BATCH_SIZE = 10;

async function runAiMatch(xmlSourceId: string | null, marketplaceId: string | null) {
  try {
    aiMatchState.status = 'running';
    aiMatchState.startedAt = new Date();

    // Load Trendyol tree — per-product candidates için
    const tree = await loadTrendyolTree();
    if (tree.leaves.length === 0) {
      aiMatchState.status = 'error';
      aiMatchState.lastError = 'Trendyol kategori ağacı boş';
      return;
    }

    // RULE 6 + RULE 7: AI eligibility gate
    // Backend enforces: categoryMatch=false AND matchedBy=null AND supplierCategory valid AND categoryId=null
    // RULE 7: categoryId!=null + categoryMatch=false anomalies excluded until forensic classification
    // TASK317 FIX: DELETED (tombstone) ürünler AI kapsamına girmez — gerçek API çağrısı harcamamak için
    const where: any = {
      categoryMatch: false,
      matchedBy: null,
      // FIX(build): JS objesinde mukerrer 'not' anahtari olamazdi; runtime zaten son degeri ('') kullanir, ayni semantik korunur.
      supplierCategory: { not: '' },
      categoryId: null,
      status: { not: 'DELETED' },
    };
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
    aiMatchState.errorBreakdown = {} as Record<ErrorStatus, number>;
    aiMatchState.semanticBreakdown = {} as Record<ErrorSemantics, number>;
    aiMatchState.productErrors = [];

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

      // Call AI Gateway — per-product candidates (P0 fix: candidate collision)
      const candidatesByProduct = new Map<string, CategoryCandidate[]>();
      for (const p of batch) {
        const rule = classifyByRule(p, tree);
        const cands = buildAiCandidates(p, tree, rule.candidates, 25);
        candidatesByProduct.set(p.id, cands);
      }
      const aiResult = await matchCategoriesWithAI(batch, candidatesByProduct, marketplaceName);

      if (aiResult.ok && aiResult.matches.length > 0) {
        aiMatchState.provider = aiResult.provider;
        aiMatchState.model = aiResult.model;

        // Apply matches — VERIFICATION GATE (AŞAMA 2)
        for (const match of aiResult.matches) {
          // FIX(312-FINAL): AIDecisionLog.autoApplied gercek uygulama durumunu yansitir.
          let appliedToProduct = false;
          // Candidate count for error classification
          const candData = candidatesByProduct.get(match.productId) || [];
          const candResult = classifyCandidateResult(candData.length, match.productId);
          if (candResult.status !== 'SUCCESS') {
            aiMatchState.errorBreakdown[candResult.status] = (aiMatchState.errorBreakdown[candResult.status] || 0) + 1;
            aiMatchState.semanticBreakdown[candResult.semantics] = (aiMatchState.semanticBreakdown[candResult.semantics] || 0) + 1;
          }

          if (match.confidence >= 0.95 && match.categoryId) {
            // 1) CategoryMapping doğrulaması
            const mapping = await prisma.categoryMapping.findFirst({
              where: { categoryId: match.categoryId, active: true, externalId: { not: null } },
              select: { id: true, active: true, externalId: true },
            }).catch(() => null);

            const mappingCheck = classifyMappingError(
              match.categoryId,
              !!mapping,
              mapping?.active ?? false,
              mapping?.externalId ?? null
            );

            if (!mapping) {
              // Mapping yok → suggestion olarak bırak
              aiMatchState.suggestedCount++;
              aiMatchState.processedProducts++;
              aiMatchState.errorBreakdown[mappingCheck.status] = (aiMatchState.errorBreakdown[mappingCheck.status] || 0) + 1;
              aiMatchState.semanticBreakdown[mappingCheck.semantics] = (aiMatchState.semanticBreakdown[mappingCheck.semantics] || 0) + 1;
              aiMatchState.productErrors.push({
                status: mappingCheck.status,
                stage: mappingCheck.stage,
                semantics: mappingCheck.semantics,
                productId: match.productId,
                model: aiResult.model,
                provider: aiResult.provider,
                timestamp: new Date().toISOString(),
                details: `Mapping bulunamadı für kategori ${match.categoryId}`,
              });
              continue;
            }

            // 2) verifyHighConfidence — ikinci AI doğrulaması
            const batchProduct = batch.find(p => p.id === match.productId);
            const leafInfo = tree.leafById.get(match.categoryId);
            const verifyRes = await verifyHighConfidence([{
              productId: match.productId,
              title: batchProduct?.title || null,
              supplierCategory: batchProduct?.supplierCategory || null,
              categoryName: leafInfo?.name || '',
              fullPath: leafInfo?.fullPath || '',
            }]);

            const v = verifyRes.get(match.productId);
            const pass = v?.verdict === true && v.confidence >= 0.9;

            const verifyCheck = classifyVerification(
              v?.verdict ?? false,
              v?.confidence ?? 0,
              match.productId
            );

            if (pass) {
              // P0: SafetyGate kontrolü — /ai-match-ai route'unda tek kapı
              if (leafInfo) {
                const safetyInput: SafetyGateInput = {
                  productId: match.productId,
                  title: batchProduct?.title || null,
                  supplierCategory: batchProduct?.supplierCategory || null,
                  currentCategoryId: null,
                  currentCategoryName: null,
                  currentCategoryPath: null,
                  selectedCategoryId: match.categoryId,
                  selectedCategoryName: leafInfo.name,
                  selectedCategoryPath: leafInfo.fullPath,
                  selectedCategoryExternalId: leafInfo.externalId,
                  candidates: candData.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score ?? 0 })),
                  aiConfidence: match.confidence,
                  verifierVerdict: v?.verdict === true,
                  verifierConfidence: v?.confidence ?? 0,
                  margin: 0.5,
                  tree,
                  isDeterministic: false,
                  decisionMethod: 'AI_PRODUCT_VERIFIED',
                };
                const safety = verifyCategorySafety(safetyInput);
                if (!safety.passed) {
                  aiMatchState.suggestedCount++;
                  aiMatchState.processedProducts++;
                  continue;
                }
              }
              // Verification PASS → categoryMatch=true yaz + readiness reconciliation
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
              queueReconcileProductGates(match.productId);
              // P0: Standart audit log — /ai-match-ai per-product
              await prisma.auditLog.create({
                data: {
                  action: 'AI_CATEGORY_MATCH_V2',
                  entity: 'product',
                  entityId: match.productId,
                  meta: buildCategoryAuditMeta({
                    productId: match.productId,
                    decisionMethod: 'AI_PRODUCT_VERIFIED',
                    decisionScope: 'PRODUCT',
                    oldCategoryId: null,
                    newCategoryId: match.categoryId,
                    supplierCategory: batchProduct?.supplierCategory ?? null,
                    selectedCategory: leafInfo?.name ?? null,
                    candidate: leafInfo?.name ?? null,
                    aiConfidence: match.confidence,
                    verifierResult: v?.verdict ? 'YES' : 'NO',
                    verifierConfidence: v?.confidence ?? 0,
                    margin: 0.5,
                    safetyGateResult: 'PASS',
                    reason: v?.reason ?? '',
                    model: `${aiResult.provider}/${aiResult.model}`,
                  }),
                  details: `AI-match: ${match.productId} → "${leafInfo?.name}" (conf=${match.confidence.toFixed(2)})`,
                },
              }).catch(() => null);
              appliedToProduct = true;
              aiMatchState.matchedCount++;
            } else {
              // Verification FAIL → suggestion olarak bırak
              // FIX(312-FINAL): oneri artik Product'a da yaziliyor (dusuk-guven dali ile ayni semantik);
              // aksi halde kullanicinin goremeyecegi "gorunmez oneriler" olusuyordu.
              await prisma.product.update({
                where: { id: match.productId },
                data: {
                  aiSuggestedCategoryId: match.categoryId,
                  aiScore: match.confidence,
                  matchedBy: 'ai_suggestion',
                },
              }).catch(() => null);
              aiMatchState.suggestedCount++;
              aiMatchState.errorBreakdown[verifyCheck.status] = (aiMatchState.errorBreakdown[verifyCheck.status] || 0) + 1;
              aiMatchState.semanticBreakdown[verifyCheck.semantics] = (aiMatchState.semanticBreakdown[verifyCheck.semantics] || 0) + 1;
              aiMatchState.productErrors.push({
                status: verifyCheck.status,
                stage: verifyCheck.stage,
                semantics: verifyCheck.semantics,
                productId: match.productId,
                model: aiResult.model,
                provider: aiResult.provider,
                timestamp: new Date().toISOString(),
                details: `Verification başarısız: ${v?.reason || 'doğrulanamadı'}`,
              });
            }
          } else if (match.confidence >= 0.85 && match.categoryId) {
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

            // Error classification for low confidence
            const decisionCheck = classifyAiDecision(
              match.decision,
              match.confidence,
              match.categoryId,
              new Set(candData.map(c => c.id)),
              match.productId
            );
            if (decisionCheck.status !== 'SUCCESS') {
              aiMatchState.errorBreakdown[decisionCheck.status] = (aiMatchState.errorBreakdown[decisionCheck.status] || 0) + 1;
              aiMatchState.semanticBreakdown[decisionCheck.semantics] = (aiMatchState.semanticBreakdown[decisionCheck.semantics] || 0) + 1;
              aiMatchState.productErrors.push({
                status: decisionCheck.status,
                stage: decisionCheck.stage,
                semantics: decisionCheck.semantics,
                productId: match.productId,
                model: aiResult.model,
                provider: aiResult.provider,
                timestamp: new Date().toISOString(),
                details: `AI düşük güven: ${match.confidence}`,
              });
            }
          } else {
            aiMatchState.manualCount++;

            // Error classification for very low confidence
            const decisionCheck = classifyAiDecision(
              match.decision,
              match.confidence,
              match.categoryId,
              new Set(candData.map(c => c.id)),
              match.productId
            );
            aiMatchState.errorBreakdown[decisionCheck.status] = (aiMatchState.errorBreakdown[decisionCheck.status] || 0) + 1;
            aiMatchState.semanticBreakdown[decisionCheck.semantics] = (aiMatchState.semanticBreakdown[decisionCheck.semantics] || 0) + 1;
            aiMatchState.productErrors.push({
              status: decisionCheck.status,
              stage: decisionCheck.stage,
              semantics: decisionCheck.semantics,
              productId: match.productId,
              model: aiResult.model,
              provider: aiResult.provider,
              timestamp: new Date().toISOString(),
              details: `AI çok düşük güven: ${match.confidence} → manuel`,
            });
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
                autoApplied: appliedToProduct,
              },
            });
          } catch { /* ignore log errors */ }

          aiMatchState.processedProducts++;
        }
      } else if (!aiResult.ok) {
        // AI failed — classify provider error
        const providerCheck = classifyProviderError(aiResult.errorCode, aiResult.error);

        // Count each product in batch with the same error
        for (const p of batch) {
          aiMatchState.productErrors.push({
            status: providerCheck.status,
            stage: providerCheck.stage,
            semantics: providerCheck.semantics,
            productId: p.id,
            model: aiResult.model,
            provider: aiResult.provider,
            timestamp: new Date().toISOString(),
            details: `Provider hatası: ${aiResult.error || 'bilinmeyen'}`,
          });
          aiMatchState.errorBreakdown[providerCheck.status] = (aiMatchState.errorBreakdown[providerCheck.status] || 0) + 1;
          aiMatchState.semanticBreakdown[providerCheck.semantics] = (aiMatchState.semanticBreakdown[providerCheck.semantics] || 0) + 1;
        }

        aiMatchState.manualCount += batch.length;
        aiMatchState.processedProducts += batch.length;
        aiMatchState.lastError = aiResult.error || 'AI başarısız';

        // If no provider available, stop processing
        if (aiResult.errorCode === 'NO_PROVIDER' || aiResult.errorCode === 'INVALID_KEY') {
          aiMatchState.status = 'error';
          return;
        }
      } else {
        // AI returned no matches — classify as AI decision failure
        for (const p of batch) {
          const candData = candidatesByProduct.get(p.id) || [];
          aiMatchState.productErrors.push({
            status: 'AI_DECISION_FAILURE',
            stage: 'AI_MATCH',
            semantics: 'AI_DECISION_FAILURE',
            productId: p.id,
            model: aiResult.model,
            provider: aiResult.provider,
            timestamp: new Date().toISOString(),
            details: `AI yanıt döndürmedi (boş match listesi)`,
          });
          aiMatchState.errorBreakdown['AI_DECISION_FAILURE'] = (aiMatchState.errorBreakdown['AI_DECISION_FAILURE'] || 0) + 1;
          aiMatchState.semanticBreakdown['AI_DECISION_FAILURE'] = (aiMatchState.semanticBreakdown['AI_DECISION_FAILURE'] || 0) + 1;
        }

        aiMatchState.manualCount += batch.length;
        aiMatchState.processedProducts += batch.length;
      }
    }

    invalidateProductsStatsCache();
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
          errorBreakdown: aiMatchState.errorBreakdown,
          semanticBreakdown: aiMatchState.semanticBreakdown,
          productErrorCount: aiMatchState.productErrors.length,
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

    // RULE 19: Pre-check eligible count — reject if zero
    const eligibleWhere: any = {
      categoryMatch: false,
      matchedBy: null,
      // FIX(build): JS objesinde mukerrer 'not' anahtari olamazdi; runtime zaten son degeri ('') kullanir, ayni semantik korunur.
      supplierCategory: { not: '' },
      categoryId: null,
    };
    if (xmlSourceId) eligibleWhere.xmlSourceId = xmlSourceId;
    const eligibleCount = await prisma.product.count({ where: eligibleWhere });
    if (eligibleCount === 0) {
      return res.json({ ok: true, message: 'AI eşleştirmeye uygun ürün bulunamadı (MANUAL_REVIEW + supplierCategory gerekli)', progress: { status: 'completed', totalProducts: 0, processedProducts: 0, matchedCount: 0, manualCount: 0 } });
    }

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
    errorBreakdown: aiMatchState.errorBreakdown,
    semanticBreakdown: aiMatchState.semanticBreakdown,
    productErrorCount: aiMatchState.productErrors.length,
  });
});

router.get('/ai-match-ai/errors', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const semanticsFilter = req.query.semantics ? String(req.query.semantics) : null;

  let errors = aiMatchState.productErrors;
  if (statusFilter) errors = errors.filter(e => e.status === statusFilter);
  if (semanticsFilter) errors = errors.filter(e => e.semantics === semanticsFilter);

  return res.json({
    total: errors.length,
    errors: errors.slice(0, limit),
    errorBreakdown: aiMatchState.errorBreakdown,
    semanticBreakdown: aiMatchState.semanticBreakdown,
  });
});

// ==================== BULK OPERATIONS ====================
router.post('/bulk-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'matches array is required' } });

    // CATEGORY CORE V2 GUARD: supplierCategory -> tek categoryId -> N ürün propagation YASAK.
    // Bir match birden fazla ürünü kapsayacaksa istek, YAZMADAN reddedilir (fail-closed).
    const scopeCounts: Array<{ xmlCategoryPath: string; count: number }> = [];
    for (const match of matches) {
      const xmlCategoryPath = String(match?.xmlCategoryPath ?? '');
      if (!xmlCategoryPath) continue;
      const count = await prisma.product.count({ where: { supplierCategory: xmlCategoryPath } });
      if (count > 1) {
        return res.status(409).json({
          error: {
            code: 'CATEGORY_GROUP_PROPAGATION_FORBIDDEN',
            message: `Grup propagation yasak: "${xmlCategoryPath}" ${count} ürünü kapsıyor. Kategori kararı PRODUCT-LEVEL olmalıdır (/category-core-v2/run kullanın).`,
          },
        });
      }
      scopeCounts.push({ xmlCategoryPath, count });
    }

    let totalMatched = 0;
    const results: Array<{ xmlCategory: string; systemCategory: string; count: number }> = [];
    for (const match of matches) {
      const { xmlCategoryPath, systemCategoryId } = match;
      const products = await prisma.product.findMany({ where: { supplierCategory: xmlCategoryPath }, select: { id: true } });
      if (products.length > 0 && systemCategoryId) {
        const productIds = products.map(p => p.id);
        await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId: systemCategoryId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
        for (const pid of productIds) {
          queueReconcileProductGates(pid);
        }
        const systemCat = await prisma.category.findUnique({ where: { id: systemCategoryId } });
        totalMatched += products.length;
        results.push({ xmlCategory: xmlCategoryPath, systemCategory: systemCat?.name || 'Bilinmeyen', count: products.length });
      }
    }

    await prisma.auditLog.create({ data: { action: 'BULK_CATEGORY_MATCH', entity: 'category', meta: JSON.stringify({ totalMatched, categoryCount: results.length }), details: `Toplu eşleştirme: ${totalMatched} ürün, ${results.length} kategori`, actorUserId: (req as any).actor?.userId || null } });
    invalidateProductsStatsCache();
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
    // FIX(F-05): sınırsız full-table okumasına güvenlik üst sınırı. Kategori tablosu
    // pratikte küçüktür; cap yalnızca patolojik büyümede devreye girer (fail-safe).
    const where: Record<string, unknown> = {};
    if (search) where.name = { contains: search };
    if (parentId !== undefined) where.parentId = parentId || null;
    const categories = await prisma.category.findMany({ where, orderBy: { name: 'asc' }, take: 50000, include: { _count: { select: { products: true, children: true } } } });
    res.json({ items: categories.map((cat: any) => ({ id: cat.id, name: cat.name, externalId: cat.externalId, parentId: cat.parentId, productCount: cat._count.products, childCount: cat._count.children, createdAt: cat.createdAt, updatedAt: cat.updatedAt })) });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch categories' } });
  }
});

// ==================== CATEGORIZED PRODUCTS ====================
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const limit = Math.min(20000, Math.max(1, parseInt(String(req.query.limit || '50')) || 50));
    const search = String(req.query.search || '').trim();
    const xmlSourceId = readQueryValue(req.query?.xmlSourceId);
    const uncategorized = req.query?.uncategorized === 'true';
    const categoryIdParam = req.query?.categoryId ? String(req.query.categoryId) : null;
    const status = req.query?.status ? String(req.query.status) : null;

    const where: any = {};
    // TASK323 FIX: silinmiş (tombstone) ürünler kategori listelerine sızmasın
    where.status = { not: 'DELETED' };
    if (uncategorized) where.categoryId = null;
    if (categoryIdParam === 'not_null') { where.categoryId = { not: null }; }
    else if (categoryIdParam) { where.categoryId = categoryIdParam; }

    if (status) {
      switch (status) {
        case 'XML': where.categoryMatch = false; where.categoryId = null; break;
        case 'DRAFT': where.categoryMatch = false; where.categoryId = { not: null }; break;
        // FIX(312-FINAL): READY filtresi GERÇEK gönderime-hazır state'i döndürmeli;
        // yalnızca categoryMatch=true tüm eşleşmiş ürünleri (READY olmayanları da) veriyordu.
        case 'READY': where.categoryMatch = true; where.status = 'READY'; break;
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
    // FIX(312-R2): kalici Trendyol mapping bilgisi — UI "kalici eslesme var/yok" ayrimini
    // bu set uzerinden gostermek zorunda (operational match = aktif + externalId'li mapping).
    const mpIdParam = readQueryValue(req.query?.marketplaceId);
    let opMpId = mpIdParam;
    if (!opMpId) {
      const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
      opMpId = ttMp?.id ?? null;
    }
    let mappedCategoryIds: string[] = [];
    if (opMpId) {
      const ms = await prisma.categoryMapping.findMany({ where: { marketplaceId: opMpId, active: true, externalId: { not: null } }, select: { categoryId: true } });
      mappedCategoryIds = Array.from(new Set(ms.map(m => m.categoryId)));
    }

    // FIX(F-05): tam sayfalama sözleşmesi (hasNext/hasPrevious eklendi; mevcut alanlar korundu).
    const totalPages = Math.ceil(total / limit);
    res.json({ items, pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrevious: page > 1 }, mappedCategoryIds, marketplaceId: opMpId });
  } catch (error) {
    console.error('Error fetching category products:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch category products' } });
  }
});

// ==================== MATCH / UNMATCH ====================
router.post('/match', requireAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, productIds } = req.body;
    // HARDENING(312): tip doğrulaması — object/array categoryId Prisma 500 üretiyordu.
    if (typeof categoryId !== 'string' || !categoryId.trim() || !Array.isArray(productIds) || productIds.length === 0 || !productIds.every((x: unknown) => typeof x === 'string' && x.trim())) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'categoryId (string) and productIds (string[]) are required' } });
    }
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Kategori bulunamadı' } });
    // TASK322: yalnızca gerçek Trendyol leaf kategorisi atanabilir (parent/virtual/inactive reject)
    try {
      const treeIdx = await loadTrendyolTree();
      if (!treeIdx.leafById.has(categoryId)) {
        return res.status(400).json({ error: { code: 'NOT_A_LEAF', message: 'Yalnızca Trendyol alt kategorisi (leaf) seçilebilir' } });
      }
    } catch (e) { /* ağaç yüklenemezse mevcut davranışla devam */ }
    const result = await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId, categoryMatch: true, matchedBy: 'manual', lastMatchDate: new Date() } });
    for (const pid of productIds) {
      queueReconcileProductGates(pid);
    }

    await prisma.auditLog.create({ data: { action: 'CATEGORY_MATCH', entity: 'category', entityId: categoryId, details: `${result.count} ürün "${category.name}" kategorisine eşleştirildi`, actorUserId: (req as any).actor?.userId || null } });
    invalidateProductsStatsCache();
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

    // RULE 14: unmatch MUST clear state consistently
    // Clear matchedBy to avoid stale provenance creating false MANUAL_REVIEW eligibility
    // TASK313-R3 FIX (fail-open kapatma): eslesen kaldırılan ürünler READY havuzunda KALMAMALI.
    const affectedIds = (await prisma.product.findMany({ where: { id: { in: productIds }, status: 'READY' }, select: { id: true } })).map(p => p.id);
    const result = await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { categoryId: null, categoryMatch: false, matchedBy: null, aiSuggestedCategoryId: null, aiScore: null } });
    for (const pid of affectedIds) { queueReconcileProductGates(pid); }

    await prisma.auditLog.create({ data: { action: 'CATEGORY_UNMATCH', entity: 'category', details: `${result.count} ürünün kategori eşleştirmesi kaldırıldı`, meta: JSON.stringify({ productIds: productIds.slice(0, 20), clearedFields: ['categoryId', 'categoryMatch', 'matchedBy', 'aiSuggestedCategoryId', 'aiScore'] }), actorUserId: (req as any).actor?.userId || null } });
    invalidateProductsStatsCache();
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
    invalidateTrendyolTreeCache(); _treeRouteCache.at = 0;
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

// ==================== BATCH RESOLVE — CANONICAL ENGINE ====================

router.post('/batch-resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, limit: reqLimit } = (req.body || {}) as { xmlSourceId?: string; limit?: number };
    const limit = Math.min(500, Math.max(1, reqLimit ?? 500));

    // Trendyol tree + marketplace ID
    const tree = await loadTrendyolTree();
    if (tree.leaves.length === 0) {
      return res.json({ ok: false, error: 'Trendyol kategori ağacı boş', results: [] });
    }
    const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
    const marketplaceId = ttMp?.id ?? null;

    // Fetch ALL unmatched products (categoryMatch=false) — TASK317: DELETED hariç
    const where: any = { categoryMatch: false, status: { not: 'DELETED' } };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const totalCount = await prisma.product.count({ where });
    const products = await prisma.product.findMany({
      where,
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, categoryId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    if (products.length === 0) {
      return res.json({ ok: true, total: 0, matched: 0, manual: 0, alreadyValid: 0, skipped: 0 });
    }

    // Classify existing categoryId
    const leafIds = new Set(tree.leaves.map(l => l.id));
    const leafById = tree.leafById;

    // Batch-check CategoryMapping for all leaf candidates
    const allCandidateIds = new Set<string>();
    for (const p of products) {
      const r = resolveCategoryCandidates(p, tree, marketplaceId);
      if (r.topCandidate) allCandidateIds.add(r.topCandidate.id);
      if (p.categoryId) allCandidateIds.add(p.categoryId);
    }

    const mappedCategoryIds = new Set<string>();
    if (marketplaceId && allCandidateIds.size > 0) {
      const mappings = await prisma.categoryMapping.findMany({
        where: { categoryId: { in: Array.from(allCandidateIds) }, marketplaceId, active: true, externalId: { not: null } },
        select: { categoryId: true },
      });
      for (const m of mappings) mappedCategoryIds.add(m.categoryId);
    }

    // Process each product
    let alreadyValid = 0;
    let matched = 0;
    let manual = 0;
    let skipped = 0;
    const appliedProducts: Array<{ xmlKey: string; oldCategoryId: string | null; newCategoryId: string; categoryName: string; confidence: number; reason: string }> = [];
    const manualProducts: Array<{ xmlKey: string; reason: string; topCandidate: string | null; topCandidateId?: string; confidence: number; mapped?: boolean; method?: string }> = [];
    console.log(`[batch-resolve] mappedCategoryIds size=${mappedCategoryIds.size} allCandidateIds size=${allCandidateIds.size}`);

    for (const p of products) {
      const existingCatValid = p.categoryId ? leafIds.has(p.categoryId) : false;
      const existingCatMapped = p.categoryId ? mappedCategoryIds.has(p.categoryId) : false;

      // Group 1: Already has valid Trendyol leaf + mapping → just set categoryMatch=true
      if (existingCatValid && existingCatMapped) {
        // P0: SafetyGate kontrolü — batch-resolve Group 1
        const validLeaf = tree.leafById.get(p.categoryId!);
        if (validLeaf) {
          const safetyInput: SafetyGateInput = {
            productId: p.id,
            title: p.title,
            supplierCategory: p.supplierCategory,
            currentCategoryId: p.categoryId ?? null,
            currentCategoryName: null,
            currentCategoryPath: p.categoryId ? tree.leafById.get(p.categoryId!)?.fullPath ?? null : null,
            selectedCategoryId: p.categoryId!,
            selectedCategoryName: validLeaf.name,
            selectedCategoryPath: validLeaf.fullPath,
            selectedCategoryExternalId: validLeaf.externalId,
            candidates: [{ id: validLeaf.id, name: validLeaf.name, fullPath: validLeaf.fullPath, score: 1.0 }],
            aiConfidence: 1.0,
            verifierVerdict: true,
            verifierConfidence: 1.0,
            margin: 1.0,
            tree,
            isDeterministic: true,
            decisionMethod: 'VERIFIED_EXISTING',
          };
          const safety = verifyCategorySafety(safetyInput);
          if (!safety.passed) {
            manual++;
            continue;
          }
        }
        await prisma.product.update({
          where: { id: p.id },
          data: { categoryMatch: true, matchedBy: 'verified', lastMatchDate: new Date(), aiScore: 1.0 },
        });
        queueReconcileProductGates(p.id);
        // P0: Standart audit log — batch-resolve already-valid per-product
        await prisma.auditLog.create({
          data: {
            action: 'CANONICAL_BATCH_RESOLVE',
            entity: 'product',
            entityId: p.id,
            meta: buildCategoryAuditMeta({
              productId: p.id,
              decisionMethod: 'VERIFIED_EXISTING',
              decisionScope: 'PRODUCT',
              oldCategoryId: p.categoryId,
              newCategoryId: p.categoryId,
              supplierCategory: p.supplierCategory,
              selectedCategory: validLeaf?.name ?? null,
              candidate: validLeaf?.name ?? null,
              aiConfidence: 1.0,
              verifierResult: 'DETERMINISTIC',
              verifierConfidence: 1.0,
              margin: 1.0,
              safetyGateResult: 'PASS',
              reason: 'existing_valid_leaf',
            }),
            details: `Batch-resolve already-valid: ${p.xmlKey} → "${validLeaf?.name}"`,
          },
        }).catch(() => null);
        alreadyValid++;
        continue;
      }

      // Group 2 & 3: Invalid/missing categoryId → resolve via canonical engine
      const result = resolveCategoryCandidates(p, tree, marketplaceId);
      const topCandidateMapped = result.topCandidate ? mappedCategoryIds.has(result.topCandidate.id) : false;
      console.log(`[batch-resolve] ${p.xmlKey} conf=${result.confidence.toFixed(2)} mapped=${topCandidateMapped} method=${result.method} candidate=${result.topCandidate?.name} candidateId=${result.topCandidate?.id.slice(0,8)}`);

      if (result.topCandidate && topCandidateMapped && result.confidence >= 0.6) {
        // P0: SafetyGate kontrolü — batch-resolve Group 2 (canonical)
        const candLeaf = tree.leafById.get(result.topCandidate.id);
        if (candLeaf) {
          const safetyInput: SafetyGateInput = {
            productId: p.id,
            title: p.title,
            supplierCategory: p.supplierCategory,
            currentCategoryId: p.categoryId ?? null,
            currentCategoryName: null,
            currentCategoryPath: p.categoryId ? tree.leafById.get(p.categoryId!)?.fullPath ?? null : null,
            selectedCategoryId: result.topCandidate.id,
            selectedCategoryName: candLeaf.name,
            selectedCategoryPath: candLeaf.fullPath,
            selectedCategoryExternalId: candLeaf.externalId,
            candidates: result.candidates.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score ?? 0 })),
            aiConfidence: result.confidence,
            verifierVerdict: true,
            verifierConfidence: 1.0,
            margin: 0.5,
            tree,
            isDeterministic: true,
            decisionMethod: 'RULE_CANONICAL_SAFE',
          };
          const safety = verifyCategorySafety(safetyInput);
          if (!safety.passed) {
            manual++;
            manualProducts.push({
              xmlKey: p.xmlKey,
              reason: 'safety_gate_fail',
              topCandidate: result.topCandidate.name,
              topCandidateId: result.topCandidate.id.slice(0, 8),
              confidence: result.confidence,
              mapped: topCandidateMapped,
              method: result.method,
            });
            continue;
          }
        }
        // Has verified candidate + sufficient confidence → auto-apply
        await prisma.product.update({
          where: { id: p.id },
          data: {
            categoryId: result.topCandidate.id,
            categoryMatch: true,
            matchedBy: 'canonical',
            lastMatchDate: new Date(),
            aiSuggestedCategoryId: result.topCandidate.id,
            aiScore: result.confidence,
          },
        });
        queueReconcileProductGates(p.id);
        // P0: Standart audit log — batch-resolve per-product
        await prisma.auditLog.create({
          data: {
            action: 'CANONICAL_BATCH_RESOLVE',
            entity: 'product',
            entityId: p.id,
            meta: buildCategoryAuditMeta({
              productId: p.id,
              decisionMethod: 'RULE_CANONICAL_SAFE',
              decisionScope: 'PRODUCT',
              oldCategoryId: p.categoryId,
              newCategoryId: result.topCandidate.id,
              supplierCategory: p.supplierCategory,
              selectedCategory: result.topCandidate.name,
              candidate: result.topCandidate.name,
              aiConfidence: result.confidence,
              verifierResult: 'DETERMINISTIC',
              verifierConfidence: 1.0,
              margin: 0.5,
              safetyGateResult: 'PASS',
              reason: existingCatValid ? 'replaced_invalid_leaf' : 'new_canonical_match',
            }),
            details: `Batch-resolve: ${p.xmlKey} → "${result.topCandidate.name}" (conf=${result.confidence.toFixed(2)})`,
          },
        }).catch(() => null);
        matched++;
        appliedProducts.push({
          xmlKey: p.xmlKey,
          oldCategoryId: p.categoryId,
          newCategoryId: result.topCandidate.id,
          categoryName: result.topCandidate.name,
          confidence: result.confidence,
          reason: existingCatValid ? 'replaced_invalid_leaf' : 'new_canonical_match',
        });
      } else if (result.topCandidate) {
        // Has candidate but low confidence → manual review
        manual++;
        manualProducts.push({
          xmlKey: p.xmlKey,
          reason: !topCandidateMapped ? 'no_verified_mapping' : `low_confidence_${result.confidence.toFixed(2)}`,
          topCandidate: result.topCandidate.name,
          topCandidateId: result.topCandidate.id.slice(0, 8),
          confidence: result.confidence,
          mapped: topCandidateMapped,
          method: result.method,
        });
      } else {
        // No candidate at all
        manual++;
        manualProducts.push({
          xmlKey: p.xmlKey,
          reason: result.method === 'no_source' ? 'no_supplier_category' : 'no_candidate_found',
          topCandidate: null,
          confidence: 0,
        });
      }
    }

    // TASK319 FIX: batch-resolve sonrasi stats cache invalidate edilmiyordu —
    // kullanici otomasyon sonrasi kart sayilarinin guncellenmedigini goruyordu.
    if (alreadyValid > 0 || matched > 0) invalidateProductsStatsCache();

    await prisma.auditLog.create({
      data: {
        action: 'CANONICAL_BATCH_RESOLVE',
        entity: 'category',
        meta: JSON.stringify({
          total: products.length, totalCount, alreadyValid, matched, manual, skipped,
          xmlSourceId, treeLeafCount: tree.leaves.length,
        }),
        details: `Canonical batch: ${alreadyValid} already valid, ${matched} canonical matched, ${manual} manual — total ${totalCount}`,
        actorUserId: (req as any).actor?.userId || null,
      },
    });

    res.json({
      ok: true,
      total: products.length,
      totalCount,
      alreadyValid,
      matched,
      manual,
      skipped,
      treeLeafCount: tree.leaves.length,
      applied: appliedProducts,
      manualReview: manualProducts.slice(0, 50),
    });
  } catch (error) {
    console.error('Error batch resolving categories:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to batch resolve categories' } });
  }
});

// ==================== RESOLVE HISTORY — TASK321 ====================
// Son otomatik çözüm koşusunun sonucunu kalıcı olarak raporlar.
// Amaç: kullanıcı sayfaya her girişte "aynı işi tekrar yapmam" için dürüst bağlam görsün.
router.get('/resolve-history', requireAuth, async (req: Request, res: Response) => {
  try {
    const last = await prisma.auditLog.findFirst({
      where: { action: 'CANONICAL_BATCH_RESOLVE' },
      orderBy: { createdAt: 'desc' },
    });
    let lastRun: Record<string, unknown> | null = null;
    if (last) {
      let meta: any = {};
      try { meta = JSON.parse(last.meta || '{}'); } catch { /* noop */ }
      const lastImport = await prisma.xmlImportRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
      const newImportSinceRun = !!lastImport?.startedAt && !!last.createdAt && new Date(lastImport.startedAt) > new Date(last.createdAt);
      lastRun = {
        at: last.createdAt,
        matched: Number(meta.matched ?? 0),
        manual: Number(meta.manual ?? 0),
        total: Number(meta.total ?? 0),
        newImportSinceRun,
      };
    }
    res.json({ ok: true, lastRun });
  } catch (error) {
    console.error('Error reading resolve history:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Koşu geçmişi okunamadı' } });
  }
});

// ==================== SUGGEST — TASK320: ürün-merkezli öneri (read-only) ====================
// Picker'da kullanıcıya "bu ürün nedir + hangi kategori adayları var + neden manuel" göstermek için.
router.get('/suggest', requireAuth, async (req: Request, res: Response) => {
  try {
    const productId = String(req.query.productId ?? '');
    if (!/^[0-9a-fA-F-]{10,40}$/.test(productId)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz ürün kimliği' } });
    }
    const p = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, sku: true, barcode: true },
    });
    if (!p) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });

    const tree = await loadTrendyolTree();
    const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
    const r = resolveCategoryCandidates(p as any, tree as any, ttMp?.id ?? null);

    res.json({
      ok: true,
      product: { id: p.id, title: p.title, brand: p.xmlBrandName, sku: p.sku, barcode: p.barcode, supplierCategory: p.supplierCategory },
      method: r.method,
      confidence: r.confidence,
      reason: r.method === 'no_source' ? 'Tedarikçi kategori bilgisi yok'
        : r.method === 'no_candidate' ? 'Güvenli aday bulunamadı'
        : r.confidence < 0.6 ? 'En iyi aday güven eşiğinin altında'
        : 'Aday(lar) bulundu',
      suggestions: r.candidates.slice(0, 5).map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath })),
    });
  } catch (error) {
    console.error('Error suggesting category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Öneri alınamadı' } });
  }
});

// ==================== BLOCKED AUTO-REMATCH — TASK318 ====================// Gönderime engel ürünler (categoryMatch=true ama aktif CategoryMapping yok) için
// kanonik motor mapping'li adayı conf>=0.6 bulursa otomatik yeniden eşleştirir.
router.post('/blocked-resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const { xmlSourceId, limit: reqLimit } = (req.body || {}) as { xmlSourceId?: string; limit?: number };
    const limit = Math.min(500, Math.max(1, reqLimit ?? 500));

    const tree = await loadTrendyolTree();
    if (tree.leaves.length === 0) return res.json({ ok: false, error: 'Trendyol kategori ağacı boş' });
    const ttMp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
    const marketplaceId = ttMp?.id ?? null;

    // Engelli gruplar: categoryMatch=true + aktif mapping'i olmayan categoryId
    const matchedGroups = await prisma.product.groupBy({
      by: ['categoryId'],
      where: { categoryMatch: true, status: { not: 'DELETED' }, categoryId: { not: null } },
      _count: { id: true },
    });
    const catIds = matchedGroups.map(g => g.categoryId as string);
    const activeMappings = marketplaceId ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: catIds }, marketplaceId, active: true, externalId: { not: null } },
      select: { categoryId: true },
    }) : [];
    const mappedSet = new Set(activeMappings.map(m => m.categoryId));
    const blockedCatIds = new Set(matchedGroups.filter(g => !mappedSet.has(g.categoryId as string)).map(g => g.categoryId as string));
    if (blockedCatIds.size === 0) return res.json({ ok: true, total: 0, rematched: 0, manual: 0 });

    const products = await prisma.product.findMany({
      where: { categoryMatch: true, status: { not: 'DELETED' }, categoryId: { in: Array.from(blockedCatIds) }, ...(xmlSourceId ? { xmlSourceId } : {}) },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, categoryId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    if (products.length === 0) return res.json({ ok: true, total: 0, rematched: 0, manual: 0 });

    // Tüm adaylar için mapping doğrulaması (bulk)
    const candidateIds = new Set<string>();
    for (const p of products) {
      const r = resolveCategoryCandidates(p as any, tree, marketplaceId);
      if (r.topCandidate) candidateIds.add(r.topCandidate.id);
    }
    const candMappings = marketplaceId && candidateIds.size > 0 ? await prisma.categoryMapping.findMany({
      where: { categoryId: { in: Array.from(candidateIds) }, marketplaceId, active: true, externalId: { not: null } },
      select: { categoryId: true },
    }) : [];
    const candMapped = new Set(candMappings.map(m => m.categoryId));

    let rematched = 0;
    const applied: any[] = [];
    const manualList: any[] = [];
    for (const p of products) {
      const r = resolveCategoryCandidates(p as any, tree, marketplaceId);
      const topMapped = r.topCandidate ? candMapped.has(r.topCandidate.id) : false;
      if (r.topCandidate && topMapped && r.confidence >= 0.6 && r.topCandidate.id !== p.categoryId) {
        // P0: SafetyGate kontrolü — blocked-resolve
        const candLeaf = tree.leafById.get(r.topCandidate.id);
        if (candLeaf) {
          const safetyInput: SafetyGateInput = {
            productId: p.id,
            title: p.title,
            supplierCategory: p.supplierCategory,
            currentCategoryId: p.categoryId ?? null,
            currentCategoryName: null,
            currentCategoryPath: p.categoryId ? tree.leafById.get(p.categoryId!)?.fullPath ?? null : null,
            selectedCategoryId: r.topCandidate.id,
            selectedCategoryName: candLeaf.name,
            selectedCategoryPath: candLeaf.fullPath,
            selectedCategoryExternalId: candLeaf.externalId,
            candidates: r.candidates.map(c => ({ id: c.id, name: c.name, fullPath: c.fullPath, score: c.score ?? 0 })),
            aiConfidence: r.confidence,
            verifierVerdict: true,
            verifierConfidence: 1.0,
            margin: 0.5,
            tree,
            isDeterministic: true,
            decisionMethod: 'RULE_CANONICAL_SAFE',
          };
          const safety = verifyCategorySafety(safetyInput);
          if (!safety.passed) {
            manualList.push({
              xmlKey: p.xmlKey, productId: p.id,
              reason: 'safety_gate_fail',
              topCandidate: r.topCandidate.name, confidence: r.confidence,
            });
            continue;
          }
        }
        await prisma.product.update({
          where: { id: p.id },
          data: { categoryId: r.topCandidate.id, categoryMatch: true, matchedBy: 'canonical', lastMatchDate: new Date(), aiScore: r.confidence },
        });
        queueReconcileProductGates(p.id);
        // P0: Standart audit log — blocked-resolve per-product
        await prisma.auditLog.create({
          data: {
            action: 'CANONICAL_BLOCKED_REMATCH',
            entity: 'product',
            entityId: p.id,
            meta: buildCategoryAuditMeta({
              productId: p.id,
              decisionMethod: 'RULE_CANONICAL_SAFE',
              decisionScope: 'PRODUCT',
              oldCategoryId: p.categoryId,
              newCategoryId: r.topCandidate.id,
              supplierCategory: p.supplierCategory,
              selectedCategory: r.topCandidate.name,
              candidate: r.topCandidate.name,
              aiConfidence: r.confidence,
              verifierResult: 'DETERMINISTIC',
              verifierConfidence: 1.0,
              margin: 0.5,
              safetyGateResult: 'PASS',
              reason: 'blocked_rematch',
            }),
            details: `Blocked-resolve: ${p.xmlKey} → "${r.topCandidate.name}" (conf=${r.confidence.toFixed(2)})`,
          },
        }).catch(() => null);
        rematched++;
        applied.push({ xmlKey: p.xmlKey, oldCategoryId: p.categoryId, newCategoryId: r.topCandidate.id, categoryName: r.topCandidate.name, confidence: r.confidence });
      } else {
        manualList.push({
          xmlKey: p.xmlKey, productId: p.id,
          reason: !r.topCandidate ? 'no_candidate' : (!topMapped ? 'candidate_unmapped' : `low_confidence_${r.confidence.toFixed(2)}`),
          topCandidate: r.topCandidate ? r.topCandidate.name : null, confidence: r.confidence,
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        action: 'CANONICAL_BLOCKED_REMATCH',
        entity: 'category',
        meta: JSON.stringify({ total: products.length, rematched, manual: manualList.length }),
        details: `Blocked rematch: ${rematched} otomatik, ${manualList.length} manuel`,
        actorUserId: (req as any).actor?.userId || null,
      },
    });
    if (rematched > 0) invalidateProductsStatsCache();

    res.json({ ok: true, total: products.length, rematched, manual: manualList.length, applied: applied.slice(0, 50), manualReview: manualList.slice(0, 50) });
  } catch (error) {
    console.error('Error blocked resolving:', error);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Blocked resolve başarısız' } });
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
    invalidateTrendyolTreeCache(); _treeRouteCache.at = 0;
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
    const affectedReady = (await prisma.product.findMany({ where: { categoryId: id, status: 'READY' }, select: { id: true } })).map(p => p.id);
    await prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null, categoryMatch: false } });
    for (const pid of affectedReady) { queueReconcileProductGates(pid); }
    await prisma.categoryMapping.deleteMany({ where: { categoryId: id } });
    await prisma.category.delete({ where: { id } });
    await prisma.auditLog.create({ data: { action: 'CATEGORY_DELETE', entity: 'category', entityId: id, details: `"${category?.name}" kategorisi silindi`, actorUserId: (req as any).actor?.userId || null } });
    invalidateTrendyolTreeCache(); _treeRouteCache.at = 0;
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete category' } });
  }
});

export default router;



