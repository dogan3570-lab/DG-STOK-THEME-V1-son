import { Router } from 'express';
import { prisma } from '../db/prisma.ts';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/authMiddleware.ts';

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
    default: return Math.round(price * 100) / 100;
  }
}

function calculatePriceV5(purchasePrice: number, vatRate: number, rule: any) {
  const steps: Array<{ step: number; name: string; before: number; after: number; formula: string }> = [];
  let currentPrice = purchasePrice;
  const profitMargin = rule.profitMargin ?? 0;
  const applyVat = rule.applyVat !== false;
  const rounding = rule.rounding || 'none';
  const minPrice = rule.minPrice ?? 0;
  const maxPrice = rule.maxPrice ?? 999999;

  steps.push({ step: 1, name: 'XML Alış Fiyatı', before: 0, after: currentPrice, formula: `Alış: ${currentPrice} TL` });

  if (applyVat && vatRate > 0) {
    const before = currentPrice;
    currentPrice = Math.round(currentPrice * (1 + vatRate / 100) * 100) / 100;
    steps.push({ step: 2, name: 'KDV Uygula', before, after: currentPrice, formula: `${before} × (1 + ${vatRate}%)` });
  } else {
    steps.push({ step: 2, name: 'KDV Uygula (Yok)', before: currentPrice, after: currentPrice, formula: 'KDV eklenmedi' });
  }

  if (profitMargin > 0) {
    const before = currentPrice;
    currentPrice = Math.round(currentPrice * (1 + profitMargin / 100) * 100) / 100;
    steps.push({ step: 3, name: 'Kâr Oranı', before, after: currentPrice, formula: `${before} × (1 + ${profitMargin}%)` });
  } else {
    steps.push({ step: 3, name: 'Kâr Oranı (Yok)', before: currentPrice, after: currentPrice, formula: 'Kâr eklenmedi' });
  }

  if (rounding !== 'none') {
    const before = currentPrice;
    currentPrice = applyRounding(currentPrice, rounding);
    steps.push({ step: 4, name: 'Yuvarlama', before, after: currentPrice, formula: `${before} → ${rounding}` });
  } else {
    steps.push({ step: 4, name: 'Yuvarlama (Yok)', before: currentPrice, after: currentPrice, formula: 'Yuvarlama yok' });
  }

  if (currentPrice < minPrice) currentPrice = minPrice;
  if (currentPrice > maxPrice) currentPrice = maxPrice;

  const finalPrice = Math.round(currentPrice * 100) / 100;

  return {
    purchasePrice,
    vatRate,
    vatIncludedPrice: steps[1]?.after || purchasePrice,
    profitMargin,
    calculatedPrice: steps[2]?.after || purchasePrice,
    roundedPrice: finalPrice,
    rounding,
    rule: rule as any,
    ruleType: (rule as any).ruleType || 'GENERAL',
    steps,
  };
}

async function findBestRule(productId: string, categoryId: string | null, marketplaceId: string) {
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

  for (const rule of rules) {
    if (rule.productId === productId) return { rule, ruleType: 'PRODUCT' as const };
  }
  for (const rule of rules) {
    if (rule.categoryId && rule.categoryId === categoryId) return { rule, ruleType: 'CATEGORY' as const };
  }
  for (const rule of rules) {
    if (!rule.productId && !rule.categoryId) return { rule, ruleType: 'GENERAL' as const };
  }
  return { rule: null, ruleType: 'NONE' as const };
}

// ==================== KURAL CRUD ====================

router.get('/rules', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const where: any = {};
    if (req.query.marketplaceId) where.marketplaceId = req.query.marketplaceId;
    const rules = await prisma.marketplacePricingRule.findMany({ where, orderBy: { priority: 'asc' } });
    res.json({ items: rules });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/rules', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: AuthedRequest, res: any) => {
  try {
    if (!req.body.marketplaceId) {
      return res.status(400).json({ error: 'marketplaceId alanı zorunludur' });
    }
    const rule = await prisma.marketplacePricingRule.create({ data: req.body });
    res.status(201).json({ item: rule });
  } catch (e) { handleRouteError(res, e); }
});

