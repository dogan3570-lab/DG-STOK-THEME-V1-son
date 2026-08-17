import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole } from '../auth/authMiddleware.ts';
import { runVariantMatchFlow } from '../services/variantMatch.ts';
import { detectVariantAttributes } from '../services/readiness.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from '../services/trendyolCatalog.ts';

/** Gerçek varyant alanları — AKYI ve HBT/DGLIVE önekli çöp alanlar hariç. */
const REAL_VARIANT_NAMES = new Set(['Renk', 'Beden', 'Numara', 'Kapasite', 'Hacim', 'Cinsiyet', 'Materyal', 'Model']);

const router = Router();

// ==================== HELPERS ====================

function extractParentSku(sku: string | null | undefined): string {
  const s = (sku || '').trim();
  if (!s) return '';
  const m = s.match(/^(.+?)[-_.]?(\d{1,3})$/);
  if (m && m[1]) return m[1].replace(/[-_.]+$/, '');
  return s.replace(/[-_.]\w+$/, '');
}

function normalizeVariantValue(v: string): string {
  return (v || '').toString().trim().toLowerCase();
}

const COLOR_MAP: Record<string, string> = {
  black: 'Siyah', white: 'Beyaz', red: 'Kirmizi', blue: 'Mavi',
  green: 'Yesil', yellow: 'Sari', purple: 'Mor', orange: 'Turuncu',
  pink: 'Pembe', gray: 'Gri', grey: 'Gri', brown: 'Kahverengi',
  beige: 'Bej', navy: 'Lacivert', burgundy: 'Bordo',
  silver: 'Gumus', gold: 'Altin', cream: 'Krem',
  siyah: 'Siyah', beyaz: 'Beyaz', kirmizi: 'Kirmizi', mavi: 'Mavi',
  yesil: 'Yesil', sari: 'Sari', mor: 'Mor', turuncu: 'Turuncu',
  pembe: 'Pembe', lacivert: 'Lacivert', bordo: 'Bordo',
  bej: 'Bej', kahverengi: 'Kahverengi', krem: 'Krem',
  fume: 'Gri', metalik: 'Gri', gumus: 'Gumus', altin: 'Altin',
};

const SIZE_PATTERNS = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl', '5xl', 'small', 'medium', 'large', 'xlarge'];
const COLOR_PATTERNS = Object.keys(COLOR_MAP);

function detectVariantsFromText(text: string): Array<{ name: string; value: string; confidence: number }> {
  // TEK AUTHORITATIVE kural: readiness.ts detectVariantAttributes (başlıktan sahte varyant üretmez).
  return detectVariantAttributes(text).map((v) => ({ name: v.name, value: v.value, confidence: 90 }));
}

// ==================== ROUTES ====================

// ==================== 1. STATS ====================
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const productWhere: Record<string, unknown> = xmlSourceId ? { xmlSourceId } : {};
    const variantWhere: Record<string, unknown> = xmlSourceId ? { product: { xmlSourceId } } : {};
    const [variantTypes, matchedProducts, unmatchedProducts, notRequiredProducts] = await Promise.all([
      prisma.variant.groupBy({ by: ['name'], where: variantWhere, _count: { name: true }, orderBy: { _count: { name: 'desc' } } }),
      prisma.product.count({ where: { variantMatch: true, ...productWhere } }),
      prisma.product.count({ where: { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' }, ...productWhere } }),
      prisma.product.count({ where: { variantStatus: 'NOT_REQUIRED', ...productWhere } }),
    ]);
    // Çöp varyant alanları (AKYI/HBT-*/DGLIVE-*) istatistikten dışlanır.
    const realTypes = variantTypes.filter((v) => REAL_VARIANT_NAMES.has(v.name));
    const totalVariants = realTypes.reduce((s, v) => s + v._count.name, 0);
    res.json({
      totalVariants,
      variantTypes: realTypes.map(v => ({ name: v.name, count: v._count.name })),
      matchedProducts,
      unmatchedProducts,
      notRequiredProducts,
      productsWithVariants: matchedProducts,
    });
  } catch (error) {
    console.error('[variants] GET stats error:', error);
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Veritabani hatasi' } });
  }
});

// ==================== 1B. DASHBOARD (XML + PAZARYERİ kapsamlı GERÇEK sayaçlar) ====================
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = String(req.query?.xmlSourceId ?? '');
    if (!xmlSourceId) return res.status(400).json({ ok: false, error: 'xmlSourceId zorunludur' });
    const marketplaceId = String(req.query?.marketplaceId ?? '');
    const where: Record<string, unknown> = { xmlSourceId };

    const [totalProducts, notRequired, autoMatched, waitingAi, manualReview, completed, hasVariant, analysisFailed] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.count({ where: { ...where, variantStatus: 'NOT_REQUIRED' } }),
      prisma.product.count({ where: { ...where, variantMatch: true } }),
      prisma.product.count({ where: { ...where, variantStatus: 'WAITING_AI', variantMatch: false } }),
      prisma.product.count({ where: { ...where, variantStatus: 'MANUAL_REVIEW' } }),
      prisma.product.count({ where: { ...where, variantStatus: 'COMPLETED' } }),
      prisma.product.count({ where: { ...where, variantStatus: { not: 'NOT_REQUIRED' } } }),
      prisma.product.count({ where: { ...where, variantStatus: { notIn: ['NOT_REQUIRED', 'WAITING_AI', 'MANUAL_REVIEW', 'COMPLETED'] } } }),
    ]);

    // AI ile eşleşenler GERÇEK kayıttan ölçülür (VariantAnalysis source='ai' + validationPassed).
    const aiValidatedRows = await prisma.variantAnalysis.findMany({ where: { validationPassed: true, source: 'ai' }, select: { productId: true } });
    const aiValidatedIds = aiValidatedRows.map((a) => a.productId);
    const aiMatched = aiValidatedIds.length > 0
      ? await prisma.product.count({ where: { id: { in: aiValidatedIds }, xmlSourceId } })
      : 0;

    // Manuel = GERÇEK MANUAL_REVIEW kaydı (kalan hesabı DEĞİL).
    const manual = manualReview;
    // hasVariant GERÇEK DB sayacından gelir (remainder hesabı YOK).

    let marketplaceName: string | null = null;
    if (marketplaceId) {
      const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { name: true } });
      marketplaceName = mp?.name ?? null;
    }

    res.json({ totalProducts, hasVariant, notRequired, autoMatched, aiMatched, manual, manualReview, waitingAi, completed, analysisFailed, marketplaceName });
  } catch (error) {
    console.error('[variants] GET dashboard error:', error);
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Dashboard alınamadı' } });
  }
});

