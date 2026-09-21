/**
 * FINANCE CENTER API — Kanonik finans motorunu (canonicalFinance.ts) kullanan tek finans API'si.
 * Tüm değerler GERÇEK DB verisinden üretilir. Veri yoksa 0 uydurulmaz; durum etiketi verilir.
 *
 * GERÇEK (REAL)      : Order tablosu (gerçekleşen satış). Şu an 0 kayıt.
 * TAHMİN (ESTIMATED) : Maliyet (XML toptan) + varsayılan komisyon/kargo oranları + pricing rule ile
 *                      hesaplanan POTANSİYEL kâr. Gerçekleşmiş satış DEĞİLDİR.
 * HESAPLANAMAZ       : Maliyet yok VEYA uygun fiyat kuralı yok.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../auth/authMiddleware.ts';
import { prisma } from '../db/prisma.ts';
import {
  resolveProductPriceChain,
  getRatesForMarketplaceKey,
  breakEvenPrice,
  targetPriceForMargin,
  centsToTL,
  type UnitEconomics,
  type RateSet,
} from '../services/finance/canonicalFinance.ts';
import { parsePriceRangeRules, type PriceRangeRule } from '../services/listingPriceResolver.ts';
import { centsToFloat } from '../shared/types/index.ts';

const router = Router();

const STATUS_NOT_DELETED = { not: 'DELETED' as const };

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function startOfWeek(d: Date): Date { const x = startOfDay(d); const off = (x.getDay() + 6) % 7; return new Date(x.getTime() - off * 86400000); }

function periodRange(period: PeriodKey, from?: string, to?: string): { start: Date | null; end: Date | null; prevStart: Date | null; prevEnd: Date | null } {
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = null;
  switch (period) {
    case 'today': start = startOfDay(now); end = null; break;
    case 'week': start = startOfWeek(now); end = null; break;
    case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); end = null; break;
    case 'year': start = new Date(now.getFullYear(), 0, 1); end = null; break;
    case 'custom': start = from ? new Date(from) : null; end = to ? new Date(to) : null; break;
    default: start = null; end = null;
  }
  let prevStart: Date | null = null;
  let prevEnd: Date | null = null;
  if (start) {
    prevEnd = start;
    const span = (end ? end.getTime() : now.getTime()) - start.getTime();
    prevStart = new Date(start.getTime() - span);
  }
  return { start, end, prevStart, prevEnd };
}

interface MpRuleBundle {
  marketplace: { id: string; name: string; key: string; active: boolean };
  rules: PriceRangeRule[] | null;
  rates: RateSet;
}

async function loadMarketplaceRules(): Promise<MpRuleBundle[]> {
  const [mps, ruleRows, templates] = await Promise.all([
    prisma.marketplace.findMany({ select: { id: true, name: true, key: true, active: true }, orderBy: { name: 'asc' } }),
    prisma.marketplacePricingRule.findMany({
      where: { active: true },
      select: { marketplaceId: true, minPrice: true, maxPrice: true, profitMargin: true, fixedAmount: true, rounding: true },
      orderBy: { minPrice: 'asc' },
    }),
    prisma.listingTemplate.findMany({ where: { active: true }, select: { marketplaceId: true, priceRangeRules: true } }),
  ]);
  return mps.map(m => {
    let rules: PriceRangeRule[] | null = ruleRows
      .filter(r => r.marketplaceId === m.id)
      .map(r => ({ minPrice: r.minPrice, maxPrice: r.maxPrice, profitMargin: r.profitMargin, fixedAmount: r.fixedAmount, rounding: r.rounding ?? undefined }));
    if (rules.length === 0) {
      const tpl = templates.find(t => t.marketplaceId === m.id && t.priceRangeRules);
      rules = tpl ? parsePriceRangeRules(tpl.priceRangeRules) : null;
    }
    return { marketplace: m, rules: rules && rules.length > 0 ? rules : null, rates: getRatesForMarketplaceKey(m.key) };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/finance-center/overview
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    const period = (String(req.query.period || 'month')) as PeriodKey;
    const { start, end, prevStart, prevEnd } = periodRange(period, req.query.from as string, req.query.to as string);
    const marketplaceId = req.query.marketplaceId ? String(req.query.marketplaceId) : '';
    const search = String(req.query.search || '').trim();
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : '';
    const brandId = req.query.brandId ? String(req.query.brandId) : '';
    const onlyLoss = String(req.query.onlyLoss || '') === 'true';
    const onlyProfit = String(req.query.onlyProfit || '') === 'true';
    const onlyNoCost = String(req.query.onlyNoCost || '') === 'true';
    const productWhere: any = { status: STATUS_NOT_DELETED };
    if (search) productWhere.OR = [{ title: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }];
    if (categoryId) productWhere.categoryId = categoryId;
    if (brandId) productWhere.brandId = brandId;
    if (onlyNoCost) productWhere.AND = [{ purchasePrice: null }, { OR: [{ salePrice: null }, { salePrice: { lte: 0 } }] }];

    const [mpBundles, products, orderWhere] = await Promise.all([
      loadMarketplaceRules(),
      prisma.product.findMany({
        where: productWhere,
        select: {
          id: true, title: true, sku: true, barcode: true, purchasePrice: true, salePrice: true,
          vatRate: true, stock: true, status: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
        },
      }),
      Promise.resolve(start ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ]);

    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: { id: true, total: true, status: true, createdAt: true, marketplaceId: true },
    });

    const activeBundles = mpBundles.filter(b => b.marketplace.active);
    const primaryBundle = activeBundles.find(b => b.marketplace.key === 'tt') ?? activeBundles.find(b => b.rules) ?? activeBundles[0];
    const headlineBundles = marketplaceId ? activeBundles.filter(b => b.marketplace.id === marketplaceId) : (primaryBundle ? [primaryBundle] : []);
    const headlineIds = new Set(headlineBundles.map(b => b.marketplace.id));

    // ── POTANSİYEL (TAHMİN): ürün × pazaryeri ─────────────────────────────────
    interface Pot { e: UnitEconomics; mp: string; mpId: string; productId: string; title: string; sku: string; barcode: string; stock: number; category: string; brand: string }
    const allPotentials: Pot[] = [];
    let costKnown = 0, costUnknown = 0, ruleMissing = 0;
    for (const p of products) {
      const hasCost = (p.purchasePrice != null && p.purchasePrice > 0) || (p.salePrice != null && p.salePrice > 0);
      if (hasCost) costKnown++; else { costUnknown++; continue; }
      for (const b of activeBundles) {
        const chain = resolveProductPriceChain(p, b.rules, b.rates);
        if (chain.economics) {
          allPotentials.push({
            e: chain.economics, mp: b.marketplace.name, mpId: b.marketplace.id,
            productId: p.id, title: p.title || '—', sku: p.sku || '—', barcode: p.barcode || '—',
            stock: p.stock || 0, category: p.category?.name || '—', brand: p.brand?.name || '—',
          });
        } else if (headlineIds.has(b.marketplace.id)) {
          ruleMissing++;
        }
      }
    }
    let potentials = allPotentials.filter(p => headlineIds.has(p.mpId));
    if (onlyProfit) potentials = potentials.filter(p => p.e.netProfitCents > 0n);
    if (onlyLoss) potentials = potentials.filter(p => p.e.netProfitCents < 0n);

    const sum = (arr: bigint[]) => arr.reduce((a, b) => a + b, 0n);
    const potential = {
      unitCount: potentials.length,
      productCount: new Set(potentials.map(p => p.productId)).size,
      revenueTL: centsToFloat(sum(potentials.map(p => p.e.saleCents))),
      costTL: centsToFloat(sum(potentials.map(p => p.e.costCents))),
      commissionTL: centsToFloat(sum(potentials.map(p => p.e.commissionCents))),
      shippingTL: centsToFloat(sum(potentials.map(p => p.e.shippingCents))),
      serviceTL: centsToFloat(sum(potentials.map(p => p.e.serviceFeeCents))),
      stopajTL: centsToFloat(sum(potentials.map(p => p.e.stopajCents))),
      vatTL: centsToFloat(sum(potentials.map(p => p.e.vatPayableCents))),
      netProfitTL: centsToFloat(sum(potentials.map(p => p.e.netProfitCents))),
    };
    const marginPct = potential.revenueTL > 0 ? Math.round((potential.netProfitTL / potential.revenueTL) * 10000) / 100 : null;

    // ── GERÇEKLEŞEN (REAL): Order ─────────────────────────────────────────────
    const realizedRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const returns = orders.filter(o => o.status === 'returned' || o.status === 'cancelled').length;
    const dayMap = new Map<string, number>();
    for (const o of orders) { const k = new Date(o.createdAt).toISOString().slice(0, 10); dayMap.set(k, (dayMap.get(k) || 0) + (o.total || 0)); }
    const dailyTrend = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, total]) => ({ date, totalTL: Math.round(total * 100) / 100 }));

    // Önceki dönem karşılaştırması (gerçekleşen ciro)
    let prevRealizedRevenue: number | null = null;
    if (prevStart && prevEnd) {
      const prevOrders = await prisma.order.findMany({ where: { createdAt: { gte: prevStart, lt: prevEnd } }, select: { total: true } });
      prevRealizedRevenue = prevOrders.reduce((s, o) => s + (o.total || 0), 0);
    }

    // ── Pazaryeri kırılımı (dinamik) ──────────────────────────────────────────
    const marketplaceBreakdown = activeBundles.map(b => {
      const rows = allPotentials.filter(p => p.mpId === b.marketplace.id);
      const rev = sum(rows.map(r => r.e.saleCents));
      const net = sum(rows.map(r => r.e.netProfitCents));
      return {
        id: b.marketplace.id,
        name: b.marketplace.name,
        key: b.marketplace.key,
        hasRules: b.rules != null,
        rates: b.rates,
        rateSource: 'ESTIMATED',
        productCount: rows.length,
        revenueTL: centsToFloat(rev),
        commissionTL: centsToFloat(sum(rows.map(r => r.e.commissionCents))),
        shippingTL: centsToFloat(sum(rows.map(r => r.e.shippingCents))),
        vatTL: centsToFloat(sum(rows.map(r => r.e.vatPayableCents))),
        netProfitTL: centsToFloat(net),
        marginPct: centsToFloat(rev) > 0 ? Math.round((centsToFloat(net) / centsToFloat(rev)) * 10000) / 100 : null,
        profitableProducts: rows.filter(r => r.e.netProfitCents > 0n).length,
        lossProducts: rows.filter(r => r.e.netProfitCents < 0n).length,
      };
    });

    // ── Kârlılık dağılımı + en iyi/zararlı ────────────────────────────────────
    const byProduct = new Map<string, Pot>();
    for (const p of potentials) if (!byProduct.has(p.productId)) byProduct.set(p.productId, p);
    const prods = [...byProduct.values()];
    const profitable = prods.filter(p => p.e.netProfitCents > 0n).length;
    const loss = prods.filter(p => p.e.netProfitCents < 0n).length;
    const breakEven = prods.filter(p => p.e.netProfitCents === 0n).length;
    const topProducts = [...prods].sort((a, b) => Number(b.e.netProfitCents - a.e.netProfitCents)).slice(0, 10)
      .map(p => ({ productId: p.productId, sku: p.sku, title: p.title.slice(0, 80), marketplace: p.mp, netProfitTL: centsToFloat(p.e.netProfitCents), marginPct: p.e.marginPct }));
    const lossProducts = [...prods].sort((a, b) => Number(a.e.netProfitCents - b.e.netProfitCents)).slice(0, 10)
      .map(p => ({ productId: p.productId, sku: p.sku, title: p.title.slice(0, 80), marketplace: p.mp, netProfitTL: centsToFloat(p.e.netProfitCents), marginPct: p.e.marginPct }));

    // ── Gider dağılımı (potansiyel) ───────────────────────────────────────────
    const expenseDistribution = [
      { key: 'cost', label: 'Ürün Maliyeti (Alış)', value: potential.costTL },
      { key: 'commission', label: 'Komisyon', value: potential.commissionTL },
      { key: 'vat', label: 'Ödenecek KDV (mahsup)', value: potential.vatTL },
      { key: 'shipping', label: 'Kargo', value: potential.shippingTL },
      { key: 'stopaj', label: 'Stopaj', value: potential.stopajTL },
      { key: 'service', label: 'Hizmet Bedeli', value: potential.serviceTL },
    ];

    // ── Alarmlar (gerçek veriden; NEDEN → ETKİ → ÖNERİ) ───────────────────────
    const unruledMarketplaces = activeBundles.filter(b => b.rules == null && b.marketplace.active).map(b => b.marketplace.name);
    const highCommissionCount = potentials.filter(p => p.e.saleCents > 0n && Number((p.e.commissionCents * 10000n) / p.e.saleCents) / 100 > 15).length;
    const alerts: Array<{ level: string; code: string; message: string; reason: string; impact: string; action: string }> = [];
    if (orders.length === 0) alerts.push({ level: 'info', code: 'NO_REAL_SALES', message: 'Gerçekleşen satış kaydı yok — tutarlar TAHMİN (potansiyel).', reason: 'Order tablosu boş (0 kayıt)', impact: 'Gerçekleşen net kâr UNAVAILABLE', action: 'Order + OrderItem (sipariş→ürün) entegrasyonu kurulmalı' });
    if (costUnknown > 0) alerts.push({ level: 'warn', code: 'MISSING_COST', message: `${costUnknown} ürünün maliyet verisi yok.`, reason: 'purchasePrice/salePrice (XML alış) boş', impact: 'Bu ürünlerde kâr hesaplanamaz', action: 'XML alış alanını eşle veya maliyet gir' });
    if (ruleMissing > 0) alerts.push({ level: 'warn', code: 'MISSING_RULE', message: `${ruleMissing} ürün için fiyat kuralı yok (manşet pazaryeri).`, reason: 'MarketplacePricingRule/ListingTemplate boş', impact: 'Listeleme fiyatı ve kâr hesaplanamaz', action: 'Fiyat bandı kuralı tanımla' });
    if (unruledMarketplaces.length > 0) alerts.push({ level: 'warn', code: 'MISSING_MARKETPLACE_RULE', message: `${unruledMarketplaces.join(', ')} için fiyat kuralı yok.`, reason: 'Pazaryeri pricing rule eksik', impact: 'O pazaryerinde kâr hesaplanamaz', action: 'Eksik pazaryeri kurallarını tanımla' });
    if (loss > 0) alerts.push({ level: 'danger', code: 'LOSS_PRODUCTS', message: `${loss} ürün potansiyel zarar ediyor.`, reason: 'Hesaplanan net kâr < 0', impact: 'Toplam potansiyel kârı eritir', action: 'Kâr fişinden başabaş/hedef fiyata göre fiyat güncelle' });
    if (highCommissionCount > 0) alerts.push({ level: 'warn', code: 'HIGH_COMMISSION', message: `${highCommissionCount} üründe komisyon cironun >%15'i.`, reason: 'Yüksek komisyon oranı/hacim', impact: 'Marjı düşürür', action: 'Komisyon oranı/pazaryeri gözden geçir' });
    if (potential.revenueTL > 0 && potential.shippingTL / potential.revenueTL > 0.1) alerts.push({ level: 'warn', code: 'HIGH_SHIPPING', message: `Kargo potansiyel cironun %${(potential.shippingTL / potential.revenueTL * 100).toFixed(1)}'i.`, reason: 'Düşük fiyatlı ürünlerde kargo kârı eritiyor', impact: 'Marjı düşürür', action: 'Kargo eşiği/birleşik gönderim' });
    if (orders.length > 0 && prevRealizedRevenue != null && prevRealizedRevenue > 0 && realizedRevenue < prevRealizedRevenue) alerts.push({ level: 'danger', code: 'REVENUE_DROP', message: `Ciro önceki döneme göre %${Math.abs(((realizedRevenue - prevRealizedRevenue) / prevRealizedRevenue) * 100).toFixed(1)} düştü.`, reason: 'Önceki dönem ciro karşılaştırması', impact: 'Satış düşüşü', action: 'Kampanya/stok/fiyat analizi' });

    const realizedStatus: 'REAL' | 'UNAVAILABLE' = orders.length > 0 ? 'REAL' : 'UNAVAILABLE';
    const verdict = orders.length > 0
      ? { scope: 'REALIZED', status: realizedRevenue > 0 ? 'PROFIT' : 'LOSS', reason: 'Gerçekleşen sipariş verisi' }
      : { scope: 'REALIZED', status: 'UNAVAILABLE', reason: 'Gerçekleşen satış kaydı yok' };

    return res.json({
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        period,
        periodLabel: start
          ? (end ? `${start.toLocaleDateString('tr-TR')} – ${end.toLocaleDateString('tr-TR')}` : `${start.toLocaleDateString('tr-TR')} – bugün`)
          : 'Tüm zamanlar',
        periodRange: { start: start?.toISOString() ?? null, end: end?.toISOString() ?? null },
        potentialScope: 'SNAPSHOT (anlık ürün/maliyet görüntüsü — dönemden bağımsız)',
        dailyTrend,
        primaryMarketplace: primaryBundle ? { id: primaryBundle.marketplace.id, name: primaryBundle.marketplace.name, key: primaryBundle.marketplace.key, hasRules: primaryBundle.rules != null } : null,
        currency: 'TRY',
        verdict,
        summary: {
          // GERÇEKLEŞEN (REAL)
          realized: {
            status: realizedStatus,
            revenueTL: realizedRevenue,
            orderCount: orders.length,
            returnCount: returns,
            avgOrderValueTL: orders.length > 0 ? Math.round((realizedRevenue / orders.length) * 100) / 100 : null,
            prevRevenueTL: prevRealizedRevenue,
            changePct: prevRealizedRevenue != null && prevRealizedRevenue > 0
              ? Math.round(((realizedRevenue - prevRealizedRevenue) / prevRealizedRevenue) * 10000) / 100
              : null,
            message: orders.length === 0 ? 'Bu dönemde gerçekleşmiş satış verisi bulunamadı (Order=0).' : null,
          },
          // POTANSİYEL (ESTIMATED)
          potential: { ...potential, marginPct, snapshotAt: new Date().toISOString(), snapshotScope: 'Güncel katalog fiyat/maliyet anlık görüntüsü — dönemden bağımsız' },
          distribution: { profitable, loss, breakEven, unknownCost: costUnknown },
        },
        marketplaceBreakdown,
        expenseDistribution,
        topProducts,
        lossProducts,
        alerts,
        dataQuality: {
          costKnown, costUnknown, ruleMissing,
          orderCount: orders.length,
          actualAvailable: orders.length > 0,
          estimated: true,
          sources: {
            cost: 'Product.purchasePrice ?? Product.salePrice (XML PriceInclusiveVat — B2B toptan alış)',
            listingPrice: 'resolveListingPrice(cost, MarketplacePricingRule) — canlı gönderim motoru',
            commission: 'Varsayılan oran (DB komisyon verisi yok) — ESTIMATED',
            shipping: 'Varsayılan oran — ESTIMATED',
            vat: 'Türk KDV mahsup (satış KDV − alış KDV)',
            realizedRevenue: 'Order tablosu — REAL (şu an 0 kayıt)',
          },
        },
      },
    });
  } catch (error) {
    console.error('[finance-center/overview]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Finance overview failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/finance-center/products — filtre + pagination (server-side)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/products', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '25'), 10) || 25));
    const search = String(req.query.search || '').trim();
    const marketplaceId = req.query.marketplaceId ? String(req.query.marketplaceId) : '';
    const categoryId = req.query.categoryId ? String(req.query.categoryId) : '';
    const brandId = req.query.brandId ? String(req.query.brandId) : '';
    const status = req.query.status ? String(req.query.status) : '';
    const onlyProfit = String(req.query.onlyProfit || '') === 'true';
    const onlyLoss = String(req.query.onlyLoss || '') === 'true';
    const onlyNoCost = String(req.query.onlyNoCost || '') === 'true';

    const where: any = { status: STATUS_NOT_DELETED };
    if (search) where.OR = [{ title: { contains: search } }, { sku: { contains: search } }, { barcode: { contains: search } }];
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (status) where.status = status;

    const mpBundles = (await loadMarketplaceRules()).filter(b => b.marketplace.active);
    const bundles = marketplaceId ? mpBundles.filter(b => b.marketplace.id === marketplaceId) : mpBundles;

    const all = await prisma.product.findMany({
      where,
      select: {
        id: true, title: true, sku: true, barcode: true, purchasePrice: true, salePrice: true,
        vatRate: true, stock: true, status: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    type Row = {
      id: string; sku: string; title: string; barcode: string; category: string; brand: string; stock: number;
      costTL: number | null; saleTL: number | null; hasCostData: boolean; dataStatus: string;
      primaryNetTL: number | null; primaryMarginPct: number | null;
      marketplaces: Array<{ id: string; name: string; key: string; listingPriceTL: number | null; status: string; netProfitTL: number | null; marginPct: number | null; roiPct: number | null; breakEvenTL: number | null }>;
    };
    const rows: Row[] = [];
    for (const p of all) {
      const hasCost = (p.purchasePrice != null && p.purchasePrice > 0) || (p.salePrice != null && p.salePrice > 0);
      if (onlyNoCost && hasCost) continue;
      const chainRows = bundles.map(b => {
        const chain = resolveProductPriceChain(p, b.rules, b.rates);
        return {
          id: b.marketplace.id, name: b.marketplace.name, key: b.marketplace.key,
          listingPriceTL: chain.listing.listingPrice,
          status: chain.listing.status,
          netProfitTL: chain.economics ? centsToFloat(chain.economics.netProfitCents) : null,
          marginPct: chain.economics ? chain.economics.marginPct : null,
          roiPct: chain.economics ? chain.economics.roiPct : null,
          breakEvenTL: breakEvenPrice(chain.costCents, b.rates),
        };
      });
      const primaryRow = chainRows.find(r => r.key === 'tt' && r.netProfitTL != null)
        ?? chainRows.find(r => r.netProfitTL != null)
        ?? chainRows.find(r => r.key === 'tt')
        ?? chainRows[0];
      const net = primaryRow?.netProfitTL ?? null;
      if (onlyProfit && !(net != null && net > 0)) continue;
      if (onlyLoss && !(net != null && net < 0)) continue;
      const primary = primaryRow;
      rows.push({
        id: p.id, sku: p.sku || '—', title: p.title || '—', barcode: p.barcode || '—',
        category: p.category?.name || '—', brand: p.brand?.name || '—', stock: p.stock || 0,
        costTL: p.purchasePrice ?? p.salePrice ?? null,
        saleTL: primary?.listingPriceTL ?? null,
        hasCostData: hasCost,
        primaryNetTL: primaryRow?.netProfitTL ?? null,
        primaryMarginPct: primaryRow?.marginPct ?? null,
        dataStatus: !hasCost ? 'MISSING_COST' : (primary?.status === 'OK' ? 'OK' : 'MISSING_RULE'),
        marketplaces: chainRows,
      });
    }

    const sort = String(req.query.sort || 'netProfit');
    const order = String(req.query.order || 'desc');
    const dir = order === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sort === 'sku') return a.sku.localeCompare(b.sku) * dir;
      if (sort === 'cost') return ((a.costTL ?? -1) - (b.costTL ?? -1)) * dir;
      if (sort === 'sale') return ((a.saleTL ?? -1) - (b.saleTL ?? -1)) * dir;
      if (sort === 'margin') return ((a.primaryMarginPct ?? -1) - (b.primaryMarginPct ?? -1)) * dir;
      return ((a.primaryNetTL ?? -1) - (b.primaryNetTL ?? -1)) * dir;
    });

    const total = rows.length;
    const items = rows.slice((page - 1) * limit, page * limit);
    return res.json({
      ok: true,
      data: {
        items,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        marketplaces: mpBundles.map(b => ({ id: b.marketplace.id, name: b.marketplace.name, key: b.marketplace.key })),
        _source: 'real-db',
      },
    });
  } catch (error) {
    console.error('[finance-center/products]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Finance products failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/finance-center/products/:id/slip — ÜRÜN KÂR FİŞİ + başabaş/hedef
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/products/:id/slip', requireAuth, async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, status: STATUS_NOT_DELETED },
      select: {
        id: true, title: true, sku: true, barcode: true, purchasePrice: true, salePrice: true,
        vatRate: true, stock: true,
        category: { select: { name: true } }, brand: { select: { name: true } },
      },
    });
    if (!product) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Ürün bulunamadı' } });

    const mpBundles = (await loadMarketplaceRules()).filter(b => b.marketplace.active);
    const targetMargin = Number(req.query.targetMargin || 20);

    const slips = mpBundles.map(b => {
      const chain = resolveProductPriceChain(product, b.rules, b.rates);
      const e = chain.economics;
      return {
        marketplaceId: b.marketplace.id,
        marketplaceName: b.marketplace.name,
        marketplaceKey: b.marketplace.key,
        costSource: chain.costSource,
        costTL: chain.costCents != null ? centsToFloat(chain.costCents) : null,
        listingStatus: chain.listing.status,
        listingReason: chain.listing.reason,
        saleTL: chain.listing.listingPrice,
        rule: chain.listing.rule,
        rates: b.rates,
        vatRate: product.vatRate ?? b.rates.vatRate,
        commissionSource: 'varsayılan-oran (ESTIMATED)',
        slip: e ? {
          saleTL: centsToFloat(e.saleCents),
          costTL: -centsToFloat(e.costCents),
          commissionTL: -centsToFloat(e.commissionCents),
          shippingTL: -centsToFloat(e.shippingCents),
          serviceTL: -centsToFloat(e.serviceFeeCents),
          stopajTL: -centsToFloat(e.stopajCents),
          vatPayableTL: -centsToFloat(e.vatPayableCents),
          saleVatTL: centsToFloat(e.saleVatCents),
          costVatTL: centsToFloat(e.costVatCents),
          netProfitTL: centsToFloat(e.netProfitCents),
          marginPct: e.marginPct,
          roiPct: e.roiPct,
        } : null,
        breakEvenPriceTL: breakEvenPrice(chain.costCents, b.rates),
        targetPriceTL: targetPriceForMargin(chain.costCents, Number.isFinite(targetMargin) ? targetMargin : 20, b.rates),
        currentListingTL: chain.listing.listingPrice,
        status: e ? (e.netProfitCents > 0n ? 'PROFIT' : e.netProfitCents < 0n ? 'LOSS' : 'BREAK_EVEN') : 'UNAVAILABLE',
      };
    });

    return res.json({
      ok: true,
      data: {
        product: {
          id: product.id, title: product.title, sku: product.sku, barcode: product.barcode,
          category: product.category?.name || '—', brand: product.brand?.name || '—', stock: product.stock || 0,
        },
        targetMarginPct: targetMargin,
        slips,
        _disclaimer: 'Tutarlar TAHMİN (potansiyeldir): maliyet XML toptan alış, komisyon/kargo oranları varsayılan. Gerçekleşen satış DEĞİLDİR.',
      },
    });
  } catch (error) {
    console.error('[finance-center/slip]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Slip failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/finance-center/meta — filtre seçenekleri (gerçek DB)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/meta', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [marketplaces, categories, brands, statuses] = await Promise.all([
      loadMarketplaceRules(),
      prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 2000 }),
      prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.product.groupBy({ by: ['status'], _count: true }),
    ]);
    return res.json({
      ok: true,
      data: {
        marketplaces: marketplaces.map(b => ({ id: b.marketplace.id, name: b.marketplace.name, key: b.marketplace.key, active: b.marketplace.active, hasRules: b.rules != null })),
        categories, brands,
        statuses: statuses.map(s => ({ status: s.status, count: s._count })),
      },
    });
  } catch (error) {
    console.error('[finance-center/meta]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Meta failed' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/finance-center/ai-analysis — AI ANALİZ KATMANI (rakam üretmez; motoru yorumlar)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/ai-analysis', requireAuth, async (req: Request, res: Response) => {
  try {
    const marketplaceId = req.query.marketplaceId ? String(req.query.marketplaceId) : '';
    const bundles = (await loadMarketplaceRules()).filter(b => b.marketplace.active);
    const primary = bundles.find(b => b.marketplace.key === 'tt') ?? bundles.find(b => b.rules) ?? bundles[0];
    const target = marketplaceId ? bundles.filter(b => b.marketplace.id === marketplaceId) : (primary ? [primary] : []);

    const products = await prisma.product.findMany({
      where: { status: STATUS_NOT_DELETED },
      select: { id: true, title: true, sku: true, purchasePrice: true, salePrice: true, vatRate: true },
    });

    let costKnown = 0, costUnknown = 0, highComm = 0, totalUnits = 0;
    let totalRev = 0, totalNet = 0, commissionSum = 0, shippingSum = 0;
    const losses: Array<{ sku: string; title: string; marketplace: string; netTL: number; marginPct: number; breakEvenTL: number | null }> = [];
    for (const p of products) {
      const hasCost = (p.purchasePrice != null && p.purchasePrice > 0) || (p.salePrice != null && p.salePrice > 0);
      if (!hasCost) { costUnknown++; continue; }
      costKnown++;
      for (const b of target) {
        const chain = resolveProductPriceChain(p, b.rules, b.rates);
        if (!chain.economics) continue;
        const e = chain.economics; totalUnits++;
        totalRev += centsToFloat(e.saleCents); totalNet += centsToFloat(e.netProfitCents);
        commissionSum += centsToFloat(e.commissionCents); shippingSum += centsToFloat(e.shippingCents);
        if (e.saleCents > 0n && Number((e.commissionCents * 10000n) / e.saleCents) / 100 > 15) highComm++;
        if (e.netProfitCents < 0n) losses.push({ sku: p.sku || '—', title: (p.title || '—').slice(0, 70), marketplace: b.marketplace.name, netTL: centsToFloat(e.netProfitCents), marginPct: e.marginPct, breakEvenTL: breakEvenPrice(chain.costCents, b.rates) });
      }
    }
    losses.sort((a, b) => a.netTL - b.netTL);

    const marginPct = totalRev > 0 ? Math.round((totalNet / totalRev) * 10000) / 100 : null;
    const commRatio = totalRev > 0 ? Math.round((commissionSum / totalRev) * 10000) / 100 : null;
    const shipRatio = totalRev > 0 ? Math.round((shippingSum / totalRev) * 10000) / 100 : null;

    const findings: Array<{ level: string; title: string; detail: string; advice: string }> = [];
    if (costUnknown > 0) findings.push({ level: 'warn', title: 'Maliyet eksik', detail: `${costUnknown} ürünün maliyeti yok`, advice: 'XML alış alanını eşle veya maliyet gir' });
    if (losses.length > 0) findings.push({ level: 'danger', title: 'Zarar eden ürünler', detail: `${losses.length} ürün potansiyel zarar`, advice: `En kötü örnek ${losses[0]?.sku}: başabaş ${losses[0]?.breakEvenTL ?? '—'} TL` });
    if (highComm > 0) findings.push({ level: 'warn', title: 'Yüksek komisyon', detail: `${highComm} üründe komisyon >%15`, advice: 'Komisyon yükünü fiyata yansıt / pazaryeri seç' });
    if (shipRatio != null && shipRatio > 10) findings.push({ level: 'warn', title: 'Kargo yükü', detail: `Kargo cironun %${shipRatio}'i`, advice: 'Kargo eşiği/birleşik gönderim' });
    if (bundles.some(b => b.rules == null)) findings.push({ level: 'warn', title: 'Fiyat kuralı eksik', detail: `${bundles.filter(b => b.rules == null).map(b => b.marketplace.name).join(', ')} kural yok`, advice: 'Pazaryeri fiyat bandı tanımla' });

    const narrative: string[] = [];
    narrative.push(`Seçili pazaryeri: ${target.map(b => b.marketplace.name).join(', ') || '—'}. Hesaplanabilen ${totalUnits} ürün/pazaryeri kombinasyonu için potansiyel ciro ${totalRev.toFixed(2)} TL, potansiyel net kâr ${totalNet.toFixed(2)} TL (marj %${marginPct ?? '—'}).`);
    if (costUnknown > 0) narrative.push(`${costUnknown} ürün maliyet verisi olmadığından kapsam dışıdır; gerçek kâr için alış maliyeti şarttır.`);
    if (losses.length > 0) narrative.push(`Zararın ana nedeni: komisyon+KDV+kargo toplamının, %75 marjlı fiyatı düşük bant ürünlerinde maliyeti karşılayamaması. En riskli: ${losses.slice(0, 3).map(l => l.sku).join(', ')}.`);
    narrative.push(`Gerçekleşen satış verisi (Order) olmadığından bu tamamen TAHMİN/potansiyeldir; gerçekleşen kâr UNAVAILABLE'dır.`);

    return res.json({
      ok: true,
      data: {
        analysisSource: 'RULE_BASED', aiUsed: false,
        aiNote: 'AI sağlayıcı çağrılmadı; analiz deterministik finans motoru çıktısından üretildi. AI eklendiğinde yalnızca yorum/öneri üretir; rakamları DEĞİŞTİRMEZ ve kullanıcı onayı olmadan DB yazmaz.',
        scope: { marketplace: target.map(b => ({ id: b.marketplace.id, name: b.marketplace.name, hasRules: b.rules != null })), costKnown, costUnknown },
        metrics: { totalRev: Math.round(totalRev * 100) / 100, totalNet: Math.round(totalNet * 100) / 100, marginPct, commRatio, shipRatio },
        findings, narrative, worstProducts: losses.slice(0, 10),
        _noWrite: true,
      },
    });
  } catch (error) {
    console.error('[finance-center/ai-analysis]', error);
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'AI analysis failed' } });
  }
});

export default router;