router.put('/rules/:id', requireAuth, requireRole(['ADMIN', 'OPERATOR']), async (req: AuthedRequest, res: any) => {
  try {
    const existing = await prisma.marketplacePricingRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Kural bulunamadı' });
    const rule = await prisma.marketplacePricingRule.update({ where: { id: String(req.params.id) }, data: req.body });
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

// ==================== FİYAT HESAPLAMA ====================

router.post('/calculate', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const { purchasePrice, vatRate, profitMargin, rounding, applyVat } = req.body || {};

    // Validate required fields
    if (purchasePrice === undefined || purchasePrice === null) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'purchasePrice zorunludur' } });
    }
    if (vatRate === undefined || vatRate === null) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'vatRate zorunludur' } });
    }

    const pp = Number(purchasePrice);
    const vr = Number(vatRate);

    if (!Number.isFinite(pp) || pp < 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz purchasePrice' } });
    }
    if (!Number.isFinite(vr) || vr < 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Geçersiz vatRate' } });
    }

    const profitM = profitMargin !== undefined ? Number(profitMargin) : 0;
    const round = rounding || 'none';
    const apply = applyVat !== false;

    const result = calculatePriceV5(pp, vr, { profitMargin: profitM, rounding: round, applyVat: apply, minPrice: 0, maxPrice: 999999 });
    res.json({ vatIncluded: result.vatIncludedPrice, beforeRounding: result.calculatedPrice, finalPrice: result.roundedPrice });
  } catch (e) { handleRouteError(res, e); }
});

// ==================== ÜRÜN FİYATI ====================

router.get('/price/:productId/:marketplaceId', requireAuth, async (req: AuthedRequest, res: any) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.productId) },
      select: { id: true, purchasePrice: true, vatRate: true, categoryId: true },
    });

    if (!product || !product.purchasePrice) {
      return res.json({ purchasePrice: 0, vatRate: 20, vatIncludedPrice: 0, profitMargin: 0, calculatedPrice: 0, roundedPrice: 0, rounding: 'none', rule: null, ruleType: 'NONE' });
    }

    const vatRate = product.vatRate ?? 20;
    const { rule, ruleType } = await findBestRule(product.id, product.categoryId, String(req.params.marketplaceId));

    if (!rule) {
      return res.json({ purchasePrice: product.purchasePrice, vatRate, vatIncludedPrice: 0, profitMargin: 0, calculatedPrice: product.purchasePrice, roundedPrice: product.purchasePrice, rounding: 'none', rule: null, ruleType: 'NONE' });
    }

    const calc = calculatePriceV5(product.purchasePrice, vatRate, { ...rule, ruleType });
    res.json(calc);
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
          select: { id: true, title: true, purchasePrice: true, vatRate: true, categoryId: true },
        });

        if (!product || !product.purchasePrice) {
          results.push({ productId, productTitle: null, marketplaceId, calculation: null, status: 'ERROR', errorMessage: 'Ürün bulunamadı veya alış fiyatı yok' });
          errorCount++;
          continue;
        }

        const vatRate = product.vatRate ?? 20;
        const { rule, ruleType } = await findBestRule(product.id, product.categoryId, marketplaceId);

        let calc;
        if (!rule) {
          calc = { purchasePrice: product.purchasePrice, vatRate, vatIncludedPrice: 0, profitMargin: 0, calculatedPrice: product.purchasePrice, roundedPrice: product.purchasePrice, rounding: 'none', rule: null, ruleType: 'NONE' };
        } else {
          calc = calculatePriceV5(product.purchasePrice, vatRate, { ...rule, ruleType });
        }

        await prisma.listingLog.create({
          data: {
            productId, marketplaceId,
            ruleId: (calc.rule as any)?.id ?? null,
            ruleType: calc.ruleType,
            purchasePrice: calc.purchasePrice,
            vatIncludedPrice: calc.vatIncludedPrice,
            profitMargin: calc.profitMargin,
            rounding: calc.rounding,
            calculatedPrice: calc.roundedPrice,
            status: 'SUCCESS',
          },
        });

        results.push({ productId, productTitle: product.title, marketplaceId, calculation: calc, status: 'SUCCESS' });
        successCount++;
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