// ==================== 1C. PRODUCTS (ürün bazlı, gerçek varyant + durum + neden) ====================
const REASON_TEXT: Record<string, string> = {
  CATEGORY_MAPPING_NOT_FOUND: 'Trendyol kategori eşlemesi yok; önce Kategori Eşleştirme ekranından kategoriyi eşleyin.',
  CATALOG_UNAVAILABLE: 'Trendyol kategori attribute ağacı alınamadı; tekrar deneyin veya manuel eşleştirin.',
  MARKETPLACE_ATTRIBUTE_NOT_SUPPORTED: 'Bu pazaryeri için gerçek attribute ağacı desteklenmiyor.',
};

function humanReason(code: string | null | undefined): string {
  if (!code) return 'Manuel eşleştirme gerekli';
  if (REASON_TEXT[code]) return REASON_TEXT[code];
  if (code.includes('INVALID_VALUE')) return 'XML varyant değeri anlamsız (AKYI/bozuk değer)';
  if (code.includes('AMBIGUOUS')) return 'Birden fazla marketplace adayı var; manuel inceleme gerekli';
  if (code.includes('NOT_FOUND')) return 'Marketplace değeri bulunamadı';
  return code;
}

function extractManualReason(checkResults: string | null): string | null {
  if (!checkResults) return null;
  try {
    const j = JSON.parse(checkResults);
    if (typeof j.reason === 'string' && j.reason) return humanReason(j.reason);
    if (Array.isArray(j.missing) && j.missing.length > 0) {
      const m = j.missing[0];
      if (m && m.reason) return humanReason(m.reason);
      if (m && m.xmlVariantName) return `Marketplace değeri bulunamadı: ${m.xmlVariantName}=${m.xmlVariantValue ?? ''}`;
    }
    if (Array.isArray(j.requiredMissing) && j.requiredMissing.length > 0) {
      const r = j.requiredMissing[0];
      if (r && r.attributeName) return `Zorunlu attribute eksik: ${r.attributeName}`;
    }
    return 'Manuel eşleştirme gerekli';
  } catch {
    return null;
  }
}

router.get('/products', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = String(req.query?.xmlSourceId ?? '');
    if (!xmlSourceId) return res.status(400).json({ ok: false, error: 'xmlSourceId zorunludur' });
    const page = Math.max(1, Number(req.query?.page ?? 1));
    const limit = Math.min(1000, Math.max(1, Number(req.query?.limit ?? 50)));
    // Varyant ekranı YALNIZCA varyant gerektiren ürünleri listeler (NOT_REQUIRED hariç).
    const where: Record<string, unknown> = { xmlSourceId, variantStatus: { not: 'NOT_REQUIRED' } };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: { id: true, title: true, xmlKey: true, sku: true, categoryId: true, variantStatus: true, variantMatch: true, matchedBy: true, variants: { select: { name: true, value: true } } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);
    const ids = items.map((p) => p.id);
    const analyses = await prisma.variantAnalysis.findMany({ where: { productId: { in: ids } }, select: { productId: true, validationPassed: true, source: true, checkResults: true } });
    const vaMap = new Map<string, { validationPassed: boolean; source: string; checkResults: string | null }>();
    for (const a of analyses) vaMap.set(a.productId, { validationPassed: a.validationPassed, source: a.source, checkResults: a.checkResults });
    const data = items.map((p) => {
      const realVariants = (p.variants || []).filter((v) => REAL_VARIANT_NAMES.has(v.name));
      const va = vaMap.get(p.id);
      let status = 'NOT_REQUIRED';
      let reason: string | null = null;
      if (p.variantStatus === 'NOT_REQUIRED') {
        status = 'NOT_REQUIRED';
      } else if (p.variantMatch && p.matchedBy === 'ai') {
        status = 'AI';
      } else if (p.variantMatch && p.matchedBy === 'manual') {
        status = 'MANUAL_MATCHED';
      } else if (p.variantMatch) {
        status = 'AUTO';
      } else if (va?.validationPassed) {
        status = 'AI';
      } else if (p.variantStatus === 'MANUAL_REVIEW') {
        status = 'MANUAL';
        reason = extractManualReason(va?.checkResults ?? null);
      } else {
        status = 'WAITING_AI';
      }
      return { id: p.id, title: p.title, xmlKey: p.xmlKey, sku: p.sku, categoryId: p.categoryId, variantStatus: p.variantStatus, variantMatch: p.variantMatch, status, reason, variants: realVariants };
    });
    res.json({ items: data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('[variants] GET products error:', error);
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Ürünler alınamadı' } });
  }
});

// ==================== 2. XML VARIANTS (DETECTION) ====================
router.get('/xml-variants', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const search = String(req.query?.search ?? '').trim();
    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    if (search) { where.OR = [{ title: { contains: search } }, { xmlKey: { contains: search } }]; }
    const products = await prisma.product.findMany({
      where, take: 500, orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, xmlKey: true, sku: true, barcode: true, stock: true, salePrice: true, images: true, description: true, detail: true, technicalSpecs: true, xmlSource: { select: { id: true, name: true } } },
    });
    const detectedVariants: Array<{ productId: string; productName: string; xmlKey: string; detectedVariants: Array<{ name: string; value: string; confidence: number }> }> = [];
    for (const product of products) {
      const searchText = [product.title || '', product.xmlKey || '', product.description || '', product.detail || '', product.technicalSpecs || ''].join(' ');
      const detected = detectVariantsFromText(searchText);
      if (detected.length > 0) detectedVariants.push({ productId: product.id, productName: product.title || product.xmlKey, xmlKey: product.xmlKey, detectedVariants: detected });
    }
    return res.json({ totalProducts: products.length, productsWithDetectedVariants: detectedVariants.length, items: detectedVariants });
  } catch (error) {
    console.error('[variants] GET xml-variants error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'XML varyant tespiti basarisiz' } });
  }
});

// ==================== 3. UNMATCHED PRODUCTS ====================
router.get('/unmatched-products', requireAuth, async (req, res) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const limit = Math.min(Number(req.query?.limit) || 100, 500);
    const offset = Number(req.query?.offset) || 0;
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (search) {
      where.OR = [{ title: { contains: search } }, { xmlKey: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }];
    }
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, xmlKey: true, sku: true, barcode: true, stock: true, salePrice: true, images: true, supplierCategory: true, xmlSource: { select: { id: true, name: true } } },
      }),
      prisma.product.count({ where }),
    ]);
    return res.json({ items, total });
  } catch (error) {
    console.error('[variants] GET unmatched-products error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Sorgu basarisiz' } });
  }
});

