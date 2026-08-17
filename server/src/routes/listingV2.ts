import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';
import { computeVatIncludedPurchasePrice } from './products.ts';

const router = Router();

function handleRouteError(res: any, e: any) {
  const statusCode = e.statusCode || 500;
  res.status(statusCode).json({ error: e.message || String(e) });
}

function applyRounding(price: number, rounding: string): number {
  switch (rounding) {
    case '0.90': return Math.floor(price) + 0.90;
    case '0.95': return Math.floor(price) + 0.95;
    case '0.99': return Math.floor(price) + 0.99;
    case '9.90': return Math.floor(price / 10) * 10 + 9.90;
    case '49.90': return Math.floor(price / 50) * 50 + 49.90;
    case '99.90': return Math.floor(price / 100) * 100 + 99.90;
    case 'nearest': return Math.round(price);
    case 'ceil': return Math.ceil(price);
    case 'floor': return Math.floor(price);
    default: return price;
  }
}

/**
 * TEK AUTHORITATIVE LİSTELEME FİYAT FORMÜLÜ.
 * Girdi: KDV DAHİL alış fiyatı (KDV ikinci kez EKLENMEZ).
 *   listelemeFiyati = kdvDahilAlis × (1 + kâr%/100) + sabitEk
 */
function computeListingPrice(vatIncludedPurchase: number, rule: {
  profitMargin?: number | null;
  fixedAmount?: number | null;
  rounding?: string | null;
}): number {
  const profit = Number(rule.profitMargin ?? 0);
  const fixed = Number(rule.fixedAmount ?? 0);
  const rounding = rule.rounding || 'none';
  const raw = vatIncludedPurchase * (1 + profit / 100) + fixed;
  if (!Number.isFinite(raw)) return 0;
  const rounded = applyRounding(raw, rounding);
  return Math.round(rounded * 100) / 100;
}

/** İki alış fiyatı bandının çakışıp çakışmadığı (max=0 → üst sınır yok). */
function bandOverlaps(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  const aHi = aMax === 0 ? Number.POSITIVE_INFINITY : aMax;
  const bHi = bMax === 0 ? Number.POSITIVE_INFINITY : bMax;
  return aMin <= bHi && bMin <= aHi;
}

/**
 * Kural seçimi: TEK ÜRÜN → KATEGORİ → GENEL.
 * Her seviyede XML izolasyonu (xmlSourceId) ve KDV dahil alış fiyatı MIN/MAX bandı kontrol edilir.
 * Uymayan seviye güvenle atlanır (fallback).
 */
async function findBestRule(
  productId: string,
  categoryId: string | null,
  marketplaceId: string,
  xmlSourceId: string | null,
  vatIncludedPurchase: number,
) {
  const rules = await prisma.marketplacePricingRule.findMany({
    where: {
      marketplaceId,
      active: true,
      OR: [
        { productId },
        { categoryId: categoryId ?? undefined },
        { productId: null, categoryId: null },
      ],
    },
    orderBy: { priority: 'asc' },
  });

  const matchesXml = (r: { xmlSourceId: string | null }) => r.xmlSourceId === null || r.xmlSourceId === xmlSourceId;
  const inBand = (r: { minPrice: number; maxPrice: number }) => {
    const min = Number(r.minPrice ?? 0);
    const max = Number(r.maxPrice ?? 0);
    return vatIncludedPurchase >= min && (max === 0 || vatIncludedPurchase <= max);
  };

  for (const rule of rules) if (rule.productId === productId && matchesXml(rule) && inBand(rule)) return { rule, ruleType: 'PRODUCT' as const };
  for (const rule of rules) if (rule.categoryId && rule.categoryId === categoryId && matchesXml(rule) && inBand(rule)) return { rule, ruleType: 'CATEGORY' as const };
  for (const rule of rules) if (!rule.productId && !rule.categoryId && matchesXml(rule) && inBand(rule)) return { rule, ruleType: 'GENERAL' as const };
  return { rule: null, ruleType: 'NONE' as const };
}

// ==================== KURAL CRUD ====================

