// DG STOK — FULL SYSTEM DB DIAGNOSTIC (read-only, no writes).
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function n(v) { return v == null ? 0 : v; }

(async () => {
  const out = {};

  out.totalProducts = await prisma.product.count();
  out.byStatus = await prisma.product.groupBy({ by: ['status'], _count: { _all: true } });
  out.byVariantStatus = await prisma.product.groupBy({ by: ['variantStatus'], _count: { _all: true } });

  out.categoryMatchTrue = await prisma.product.count({ where: { categoryMatch: true } });
  out.brandMatchTrue = await prisma.product.count({ where: { brandMatch: true } });
  out.templateMatchTrue = await prisma.product.count({ where: { templateMatch: true } });
  out.variantMatchTrue = await prisma.product.count({ where: { variantMatch: true } });
  out.variantNotRequired = await prisma.product.count({ where: { variantStatus: 'NOT_REQUIRED' } });

  out.statusReady = await prisma.product.count({ where: { status: 'READY' } });
  out.readyFilter = await prisma.product.count({
    where: {
      status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true,
      OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }],
    },
  });

  out.categoryIdNull = await prisma.product.count({ where: { categoryId: null } });
  out.brandIdNull = await prisma.product.count({ where: { brandId: null } });
  out.categoryMatchTrueButCategoryIdNull = await prisma.product.count({ where: { categoryMatch: true, categoryId: null } });
  out.brandMatchTrueButBrandIdNull = await prisma.product.count({ where: { brandMatch: true, brandId: null } });

  // Ready olup 4/4 tamamlanmamış ürünlerin eksik sebep dağılımı
  out.readyMissingCategory = await prisma.product.count({ where: { status: 'READY', categoryMatch: false } });
  out.readyMissingBrand = await prisma.product.count({ where: { status: 'READY', brandMatch: false } });
  out.readyMissingTemplate = await prisma.product.count({ where: { status: 'READY', templateMatch: false } });
  out.readyMissingVariant = await prisma.product.count({ where: { status: 'READY', variantMatch: false, variantStatus: { not: 'NOT_REQUIRED' } } });

  // XML kaynakları
  const xmlSources = await prisma.xmlSource.findMany({ select: { id: true, name: true, active: true } });
  out.xmlSources = xmlSources.map(s => ({ id: s.id, name: s.name, active: s.active }));

  // Kategori mapping: numeric externalId kontrolü
  out.categoryMappingTotal = await prisma.categoryMapping.count();
  const catMappings = await prisma.categoryMapping.findMany({ select: { externalId: true, marketplaceId: true, source: true } });
  out.categoryMappingBySource = {};
  for (const m of catMappings) {
    const k = (m.source || 'null') + (m.marketplaceId ? ':mp' : ':no-mp');
    out.categoryMappingBySource[k] = (out.categoryMappingBySource[k] || 0) + 1;
  }
  out.categoryMappingNumericExternal = catMappings.filter(m => /^\d+$/.test(String(m.externalId || ''))).length;
  out.categoryMappingEmptyExternal = catMappings.filter(m => !m.externalId).length;

  // Brand externalId numeric kontrolü
  out.brandTotal = await prisma.brand.count();
  const brands = await prisma.brand.findMany({ select: { externalId: true } });
  out.brandNumericExternal = brands.filter(b => /^\d+$/.test(String(b.externalId || ''))).length;
  out.brandEmptyExternal = brands.filter(b => !b.externalId).length;

  // Listing template
  out.listingTemplateTotal = await prisma.listingTemplate.count();

  // Marketplace state
  out.mpStateTotal = await prisma.productMarketplaceState.count();
  out.mpStateByStatus = await prisma.productMarketplaceState.groupBy({ by: ['status'], _count: { _all: true } });

  // Fiyat kuralları
  out.pricingRules = await prisma.marketplacePricingRule.count();
  out.listingLogs = await prisma.listingLog.count();

  // Marketplace'ler
  const marketplaces = await prisma.marketplace.findMany({ select: { id: true, key: true, name: true, active: true, apiStatus: true } });
  out.marketplaces = marketplaces;

  // AKILLIBAYI1 context detayı
  const ctx = xmlSources.find(s => s.name && s.name.toUpperCase().includes('AKILLI'));
  out.context = ctx || null;
  if (ctx) {
    const w = { xmlSourceId: ctx.id };
    out.ctxTotal = await prisma.product.count({ where: w });
    out.ctxCategoryMatch = await prisma.product.count({ where: { ...w, categoryMatch: true } });
    out.ctxBrandMatch = await prisma.product.count({ where: { ...w, brandMatch: true } });
    out.ctxTemplateMatch = await prisma.product.count({ where: { ...w, templateMatch: true } });
    out.ctxVariantMatch = await prisma.product.count({ where: { ...w, variantMatch: true } });
    out.ctxVariantNotRequired = await prisma.product.count({ where: { ...w, variantStatus: 'NOT_REQUIRED' } });
    out.ctxStatusReady = await prisma.product.count({ where: { ...w, status: 'READY' } });
    out.ctxReadyFilter = await prisma.product.count({
      where: { ...w, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] },
    });
    out.ctxByVariantStatus = await prisma.product.groupBy({ by: ['variantStatus'], where: w, _count: { _all: true } });
    out.ctxCategoryIdNull = await prisma.product.count({ where: { ...w, categoryId: null } });
    out.ctxBrandIdNull = await prisma.product.count({ where: { ...w, brandId: null } });
  }

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect().catch(() => null); process.exit(1); });