// ==================== 4. BATCH ADD ====================
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { name, value, productIds } = req.body;
    if (!name || !value || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name, value ve productIds gerekli' } });
    }
    if (productIds.length > 500) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maksimum 500 urun' } });
    const existing = await prisma.variant.findMany({ where: { productId: { in: productIds }, name, value }, select: { productId: true } });
    const existingSet = new Set(existing.map(e => e.productId));
    const newData = productIds.filter(pid => !existingSet.has(pid)).map(pid => ({ name, value, productId: pid }));
    let created = 0;
    if (newData.length > 0) {
      for (let i = 0; i < newData.length; i += 100) {
        const batch = newData.slice(i, i + 100);
        await prisma.variant.createMany({ data: batch }).catch(() => null);
        created += batch.length;
      }
    }
    if (created > 0) await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { variantMatch: true } });
    await prisma.auditLog.create({ data: { action: 'BATCH_VARIANT_CREATE', entity: 'variant', details: `Toplu varyant: ${created} adet ${name}:${value}`, actorUserId: (req as any).actor?.userId || null } });
    return res.json({ created, skipped: productIds.length - created, message: `${created} varyant olusturuldu, ${productIds.length - created} zaten vardi` });
  } catch (error) {
    console.error('[variants] POST batch error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Toplu varyant ekleme basarisiz' } });
  }
});

// ==================== 5. AUTO-DETECT (context'li: XML varyant tespiti + NOT_REQUIRED sınıflama) ====================
router.post('/auto-detect', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = String(req.body?.xmlSourceId ?? req.query?.xmlSourceId ?? '');
    if (!xmlSourceId) return res.status(400).json({ ok: false, error: 'xmlSourceId zorunludur' });

    // Yalnızca SEÇİLEN XML: eşleşmemiş ve NOT_REQUIRED olmayan ürünler.
    const where: Record<string, unknown> = { xmlSourceId, variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (Array.isArray(req.body?.productIds) && req.body.productIds.length > 0) where.id = { in: req.body.productIds };

    const products = await prisma.product.findMany({
      where,
      take: 2000,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, xmlKey: true, sku: true, description: true },
    });

    let withVariants = 0;
    let withoutVariants = 0;
    const noVariantIds: string[] = [];

    for (const product of products) {
      const searchText = [product.title || '', product.xmlKey || '', product.sku || '', product.description || ''].join(' ');
      const detected = detectVariantAttributes(searchText);
      if (detected.length > 0) withVariants++;
      else { withoutVariants++; noVariantIds.push(product.id); }
    }

    // XML'de gerçek varyant yoksa NOT_REQUIRED — kullanıcıya MANUAL iş ÇIKMAZ.
    let notRequiredUpdated = 0;
    if (noVariantIds.length > 0) {
      const r = await prisma.product.updateMany({ where: { id: { in: noVariantIds }, variantStatus: { not: 'NOT_REQUIRED' } }, data: { variantMatch: false, variantStatus: 'NOT_REQUIRED' } });
      notRequiredUpdated = r.count;
    }

    await prisma.auditLog.create({ data: { action: 'AUTO_VARIANT_DETECT', entity: 'variant', details: `Varyant tespiti: ${withVariants} varyantlı, ${withoutVariants} varyantsız (${notRequiredUpdated} NOT_REQUIRED)`, actorUserId: (req as any).actor?.userId || null } });
    return res.json({ ok: true, totalScanned: products.length, totalProductsWithVariants: withVariants, totalProductsWithoutVariants: withoutVariants, notRequiredUpdated, message: `${withVariants} varyantlı, ${withoutVariants} varyantsız ürün tespit edildi` });
  } catch (error) {
    console.error('[variants] POST auto-detect error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Otomatik varyant tespiti basarisiz' } });
  }
});

// ==================== 6. BULK MATCH ====================
router.post('/bulk-match', requireAuth, async (req, res) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'matches array is required' } });
    const allVariantData: Array<{ productId: string; name: string; value: string }> = [];
    const allProductIds: string[] = [];
    for (const match of matches) {
      const { productId, variants } = match;
      if (!productId || !Array.isArray(variants) || variants.length === 0) continue;
      allProductIds.push(productId);
      for (const variant of variants) {
        const { name, value } = variant;
        if (name && value) allVariantData.push({ productId, name, value });
      }
    }
    let totalCreated = 0;
    if (allVariantData.length > 0) {
      const existingVariants = await prisma.variant.findMany({
        where: { OR: allVariantData.map(v => ({ productId: v.productId, name: v.name, value: v.value })) },
        select: { productId: true, name: true, value: true },
      });
      const existingKeys = new Set(existingVariants.map(e => `${e.productId}:${e.name}:${e.value}`));
      const newVariants = allVariantData.filter(v => !existingKeys.has(`${v.productId}:${v.name}:${v.value}`));
      for (let i = 0; i < newVariants.length; i += 100) {
        const batch = newVariants.slice(i, i + 100);
        await prisma.variant.createMany({ data: batch }).catch(() => null);
        totalCreated += batch.length;
      }
    }
    const uniqueProductIds = [...new Set(allProductIds)];
    if (uniqueProductIds.length > 0) await prisma.product.updateMany({ where: { id: { in: uniqueProductIds } }, data: { variantMatch: true } });
    await prisma.auditLog.create({ data: { action: 'BULK_VARIANT_MATCH', entity: 'variant', details: `Toplu eslestirme: ${totalCreated} varyant, ${uniqueProductIds.length} urun`, actorUserId: (req as any).actor?.userId || null } });
    return res.json({ totalCreated, totalProducts: uniqueProductIds.length, message: `${totalCreated} varyant ${uniqueProductIds.length} urune eklendi` });
  } catch (error) {
    console.error('[variants] POST bulk-match error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Toplu varyant eslestirme basarisiz' } });
  }
});

// ==================== 7. LIST VARIANTS ====================
router.get('/', requireAuth, async (req, res) => {
  try {
    const search = String(req.query?.search ?? '').trim();
    const name = req.query?.name ? String(req.query.name).trim() : null;
    const limit = Math.min(Number(req.query?.limit) || 500, 1000);
    const offset = Number(req.query?.offset) || 0;
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : null;
    const where: any = {};
    if (search) { where.OR = [{ name: { contains: search } }, { value: { contains: search } }]; }
    if (name) where.name = name;
    if (xmlSourceId) where.product = { xmlSourceId };
    const [items, total] = await Promise.all([
      prisma.variant.findMany({ where, take: limit, skip: offset, orderBy: { updatedAt: 'desc' }, include: { product: { select: { id: true, title: true, xmlKey: true, sku: true, images: true, salePrice: true, stock: true } } } }),
      prisma.variant.count({ where }),
    ]);
    return res.json({ items, total, limit, offset });
  } catch (error) {
    console.error('[variants] GET error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Sorgu basarisiz' } });
  }
});

