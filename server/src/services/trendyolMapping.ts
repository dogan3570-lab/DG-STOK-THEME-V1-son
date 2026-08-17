/**
 * TRENDYOL MAPPING ORCHESTRATION — gerçek Trendyol catalog response'larını
 * kullanarak XML → Trendyol mapping üretir ve KONTROLLÜ şekilde DB'ye yazar.
 *
 * KURALLAR:
 *  - Yalnızca gerçek API response'undan gelen numeric ID yazılır.
 *  - Sahte ID / sahte mapping / kör toplu import YASAK.
 *  - Belirsiz eşleşme MANUAL_REVIEW, yoksa NOT_FOUND — yazılmaz.
 *  - Kontrollü örneklem (varsayılan 10) üzerinde doğrulanır.
 */
import { prisma } from '../db/prisma.ts';
import {
  fetchTrendyolCategoryTree,
  fetchTrendyolBrands,
  fetchTrendyolCategoryAttributes,
  fetchTrendyolAttributeValues,
  type TrendyolCategory,
  type TrendyolBrand,
} from './trendyolCatalog.ts';
import { matchTrendyolCategoryByPath, matchTrendyolBrand, classifyMatch, type ClassifiedMatch } from './categoryBrandMapper.ts';
import { resolveTrendyolAttributes } from './trendyolVariantResolver.ts';
import { parsePositiveInt } from './sendReadiness.ts';

const MAPPING_SOURCE = 'trendyol_catalog';

export interface MappingRunSummary {
  ok: boolean;
  scanned: number;
  autoMatched: number;
  manualReview: number;
  notFound: number;
  catalogUnavailable?: boolean;
  error?: string;
  results: Array<{ input: string; status: string; externalId: number | null; externalName: string | null; reason: string | null }>;
}

async function requireTrendyolMarketplace(marketplaceId: string): Promise<{ ok: boolean; error?: string }> {
  const mp = await prisma.marketplace.findUnique({ where: { id: marketplaceId }, select: { key: true } });
  if (!mp) return { ok: false, error: 'MARKETPLACE_NOT_FOUND' };
  if (mp.key !== 'tt') return { ok: false, error: 'MARKETPLACE_NOT_TRENDYOL' };
  return { ok: true };
}

// ==================== CATEGORY MAPPING ====================

export async function mapTrendyolCategories(input: { xmlSourceId: string; marketplaceId: string; limit?: number }): Promise<MappingRunSummary> {
  const mpCheck = await requireTrendyolMarketplace(input.marketplaceId);
  if (!mpCheck.ok) return { ok: false, scanned: 0, autoMatched: 0, manualReview: 0, notFound: 0, error: mpCheck.error, results: [] };

  const tree: TrendyolCategory[] = await fetchTrendyolCategoryTree();
  if (!Array.isArray(tree) || tree.length === 0) {
    return { ok: false, scanned: 0, autoMatched: 0, manualReview: 0, notFound: 0, catalogUnavailable: true, error: 'CATALOG_UNAVAILABLE', results: [] };
  }

  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const rows = await prisma.product.groupBy({
    by: ['supplierCategory'],
    where: { xmlSourceId: input.xmlSourceId, supplierCategory: { not: null } },
    _count: { id: true },
    orderBy: { supplierCategory: 'asc' },
    take: limit,
  });

  const summary: MappingRunSummary = { ok: true, scanned: rows.length, autoMatched: 0, manualReview: 0, notFound: 0, results: [] };

  for (const row of rows) {
    const path = String(row.supplierCategory ?? '').trim();
    if (!path) continue;
    const match = matchTrendyolCategoryByPath(path, tree);
    const classified: ClassifiedMatch = classifyMatch(match);

    if (classified.status === 'AUTO_MATCH' && classified.id !== null) {
      const leaf = path.split('>').map((s) => s.trim()).filter(Boolean).pop() || path;
      const category = await prisma.category.upsert({
        where: { name: leaf },
        update: { externalId: String(classified.id) },
        create: { name: leaf, externalId: String(classified.id) },
      });
      await prisma.categoryMapping.upsert({
        where: { categoryId_marketplaceId_source: { categoryId: category.id, marketplaceId: input.marketplaceId, source: MAPPING_SOURCE } },
        update: { externalId: String(classified.id), externalName: classified.name, externalPath: path, confidence: 1.0, active: true },
        create: {
          categoryId: category.id,
          marketplaceId: input.marketplaceId,
          externalId: String(classified.id),
          externalName: classified.name,
          externalPath: path,
          source: MAPPING_SOURCE,
          confidence: 1.0,
          active: true,
        },
      });
      await prisma.product.updateMany({
        where: { xmlSourceId: input.xmlSourceId, supplierCategory: path },
        data: { categoryId: category.id, categoryMatch: true, matchedBy: MAPPING_SOURCE, lastMatchDate: new Date() },
      });
      summary.autoMatched++;
      summary.results.push({ input: path, status: classified.status, externalId: classified.id, externalName: classified.name, reason: null });
    } else {
      if (classified.status === 'MANUAL_REVIEW') summary.manualReview++;
      else summary.notFound++;
      summary.results.push({ input: path, status: classified.status, externalId: null, externalName: null, reason: classified.reason });
    }
  }

  return summary;
}