router.get('/rules', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const where: any = {};
    if (req.query.marketplaceId) where.marketplaceId = req.query.marketplaceId;
    if (req.query.xmlSourceId) where.xmlSourceId = req.query.xmlSourceId;
    const rules = await prisma.marketplacePricingRule.findMany({ where, orderBy: { priority: 'asc' } });
    res.json({ items: rules });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/rules', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: AuthedRequest, res: any) => {
  try {
    const {
      marketplaceId, xmlSourceId = null, productId = null, categoryId = null,
      minPrice = 0, maxPrice = 0, profitMargin = 0, fixedAmount = 0,
      rounding = 'none', active = true, priority = 3,
    } = req.body || {};

    if (!marketplaceId) {
      return res.status(400).json({ error: 'marketplaceId alanı zorunludur' });
    }

    const min = Number(minPrice);
    const max = Number(maxPrice);
    const profit = Number(profitMargin);
    const fixed = Number(fixedAmount);

    // KAPSAM: productId veya categoryId veya genel (ikisi birden null). İkisi birden dolu olamaz.
    if (productId && categoryId) {
      return res.status(400).json({ error: 'Kural hem ürüne hem kategoriye bağlanamaz; tek kapsam seçin' });
    }

    if (!Number.isFinite(min) || min < 0) return res.status(400).json({ error: 'minPrice 0 veya pozitif olmalıdır' });
    if (!Number.isFinite(max) || max < 0) return res.status(400).json({ error: 'maxPrice 0 (sınırsız) veya pozitif olmalıdır' });
    if (max !== 0 && min > max) return res.status(400).json({ error: 'minPrice maxPrice değerinden büyük olamaz' });
    if (!Number.isFinite(profit) || profit < 0) return res.status(400).json({ error: 'profitMargin geçersiz (0 veya pozitif olmalı)' });
    if (!Number.isFinite(fixed) || fixed < 0) return res.status(400).json({ error: 'fixedAmount negatif olamaz' });

    // FAIL-SAFE: aynı kapsam + marketplace + xmlSourceId + çakışan bant → 409 (belirsizlik engellenir)
    const existing = await prisma.marketplacePricingRule.findMany({
      where: {
        marketplaceId,
        active: true,
        xmlSourceId: xmlSourceId ?? null,
        productId: productId ?? null,
        categoryId: categoryId ?? null,
      },
    });
    const conflict = existing.find((e) => bandOverlaps(Number(e.minPrice), Number(e.maxPrice), min, max));
    if (conflict) {
      return res.status(409).json({ error: 'Aynı kapsamda çakışan bir fiyat kuralı zaten var (min/max bandı örtüşüyor)' });
    }

    const rule = await prisma.marketplacePricingRule.create({
      data: {
        marketplaceId,
        xmlSourceId: xmlSourceId ?? null,
        productId: productId ?? null,
        categoryId: categoryId ?? null,
        minPrice: min,
        maxPrice: max,
        fixedAmount: fixed,
        profitMargin: profit,
        rounding: rounding || 'none',
        active,
        priority: Number(priority) || 3,
      },
    });
    res.status(201).json({ item: rule });
  } catch (e) { handleRouteError(res, e); }
});