// ==================== 8. VARIANT TYPES ====================
router.get('/types', requireAuth, async (_req, res) => {
  try {
    const types = await prisma.variant.groupBy({ by: ['name'], _count: { name: true }, orderBy: { _count: { name: 'desc' } } });
    return res.json({ items: types.map(t => ({ name: t.name, count: t._count.name })) });
  } catch (error) {
    console.error('[variants] GET types error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Sorgu basarisiz' } });
  }
});

// ==================== 9. AI SUGGEST (SINGLE) ====================
// FALSE-POSITIVE FIX: başlıktan çıplak s/m/l, 32-50 arası sayı ve fiziksel ölçü ASLA varyant üretilmez.
// Tek authoritative kural: readiness.detectVariantAttributes.
router.post('/ai-suggest', requireAuth, async (req, res) => {
  try {
    const { title, description } = req.body;
    const searchText = String(title || '') + ' ' + String(description || '');
    const detected = detectVariantAttributes(searchText);
    const suggestions = detected.map((v) => ({ name: v.name, value: v.value, confidence: 90 }));
    return res.json({ suggestions, source: 'readiness_rule' });
  } catch (error) {
    console.error('[variants] POST ai-suggest error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'AI oneri basarisiz' } });
  }
});

// ==================== 10. BULK AI SUGGEST ====================
// FALSE-POSITIVE FIX: yalnızca gerçek varyant sinyali (readiness) kabul edilir.
router.post('/bulk-ai-suggest', requireAuth, async (req, res) => {
  try {
    const { productIds } = req.body;
    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (Array.isArray(productIds) && productIds.length > 0) where.id = { in: productIds };
    const products = await prisma.product.findMany({ where, select: { id: true, title: true, description: true }, take: 200 });
    const results: Array<{ productId: string; productTitle: string; suggestions: Array<{ name: string; value: string; confidence: number }> }> = [];

    for (const product of products) {
      const searchText = String(product.title || '') + ' ' + String(product.description || '');
      const detected = detectVariantAttributes(searchText);
      if (detected.length === 0) continue;
      const suggestions = detected.map((v) => ({ name: v.name, value: v.value, confidence: 90 }));
      results.push({ productId: product.id, productTitle: product.title || '', suggestions });
    }
    return res.json({ totalScanned: products.length, totalSuggestions: results.length, results });
  } catch (error) {
    console.error('[variants] POST bulk-ai-suggest error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Toplu AI oneri basarisiz' } });
  }
});