// ==================== BRAND MAPPING ====================

export async function mapTrendyolBrands(input: { xmlSourceId: string; marketplaceId: string; limit?: number }): Promise<MappingRunSummary> {
  const mpCheck = await requireTrendyolMarketplace(input.marketplaceId);
  if (!mpCheck.ok) return { ok: false, scanned: 0, autoMatched: 0, manualReview: 0, notFound: 0, error: mpCheck.error, results: [] };

  const brands: TrendyolBrand[] = await fetchTrendyolBrands(0, 1000);
  if (!Array.isArray(brands) || brands.length === 0) {
    return { ok: false, scanned: 0, autoMatched: 0, manualReview: 0, notFound: 0, catalogUnavailable: true, error: 'CATALOG_UNAVAILABLE', results: [] };
  }

  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const rows = await prisma.product.groupBy({
    by: ['xmlBrandName'],
    where: { xmlSourceId: input.xmlSourceId, xmlBrandName: { not: null } },
    _count: { id: true },
    orderBy: { xmlBrandName: 'asc' },
    take: limit,
  });

  const summary: MappingRunSummary = { ok: true, scanned: rows.length, autoMatched: 0, manualReview: 0, notFound: 0, results: [] };

  for (const row of rows) {
    const xmlBrand = String(row.xmlBrandName ?? '').trim();
    if (!xmlBrand) continue;
    const match = matchTrendyolBrand(xmlBrand, brands);
    const classified = classifyMatch(match);

    if (classified.status === 'AUTO_MATCH' && classified.id !== null) {
      const brand = await prisma.brand.upsert({
        where: { name: classified.name ?? xmlBrand },
        update: { externalId: String(classified.id) },
        create: { name: classified.name ?? xmlBrand, externalId: String(classified.id) },
      });
      await prisma.brandMapping.upsert({
        where: { xmlBrandName: xmlBrand },
        update: { dgBrandId: brand.id, confidence: 1.0, isAuto: true, marketplaceKey: 'tt' },
        create: { xmlBrandName: xmlBrand, dgBrandId: brand.id, confidence: 1.0, isAuto: true, marketplaceKey: 'tt' },
      });
      await prisma.product.updateMany({
        where: { xmlSourceId: input.xmlSourceId, xmlBrandName: xmlBrand },
        data: { brandId: brand.id, brandMatch: true, brandUsageType: 'DG_BRAND', matchedBy: MAPPING_SOURCE, lastMatchDate: new Date() },
      });
      await prisma.brandMapping.update({ where: { xmlBrandName: xmlBrand }, data: { productCount: row._count.id } }).catch(() => null);
      summary.autoMatched++;
      summary.results.push({ input: xmlBrand, status: classified.status, externalId: classified.id, externalName: classified.name, reason: null });
    } else {
      if (classified.status === 'MANUAL_REVIEW') summary.manualReview++;
      else summary.notFound++;
      summary.results.push({ input: xmlBrand, status: classified.status, externalId: null, externalName: null, reason: classified.reason });
    }
  }

  return summary;
}

// ==================== VARIANT / ATTRIBUTE MAPPING ====================

export interface VariantRunSummary {
  ok: boolean;
  scanned: number;
  matched: number;
  manualReview: number;
  catalogUnavailable?: boolean;
  error?: string;
  results: Array<{ productId: string; title: string | null; status: string; reason: string | null }>;
}