router.put('/rules/:id', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: AuthedRequest, res: any) => {
  try {
    const existing = await prisma.marketplacePricingRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Kural bulunamadı' });

    const patch: any = {};
    const numFields = ['minPrice', 'maxPrice', 'profitMargin', 'fixedAmount', 'priority'] as const;
    for (const f of numFields) {
      if (req.body[f] !== undefined) {
        const v = Number(req.body[f]);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${f} geçersiz` });
        patch[f] = v;
      }
    }
    if (patch.minPrice !== undefined && patch.maxPrice !== undefined && patch.maxPrice !== 0 && patch.minPrice > patch.maxPrice) {
      return res.status(400).json({ error: 'minPrice maxPrice değerinden büyük olamaz' });
    }
    for (const f of ['xmlSourceId', 'productId', 'categoryId', 'rounding'] as const) {
      if (req.body[f] !== undefined) patch[f] = req.body[f] || null;
    }
    if (req.body.active !== undefined) patch.active = !!req.body.active;

    const rule = await prisma.marketplacePricingRule.update({ where: { id: String(req.params.id) }, data: patch });
    res.json({ item: rule });
  } catch (e) { handleRouteError(res, e); }
});

router.delete('/rules/:id', requireAuth, requireRole(['ADMIN']), async (req: AuthedRequest, res: any) => {
  try {
    const existing = await prisma.marketplacePricingRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Kural bulunamadı' });
    await prisma.marketplacePricingRule.delete({ where: { id: String(req.params.id) } });
    res.json({ ok: true });
  } catch (e) { handleRouteError(res, e); }
});

// ==================== FİYAT HESAPLAMA (KDV dahil girdi) ====================

router.post('/calculate', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const { vatIncludedPurchase, profitMargin, fixedAmount, rounding } = req.body || {};
    const vatIncluded = Number(vatIncludedPurchase);
    if (!Number.isFinite(vatIncluded) || vatIncluded <= 0) {
      return res.status(400).json({ error: { code: 'PRICE_DATA_MISSING', message: 'KDV dahil alış fiyatı geçersiz (0, negatif, null)' } });
    }
    const profit = Number(profitMargin ?? 0);
    const fixed = Number(fixedAmount ?? 0);
    if (!Number.isFinite(profit) || profit < 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Kâr oranı geçersiz' } });
    if (!Number.isFinite(fixed) || fixed < 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Sabit ek geçersiz' } });

    const finalPrice = computeListingPrice(vatIncluded, { profitMargin: profit, fixedAmount: fixed, rounding: rounding || 'none' });
    res.json({
      vatIncludedPurchase: Math.round(vatIncluded * 100) / 100,
      profitMargin: profit,
      fixedAmount: fixed,
      finalPrice,
      formula: `${vatIncluded} × (1 + ${profit}/100) + ${fixed} = ${finalPrice}`,
    });
  } catch (e) { handleRouteError(res, e); }
});

// ==================== ÜRÜN FİYATI ====================

router.get('/price/:productId/:marketplaceId', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.productId) },
      select: {
        id: true, purchasePrice: true, salePrice: true, vatRate: true, categoryId: true, xmlSourceId: true,
        xmlSource: { select: { vatRate: true, purchasePriceVatStatus: true } },
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    const vatIncludedPurchase = computeVatIncludedPurchasePrice(product, product.xmlSource);
    if (!Number.isFinite(vatIncludedPurchase) || vatIncludedPurchase <= 0) {
      return res.json({ productId: product.id, vatIncludedPurchase: 0, listingPrice: null, rule: null, ruleType: 'NONE', status: 'PRICE_DATA_MISSING' });
    }

    const { rule, ruleType } = await findBestRule(product.id, product.categoryId, String(req.params.marketplaceId), product.xmlSourceId, vatIncludedPurchase);
    if (!rule) {
      return res.json({ productId: product.id, vatIncludedPurchase, listingPrice: null, rule: null, ruleType: 'NONE', status: 'PRICE_RULE_NOT_FOUND' });
    }

    const listingPrice = computeListingPrice(vatIncludedPurchase, rule);
    res.json({
      productId: product.id,
      vatIncludedPurchase,
      listingPrice,
      rule: { id: rule.id, marketplaceId: rule.marketplaceId, xmlSourceId: rule.xmlSourceId, productId: rule.productId, categoryId: rule.categoryId, minPrice: rule.minPrice, maxPrice: rule.maxPrice, profitMargin: rule.profitMargin, fixedAmount: rule.fixedAmount, rounding: rule.rounding },
      ruleType,
      status: 'OK',
    });
  } catch (e) { handleRouteError(res, e); }
});

// ==================== TOPLU LİSTELEME ====================

router.post('/bulk-list', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: AuthedRequest, res: any) => {
  try {
    const { marketplaceId, productIds } = req.body;
    if (!marketplaceId || !productIds?.length) {
      return res.status(400).json({ error: 'marketplaceId ve productIds gerekli' });
    }

    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const productId of productIds.slice(0, 10000)) {
      try {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: {
            id: true, title: true, purchasePrice: true, salePrice: true, vatRate: true, categoryId: true, xmlSourceId: true,
            xmlSource: { select: { vatRate: true, purchasePriceVatStatus: true } },
          },
        });

        if (!product) {
          results.push({ productId, productTitle: null, marketplaceId, calculation: null, status: 'ERROR', errorMessage: 'Ürün bulunamadı' });
          errorCount++;
          continue;
        }

        const vatIncludedPurchase = computeVatIncludedPurchasePrice(product, product.xmlSource);
        if (!Number.isFinite(vatIncludedPurchase) || vatIncludedPurchase <= 0) {
          results.push({ productId, productTitle: product.title, marketplaceId, calculation: null, status: 'ERROR', errorMessage: 'KDV dahil alış fiyatı geçersiz' });
          errorCount++;
          continue;
        }

        const { rule, ruleType } = await findBestRule(product.id, product.categoryId, marketplaceId, product.xmlSourceId, vatIncludedPurchase);
        const listingPrice = rule ? computeListingPrice(vatIncludedPurchase, rule) : null;

        await prisma.listingLog.create({
          data: {
            productId, marketplaceId,
            ruleId: rule?.id ?? null,
            ruleType,
            purchasePrice: vatIncludedPurchase,
            vatIncludedPrice: vatIncludedPurchase,
            profitMargin: rule?.profitMargin ?? 0,
            rounding: rule?.rounding ?? 'none',
            calculatedPrice: listingPrice ?? 0,
            status: listingPrice != null ? 'SUCCESS' : 'ERROR',
            errorMessage: listingPrice != null ? null : 'Uygun fiyat kuralı bulunamadı',
          },
        });

        results.push({ productId, productTitle: product.title, marketplaceId, calculation: { vatIncludedPurchase, listingPrice, ruleType }, status: listingPrice != null ? 'SUCCESS' : 'ERROR' });
        if (listingPrice != null) successCount++; else errorCount++;
      } catch (err) {
        results.push({ productId, productTitle: null, marketplaceId, calculation: null, status: 'ERROR', errorMessage: String(err) });
        errorCount++;
      }
    }

    res.json({ results, successCount, errorCount });
  } catch (e) { handleRouteError(res, e); }
});

// ==================== LOGLAR ====================

router.get('/logs', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const where: any = {};
    if (req.query.marketplaceId) where.marketplaceId = req.query.marketplaceId;
    const logs = await prisma.listingLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(req.query.limit) || 100,
    });
    res.json({ items: logs });
  } catch (e) { handleRouteError(res, e); }
});

export default router;