// ==================== 11. UNIVERSAL ATTRIBUTES ====================
router.get('/universal-attributes', (_req, res) => {
  const attrs = [
    { key: 'Renk', label: 'Renk', icon: '🎨', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon', 'N11'] },
    { key: 'Beden', label: 'Beden', icon: '👕', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon', 'N11'] },
    { key: 'Numara', label: 'Numara', icon: '🔢', marketplaces: ['Trendyol', 'Hepsiburada', 'N11'] },
    { key: 'Cinsiyet', label: 'Cinsiyet', icon: '⚤', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon'] },
    { key: 'Materyal', label: 'Materyal', icon: '🧵', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon'] },
    { key: 'Kapasite', label: 'Kapasite', icon: '📊', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Hacim', label: 'Hacim', icon: '🧊', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Model', label: 'Model', icon: '🏷️', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Olcu', label: 'Olcu', icon: '📐', marketplaces: ['Trendyol', 'Hepsiburada'] },
  ];
  return res.json({ items: attrs });
});

// ==================== 12. MARKETPLACE ATTRIBUTES ====================
router.get('/marketplace-attributes/:key', (req, res) => {
  const attrs = [
    { key: 'Renk', label: 'Renk', icon: '🎨', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon', 'N11'] },
    { key: 'Beden', label: 'Beden', icon: '👕', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon', 'N11'] },
    { key: 'Numara', label: 'Numara', icon: '🔢', marketplaces: ['Trendyol', 'Hepsiburada', 'N11'] },
    { key: 'Cinsiyet', label: 'Cinsiyet', icon: '⚤', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon'] },
    { key: 'Materyal', label: 'Materyal', icon: '🧵', marketplaces: ['Trendyol', 'Hepsiburada', 'Amazon'] },
    { key: 'Kapasite', label: 'Kapasite', icon: '📊', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Hacim', label: 'Hacim', icon: '🧊', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Model', label: 'Model', icon: '🏷️', marketplaces: ['Trendyol', 'Hepsiburada'] },
    { key: 'Olcu', label: 'Olcu', icon: '📐', marketplaces: ['Trendyol', 'Hepsiburada'] },
  ];
  const key = req.params.key;
  const mpMap: Record<string, typeof attrs> = {
    trendyol: attrs.filter(a => a.marketplaces.includes('Trendyol')),
    hepsiburada: attrs.filter(a => a.marketplaces.includes('Hepsiburada')),
    amazon: attrs.filter(a => a.marketplaces.includes('Amazon')),
    n11: attrs.filter(a => a.marketplaces.includes('N11')),
  };
  return res.json({ items: mpMap[key] || attrs });
});

// ==================== 13. SCREEN (EXCEPTION) ====================
router.get('/screen', requireAuth, async (req, res) => {
  try {
    const xmlSourceId = req.query?.xmlSourceId ? String(req.query.xmlSourceId) : undefined;
    const search = req.query?.search ? String(req.query.search) : undefined;
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));

    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
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
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, sku: true, xmlKey: true, title: true, barcode: true,
          stock: true, status: true, variantMatch: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          xmlSource: { select: { id: true, name: true } },
          variants: { select: { id: true, name: true, value: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const screenProducts = items.map(p => {
      const hasColor = p.variants.some(v => v.name === 'Renk');
      const hasSize = p.variants.some(v => v.name === 'Beden');
      const hasNumber = p.variants.some(v => v.name === 'Numara');
      return {
        id: p.id,
        sku: p.sku,
        xmlKey: p.xmlKey,
        title: p.title,
        barcode: p.barcode,
        brandName: p.brand?.name || null,
        categoryName: p.category?.name || null,
        xmlSourceName: p.xmlSource?.name || null,
        confidence: p.variants.length > 0 ? Math.min(95, 50 + p.variants.length * 15) : 0,
        status: p.variantMatch ? 'AUTO_ACCEPTED' : (p.variants.length > 0 ? 'AUTO_SUGGEST' : 'MANUAL_REVIEW'),
        reason: !p.variantMatch ? (p.variants.length === 0 ? 'Varyant bilgisi bulunamadi' : 'Kismi eslesme') : null,
        suggestedAction: p.variantMatch ? null : 'Otomatik veya manuel eslestirme gerekli',
        hasColor, hasSize, hasNumber,
        parentSku: p.sku ? p.sku.split(/[-_\s]+/)[0] : null,
        groupId: null,
      };
    });

    return res.json({ ok: true, items: screenProducts, total });
  } catch (error) {
    console.error('[variants] GET screen error:', error);
    return res.status(500).json({ ok: false, error: 'Istisna ekrani verileri alinamadi' });
  }
});

// ==================== 14. PROBLEMS ====================
router.get('/problems', requireAuth, async (req, res) => {
  try {
    const search = req.query?.search ? String(req.query.search) : undefined;
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));

    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { xmlKey: { contains: search } },
        { sku: { contains: search } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, sku: true, xmlKey: true, title: true,
          variants: { select: { name: true, value: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const problems = items.map(p => ({
      id: p.id,
      sku: p.sku,
      xmlKey: p.xmlKey,
      title: p.title,
      variantCount: p.variants.length,
      missingAttributes: ['Renk', 'Beden', 'Numara'].filter(attr => !p.variants.some(v => v.name === attr)),
      severity: p.variants.length === 0 ? 'high' : 'medium',
    }));

    return res.json({ ok: true, items: problems, total });
  } catch (error) {
    console.error('[variants] GET problems error:', error);
    return res.status(500).json({ ok: false, error: 'Problem listesi alinamadi' });
  }
});

// ==================== 15. AUTO-MATCH ====================
router.post('/auto-match', requireAuth, async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'productIds array gerekli' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, xmlKey: true, title: true, variants: { select: { name: true, value: true } } },
    });

    const preview: Array<{ productId: string; parentSku: string; groupId: string; confidence: number }> = [];
    let matched = 0;
    let failed = 0;

    for (const product of products) {
      const parentSku = product.sku ? product.sku.split(/[-_\s]+/)[0] : (product.xmlKey || '').split(/[-_\s]+/)[0];
      if (!parentSku) { failed++; continue; }
      const confidence = product.variants.length > 0 ? 90 : 75;
      preview.push({
        productId: product.id,
        parentSku,
        groupId: `V5_AUTO_${Date.now()}_${product.id.substring(0, 6)}`,
        confidence,
      });
      matched++;
    }

    return res.json({ ok: true, matched, failed, preview });
  } catch (error) {
    console.error('[variants] POST auto-match error:', error);
    return res.status(500).json({ ok: false, error: 'Otomatik eslestirme basarisiz' });
  }
});

// ==================== 16. CONFIRM MATCH ====================
router.post('/confirm-match', requireAuth, async (req, res) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ ok: false, error: 'matches array gerekli' });
    }

    const updatedIds: string[] = [];
    for (const match of matches) {
      const { productId } = match;
      if (!productId) continue;
      await prisma.product.update({ where: { id: productId }, data: { variantMatch: true } });
      updatedIds.push(productId);
    }

    await prisma.auditLog.create({
      data: { action: 'V5_CONFIRM_MATCH', entity: 'variant', details: `V5 otomatik eslestirme onayi: ${updatedIds.length} urun`, actorUserId: (req as any).actor?.userId || null },
    });

    return res.json({ ok: true, totalUpdated: updatedIds.length });
  } catch (error) {
    console.error('[variants] POST confirm-match error:', error);
    return res.status(500).json({ ok: false, error: 'Onaylama basarisiz' });
  }
});

// ==================== 17. MANUAL MATCH ====================
router.post('/manual-match', requireAuth, async (req, res) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ ok: false, error: 'matches array gerekli' });
    }

    const allUpdatedIds: string[] = [];
    for (const match of matches) {
      const { productIds } = match;
      if (!Array.isArray(productIds)) continue;
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { variantMatch: true } });
      allUpdatedIds.push(...productIds);
    }

    await prisma.auditLog.create({
      data: { action: 'V5_MANUAL_MATCH', entity: 'variant', details: `V5 manuel eslestirme: ${allUpdatedIds.length} urun`, actorUserId: (req as any).actor?.userId || null },
    });

    return res.json({ ok: true, totalUpdated: allUpdatedIds.length });
  } catch (error) {
    console.error('[variants] POST manual-match error:', error);
    return res.status(500).json({ ok: false, error: 'Manuel eslestirme basarisiz' });
  }
});

// ==================== 18. APPROVE ====================
router.post('/approve', requireAuth, async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'productIds array gerekli' });
    }

    await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { variantMatch: true } });

    await prisma.auditLog.create({
      data: { action: 'V5_APPROVE', entity: 'variant', details: `V5 onay: ${productIds.length} urun`, actorUserId: (req as any).actor?.userId || null },
    });

    return res.json({ ok: true, updated: productIds.length });
  } catch (error) {
    console.error('[variants] POST approve error:', error);
    return res.status(500).json({ ok: false, error: 'Onaylama basarisiz' });
  }
});

// ==================== 19. REANALYZE ====================
router.post('/reanalyze', requireAuth, async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'productIds array gerekli' });
    }

    let analyzed = 0;
    let errors = 0;
    for (const productId of productIds) {
      try {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { id: true, title: true, xmlKey: true, sku: true, variantMatch: true, variants: { select: { name: true, value: true } } },
        });
        if (!product) { errors++; continue; }
        const searchText = [product.title || '', product.xmlKey || '', product.sku || ''].join(' ');
        const detected = detectVariantsFromText(searchText);
        if (detected.length > 0 && !product.variantMatch) {
          for (const v of detected) {
            await prisma.variant.upsert({
              where: { productId_name_value: { productId: product.id, name: v.name, value: v.value } },
              create: { productId: product.id, name: v.name, value: v.value },
              update: {},
            });
          }
          await prisma.product.update({ where: { id: productId }, data: { variantMatch: true } });
        }
        analyzed++;
      } catch {
        errors++;
      }
    }

    return res.json({ ok: true, analyzed, errors });
  } catch (error) {
    console.error('[variants] POST reanalyze error:', error);
    return res.status(500).json({ ok: false, error: 'Yeniden analiz basarisiz' });
  }
});