export async function mapTrendyolVariants(input: { xmlSourceId: string; marketplaceId: string; limit?: number }): Promise<VariantRunSummary> {
  const mpCheck = await requireTrendyolMarketplace(input.marketplaceId);
  if (!mpCheck.ok) return { ok: false, scanned: 0, matched: 0, manualReview: 0, error: mpCheck.error, results: [] };

  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const products = await prisma.product.findMany({
    where: { xmlSourceId: input.xmlSourceId, categoryId: { not: null } },
    include: { variants: { select: { name: true, value: true } } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  const summary: VariantRunSummary = { ok: true, scanned: products.length, matched: 0, manualReview: 0, results: [] };

  for (const product of products) {
    const mapping = await prisma.categoryMapping.findFirst({
      where: { categoryId: product.categoryId as string, marketplaceId: input.marketplaceId, active: true },
      select: { externalId: true },
      orderBy: { createdAt: 'desc' },
    });
    const categoryId = parsePositiveInt(mapping?.externalId ?? null);
    if (categoryId === null) {
      summary.results.push({ productId: product.id, title: product.title, status: 'NOT_FOUND', reason: 'CATEGORY_MAPPING_NOT_FOUND' });
      continue;
    }

    const attrDefs = await fetchTrendyolCategoryAttributes(categoryId);
    if (!Array.isArray(attrDefs) || attrDefs.length === 0) {
      summary.catalogUnavailable = true;
      summary.results.push({ productId: product.id, title: product.title, status: 'NOT_VERIFIED', reason: 'CATALOG_UNAVAILABLE' });
      continue;
    }

    const relevant = attrDefs.filter((a) => a.varianter || a.slicer).slice(0, 30);
    const valuesByAttribute = new Map<number, { attributeValueId: number; attributeValue: string }[]>();
    for (const attr of relevant) {
      const values = await fetchTrendyolAttributeValues(categoryId, attr.attribute.id);
      valuesByAttribute.set(attr.attribute.id, values);
    }

    const variants = product.variants.map((v) => ({ name: v.name, value: v.value }));
    const resolution = resolveTrendyolAttributes(attrDefs, valuesByAttribute, variants);

    const checkResults = JSON.stringify({
      categoryId,
      status: resolution.status,
      missing: resolution.missing,
      requiredMissing: resolution.requiredMissing,
      attributes: resolution.attributes,
      verifiedAt: new Date().toISOString(),
    });

    const existing = await prisma.variantAnalysis.findFirst({ where: { productId: product.id } });
    if (existing) {
      await prisma.variantAnalysis.update({
        where: { id: existing.id },
        data: { checkResults, validationPassed: resolution.status === 'OK', confidence: resolution.status === 'OK' ? 100 : 0, autoFixResult: resolution.status === 'OK' ? 'matched' : 'manual_review', status: resolution.status === 'OK' ? 'MATCHED' : 'MANUAL_REVIEW' },
      });
    } else {
      await prisma.variantAnalysis.create({
        data: {
          productId: product.id,
          source: MAPPING_SOURCE,
          status: resolution.status === 'OK' ? 'MATCHED' : 'MANUAL_REVIEW',
          confidence: resolution.status === 'OK' ? 100 : 0,
          checkResults,
          autoFixResult: resolution.status === 'OK' ? 'matched' : 'manual_review',
          validationPassed: resolution.status === 'OK',
        },
      });
    }

    if (resolution.status === 'OK') {
      await prisma.product.update({ where: { id: product.id }, data: { variantMatch: true, variantStatus: 'COMPLETED' } });
      summary.matched++;
      summary.results.push({ productId: product.id, title: product.title, status: 'MATCHED', reason: null });
    } else {
      await prisma.product.update({ where: { id: product.id }, data: { variantMatch: false, variantStatus: 'MANUAL_REVIEW' } });
      summary.manualReview++;
      summary.results.push({ productId: product.id, title: product.title, status: resolution.status, reason: (resolution.missing.map((m) => m.reason).join('; ') || null) });
    }
  }

  return summary;
}

// ==================== 3 SANİYE UX STATUS ====================

export interface GateCounts {
  ready: number;
  waiting: number;
  error: number;
}

export interface TrendyolMappingStatus {
  ok: boolean;
  context: {
    xmlSourceId: string;
    xmlSourceName: string | null;
    marketplaceId: string;
    marketplaceName: string | null;
  };
  header: string;
  gates: {
    category: GateCounts;
    brand: GateCounts;
    variant: GateCounts;
    listing: GateCounts;
  };
  totals: { ready: number; waiting: number; error: number; total: number };
  progress: number; // 0 | 20 | 40 | 60 | 80 | 100 (geriye zıplamaz)
}

export async function getTrendyolMappingStatus(input: { xmlSourceId: string; marketplaceId: string }): Promise<TrendyolMappingStatus> {
  const [xmlSource, marketplace, products] = await Promise.all([
    prisma.xmlSource.findUnique({ where: { id: input.xmlSourceId }, select: { name: true } }),
    prisma.marketplace.findUnique({ where: { id: input.marketplaceId }, select: { name: true, key: true } }),
    prisma.product.findMany({
      where: { xmlSourceId: input.xmlSourceId },
      select: { id: true, categoryId: true, brandId: true, variantStatus: true, variantMatch: true },
    }),
  ]);

  const productIds = products.map((p) => p.id);

  const [categoryMappings, brands, templates] = await Promise.all([
    prisma.categoryMapping.findMany({ where: { marketplaceId: input.marketplaceId, active: true }, select: { categoryId: true, externalId: true } }),
    prisma.brand.findMany({ select: { id: true, externalId: true } }),
    prisma.listingTemplate.findMany({
      where: { marketplaceId: input.marketplaceId, active: true },
      select: { id: true, productId: true, categoryId: true, brandId: true },
    }),
  ]);

  // SQLite parametre limiti için chunk'lı variantAnalysis sorgusu
  const CHUNK = 800;
  const vaChunks = await Promise.all(
    Array.from({ length: Math.ceil(productIds.length / CHUNK) }, (_, i) =>
      prisma.variantAnalysis.findMany({
        where: { productId: { in: productIds.slice(i * CHUNK, (i + 1) * CHUNK) } },
        select: { productId: true, validationPassed: true },
      })
    )
  );
  const variantAnalyses = vaChunks.flat();

  const categoryExternal = new Map<string, string | null>();
  for (const m of categoryMappings) categoryExternal.set(m.categoryId, m.externalId);
  const brandExternal = new Map<string, string | null>();
  for (const b of brands) brandExternal.set(b.id, b.externalId);
  const variantValidated = new Set<string>();
  for (const v of variantAnalyses) if (v.validationPassed) variantValidated.add(v.productId);

  const productTemplates = new Set(templates.filter((t) => t.productId).map((t) => t.productId as string));
  const categoryTemplates = new Set(templates.filter((t) => t.categoryId && !t.productId && !t.brandId).map((t) => t.categoryId as string));
  const generalTemplateExists = templates.some((t) => !t.productId && !t.categoryId && !t.brandId);

  const gates = {
    category: { ready: 0, waiting: 0, error: 0 },
    brand: { ready: 0, waiting: 0, error: 0 },
    variant: { ready: 0, waiting: 0, error: 0 },
    listing: { ready: 0, waiting: 0, error: 0 },
  };

  let totalsReady = 0;
  let totalsWaiting = 0;
  let totalsError = 0;

  for (const p of products) {
    const catReady = !!p.categoryId && parsePositiveInt(categoryExternal.get(p.categoryId) ?? null) !== null;
    const brandReady = !!p.brandId && parsePositiveInt(brandExternal.get(p.brandId) ?? null) !== null;
    const variantReady = variantValidated.has(p.id) || p.variantStatus === 'NOT_REQUIRED';
    const listingReady = productTemplates.has(p.id) || (!!p.categoryId && categoryTemplates.has(p.categoryId)) || generalTemplateExists;

    if (catReady) gates.category.ready++;
    else if (p.categoryId) gates.category.waiting++;
    else gates.category.error++;

    if (brandReady) gates.brand.ready++;
    else if (p.brandId) gates.brand.waiting++;
    else gates.brand.error++;

    if (variantReady) gates.variant.ready++;
    else if (p.variantStatus === 'MANUAL_REVIEW' || p.variantStatus === 'WAITING_AI' || p.variantStatus === 'COMPLETED') gates.variant.waiting++;
    else gates.variant.error++;

    if (listingReady) gates.listing.ready++;
    else gates.listing.error++;

    const states = [catReady, brandReady, variantReady, listingReady];
    const errorCount = states.filter((s) => !s).length;
    if (errorCount === 0) totalsReady++;
    else if (errorCount === states.length) totalsError++;
    else totalsWaiting++;
  }

  const total = products.length;
  // Monotonik progress: hazır oranı 20'lik dilimlere yuvarlanır (0..100).
  const progress = total > 0 ? Math.min(100, Math.floor((totalsReady / total) * 5) * 20) : 0;

  return {
    ok: true,
    context: {
      xmlSourceId: input.xmlSourceId,
      xmlSourceName: xmlSource?.name ?? null,
      marketplaceId: input.marketplaceId,
      marketplaceName: marketplace?.name ?? null,
    },
    header: `XML: ${xmlSource?.name ?? 'SEÇİLMEDİ'} | PAZARYERİ: ${marketplace?.name ?? 'SEÇİLMEDİ'} — BU XML'İN ÜRÜNLERİ ŞU PAZARYERİNE HAZIRLANIYOR`,
    gates,
    totals: { ready: totalsReady, waiting: totalsWaiting, error: totalsError, total },
    progress,
  };
}

export async function runTrendyolMappingPipeline(input: { xmlSourceId: string; marketplaceId: string; limit?: number }) {
  const categories = await mapTrendyolCategories(input);
  const brands = await mapTrendyolBrands(input);
  const variants = await mapTrendyolVariants(input);
  return { categories, brands, variants };
}
