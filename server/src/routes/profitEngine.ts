import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../auth/authMiddleware.ts';
import { ProfitCalculator } from '../core/calculator/index.ts';
import { AnomalyDetector } from '../core/engine/anomaly.ts';
import { LearningEngine } from '../core/engine/learning.ts';
import { CommercialLearningEngine } from '../core/engine/commercial-learning.ts';
import { DataSource } from '../shared/types/index.ts';
import { prisma } from '../db/prisma.ts';

const router = Router();

const anomalyDetector = new AnomalyDetector();
const learningEngine = new LearningEngine();
const commercialLearning = new CommercialLearningEngine(learningEngine);

// ─── VARSAYilan ORANLAR (DB'de kayitli komisyon/kargo verisi yoksa kullanilir) ───
const DEFAULT_RATES = {
  trendyol: { commission: 12, shipping: 8, serviceFee: 2, stopaj: 1, vatRate: 20 },
  hepsiburada: { commission: 14, shipping: 10, serviceFee: 2, stopaj: 1, vatRate: 20 },
  n11: { commission: 10, shipping: 9, serviceFee: 2, stopaj: 1, vatRate: 20 },
  amazon: { commission: 15, shipping: 12, serviceFee: 3, stopaj: 1, vatRate: 20 },
  default: { commission: 12, shipping: 10, serviceFee: 2, stopaj: 1, vatRate: 20 },
};

function getRatesForMarketplace(key: string | null) {
  if (!key) return DEFAULT_RATES.default;
  const k = key.toLowerCase().replace(/\s+/g, '');
  if (k.includes('trendyol') || k === 'tt') return DEFAULT_RATES.trendyol;
  if (k.includes('hepsiburada') || k === 'hb') return DEFAULT_RATES.hepsiburada;
  if (k.includes('n11')) return DEFAULT_RATES.n11;
  if (k.includes('amazon')) return DEFAULT_RATES.amazon;
  return DEFAULT_RATES.default;
}