// ==================== 20. SCAN ====================
router.post('/scan', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req, res) => {
  try {
    const where: any = { variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } };
    const products = await prisma.product.findMany({
      where,
      select: { id: true, title: true, xmlKey: true, sku: true, description: true, detail: true, technicalSpecs: true, variantMatch: true, variants: { select: { id: true, name: true, value: true } } },
      take: 2000,
    });

    let totalDetected = 0;
    let totalProductsWithVariants = 0;
    const variantData: Array<{ productId: string; name: string; value: string }> = [];
    const matchedProductIds: string[] = [];

    for (const product of products) {
      const searchText = [product.title || '', product.xmlKey || '', product.sku || '', product.description || '', product.detail || '', product.technicalSpecs || ''].join(' ');
      const detected = detectVariantsFromText(searchText);
      if (detected.length > 0) {
        matchedProductIds.push(product.id);
        for (const v of detected) {
          const exists = product.variants.some(ev => ev.name === v.name && ev.value === v.value);
          if (!exists) variantData.push({ productId: product.id, name: v.name, value: v.value });
        }
      }
    }

    if (variantData.length > 0) {
      for (let i = 0; i < variantData.length; i += 100) {
        const batch = variantData.slice(i, i + 100);
        await prisma.variant.createMany({ data: batch }).catch(() => null);
        totalDetected += batch.length;
      }
    }

    if (matchedProductIds.length > 0) {
      await prisma.product.updateMany({ where: { id: { in: matchedProductIds } }, data: { variantMatch: true } });
      totalProductsWithVariants = matchedProductIds.length;
    }

    await prisma.auditLog.create({
      data: { action: 'V5_SCAN', entity: 'variant', details: `Tarama: ${totalDetected} varyant, ${totalProductsWithVariants} urun`, actorUserId: (req as any).actor?.userId || null },
    });

    return res.json({
      ok: true,
      totalDetected,
      totalProductsWithVariants,
      totalScanned: products.length,
      message: `${totalDetected} varyant ${totalProductsWithVariants} urunde tespit edildi`,
    });
  } catch (error) {
    console.error('[variants] POST scan error:', error);
    return res.status(500).json({ ok: false, error: 'Tarama basarisiz' });
  }
});

// ==================== 21. LOGS ====================
router.get('/logs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    const items = await prisma.auditLog.findMany({
      where: { entity: 'variant' },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, details: true, createdAt: true, actorUserId: true },
    });
    return res.json({ items });
  } catch (error) {
    console.error('[variants] GET logs error:', error);
    return res.status(500).json({ ok: false, error: 'Loglar alinamadi' });
  }
});

// ==================== 22. THRESHOLDS ====================
router.get('/thresholds', requireAuth, async (_req, res) => {
  try {
    const items = await prisma.variantThreshold.findMany({ orderBy: { key: 'asc' } });
    const map: Record<string, number> = {};
    for (const item of items) map[item.key] = item.value;
    const defaults: Record<string, number> = { auto_accept: 95, auto_suggest: 80, manual: 0 };
    return res.json({ ok: true, items: { ...defaults, ...map } });
  } catch (error) {
    console.error('[variants] GET thresholds error:', error);
    return res.status(500).json({ ok: false, error: 'Esik degerleri alinamadi' });
  }
});

router.put('/thresholds', requireAuth, async (req, res) => {
  try {
    const thresholds = req.body;
    if (!thresholds || typeof thresholds !== 'object') {
      return res.status(400).json({ ok: false, error: 'thresholds body olarak gonderilmelidir' });
    }
    const allowedKeys = ['auto_accept', 'auto_suggest', 'manual'];
    const updated: Record<string, number> = {};
    for (const key of allowedKeys) {
      if (thresholds[key] !== undefined) {
        const value = Number(thresholds[key]);
        if (isNaN(value) || value < 0 || value > 100) {
          return res.status(400).json({ ok: false, error: `${key} degeri 0-100 arasinda olmalidir` });
        }
        await prisma.variantThreshold.upsert({ where: { key }, create: { key, value }, update: { value } });
        updated[key] = value;
      }
    }
    const items = await prisma.variantThreshold.findMany({ orderBy: { key: 'asc' } });
    const map: Record<string, number> = {};
    for (const item of items) map[item.key] = item.value;
    const defaults: Record<string, number> = { auto_accept: 95, auto_suggest: 80, manual: 0 };
    return res.json({ ok: true, items: { ...defaults, ...map }, updated });
  } catch (error) {
    console.error('[variants] PUT thresholds error:', error);
    return res.status(500).json({ ok: false, error: 'Esik degerleri guncellenemedi' });
  }
});

// ==================== 23. UNMATCH (REVERSE) ====================
router.post('/unmatch', requireAuth, async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ ok: false, error: 'productId gerekli' });

    await prisma.product.update({ where: { id: productId }, data: { variantMatch: false, variantStatus: 'WAITING_AI' } });
    await prisma.variant.deleteMany({ where: { productId } });

    await prisma.auditLog.create({
      data: { action: 'VARIANT_UNMATCH', entity: 'variant', details: `Varyant eslesmesi kaldirildi: ${productId}`, actorUserId: (req as any).actor?.userId || null },
    });

    return res.json({ ok: true, message: 'Eslesme kaldirildi' });
  } catch (error) {
    console.error('[variants] POST unmatch error:', error);
    return res.status(500).json({ ok: false, error: 'Eslesme kaldirilamadi' });
  }
});

// ==================== 24. CREATE VARIANT ====================
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, value, productId } = req.body;
    if (!name || !value) return res.status(400).json({ ok: false, error: 'name ve value gerekli' });
    const item = await prisma.variant.create({ data: { name, value, productId: productId || undefined } });
    if (productId) {
      await prisma.product.update({ where: { id: productId }, data: { variantMatch: true } });
    }
    await prisma.auditLog.create({ data: { action: 'VARIANT_CREATE', entity: 'variant', details: `Varyant olusturuldu: ${name}:${value} ${productId ? `(urun: ${productId})` : ''}`, actorUserId: (req as any).actor?.userId || null } });
    return res.status(201).json({ item });
  } catch (error: any) {
    if (error?.code === 'P2002') return res.status(409).json({ ok: false, error: 'Bu varyant zaten mevcut' });
    console.error('[variants] POST error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Varyant olusturulamadi' } });
  }
});

// ==================== 28. AI / WHITELIST VARYANT EŞLEŞTİRME (GERÇEK CATALOG + AI) ====================
router.post('/ai-match', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req, res) => {
  try {
    const xmlSourceId = String(req.query?.xmlSourceId ?? req.body?.xmlSourceId ?? '');
    const marketplaceId = String(req.query?.marketplaceId ?? req.body?.marketplaceId ?? '');
    if (!xmlSourceId || !marketplaceId) {
      return res.status(400).json({ ok: false, error: { code: 'CONTEXT_REQUIRED', message: 'xmlSourceId ve marketplaceId zorunludur' } });
    }

    const marketplace = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { id: true, name: true, key: true } });
    if (!marketplace) return res.status(404).json({ ok: false, error: { code: 'MARKETPLACE_NOT_FOUND', message: 'Pazaryeri bulunamadı' } });

    const limit = Math.min(50, Math.max(1, Number(req.query?.limit ?? req.body?.limit ?? 20)));
    const useAI = String(req.query?.useAI ?? req.body?.useAI ?? '1') !== '0';
    const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds.map(String) : undefined;

    const flow = await runVariantMatchFlow({ xmlSourceId, marketplaceId: marketplace.id, limit, useAI, productIds });

    return res.json({
      ok: flow.ok,
      matchedCount: flow.autoMatched + flow.aiMatched,
      autoMatched: flow.autoMatched,
      aiMatched: flow.aiMatched,
      notRequired: flow.notRequired,
      manualCount: flow.manualReview,
      failedCount: flow.failed,
      remaining: flow.remaining,
      catalogUnavailable: flow.catalogUnavailable,
      message: `${flow.autoMatched} otomatik, ${flow.aiMatched} AI, ${flow.notRequired} varyantsız, ${flow.manualReview} manuel`,
      results: flow.results,
    });
  } catch (error) {
    console.error('[variants] POST ai-match error:', error);
    res.status(500).json({ ok: false, error: { code: 'DB_ERROR', message: 'Varyant AI eşleştirme başarısız' } });
  }
});

// ==================== 24B. MANUEL EŞLEŞTİRME (GERÇEK TRENDYOL ATTRIBUTE/VALUE) ====================
async function resolveTrendyolCategoryExternalId(categoryId: string | null, marketplaceId: string): Promise<number | null> {
  if (!categoryId) return null;
  const mapping = await prisma.categoryMapping.findFirst({
    where: { categoryId, marketplaceId, active: true },
    select: { externalId: true },
    orderBy: { createdAt: 'desc' },
  });
  const parsed = parseInt(String(mapping?.externalId ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Ürüne ait gerçek Trendyol varyant attribute listesi (sahte ID yok; gerçek catalog'dan).
router.get('/manual-options', requireAuth, async (req, res) => {
  try {
    const productId = String(req.query?.productId ?? '');
    const marketplaceId = String(req.query?.marketplaceId ?? '');
    if (!productId || !marketplaceId) return res.status(400).json({ ok: false, error: 'productId ve marketplaceId zorunludur' });
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, title: true, xmlKey: true, sku: true, barcode: true, categoryId: true,
        brand: { select: { name: true } }, customBrandName: true, xmlBrandName: true,
        xmlSource: { select: { id: true, name: true } },
        variants: { select: { name: true, value: true } },
      },
    });
    if (!product) return res.status(404).json({ ok: false, error: 'Ürün bulunamadı' });
    // AKYI/HBT/DGLIVE gibi çöp alanları manuel modalda varyant olarak GÖSTERME.
    const realXmlVariants = (product.variants || []).filter((v) => REAL_VARIANT_NAMES.has(v.name));

    // Mevcut manuel eşleşme (varsa) — aynı ürün tekrar açıldığında "yapılmış" hali gösterilir.
    let existingMatch: { attributeId: number | null; attributeName: string | null; attributeValueId: number | null; attributeValue: string | null } | null = null;
    const analysis = await prisma.variantAnalysis.findFirst({ where: { productId } });
    if (analysis) {
      try {
        const j = JSON.parse(analysis.checkResults || '{}');
        if (j && (j.attributeName || j.attributeValue)) {
          existingMatch = { attributeId: j.attributeId ?? null, attributeName: j.attributeName ?? null, attributeValueId: j.attributeValueId ?? null, attributeValue: j.attributeValue ?? null };
        }
      } catch { /* mevcut eşleşme okunamazsa yok say */ }
    }

    const productInfo = {
      title: product.title,
      xmlKey: product.xmlKey,
      sku: product.sku,
      barcode: product.barcode,
      brandName: product.brand?.name || product.customBrandName || product.xmlBrandName || null,
      xmlSourceName: product.xmlSource?.name || null,
    };

    const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { key: true } });
    if (!mp || mp.key !== 'tt') return res.json({ ok: true, categoryMapped: false, reason: 'MARKETPLACE_NOT_SUPPORTED', ...productInfo, attributes: [], xmlVariants: realXmlVariants, existingMatch });
    const categoryExternalId = await resolveTrendyolCategoryExternalId(product.categoryId, marketplaceId);
    if (categoryExternalId === null) return res.json({ ok: true, categoryMapped: false, reason: 'CATEGORY_MAPPING_NOT_FOUND', ...productInfo, attributes: [], xmlVariants: realXmlVariants, existingMatch });
    const defs = await fetchTrendyolCategoryAttributes(categoryExternalId);
    const attributes = (defs || []).filter((a) => a.varianter || a.slicer).map((a) => ({ attributeId: a.attribute.id, attributeName: a.attribute.name, varianter: a.varianter, slicer: a.slicer, required: a.required }));
    return res.json({ ok: true, categoryMapped: true, categoryExternalId, ...productInfo, attributes, xmlVariants: realXmlVariants, existingMatch });
  } catch (error) {
    console.error('[variants] GET manual-options error:', error);
    return res.status(500).json({ ok: false, error: 'Manuel eşleştirme seçenekleri alınamadı' });
  }
});