function fmt(n: number) { return Math.round(n * 100) / 100; }

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/profit-engine/calculate — Mevcut ProfitCalculator BigInt motoru
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/calculate', requireAuth, async (req: Request, res: Response) => {
  try {
    const input = req.body;
    const requiredFields = ['grossSales', 'productCost', 'commission', 'shippingCost', 'serviceFee', 'stopaj', 'advertising', 'marketing', 'returnCost', 'otherExpenses', 'vatRate'];
    for (const field of requiredFields) {
      if (input[field] === undefined) {
        return res.status(400).json({ ok: false, error: `Missing field: ${field}` });
      }
    }
    const result = ProfitCalculator.calculate(
      {
        grossSalesCents: BigInt(Math.round(input.grossSales * 100)),
        discountCents: BigInt(Math.round((input.discount || 0) * 100)),
        productCostCents: BigInt(Math.round(input.productCost * 100)),
        commissionCents: BigInt(Math.round(input.commission * 100)),
        shippingCostCents: BigInt(Math.round(input.shippingCost * 100)),
        serviceFeeCents: BigInt(Math.round((input.serviceFee || 0) * 100)),
        stopajCents: BigInt(Math.round((input.stopaj || 0) * 100)),
        advertisingCents: BigInt(Math.round((input.advertising || 0) * 100)),
        marketingCents: BigInt(Math.round((input.marketing || 0) * 100)),
        returnCostCents: BigInt(Math.round((input.returnCost || 0) * 100)),
        otherExpensesCents: BigInt(Math.round((input.otherExpenses || 0) * 100)),
        vatRate: input.vatRate || 20,
      },
      { source: DataSource.MANUAL, sourceId: null, timestamp: new Date(), confidence: 1.0 }
    );
    return res.json({
      ok: true,
      data: {
        grossSales: Number(result.grossSalesCents) / 100,
        discount: Number(result.discountCents) / 100,
        netSales: Number(result.netSalesCents) / 100,
        productCost: Number(result.productCostCents) / 100,
        commission: Number(result.commissionCents) / 100,
        shippingCost: Number(result.shippingCostCents) / 100,
        serviceFee: Number(result.serviceFeeCents) / 100,
        stopaj: Number(result.stopajCents) / 100,
        advertising: Number(result.advertisingCents) / 100,
        marketing: Number(result.marketingCents) / 100,
        returnCost: Number(result.returnCostCents) / 100,
        otherExpenses: Number(result.otherExpensesCents) / 100,
        vatPayable: Number(result.vatPayableCents || 0n) / 100,
        operationalProfit: Number(result.operationalProfitCents) / 100,
        netProfit: Number(result.netProfitCents) / 100,
        profitMargin: result.profitMargin,
        roi: result.roi,
        currency: result.currency,
        calculationVersion: result.calculationVersion,
        calculatedAt: result.calculatedAt,
        source: result.source,
      },
    });
  } catch (error) {
    console.error('[profit-engine/calculate]', error);
    return res.status(500).json({ ok: false, error: { code: 'CALCULATION_ERROR', message: error instanceof Error ? error.message : 'Calculation failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/dashboard — Dönemsel dashboard (BUGÜN/HAFTA/AY/YIL)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/dashboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'all';
    const now = new Date();
    let startDate: Date | null = null;

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    const orderWhere = startDate ? { createdAt: { gte: startDate } } : {};

    const [products, orders, marketplaces, pricingRules] = await Promise.all([
      prisma.product.findMany({
        select: {
          id: true, title: true, sku: true, salePrice: true, purchasePrice: true,
          profitMargin: true, stock: true, vatRate: true, status: true,
        },
      }),
      prisma.order.findMany({
        select: { id: true, total: true, status: true, createdAt: true, marketplaceId: true },
        where: orderWhere,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.marketplace.findMany({ select: { id: true, name: true, key: true, active: true } }),
      prisma.marketplacePricingRule.findMany({
        select: { marketplaceId: true, profitMargin: true, minPrice: true, maxPrice: true },
        where: { active: true },
      }),
    ]);

    const orderCount = orders.length;
    const productCount = products.length;
    const activeMarketplaces = marketplaces.filter(m => m.active);

    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    const productsWithCost = products.filter(p => p.purchasePrice != null && p.purchasePrice > 0);
    const productsWithPrice = products.filter(p => p.salePrice != null && p.salePrice > 0);

    const returnOrders = orders.filter(o => o.status === 'returned' || o.status === 'cancelled');
    const returnCount = returnOrders.length;
    const returnRate = orderCount > 0 ? fmt(returnCount / orderCount * 100) : 0;
    const avgOrderValue = orderCount > 0 ? fmt(totalRevenue / orderCount) : 0;

    // Ürün bazlı kârlılık hesapla — SADECE purchasePrice mevcut ürünlerde kesin hesaplama
    const productProfits = productsWithPrice.map(p => {
      const hasCost = p.purchasePrice != null && p.purchasePrice > 0;
      const cost = hasCost ? p.purchasePrice! : null;
      const sale = p.salePrice || 0;
      const grossProfit = hasCost ? fmt(sale - cost!) : null;
      const margin = (hasCost && sale > 0) ? fmt((sale - cost!) / sale * 100) : null;
      const rates = DEFAULT_RATES.default;
      const estCommission = fmt(sale * rates.commission / 100);
      const estShipping = fmt(rates.shipping);
      const estServiceFee = fmt(rates.serviceFee);
      const estStopaj = fmt(sale * rates.stopaj / 100);
      const vatRate = p.vatRate || rates.vatRate;
      const vatAmount = fmt(sale * vatRate / 100);
      const netProfit = hasCost ? fmt(grossProfit! - estCommission - estShipping - estServiceFee - estStopaj - vatAmount) : null;
      const roi = (hasCost && cost! > 0) ? fmt(netProfit! / cost! * 100) : null;
      return {
        productId: p.id, sku: p.sku || '—', title: p.title || '—',
        salePrice: sale, purchasePrice: cost,
        hasCostData: hasCost,
        grossProfit, margin,
        estCommission, estShipping, estServiceFee, estStopaj, vatAmount,
        netProfit, roi, stock: p.stock || 0, vatRate,
      };
    });

    const profitableProducts = productProfits.filter(p => p.hasCostData && p.netProfit != null && p.netProfit > 0);
    const lossProducts = productProfits.filter(p => p.hasCostData && p.netProfit != null && p.netProfit < 0);
    const breakEvenProducts = productProfits.filter(p => p.hasCostData && p.netProfit === 0);
    const unknownCostProducts = productProfits.filter(p => !p.hasCostData);

    const totalStockValue = productsWithCost.reduce((s, p) => s + (p.purchasePrice! * (p.stock || 0)), 0);
    const totalPotentialRevenue = productsWithPrice.reduce((s, p) => s + (p.salePrice! * (p.stock || 0)), 0);
    const costKnownProducts = productProfits.filter(p => p.hasCostData);
    const avgMargin = costKnownProducts.length > 0
      ? fmt(costKnownProducts.reduce((s, p) => s + (p.margin || 0), 0) / costKnownProducts.length) : null;
    const avgNetProfit = costKnownProducts.length > 0
      ? fmt(costKnownProducts.reduce((s, p) => s + (p.netProfit || 0), 0) / costKnownProducts.length) : null;

    return res.json({
      ok: true,
      data: {
        period,
        generatedAt: now.toISOString(),
        summary: {
          totalRevenue,
          realizedRevenue: fmt(totalRevenue),
          potentialRevenue: fmt(totalPotentialRevenue),
          orderCount,
          productCount,
          costKnownProducts: costKnownProducts.length,
          unknownCostProducts: unknownCostProducts.length,
          returnCount,
          returnRate,
          avgOrderValue,
          totalStockValue: productsWithCost.length > 0 ? fmt(totalStockValue) : null,
          totalPotentialRevenue: fmt(totalPotentialRevenue),
          avgMargin,
          avgNetProfit,
          estimatedTotalProfit: avgNetProfit != null ? fmt(avgNetProfit * costKnownProducts.length) : null,
          profitableProductCount: profitableProducts.length,
          lossProductCount: lossProducts.length,
          breakEvenProductCount: breakEvenProducts.length,
          unknownCostProductCount: unknownCostProducts.length,
          activeMarketplaceCount: activeMarketplaces.length,
        },
        products: productProfits.slice(0, 50),
        lossProducts: lossProducts.sort((a, b) => (a.netProfit || 0) - (b.netProfit || 0)).slice(0, 20),
        profitableProducts: profitableProducts.sort((a, b) => (b.netProfit || 0) - (a.netProfit || 0)).slice(0, 20),
        dailyTrend: orders.length > 0 ? buildDailyTrend(orders) : [],
        _source: 'real-db',
        _dataQuality: {
          purchasePriceKnown: costKnownProducts.length,
          purchasePriceUnknown: unknownCostProducts.length,
          orderCount: orderCount,
          estimatedFields: costKnownProducts.length > 0 ? ['commission', 'shipping', 'serviceFee', 'stopaj'] : [],
          note: orderCount === 0 && unknownCostProducts.length > 0
            ? 'Sipariş verisi ve ürün maliyet verisi bulunmamaktadır. Komisyon/kargo/stopaj oranları varsayılan değerlerdir. Maliyet bilinmeyen ürünlerde kâr hesabı yapılamaz.'
            : orderCount === 0
            ? 'Sipariş verisi bulunmamaktadır.'
            : unknownCostProducts.length > 0
            ? 'Bazı ürünlerin maliyet verisi eksik. Kâr hesabı sadece maliyet bilinen ürünler için yapılabilir.'
            : undefined,
        },
      },
    });
  } catch (error) {
    console.error('[profit-engine/dashboard]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Dashboard failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/summary — Finans özeti (gerçek DB; veri yoksa 0)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/summary', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [orders, products] = await Promise.all([
      prisma.order.findMany({ select: { total: true, status: true, createdAt: true, marketplaceId: true } }),
      prisma.product.findMany({ select: { id: true, sku: true, title: true, salePrice: true, purchasePrice: true, stock: true } }),
    ]);

    const orderCount = orders.length;
    const productCount = products.length;
    const totalRevenue = fmt(orders.reduce((s, o) => s + (o.total || 0), 0));
    const returnCount = orders.filter(o => o.status === 'returned' || o.status === 'cancelled').length;
    const returnRate = orderCount > 0 ? fmt(returnCount / orderCount * 100) : 0;
    const avgOrderValue = orderCount > 0 ? fmt(totalRevenue / orderCount) : 0;

    // Sadece maliyeti bilinen ürünlerde kesin net kâr hesaplanabilir
    const costKnown = products.filter(p => p.purchasePrice != null && p.purchasePrice > 0 && p.salePrice != null && p.salePrice > 0);
    const rates = DEFAULT_RATES.default;
    let totalCost = 0;
    let totalProfit = 0;
    const topProducts = costKnown.map(p => {
      const sale = p.salePrice!;
      const cost = p.purchasePrice!;
      const commission = sale * rates.commission / 100;
      const stopaj = sale * rates.stopaj / 100;
      const vat = sale * (rates.vatRate) / 100;
      const profit = fmt(sale - cost - commission - rates.shipping - rates.serviceFee - stopaj - vat);
      totalCost += cost;
      totalProfit += profit;
      return {
        productId: p.id, sku: p.sku || '—', title: p.title || '—',
        revenue: fmt(sale), cost: fmt(cost), profit,
        margin: fmt(profit / sale * 100), orderCount: 0,
      };
    }).sort((a, b) => b.profit - a.profit).slice(0, 10);

    const netProfit = fmt(totalProfit);
    const profitMargin = totalRevenue > 0 ? fmt(netProfit / totalRevenue * 100) : 0;

    // En iyi pazaryeri (gerçek siparişlerden)
    const mpTotals: Record<string, number> = {};
    orders.forEach(o => {
      const key = o.marketplaceId || 'unknown';
      mpTotals[key] = (mpTotals[key] || 0) + (o.total || 0);
    });
    const topMarketplaceId = Object.entries(mpTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    let topMarketplace = '-';
    if (topMarketplaceId && topMarketplaceId !== 'unknown') {
      const mp = await prisma.marketplace.findUnique({ where: { id: topMarketplaceId }, select: { name: true } });
      topMarketplace = mp?.name || '-';
    }

    return res.json({
      ok: true,
      data: {
        totalRevenue,
        totalCost: fmt(totalCost),
        totalProfit: netProfit,
        totalLoss: fmt(topProducts.filter(p => p.profit < 0).reduce((s, p) => s + p.profit, 0)),
        netProfit,
        profitMargin,
        orderCount,
        productCount,
        returnCount,
        returnRate,
        avgOrderValue,
        topMarketplace,
        topProducts,
        dailyTrend: orderCount > 0 ? buildDailyTrend(orders) : [],
        _source: 'real-db',
        _note: costKnown.length === 0 ? 'Maliyet bilgisi (purchasePrice) olan ürün yok; kâr hesabı yapılamaz.' : undefined,
      },
    });
  } catch (error) {
    console.error('[profit-engine/summary]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Summary failed' } });
  }
});

function buildDailyTrend(orders: { total: number; status: string; createdAt: Date }[]) {
  const map: Record<string, { revenue: number; count: number; returns: number }> = {};
  orders.forEach(o => {
    const d = o.createdAt.toISOString().slice(0, 10);
    if (!map[d]) map[d] = { revenue: 0, count: 0, returns: 0 };
    map[d].revenue += o.total || 0;
    map[d].count += 1;
    if (o.status === 'returned' || o.status === 'cancelled') map[d].returns += 1;
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, d]) => ({ date, revenue: fmt(d.revenue), orderCount: d.count, returnCount: d.returns }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/products — Tüm ürünlerin kârlılık analizi
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit as string) || 25));
    const sort = (req.query.sort as string) || 'netProfit';
    const order = (req.query.order as string) || 'desc';
    const search = (req.query.search as string) || '';
    const marketplace = (req.query.marketplace as string) || '';

    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true, title: true, sku: true, barcode: true, salePrice: true, purchasePrice: true,
          profitMargin: true, stock: true, vatRate: true, status: true,
          marketplaceStates: {
            select: { price: true, stock: true, status: true, marketplace: { select: { id: true, name: true, key: true } } },
          },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    const enriched = products.map(p => {
      const hasCost = p.purchasePrice != null && p.purchasePrice > 0;
      const cost = hasCost ? p.purchasePrice! : null;
      const sale = p.salePrice || 0;
      const grossProfit = hasCost ? fmt(sale - cost!) : null;
      const margin = (hasCost && sale > 0) ? fmt((sale - cost!) / sale * 100) : null;
      const rates = DEFAULT_RATES.default;
      const estCommission = fmt(sale * rates.commission / 100);
      const estShipping = fmt(rates.shipping);
      const estServiceFee = fmt(rates.serviceFee);
      const estStopaj = fmt(sale * rates.stopaj / 100);
      const vatRate = p.vatRate || rates.vatRate;
      const vatAmount = fmt(sale * vatRate / 100);
      const netProfit = hasCost ? fmt(grossProfit! - estCommission - estShipping - estServiceFee - estStopaj - vatAmount) : null;
      const roi = (hasCost && cost! > 0) ? fmt(netProfit! / cost! * 100) : null;
      return {
        id: p.id, title: p.title, sku: p.sku, barcode: p.barcode,
        salePrice: sale, purchasePrice: cost, hasCostData: hasCost,
        grossProfit, margin,
        estCommission, estShipping, estServiceFee, estStopaj, vatAmount,
        netProfit, roi, stock: p.stock || 0, vatRate,
        status: p.status,
        category: p.category?.name || '—',
        brand: p.brand?.name || '—',
        marketplaces: p.marketplaceStates.map(ms => ({
          name: ms.marketplace.name, key: ms.marketplace.key,
          price: ms.price, stock: ms.stock, status: ms.status,
        })),
        breakdown: {
          salePrice: sale,
          purchasePrice: cost,
          hasCostData: hasCost,
          commission: estCommission,
          commissionSource: 'varsayılan-oran',
          shipping: estShipping,
          shippingSource: 'varsayılan-oran',
          serviceFee: estServiceFee,
          stopaj: estStopaj,
          stopajSource: 'varsayılan-oran',
          vat: vatAmount,
          netProfit,
        },
      };
    });

    if (sort === 'netProfit') enriched.sort((a, b) => order === 'desc' ? b.netProfit - a.netProfit : a.netProfit - b.netProfit);
    else if (sort === 'margin') enriched.sort((a, b) => order === 'desc' ? b.margin - a.margin : a.margin - b.margin);
    else if (sort === 'salePrice') enriched.sort((a, b) => order === 'desc' ? b.salePrice - a.salePrice : a.salePrice - b.salePrice);
    else if (sort === 'stock') enriched.sort((a, b) => order === 'desc' ? b.stock - a.stock : a.stock - b.stock);

    return res.json({
      ok: true,
      data: {
        items: enriched,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        _note: 'Komisyon, kargo, hizmet bedeli ve stopaj oranları varsayılan değerlerdir. Gerçek oranlar pazaryeri yapılandırma bölümünden ayarlanabilir.',
        _rates: DEFAULT_RATES,
      },
    });
  } catch (error) {
    console.error('[profit-engine/products]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Products fetch failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/products/:id — Tek ürün detaylı kârlılık kırılımı
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/products/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, title: true, sku: true, barcode: true, salePrice: true, purchasePrice: true,
        profitMargin: true, stock: true, vatRate: true, status: true, currency: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        xmlSource: { select: { id: true, name: true, company: true } },
        marketplaceStates: {
          select: {
            price: true, stock: true, status: true, listingUrl: true,
            marketplace: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });
    if (!product) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });

    const hasCost = product.purchasePrice != null && product.purchasePrice > 0;
    const cost = hasCost ? product.purchasePrice! : null;
    const sale = product.salePrice || 0;
    const grossProfit = hasCost ? fmt(sale - cost!) : null;
    const margin = (hasCost && sale > 0) ? fmt((sale - cost!) / sale * 100) : null;
    const rates = DEFAULT_RATES.default;
    const estCommission = fmt(sale * rates.commission / 100);
    const estShipping = fmt(rates.shipping);
    const estServiceFee = fmt(rates.serviceFee);
    const estStopaj = fmt(sale * rates.stopaj / 100);
    const vatRate = product.vatRate || rates.vatRate;
    const vatAmount = fmt(sale * vatRate / 100);
    const netProfit = hasCost ? fmt(grossProfit! - estCommission - estShipping - estServiceFee - estStopaj - vatAmount) : null;
    const roi = (hasCost && cost! > 0) ? fmt(netProfit! / cost! * 100) : null;

    return res.json({
      ok: true,
      data: {
        product: {
          id: product.id, title: product.title, sku: product.sku, barcode: product.barcode,
          category: product.category?.name || '—',
          brand: product.brand?.name || '—',
          source: product.xmlSource?.name || '—',
          currency: product.currency || 'TRY',
          status: product.status,
        },
        financial: {
          salePrice: sale, purchasePrice: cost, hasCostData: hasCost,
          grossProfit, margin,
          stock: product.stock || 0,
          stockValue: hasCost ? fmt(cost! * (product.stock || 0)) : null,
          potentialRevenue: fmt(sale * (product.stock || 0)),
        },
        breakdown: {
          salePrice: sale,
          purchasePrice: cost,
          hasCostData: hasCost,
          commission: estCommission,
          commissionRate: rates.commission,
          commissionSource: 'varsayılan-oran',
          shipping: estShipping,
          shippingSource: 'varsayılan-oran',
          serviceFee: estServiceFee,
          stopaj: estStopaj,
          stopajRate: rates.stopaj,
          stopajSource: 'varsayılan-oran',
          vat: vatAmount,
          vatRate,
          netProfit,
          roi,
          _source: 'estimated',
          _note: 'Komisyon, kargo, hizmet bedeli ve stopaj oranları varsayılan değerlerdir.',
        },
        marketplaces: product.marketplaceStates.map(ms => ({
          name: ms.marketplace.name, key: ms.marketplace.key,
          price: ms.price, stock: ms.stock, status: ms.status,
          url: ms.listingUrl,
        })),
        anomalies: {
          isLoss: netProfit < 0,
          isZeroMargin: margin === 0,
          isHighMargin: margin > 30,
          stockOut: product.stock <= 0,
          lowStock: product.stock > 0 && product.stock <= (product.stock || 0) * 0.1,
        },
      },
    });
  } catch (error) {
    console.error('[profit-engine/products/:id]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Product detail failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/marketplaces — Pazaryeri karşılaştırmalı analiz
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/marketplaces', requireAuth, async (_req: Request, res: Response) => {
  try {
    const marketplaces = await prisma.marketplace.findMany({
      select: {
        id: true, name: true, key: true, active: true,
        _count: { select: { productMarketplaceStates: true, orders: true } },
        productMarketplaceStates: {
          select: {
            price: true, stock: true, status: true,
            product: { select: { purchasePrice: true, salePrice: true } },
          },
        },
      },
    });

    const result = marketplaces.map(mp => {
      const rates = getRatesForMarketplace(mp.key);
      const pms = mp.productMarketplaceStates;
      const listedProducts = pms.filter(p => p.status === 'LISTED' || p.status === 'active');
      const totalListed = listedProducts.length;
      const totalStock = listedProducts.reduce((s, p) => s + (p.stock || 0), 0);
      const avgPrice = totalListed > 0
        ? fmt(listedProducts.reduce((s, p) => s + (p.price || 0), 0) / totalListed) : 0;

      const productsWithCost = listedProducts.filter(p => p.product.purchasePrice != null);
      const totalCost = productsWithCost.reduce((s, p) => s + (p.product.purchasePrice! * (p.stock || 0)), 0);
      const totalPotentialRevenue = listedProducts.reduce((s, p) => s + ((p.price || 0) * (p.stock || 0)), 0);
      const grossProfit = totalPotentialRevenue - totalCost;
      const estCommission = fmt(totalPotentialRevenue * rates.commission / 100);
      const estShipping = fmt(totalStock * rates.shipping);
      const estServiceFee = fmt(totalPotentialRevenue * rates.serviceFee / 100);
      const estStopaj = fmt(totalPotentialRevenue * rates.stopaj / 100);
      const estVat = fmt(totalPotentialRevenue * rates.vatRate / 100);
      const netProfit = fmt(grossProfit - estCommission - estShipping - estServiceFee - estStopaj - estVat);
      const margin = totalPotentialRevenue > 0 ? fmt(netProfit / totalPotentialRevenue * 100) : 0;

      return {
        id: mp.id, name: mp.name, key: mp.key, active: mp.active,
        orderCount: mp._count.orders,
        totalListed, totalStock,
        avgPrice,
        totalCost: fmt(totalCost),
        totalPotentialRevenue: fmt(totalPotentialRevenue),
        grossProfit: fmt(grossProfit),
        estCommission, estShipping, estServiceFee, estStopaj, estVat,
        netProfit, margin,
        rates,
        dataQuality: {
          totalPms: pms.length,
          listed: listedProducts.length,
          pending: pms.filter(p => p.status === 'PENDING').length,
          hasRealPrice: listedProducts.some(p => p.price != null && p.price > 0),
          hasRealStock: listedProducts.some(p => p.stock != null && p.stock > 0),
        },
      };
    });

    result.sort((a, b) => b.netProfit - a.netProfit);

    return res.json({ ok: true, data: { items: result, _source: 'real-db' } });
  } catch (error) {
    console.error('[profit-engine/marketplaces]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Marketplace analysis failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/loss-analysis — Zarar analizi
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/loss-analysis', requireAuth, async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { salePrice: { not: null, gt: 0 } },
      select: {
        id: true, title: true, sku: true, salePrice: true, purchasePrice: true,
        stock: true, vatRate: true,
        category: { select: { name: true } },
      },
    });

    const rates = DEFAULT_RATES.default;
    const analysis = products.map(p => {
      const cost = p.purchasePrice || 0;
      const sale = p.salePrice || 0;
      const grossProfit = sale - cost;
      const estCommission = sale * rates.commission / 100;
      const estShipping = rates.shipping;
      const estServiceFee = rates.serviceFee;
      const estStopaj = sale * rates.stopaj / 100;
      const vatRate = p.vatRate || rates.vatRate;
      const vatAmount = sale * vatRate / 100;
      const netProfit = grossProfit - estCommission - estShipping - estServiceFee - estStopaj - vatAmount;
      const margin = sale > 0 ? fmt(netProfit / sale * 100) : 0;

      const reasons: string[] = [];
      if (cost >= sale) reasons.push(`Maliyet (${cost} TL) satış fiyatına eşit veya yüksek`);
      if (estCommission > grossProfit * 0.5) reasons.push(`Komisyon (${fmt(estCommission)} TL) brüt kârın %50'sinden fazla`);
      if (vatAmount > grossProfit * 0.3) reasons.push(`KDV yükü (${fmt(vatAmount)} TL) yüksek`);

      return {
        id: p.id, title: p.title, sku: p.sku,
        salePrice: sale, purchasePrice: cost,
        grossProfit: fmt(grossProfit), margin, netProfit: fmt(netProfit),
        stock: p.stock || 0, category: p.category?.name || '—',
        reasons,
        severity: netProfit < -sale * 0.2 ? 'CRITICAL' : netProfit < 0 ? 'HIGH' : 'LOW',
      };
    });

    const lossProducts = analysis.filter(p => p.netProfit < 0).sort((a, b) => a.netProfit - b.netProfit);
    const highMarginLoss = lossProducts.filter(p => p.severity === 'CRITICAL');
    const marginDeclining = analysis.filter(p => p.margin > 0 && p.margin < 5);

    return res.json({
      ok: true,
      data: {
        totalProducts: analysis.length,
        lossCount: lossProducts.length,
        criticalCount: highMarginLoss.length,
        decliningMarginCount: marginDeclining.length,
        lossProducts: lossProducts.slice(0, 30),
        highMarginLoss: highMarginLoss.slice(0, 10),
        marginDeclining: marginDeclining.slice(0, 10),
        _source: 'real-db',
        _note: 'Analiz varsayılan oranlarla yapılmıştır. Gerçek oranlar farklı olabilir.',
      },
    });
  } catch (error) {
    console.error('[profit-engine/loss-analysis]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Loss analysis failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/period-comparison — Dönem karşılaştırması
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/period-comparison', requireAuth, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [thisMonthOrders, lastMonthOrders] = await Promise.all([
      prisma.order.findMany({
        select: { id: true, total: true, status: true, createdAt: true },
        where: { createdAt: { gte: thisMonthStart } },
      }),
      prisma.order.findMany({
        select: { id: true, total: true, status: true, createdAt: true },
        where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
      }),
    ]);

    const calcPeriod = (orders: { total: number; status: string }[]) => {
      const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
      const returns = orders.filter(o => o.status === 'returned' || o.status === 'cancelled');
      const returnAmount = returns.reduce((s, o) => s + (o.total || 0), 0);
      return { revenue: fmt(revenue), orderCount: orders.length, returnCount: returns.length, returnAmount: fmt(returnAmount) };
    };

    const thisMonth = calcPeriod(thisMonthOrders);
    const lastMonth = calcPeriod(lastMonthOrders);

    const revenueDiff = fmt(Number(thisMonth.revenue) - Number(lastMonth.revenue));
    const revenueDiffPercent = Number(lastMonth.revenue) > 0
      ? fmt((Number(thisMonth.revenue) - Number(lastMonth.revenue)) / Number(lastMonth.revenue) * 100) : 0;

    return res.json({
      ok: true,
      data: {
        thisMonth: { ...thisMonth, period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` },
        lastMonth: { ...lastMonth, period: `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}` },
        comparison: { revenueDiff, revenueDiffPercent, orderDiff: thisMonth.orderCount - lastMonth.orderCount },
        _source: 'real-db',
        _note: thisMonth.orderCount === 0 && lastMonth.orderCount === 0 ? 'Dönem için sipariş verisi bulunmamaktadır.' : undefined,
      },
    });
  } catch (error) {
    console.error('[profit-engine/period-comparison]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Period comparison failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/profit-engine/simulate — Manuel simülasyon (DB'yi değiştirmez)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/simulate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { salePrice, purchasePrice, commissionRate, shippingCost, serviceFee, stopajRate, vatRate } = req.body;
    if (salePrice === undefined || purchasePrice === undefined) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'salePrice ve purchasePrice zorunludur' } });
    }

    const sale = Number(salePrice) || 0;
    const cost = Number(purchasePrice) || 0;
    const commRate = Number(commissionRate) || 12;
    const ship = Number(shippingCost) || 8;
    const svc = Number(serviceFee) || 2;
    const stopRate = Number(stopajRate) || 1;
    const vat = Number(vatRate) || 20;

    const grossProfit = sale - cost;
    const commission = fmt(sale * commRate / 100);
    const stopaj = fmt(sale * stopRate / 100);
    const vatAmount = fmt(sale * vat / 100);
    const totalExpenses = commission + ship + svc + stopaj + vatAmount;
    const netProfit = fmt(grossProfit - totalExpenses);
    const margin = sale > 0 ? fmt(netProfit / sale * 100) : 0;
    const roi = cost > 0 ? fmt(netProfit / cost * 100) : 0;

    return res.json({
      ok: true,
      data: {
        input: { salePrice: sale, purchasePrice: cost, commissionRate: commRate, shippingCost: ship, serviceFee: svc, stopajRate: stopRate, vatRate: vat },
        result: {
          grossProfit: fmt(grossProfit),
          commission, shipping: ship, serviceFee: svc, stopaj,
          totalExpenses: fmt(totalExpenses),
          vat: vatAmount,
          netProfit, margin, roi,
        },
        _note: 'Bu bir simülasyondur. DB\'deki gerçek veriyi değiştirmez.',
      },
    });
  } catch (error) {
    console.error('[profit-engine/simulate]', error);
    return res.status(500).json({ ok: false, error: { code: 'SIMULATION_ERROR', message: 'Simulation failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/anomalies — Gerçek DB verisinden anomali tespiti
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/anomalies', requireAuth, async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      select: { id: true, title: true, sku: true, salePrice: true, purchasePrice: true, profitMargin: true, stock: true },
    });

    const anomalies: any[] = [];
    const rates = DEFAULT_RATES.default;

    products.forEach(p => {
      if (p.purchasePrice != null && p.salePrice != null && p.salePrice > 0) {
        const grossMargin = (p.salePrice - p.purchasePrice) / p.salePrice * 100;
        const estCommission = p.salePrice * rates.commission / 100;
        const totalCosts = estCommission + rates.shipping + rates.serviceFee + p.salePrice * rates.stopaj / 100;
        const netMargin = ((p.salePrice - p.purchasePrice - totalCosts) / p.salePrice * 100);

        if (netMargin < -20) {
          anomalies.push({
            id: `anom-critical-${p.id}`, type: 'PRICING', severity: 'CRITICAL',
            expected: p.purchasePrice, actual: p.salePrice,
            difference: fmt(p.salePrice - p.purchasePrice),
            percentageDiff: fmt(netMargin),
            productId: p.id, marketplaceKey: 'system', date: new Date(),
            details: `${p.title || p.sku}: Ağır zarar — Net marj %${fmt(netMargin)}. Satış ${p.salePrice} TL, maliyet ${p.purchasePrice} TL.`,
            resolved: false,
          });
        } else if (netMargin < 0) {
          anomalies.push({
            id: `anom-loss-${p.id}`, type: 'PRICING', severity: 'HIGH',
            expected: p.purchasePrice, actual: p.salePrice,
            difference: fmt(p.salePrice - p.purchasePrice),
            percentageDiff: fmt(netMargin),
            productId: p.id, marketplaceKey: 'system', date: new Date(),
            details: `${p.title || p.sku}: Zarar — Net marj %${fmt(netMargin)}.`,
            resolved: false,
          });
        }
      }
      if (p.stock <= 0 && p.salePrice != null && p.salePrice > 0) {
        anomalies.push({
          id: `anom-stock-${p.id}`, type: 'STOCK', severity: 'MEDIUM',
          expected: 10, actual: p.stock, difference: -10, percentageDiff: -100,
          productId: p.id, marketplaceKey: 'system', date: new Date(),
          details: `${p.title || p.sku}: Stok tükendi.`,
          resolved: false,
        });
      }
    });

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    anomalies.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1; });

    return res.json({
      ok: true,
      data: {
        total: anomalies.length, byType, bySeverity,
        critical: anomalies.filter(a => a.severity === 'CRITICAL'),
        unresolved: anomalies.slice(0, 50),
        _source: 'real-db',
      },
    });
  } catch (error) {
    console.error('[profit-engine/anomalies]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Anomalies failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/profit-engine/learning — Öğrenme istatistikleri
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/learning', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Kalıcı ticari öğrenme verisinden türet (restart sonrası da tutarlı)
    const commercial = commercialLearning.getStats();
    const insights = commercialLearning.getLearnedInsights();

    const byType: Record<string, number> = {};
    let confidenceSum = 0;
    for (const i of insights) {
      byType[i.metric] = (byType[i.metric] || 0) + 1;
      confidenceSum += i.confidence;
    }

    return res.json({
      ok: true,
      data: {
        totalRules: insights.length,
        activeRules: insights.filter(i => i.status !== 'emerging').length,
        avgConfidence: insights.length > 0 ? confidenceSum / insights.length : 0,
        byType,
        verifiedRules: insights.filter(i => i.status === 'confirmed').length,
        lastUpdated: new Date(),
        // Ticari öğrenme özeti (kalıcı)
        commercial: {
          totalObservations: commercial.totalObservations,
          totalDeviations: commercial.totalDeviations,
          totalInsights: commercial.totalInsights,
          totalAlerts: commercial.totalAlerts,
          unacknowledgedAlerts: commercial.unacknowledgedAlerts,
        },
      },
    });
  } catch (error) {
    console.error('[profit-engine/learning]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Learning fetch failed' } });
  }
});

router.post('/learning', requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, conditions, result, source } = req.body;
    if (!type || !conditions || result === undefined) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } });
    }
    learningEngine.addSample(type, conditions, result, source || DataSource.LEARNED);
    return res.json({ ok: true, message: 'Learning sample added' });
  } catch (error) {
    console.error('[profit-engine/learning]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Learning add failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/profit-engine/detect-anomaly — Anomali tespiti
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/detect-anomaly', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderId, marketplaceKey, expected, actual } = req.body;
    if (!orderId || !marketplaceKey || expected === undefined || actual === undefined) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } });
    }
    const anomalies = anomalyDetector.detectAllAnomalies(orderId, marketplaceKey, {
      commissionRate: expected, actualCommissionRate: actual,
    });
    return res.json({ ok: true, data: { anomalies } });
  } catch (error) {
    console.error('[profit-engine/detect-anomaly]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Detect anomaly failed' } });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// TİCARİ ÖĞRENME ENDPOINT'LERİ
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/profit-engine/learn/observe — Sipariş gözlemi kaydet (gerçek veri)
router.post('/learn/observe', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orderId, marketplaceKey, category, expected, actual, orderTotal, source } = req.body;
    if (!orderId || !marketplaceKey || !expected || !actual) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'orderId, marketplaceKey, expected, actual zorunludur' } });
    }
    const result = commercialLearning.recordObservation({
      orderId, marketplaceKey, category, expected, actual, orderTotal: orderTotal || 0,
      source: source === 'test' || source === 'simulation' ? source : 'real',
    });
    return res.json({
      ok: true,
      data: {
        observation: result.observation,
        deviations: result.deviations,
        newInsights: result.newInsights,
        newAlerts: result.newAlerts,
      },
    });
  } catch (error) {
    console.error('[profit-engine/learn/observe]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Observe failed' } });
  }
});

// GET /api/profit-engine/learn/insights — Öğrenilen bilgileri getir
router.get('/learn/insights', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplace = req.query.marketplace as string | undefined;
    const category = req.query.category as string | undefined;
    const metric = req.query.metric as string | undefined;
    const insights = commercialLearning.getLearnedInsights({
      marketplaceKey: marketplace,
      category,
      metric,
    });
    return res.json({ ok: true, data: { items: insights, total: insights.length } });
  } catch (error) {
    console.error('[profit-engine/learn/insights]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Insights fetch failed' } });
  }
});

// GET /api/profit-engine/learn/alerts — Akıllı uyarıları getir
router.get('/learn/alerts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const alerts = commercialLearning.getAlerts();
    return res.json({ ok: true, data: { items: alerts, total: alerts.length } });
  } catch (error) {
    console.error('[profit-engine/learn/alerts]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Alerts fetch failed' } });
  }
});

// POST /api/profit-engine/learn/alerts/:id/ack — Uyarıyı onayla
router.post('/learn/alerts/:id/ack', requireAuth, async (req: Request, res: Response) => {
  try {
    const acknowledged = commercialLearning.acknowledgeAlert(String(req.params.id));
    return res.json({ ok: true, data: { acknowledged } });
  } catch (error) {
    console.error('[profit-engine/learn/alerts/ack]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Alert ack failed' } });
  }
});

// GET /api/profit-engine/learn/stats — Öğrenme istatistikleri
router.get('/learn/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const stats = commercialLearning.getStats();
    return res.json({ ok: true, data: stats });
  } catch (error) {
    console.error('[profit-engine/learn/stats]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Stats fetch failed' } });
  }
});

// GET /api/profit-engine/learn/accuracy — Tahmin doğruluğu
router.get('/learn/accuracy', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplace = req.query.marketplace as string | undefined;
    const category = req.query.category as string | undefined;
    const metric = req.query.metric as string | undefined;
    const accuracy = commercialLearning.getPredictionAccuracy({
      marketplaceKey: marketplace,
      category,
      metric,
    });
    return res.json({ ok: true, data: accuracy });
  } catch (error) {
    console.error('[profit-engine/learn/accuracy]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Accuracy fetch failed' } });
  }
});

// GET /api/profit-engine/learn/estimate — Güvenli öğrenilmiş tahmin (resmi kaydı değiştirmez)
router.get('/learn/estimate', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplace = req.query.marketplace as string | undefined;
    const metric = req.query.metric as string | undefined;
    const category = req.query.category as string | undefined;
    const officialRaw = req.query.official as string | undefined;
    if (!marketplace || !metric) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'marketplace ve metric zorunludur' } });
    }
    const officialValue = officialRaw !== undefined && officialRaw !== '' ? Number(officialRaw) : null;
    const estimate = commercialLearning.getLearnedEstimate(marketplace, metric, officialValue, category);
    return res.json({ ok: true, data: estimate });
  } catch (error) {
    console.error('[profit-engine/learn/estimate]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Estimate failed' } });
  }
});

// POST /api/profit-engine/learn/simulate — İzole test senaryosu (DB ve üretim state'ini DEĞİŞTİRMEZ)
router.post('/learn/simulate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { scenarios } = req.body;
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'scenarios dizisi zorunludur' } });
    }
    const invalid = scenarios.find((s: any) => !s || !s.expected || !s.actual);
    if (invalid) {
      return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Her senaryo expected ve actual içermelidir' } });
    }

    // İzole motor: üretim observations/insights/alerts ve disk ETKİLENMEZ
    const result = commercialLearning.simulate(scenarios);
    return res.json({
      ok: true,
      data: {
        results: result.results,
        summary: result.summary,
        isolated: true,
        _note: "Bu bir izole simulasyondur. DB verisini ve uretim ogrenme state'ini degistirmez.",
      },
    });
  } catch (error) {
    console.error('[profit-engine/learn/simulate]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Learn simulate failed' } });
  }
});

// GET /api/profit-engine/learn/data-status — Gerçek öğrenme verisinin varlığını raporlar
router.get('/learn/data-status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [orderCount, productCount, templateCount] = await Promise.all([
      prisma.order.count(),
      prisma.product.count(),
      prisma.listingTemplate.count(),
    ]);
    const [withPurchasePrice, withCommissionRate, withCargoSettings] = await Promise.all([
      prisma.product.count({ where: { purchasePrice: { not: null } } }),
      prisma.listingTemplate.count({ where: { commissionRate: { not: null } } }),
      prisma.listingTemplate.count({ where: { cargoSettings: { not: null } } }),
    ]);

    const gaps: string[] = [];
    if (orderCount === 0) gaps.push('gerçek sipariş (Order) kaydı yok — gerçek sipariş öğrenmesi mümkün değil');
    if (withPurchasePrice === 0) gaps.push('ürün alış maliyeti (purchasePrice) boş — maliyet sapması öğrenilemez');
    if (withCommissionRate === 0) gaps.push('resmi komisyon oranı (ListingTemplate.commissionRate) boş — resmi-vs-gerçek karşılaştırması yok');
    if (withCargoSettings === 0) gaps.push('kargo ayarı (ListingTemplate.cargoSettings) boş — kargo öğrenmesi yok');
    gaps.push('sipariş bazlı gerçek komisyon/kargo/iade tutarı hiçbir tabloda tutulmuyor — actual değerler saklanmıyor');

    return res.json({
      ok: true,
      data: {
        realDataAvailable: orderCount > 0 && withPurchasePrice > 0,
        counts: { orderCount, productCount, templateCount, withPurchasePrice, withCommissionRate, withCargoSettings },
        gaps,
        _note: 'Bu rapor gerçek veri varlığını gösterir. Veri yoksa öğrenme motoru gerçek öğrenme yapamaz.',
      },
    });
  } catch (error) {
    console.error('[profit-engine/learn/data-status]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Data status failed' } });
  }
});

export default router;