// Seçilen gerçek attribute'un gerçek değerleri (sahte valueId üretilmez).
router.get('/manual-values', requireAuth, async (req, res) => {
  try {
    const productId = String(req.query?.productId ?? '');
    const marketplaceId = String(req.query?.marketplaceId ?? '');
    const attributeId = Number(req.query?.attributeId ?? 0);
    if (!productId || !marketplaceId || !Number.isFinite(attributeId) || attributeId <= 0) return res.status(400).json({ ok: false, error: 'productId, marketplaceId ve attributeId zorunludur' });
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
    if (!product) return res.status(404).json({ ok: false, error: 'Ürün bulunamadı' });
    const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { key: true } });
    if (!mp || mp.key !== 'tt') return res.json({ ok: true, values: [] });
    const categoryExternalId = await resolveTrendyolCategoryExternalId(product.categoryId, marketplaceId);
    if (categoryExternalId === null) return res.json({ ok: true, values: [] });
    const values = await fetchTrendyolAttributeValues(categoryExternalId, attributeId);
    return res.json({ ok: true, values: (values || []).map((v) => ({ attributeValueId: v.attributeValueId, attributeValue: v.attributeValue })) });
  } catch (error) {
    console.error('[variants] GET manual-values error:', error);
    return res.status(500).json({ ok: false, error: 'Attribute değerleri alınamadı' });
  }
});

// Manuel eşleştirmeyi GERÇEK Trendyol ID'leriyle kaydeder (fail-closed doğrulama).
router.post('/manual-match-v2', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req, res) => {
  try {
    const productId = String(req.body?.productId ?? '');
    const marketplaceId = String(req.body?.marketplaceId ?? '');
    const attributeId = Number(req.body?.attributeId ?? 0);
    const attributeValueId = Number(req.body?.attributeValueId ?? 0);
    if (!productId || !marketplaceId || !Number.isFinite(attributeId) || attributeId <= 0 || !Number.isFinite(attributeValueId) || attributeValueId <= 0) {
      return res.status(400).json({ ok: false, error: 'productId, marketplaceId, attributeId ve attributeValueId zorunludur' });
    }
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, categoryId: true } });
    if (!product) return res.status(404).json({ ok: false, error: 'Ürün bulunamadı' });
    const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { key: true } });
    if (!mp || mp.key !== 'tt') return res.status(400).json({ ok: false, error: { code: 'MARKETPLACE_NOT_SUPPORTED', message: 'Yalnızca Trendyol manuel eşleştirme desteklenir' } });
    const categoryExternalId = await resolveTrendyolCategoryExternalId(product.categoryId, marketplaceId);
    if (categoryExternalId === null) return res.status(400).json({ ok: false, error: { code: 'CATEGORY_MAPPING_NOT_FOUND', message: 'Trendyol kategori eşlemesi yok' } });

    // FAIL-CLOSED: attributeId gerçek kategori attribute listesinde olmalı.
    const defs = await fetchTrendyolCategoryAttributes(categoryExternalId);
    const attrDef = defs.find((a) => a.attribute.id === attributeId && (a.varianter || a.slicer));
    if (!attrDef) return res.status(400).json({ ok: false, error: { code: 'INVALID_ATTRIBUTE', message: 'Attribute gerçek kategori ağacında bulunamadı' } });

    // FAIL-CLOSED: attributeValueId gerçek value listesinde olmalı (sahte ID reddedilir).
    const values = await fetchTrendyolAttributeValues(categoryExternalId, attributeId);
    const valueHit = values.find((v) => v.attributeValueId === attributeValueId);
    if (!valueHit) return res.status(400).json({ ok: false, error: { code: 'INVALID_VALUE', message: 'Değer gerçek kategori ağacında bulunamadı' } });

    const variantName = attrDef.attribute.name;
    const variantValue = valueHit.attributeValue;
    await prisma.variant.upsert({
      where: { productId_name_value: { productId, name: variantName, value: variantValue } },
      create: { productId, name: variantName, value: variantValue },
      update: {},
    });
    await prisma.product.update({ where: { id: productId }, data: { variantMatch: true, variantStatus: 'COMPLETED', matchedBy: 'manual', lastMatchDate: new Date() } });

    const existing = await prisma.variantAnalysis.findFirst({ where: { productId } });
    const analysisData = {
      source: 'manual',
      status: 'MATCHED',
      confidence: 100,
      validationPassed: true,
      autoFixAttempted: false,
      autoFixResult: 'matched',
      checkResults: JSON.stringify({ marketplaceName: 'Trendyol', categoryId: categoryExternalId, attributeId, attributeValueId, attributeName: variantName, attributeValue: variantValue }),
    };
    if (existing) await prisma.variantAnalysis.update({ where: { id: existing.id }, data: analysisData });
    else await prisma.variantAnalysis.create({ data: { productId, ...analysisData } });

    await prisma.auditLog.create({ data: { action: 'V5_MANUAL_MATCH_V2', entity: 'variant', details: `Manuel eşleştirme: ${variantName}=${variantValue} (attr ${attributeId}, val ${attributeValueId})`, actorUserId: (req as any).actor?.userId || null } });

    return res.json({ ok: true, productId, attributeId, attributeName: variantName, attributeValueId, attributeValue: variantValue });
  } catch (error) {
    console.error('[variants] POST manual-match-v2 error:', error);
    return res.status(500).json({ ok: false, error: 'Manuel eşleştirme kaydedilemedi' });
  }
});

// ==================== 25. GET SINGLE VARIANT ====================
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const item = await prisma.variant.findUnique({
      where: { id: String(req.params.id) },
      include: { product: { select: { id: true, title: true, xmlKey: true, sku: true, images: true, salePrice: true, stock: true } } },
    });
    if (!item) return res.status(404).json({ ok: false, error: 'Varyant bulunamadi' });
    return res.json({ item });
  } catch (error) {
    console.error('[variants] GET /:id error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Varyant getirilemedi' } });
  }
});

// ==================== 26. UPDATE VARIANT ====================
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, value } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (value !== undefined) data.value = value;
    const item = await prisma.variant.update({ where: { id: String(req.params.id) }, data });
    await prisma.auditLog.create({ data: { action: 'VARIANT_UPDATE', entity: 'variant', details: `Varyant guncellendi: ${item.name}:${item.value}`, actorUserId: (req as any).actor?.userId || null } });
    return res.json({ item });
  } catch (error) {
    console.error('[variants] PUT /:id error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Varyant guncellenemedi' } });
  }
});

// ==================== 27. DELETE VARIANT ====================
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const item = await prisma.variant.findUnique({ where: { id }, select: { id: true, name: true, value: true } });
    if (!item) return res.status(404).json({ ok: false, error: 'Varyant bulunamadi' });
    await prisma.variant.delete({ where: { id } });
    await prisma.auditLog.create({ data: { action: 'VARIANT_DELETE', entity: 'variant', details: `Varyant silindi: ${item.name}:${item.value}`, actorUserId: (req as any).actor?.userId || null } });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[variants] DELETE error:', error);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Varyant silinemedi' } });
  }
});

export default router;
