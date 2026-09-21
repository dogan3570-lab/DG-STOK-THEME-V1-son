import { prisma } from '../db/prisma.ts';
import { invalidateDashboardStatsCache } from '../routes/dashboard.ts';
import { ensureDefaultListingTemplates } from '../bootstrap.ts';
import {reconcileProductGates, queueReconcileProductGates, queueReconcileProductGatesBulk} from './readinessService.ts';
import { reconcileProductMarketplaceState, reconcileProductMarketplaceStateBulk } from './marketplaceReconcile.ts';
import { isMarketplaceOperational } from './marketplaceTruth.ts';
import { invalidateTitleIndex } from './titleSearchIndex.ts';

export type XmlImportResult = {
  ok: boolean;
  importedCount: number;
  updatedCount: number;
  skippedCount?: number;
  failedCount?: number;
  filteredCount?: number;
  items: Array<{ xmlKey: string; created: boolean; matchedBy?: 'xmlKey' | 'sku'; outcome?: string; errorDetail?: string }>;
  error?: { code: string; message: string };
  runId?: string;
};

export type XmlImportFilter = {
  filterOutOfStock?: boolean;
  includeCategories?: string[];
  excludeBrands?: string[];
  minPrice?: number;
  maxPrice?: number;
  searchKeywords?: string[];
  includeBarcodes?: string[];
};

export type XmlImportProduct = {
  xmlKey: string;
  title: string | null;
  sku: string;
  barcode: string | null;
  stock: number;
  minStock: number;
  price: number | null;
  listPrice: number | null;
  tax: number | null;
  currency: string | null;
  brand: string | null;
  category: string | null;
  mainCategory: string | null;
  topCategory: string | null;
  subCategory: string | null;
  description: string | null;
  detail: string | null;
  images: string | null;
  link: string | null;
  unit: string | null;
  active: boolean;
  // Gerçek varyant yapısı: yalnızca XML parent/group kayıtlarından tespit edilir.
  parentId: string | null;
  groupId: string | null;
  purchasePrice: number | null;
};

function parseXmlDocument(xml: string) {
  const source = xml?.trim() ?? '';
  if (!source) {
    return { ok: false as const, error: 'Empty XML payload' };
  }

  const tagRegex = /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[^>]*\?>|<!DOCTYPE[\s\S]*?>|<\/?([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/g;
  const stack: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    const fullTag = match[0];
    if (fullTag.startsWith('<!--') || fullTag.startsWith('<![') || fullTag.startsWith('<?') || fullTag.startsWith('<!DOCTYPE')) {
      continue;
    }

    if (fullTag.startsWith('</')) {
      const tagName = match[3]?.toLowerCase();
      if (!tagName) {
        return { ok: false as const, error: 'Invalid XML: malformed closing tag' };
      }

      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return { ok: false as const, error: `Invalid XML: mismatched closing tag ${tagName}` };
      }

      stack.pop();
      continue;
    }

    if (fullTag.endsWith('/>')) {
      continue;
    }

    const tagName = match[3]?.toLowerCase();
    if (!tagName) {
      return { ok: false as const, error: 'Invalid XML: malformed opening tag' };
    }

    stack.push(tagName);
  }

  if (stack.length > 0) {
    return { ok: false as const, error: `Invalid XML: unclosed tag ${stack[stack.length - 1]}` };
  }

  return { ok: true as const, source };
}

export interface ImageValidationResult {
  totalUrls: number;
  validUrls: number;
  httpsCount: number;
  httpCount: number;
  invalidFormatUrls: number;
  suspiciousUrls: string[];
}

export function validateImageUrls(images: string | null): ImageValidationResult {
  const result: ImageValidationResult = {
    totalUrls: 0,
    validUrls: 0,
    httpsCount: 0,
    httpCount: 0,
    invalidFormatUrls: 0,
    suspiciousUrls: [],
  };

  if (!images) return result;

  const urls = images.split(',').filter(Boolean);
  result.totalUrls = urls.length;

  const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed.startsWith('http')) {
      result.invalidFormatUrls++;
      result.suspiciousUrls.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('https')) {
      result.httpsCount++;
    } else {
      result.httpCount++;
    }

    const ext = trimmed.split('.').pop()?.toLowerCase().split('?')[0];
    if (ext && validExtensions.includes(ext)) {
      result.validUrls++;
    }
  }

  return result;
}

function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTurkishChars(value: string): string {
  const charMap: Record<string, string> = {
    'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c',
    'İ': 'I', 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'Ö': 'O', 'Ç': 'C',
    'â': 'a', 'î': 'i', 'û': 'u', 'ô': 'o',
    'Â': 'A', 'Î': 'I', 'Û': 'U', 'Ô': 'O',
  };
  return value.replace(/[ığüşöçİĞÜŞÖÇâîûôÂÎÛÔ]/g, (ch) => charMap[ch] || ch);
}

function removeEmojis(value: string): string {
  return value
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .trim();
}

function cleanBarcode(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/[^A-Za-z0-9]/g, '').trim() || null;
}

function generateSku(xmlKey: string, title?: string | null): string {
  if (xmlKey.length <= 20) return xmlKey;
  const prefix = (title || xmlKey).substring(0, 3).toUpperCase();
  const hash = Math.abs(xmlKey.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)).toString(36).toUpperCase();
  return `${prefix}${hash}`;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/</gi, '<')
    .replace(/>/gi, '>')
    .replace(/'/gi, "'")
    .replace(/"/gi, '"')
    .replace(/&/gi, '&')
    .replace(/&(?![a-zA-Z#])/g, '&');
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '));
}

function extractTagValue(content: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(content);
  if (!match) return null;

  let value = match[1];
  const cdataMatch = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) {
    value = cdataMatch[1];
  } else {
    value = stripTags(value);
  }

  value = normalizeTurkishChars(value);
  value = removeEmojis(value);

  return normalizeText(value);
}

const DEFAULT_PURCHASE_PRICE_FIELDS = [
  'purchasePrice',
  'purchase_price',
  'wholesalePrice',
  'wholesale_price',
  'costPrice',
  'cost_price',
  'supplierPrice',
  'supplier_price',
  'tedarikciFiyati',
  'alisfiyati',
  'alisfiyat',
  'alisFiyati',
  'alisFiyat',
  'PurchasePrice',
  'WholesalePrice',
  'CostPrice',
];

function extractPurchasePrice(content: string, purchasePriceField?: string | null): number | null {
  const fieldsToTry = purchasePriceField ? [purchasePriceField, ...DEFAULT_PURCHASE_PRICE_FIELDS] : DEFAULT_PURCHASE_PRICE_FIELDS;
  for (const field of fieldsToTry) {
    const value = extractTagValue(content, field);
    if (value != null) {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

export function parseXmlImportPayload(xml: string, purchasePriceField?: string | null): XmlImportProduct[] {
  const parsed = parseXmlDocument(xml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  const productRegex = /<(product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const matches = Array.from(parsed.source.matchAll(productRegex));

  if (matches.length === 0) {
    return [];
  }

  return matches
    .map((match) => {
      const content = match[2] ?? '';

      const xmlKey = extractTagValue(content, 'xmlKey') || extractTagValue(content, 'id');
      if (!xmlKey) return null;

      // Gerçek varyant yapısı: parent/group kayıtları (AKILLIBAYI1'de YOKTUR).
      const parentId = extractTagValue(content, 'parentId') || extractTagValue(content, 'parent_id') || extractTagValue(content, 'itemParentId');
      const groupId = extractTagValue(content, 'groupId') || extractTagValue(content, 'group_id') || extractTagValue(content, 'itemGroupId');

      const title = extractTagValue(content, 'title') || extractTagValue(content, 'name');
      // P0 BUFFER FIX: tedarikçi PascalCase alanları — yalnız standart alanlar boşsa fallback.
      const sku = extractTagValue(content, 'sku') || extractTagValue(content, 'productCode') || extractTagValue(content, 'modelCode') || extractTagValue(content, 'StockCode');
      const barcode = extractTagValue(content, 'barcode') || extractTagValue(content, 'Gtin');
      const stockValue = extractTagValue(content, 'stock') || extractTagValue(content, 'quantity') || extractTagValue(content, 'StockAmount');
      const minStockValue = extractTagValue(content, 'minStock');
      const priceValue = extractTagValue(content, 'price') || extractTagValue(content, 'listPrice') || extractTagValue(content, 'PriceInclusiveVat');
      const listPriceValue = extractTagValue(content, 'listPrice');
      const taxValue = extractTagValue(content, 'tax') || extractTagValue(content, 'VatRate');
      const currency = extractTagValue(content, 'currency') || extractTagValue(content, 'CurrencyCode');
      const brand = extractTagValue(content, 'brand');
      // P0 BUFFER FIX: kategori alanları yoksa breadcrumb ("Üst -> Orta -> Alt") parçalanır
      let category = extractTagValue(content, 'category');
      let mainCategory = extractTagValue(content, 'main_category');
      let topCategory = extractTagValue(content, 'top_category');
      let subCategory = extractTagValue(content, 'sub_category');
      if (!category && !mainCategory && !topCategory && !subCategory) {
        const breadcrumbRaw = extractTagValue(content, 'CategoryBreadCrumb');
        if (breadcrumbRaw) {
          // P0 BUFFER FIX: entity-encoded ayracı (-&gt;) yerel decode et, sonra böl
          const breadcrumb = breadcrumbRaw.replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
          const parts = breadcrumb.split(/->|—|–/).map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) {
            topCategory = parts[0] || null;
            if (parts.length > 1) mainCategory = parts[1] || null;
            if (parts.length > 2) subCategory = parts[2] || null;
            category = parts[parts.length - 1] || null;
          }
        }
      }
      const description = extractTagValue(content, 'description');
      const detail = extractTagValue(content, 'detail');
      const link = extractTagValue(content, 'link');
      const unit = extractTagValue(content, 'unit');
      const activeValue = extractTagValue(content, 'active');

      // Purchase price extraction — configurable field + common defaults
      const purchasePrice = extractPurchasePrice(content, purchasePriceField);

      const images: string[] = [];

      const imagesTag = extractTagValue(content, 'images') || extractTagValue(content, 'pictures') || extractTagValue(content, 'resimler');
      if (imagesTag) {
        imagesTag.split(',').forEach(img => {
          const trimmed = img.trim();
          if (trimmed && trimmed.startsWith('http')) images.push(trimmed);
        });
      }

      for (let i = 1; i <= 10; i++) {
        const img = extractTagValue(content, `image${i}`) || extractTagValue(content, `picture${i}`) || extractTagValue(content, `resim${i}`);
        if (img && img.startsWith('http')) images.push(img);
      }

      if (images.length === 0) {
        const singleImg = extractTagValue(content, 'image') || extractTagValue(content, 'picture') || extractTagValue(content, 'resim') || extractTagValue(content, 'img') || extractTagValue(content, 'gorsel');
        if (singleImg && singleImg.startsWith('http')) images.push(singleImg);
      }

      if (images.length === 0) {
        const imageUrlRegex = /<image[^>]*>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/image>/gi;
        const urlMatches = Array.from(content.matchAll(imageUrlRegex));
        urlMatches.forEach(m => {
          const url = m[1]?.trim();
          if (url && url.startsWith('http')) images.push(url);
        });
      }

      if (images.length === 0) {
        const urlRegex = /(https?:\/\/[^\s"'<>]+(?:jpg|jpeg|png|gif|webp|bmp))/gi;
        const urlMatches = Array.from(content.matchAll(urlRegex));
        urlMatches.forEach(m => {
          const url = m[1]?.trim();
          if (url && !images.includes(url)) images.push(url);
        });
      }

      return {
        xmlKey,
        title: title || null,
        sku: sku || generateSku(xmlKey, title),
        barcode: cleanBarcode(barcode),
        stock: Number.parseInt(stockValue ?? '0', 10),
        minStock: Number.parseInt(minStockValue ?? '0', 10),
        price: priceValue ? Number.parseFloat(priceValue) : null,
        listPrice: listPriceValue ? Number.parseFloat(listPriceValue) : null,
        tax: taxValue ? Number.parseFloat(taxValue) : null,
        currency: currency || null,
        brand: brand || null,
        category: category || null,
        mainCategory: mainCategory || null,
        topCategory: topCategory || null,
        subCategory: subCategory || null,
        description: description || null,
        detail: detail || null,
        images: images.length > 0 ? images.join(',') : null,
        link: link || null,
        unit: unit || null,
        active: activeValue === '1',
        parentId: parentId || null,
        groupId: groupId || null,
        purchasePrice,
      } satisfies XmlImportProduct;
    })
    .filter((item): item is XmlImportProduct => item != null);
}

const syncLocks = new Map<string, boolean>();
const abortControllers = new Map<string, AbortController>();

const BATCH_SIZE = 500;

export function cancelSync(sourceId: string): boolean {
  const controller = abortControllers.get(sourceId);
  if (controller) {
    controller.abort();
    abortControllers.delete(sourceId);
    syncLocks.delete(sourceId);
    console.log(`[Import] Sync cancelled for source ${sourceId}`);
    return true;
  }
  return false;
}

export function isSyncLocked(sourceId: string): boolean {
  return syncLocks.get(sourceId) === true;
}

function applyImportFilter(items: XmlImportProduct[], filter?: XmlImportFilter): { filtered: XmlImportProduct[]; filteredCount: number } {
  if (!filter) return { filtered: items, filteredCount: 0 };

  let filtered = [...items];
  let filteredCount = 0;

  if (filter.filterOutOfStock) {
    const before = filtered.length;
    filtered = filtered.filter(item => item.stock > 0);
    filteredCount += before - filtered.length;
  }

  if (filter.includeCategories && filter.includeCategories.length > 0) {
    const cats = filter.includeCategories.map(c => c.toLowerCase());
    const before = filtered.length;
    filtered = filtered.filter(item => {
      const itemCats = [item.category, item.mainCategory, item.subCategory, item.topCategory]
        .filter(Boolean)
        .map(c => c!.toLowerCase());
      return itemCats.some(ic => cats.some(c => ic.includes(c)));
    });
    filteredCount += before - filtered.length;
  }

  if (filter.excludeBrands && filter.excludeBrands.length > 0) {
    const brands = filter.excludeBrands.map(b => b.toLowerCase());
    const before = filtered.length;
    filtered = filtered.filter(item => !item.brand || !brands.some(b => item.brand!.toLowerCase().includes(b)));
    filteredCount += before - filtered.length;
  }

  if (filter.minPrice != null) {
    const before = filtered.length;
    filtered = filtered.filter(item => item.price == null || item.price >= filter.minPrice!);
    filteredCount += before - filtered.length;
  }

  if (filter.maxPrice != null) {
    const before = filtered.length;
    filtered = filtered.filter(item => item.price == null || item.price <= filter.maxPrice!);
    filteredCount += before - filtered.length;
  }

  if (filter.searchKeywords && filter.searchKeywords.length > 0) {
    const keywords = filter.searchKeywords.map(k => k.toLowerCase());
    const before = filtered.length;
    filtered = filtered.filter(item => {
      const searchText = [item.title, item.sku, item.barcode, item.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return keywords.some(k => searchText.includes(k));
    });
    filteredCount += before - filtered.length;
  }

  if (filter.includeBarcodes && filter.includeBarcodes.length > 0) {
    const barcodes = filter.includeBarcodes.map(b => b.toLowerCase());
    const before = filtered.length;
    filtered = filtered.filter(item => item.barcode && barcodes.includes(item.barcode.toLowerCase()));
    filteredCount += before - filtered.length;
  }

  return { filtered, filteredCount };
}

export async function importXmlProducts(xml: string, options?: { actorUserId?: string | null; sourceName?: string | null; sourceId?: string | null; signal?: AbortSignal; filter?: XmlImportFilter }) {
  const parsed = parseXmlDocument(xml);
  if (!parsed.ok) {
    return { ok: false, error: { code: 'INVALID_XML', message: parsed.error }, importedCount: 0, updatedCount: 0, items: [] } satisfies XmlImportResult;
  }

  if (options?.signal?.aborted) {
    return { ok: false, error: { code: 'CANCELLED', message: 'Senkronizasyon iptal edildi' }, importedCount: 0, updatedCount: 0, items: [] } satisfies XmlImportResult;
  }

  // Fetch sourceRecord early to get purchasePriceField for XML parsing
  let sourceRecord = null as Awaited<ReturnType<typeof prisma.xmlSource.findFirst>> | null;
  if (options?.sourceId) {
    sourceRecord = await prisma.xmlSource.findUnique({ where: { id: options.sourceId } });
  } else if (options?.sourceName) {
    sourceRecord = await prisma.xmlSource.findFirst({ where: { name: options.sourceName } });
  }

  const items = parseXmlImportPayload(xml, sourceRecord?.purchasePriceField ?? null);

  if (items.length === 0) {
    return { ok: true, importedCount: 0, updatedCount: 0, skippedCount: 0, items: [] } satisfies XmlImportResult;
  }

  const { filtered: filteredItems, filteredCount } = applyImportFilter(items, options?.filter);
  if (filteredCount > 0) {
    console.log(`[Import] Filter applied: ${filteredCount} items filtered out, ${filteredItems.length} remaining`);
  }

  // VERİ KÖPRÜSÜ: kaynak garantile — ürünler asla xmlSourceId=null kalmaz
  let sourceId = sourceRecord?.id ?? '';
  if (!sourceId) {
    const newSource = await prisma.xmlSource.create({
      data: { name: options?.sourceName ?? 'manual-import', sourceType: 'MANUAL', active: true, scheduleIntervalMinutes: 60 },
    });
    sourceId = newSource.id;
  }

  const lockKey = sourceId || 'global';

  if (syncLocks.get(lockKey)) {
    console.log(`[Import] Sync already in progress for ${options?.sourceName || lockKey}, skipping...`);
    return { ok: false, error: { code: 'SYNC_IN_PROGRESS', message: 'Bu kaynak için senkronizasyon zaten devam ediyor' }, importedCount: 0, updatedCount: 0, items: [] } satisfies XmlImportResult;
  }

  syncLocks.set(lockKey, true);

  try {
    // CHECKPOINT/RESUME: önceki yarıda kalmış (stale 'running') çalışmayı işaretle.
    // Silme yok; yalnızca durum güncellemesi (idempotent). Veriler ürün bazında
    // zaten unique upsert olduğu için yeni çalışma kaldığı yerden güvenle sürer.
    try {
      await prisma.xmlImportRun.updateMany({
        where: { sourceId, status: 'running' },
        data: { status: 'interrupted', errorDetail: 'Interrupted by new import run (resume)' },
      });
    } catch (staleErr) {
      console.error('[Import] Stale-run marking failed:', staleErr);
    }

    const run = await prisma.xmlImportRun.create({
      data: {
        sourceId,
        status: 'running',
        totalProducts: items.length,
      },
    });

    const results = [] as Array<{ xmlKey: string; created: boolean; matchedBy?: 'xmlKey' | 'sku'; outcome: string; errorDetail?: string }>;
    let failedCount = 0;
    // TASK314 tombstone sayaçları mevcut skippedCount'a entegre (ayrı değişken gerekmez)
    let skippedCount = 0;

    const allCategories = await prisma.category.findMany({ select: { id: true, name: true } });
    const categoryMap = new Map(allCategories.map(c => [c.name.toLowerCase(), c.id]));
    const allBrands = await prisma.brand.findMany({ select: { id: true, name: true } });
    const brandMap = new Map(allBrands.map(b => [b.name.toLowerCase(), b.id]));
    const allActiveMarketplaces = await prisma.marketplace.findMany({ where: { active: true }, select: { id: true, apiKey: true, apiSecret: true, apiUrl: true } });
    const activeMarketplaces = allActiveMarketplaces.filter(mp => isMarketplaceOperational(mp));
    const activeMarketplaceIds = activeMarketplaces.map(m => m.id);
    if (activeMarketplaceIds.length === 0) {
      console.warn('[Import] ⚠ UYARI: Operasyonel pazaryeri bulunmuyor! PMS creation atlanacak. Ürünler import sonrası reconcile edilmeli.');
    }

    // DEFAULT FALLBACK: kategorisiz/markasız ürün kalmasın
    const defaultCategory = await prisma.category.upsert({ where: { name: 'Genel' }, update: {}, create: { name: 'Genel' } });
    const defaultBrand = await prisma.brand.upsert({ where: { name: 'Bilinmeyen' }, update: {}, create: { name: 'Bilinmeyen' } });

    // OTOMATİK ŞABLON: aktif pazaryerleri için varsayılan listing şablonu garantile
    try {
      await ensureDefaultListingTemplates();
    } catch (e) {
      console.error('[Import] ensureDefaultListingTemplates failed:', e);
    }

    const seenXmlKeys = new Set<string>();
    const uniqueItems = filteredItems.filter(item => {
      if (seenXmlKeys.has(item.xmlKey)) {
        skippedCount++;
        return false;
      }
      seenXmlKeys.add(item.xmlKey);
      return true;
    });

    // GERÇEK VARIANT TANIMI: yalnızca aynı parent/group altında 2+ satılabilir
    // seçenek varsa ürün varyantlıdır. Başlıktaki renk/beden/numara/ölçü ASLA varyant değildir.
    const groupCounts = new Map<string, number>();
    for (const it of uniqueItems) {
      const gk = it.parentId || it.groupId;
      if (gk) groupCounts.set(gk, (groupCounts.get(gk) || 0) + 1);
    }

    for (let i = 0; i < uniqueItems.length; i += BATCH_SIZE) {
      if (options?.signal?.aborted) {
        // CHECKPOINT: yarıda kesildi — mevcut işlenmiş ürünler kayıtlıdır;
        // yeni çalışma kaldığı yerden devam eder (unique upsert + PMS unique pair).
        await prisma.xmlImportRun.update({
          where: { id: run.id },
          data: { status: 'interrupted', errorDetail: 'Aborted via signal (resumable)', finishedAt: new Date() },
        });
        return {
          ok: false,
          error: { code: 'CANCELLED', message: 'Senkronizasyon iptal edildi (resumable)' },
          importedCount: results.filter(r => r.outcome === 'created').length,
          updatedCount: results.filter(r => r.outcome === 'updated').length,
          items: results,
          runId: run.id,
        } satisfies XmlImportResult;
      }
      const batch = uniqueItems.slice(i, i + BATCH_SIZE);
      const batchResults: typeof results = [];

      // FIX(2M): Toplu mevcut ürün kontrolü — N+1 kaldırıldı (500'e kadar ürün tek sorguda)
      const batchXmlKeys = batch.map(it => it.xmlKey);
      const existingProducts = await prisma.product.findMany({
        where: { xmlKey: { in: batchXmlKeys } },
        select: { id: true, xmlKey: true, matchedBy: true, categoryMatch: true, status: true, variantMatch: true, variantStatus: true },
      });
      const existingMap = new Map(existingProducts.map(p => [p.xmlKey, p]));

      const protectedMatchedBys = ['manual', 'ai', 'auto', 'verified', 'canonical'];
      const toCreate: typeof batch = [];
      const toUpdate: typeof batch = [];

      for (const item of batch) {
        const existing = existingMap.get(item.xmlKey);
        if (existing && existing.status === 'DELETED') {
          skippedCount++;
          batchResults.push({ xmlKey: item.xmlKey, created: false, outcome: 'skipped_deleted', errorDetail: 'kullanıcı silmiş (tombstone)' });
          continue;
        }
        if (existing) {
          toUpdate.push(item);
        } else {
          toCreate.push(item);
        }
      }

      // Yeni ürünler — bulk createMany (skipDuplicates ile çakışma koruması)
      if (toCreate.length > 0) {
        const createData = toCreate.map(item => {
          const categoryParts = [item.topCategory, item.mainCategory, item.subCategory, item.category].filter(Boolean);
          const supplierCategory = categoryParts.length > 0 ? categoryParts.join(' > ') : null;
          const catName = (item.category || item.subCategory || item.mainCategory || item.topCategory || '').toLowerCase().trim();
          const categoryId = catName ? categoryMap.get(catName) || defaultCategory.id : defaultCategory.id;
          const brandName = (item.brand || '').toLowerCase().trim();
          const brandId = brandName ? brandMap.get(brandName) || defaultBrand.id : defaultBrand.id;
          const groupKey = item.parentId || item.groupId;
          const hasVariants = !!groupKey && (groupCounts.get(groupKey) || 0) > 1;

          return {
            xmlKey: item.xmlKey,
            title: item.title,
            sku: item.sku,
            barcode: item.barcode,
            stock: Number.isFinite(item.stock) ? item.stock : 0,
            minStock: Number.isFinite(item.minStock) ? item.minStock : 0,
            // KANONİK MALİYET: XML PriceInclusiveVat = B2B toptan ALIŞ (KDV dahil).
            // purchasePrice canonical maliyet alanıdır. salePrice yalnız geri-uyumluluk aynasıdır
            // (maliyet olarak KULLANILMAZ; tüketiciler purchasePrice ?? salePrice okur).
            purchasePrice: item.purchasePrice ?? item.price,
            salePrice: item.price,
            vatRate: item.tax,
            description: item.description,
            images: item.images,
            link: item.link,
            unit: item.unit,
            currency: item.currency,
            detail: item.detail,
            categoryId,
            brandId,
            xmlBrandName: item.brand || null,
            supplierCategory,
            categoryMatch: false,
            brandMatch: true,
            variantMatch: false,
            variantStatus: hasVariants ? 'WAITING_AI' : 'NOT_REQUIRED',
            templateMatch: true,
            status: 'XML' as const,
            xmlSourceId: sourceId,
          };
        });

        try {
          await prisma.product.createMany({ data: createData });
        } catch (e: any) {
          // P2002 = unique constraint — race condition ile zaten eklendi, sorun yok
          if (e?.code !== 'P2002') {
            console.error('[Import] createMany failure:', e);
          }
        }

        // Oluşturulan ürünleri IDs ile çek (PMS reconcile için gerekli)
        const createdXmlKeys = createData.map(d => d.xmlKey);
        const createdProducts = await prisma.product.findMany({
          where: { xmlKey: { in: createdXmlKeys } },
          select: { id: true, xmlKey: true },
        });
        const createdMap = new Map(createdProducts.map(p => [p.xmlKey, p]));

        // FIX(2M): Toplu PMS reconcile — ürün başına N+1 sorgu yerine tek raw SQL
        const createdIds = createdProducts.map(p => p.id);
        for (const mpId of activeMarketplaceIds) {
          reconcileProductMarketplaceStateBulk(createdIds, mpId).catch(() => null);
        }
        queueReconcileProductGatesBulk(createdIds);

        for (const item of toCreate) {
          const created = createdMap.get(item.xmlKey);
          if (created) {
            batchResults.push({ xmlKey: item.xmlKey, created: true, outcome: 'created' });
          } else {
            // createMany skipDuplicates — muhtemelen race condition ile eklendi
            batchResults.push({ xmlKey: item.xmlKey, created: false, outcome: 'updated' });
          }
        }
      }

      // Mevcut ürünler — bulk update (koruma kontrolü ile)
      if (toUpdate.length > 0) {
        for (const item of toUpdate) {
          try {
            const existing = existingMap.get(item.xmlKey)!;
            const categoryParts = [item.topCategory, item.mainCategory, item.subCategory, item.category].filter(Boolean);
            const supplierCategory = categoryParts.length > 0 ? categoryParts.join(' > ') : null;
            const catName = (item.category || item.subCategory || item.mainCategory || item.topCategory || '').toLowerCase().trim();
            const categoryId = catName ? categoryMap.get(catName) || defaultCategory.id : defaultCategory.id;
            const brandName = (item.brand || '').toLowerCase().trim();
            const brandId = brandName ? brandMap.get(brandName) || defaultBrand.id : defaultBrand.id;
            const groupKey = item.parentId || item.groupId;
            const hasVariants = !!groupKey && (groupCounts.get(groupKey) || 0) > 1;
            const hasProtectedMatch = existing.categoryMatch && existing.matchedBy && protectedMatchedBys.includes(existing.matchedBy);

            await prisma.product.update({
              where: { xmlKey: item.xmlKey },
              data: {
                title: item.title,
                sku: item.sku,
                barcode: item.barcode,
                stock: Number.isFinite(item.stock) ? item.stock : 0,
                minStock: Number.isFinite(item.minStock) ? item.minStock : 0,
                // KANONİK MALİYET (bkz. create yolu).
                purchasePrice: item.purchasePrice ?? item.price,
                salePrice: item.price,
                vatRate: item.tax,
                description: item.description,
                images: item.images,
                link: item.link,
                unit: item.unit,
                currency: item.currency,
                detail: item.detail,
                ...(hasProtectedMatch ? {} : {
                  categoryId: categoryId || defaultCategory.id,
                  categoryMatch: false,
                  matchedBy: null,
                  aiScore: null,
                  aiSuggestedCategoryId: null,
                  lastMatchDate: null,
                }),
                brandId: brandId || defaultBrand.id,
                xmlBrandName: item.brand || null,
                supplierCategory,
                brandMatch: true,
                variantMatch: hasProtectedMatch ? existing.variantMatch : false,
                variantStatus: hasProtectedMatch ? existing.variantStatus : (hasVariants ? 'WAITING_AI' : 'NOT_REQUIRED'),
                templateMatch: true,
                status: 'XML',
                xmlSourceId: sourceId,
              },
            });
            batchResults.push({ xmlKey: item.xmlKey, created: false, outcome: 'updated' });
          } catch (err) {
            failedCount++;
            batchResults.push({ xmlKey: item.xmlKey, created: false, outcome: 'failed', errorDetail: String(err) });
          }
        }

        // FIX(2M): Toplu reconcilePMS — mevcut ürünler için tek raw SQL
        const updatedIds = toUpdate
          .map(item => existingMap.get(item.xmlKey)?.id)
          .filter(Boolean) as string[];
        for (const mpId of activeMarketplaceIds) {
          reconcileProductMarketplaceStateBulk(updatedIds, mpId).catch(() => null);
        }
        queueReconcileProductGatesBulk(updatedIds);
      }

      results.push(...batchResults);

      await prisma.xmlImportRun.update({
        where: { id: run.id },
        data: {
          newProducts: results.filter(r => r.outcome === 'created').length,
          updatedProducts: results.filter(r => r.outcome === 'updated').length,
          failedProducts: failedCount,
        },
      });
    }

    const totalImported = results.filter(r => r.outcome === 'created').length;
    const totalUpdated = results.filter(r => r.outcome === 'updated').length;
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - run.startedAt.getTime();

    await prisma.xmlImportRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        durationMs,
        status: 'completed',
        newProducts: totalImported,
        updatedProducts: totalUpdated,
        failedProducts: failedCount,
        skippedProducts: skippedCount,
      },
    });

    await prisma.xmlSource.update({
      where: { id: run.sourceId },
      data: {
        lastRunAt: finishedAt,
        lastSuccessAt: finishedAt,
        lastError: null,
      },
    });

    invalidateDashboardStatsCache();
    invalidateTitleIndex().catch(() => null); // non-blocking title index refresh

    await prisma.auditLog.create({
      data: {
        action: 'xml.import.success',
        actorUserId: options?.actorUserId ?? null,
        meta: JSON.stringify({
          sourceName: options?.sourceName ?? null,
          importedCount: totalImported,
          updatedCount: totalUpdated,
          totalItems: results.length,
        }),
      },
    });

    try {
      await prisma.notification.create({
        data: {
          type: 'xml_import',
          title: `XML İçe Aktarma: ${options?.sourceName || 'Manuel'}`,
          message: `${totalImported} yeni, ${totalUpdated} güncellendi, ${failedCount} hatalı, ${skippedCount} atlanan (${(durationMs / 1000).toFixed(1)}sn)`,
        },
      });
    } catch (notifError) {
      console.error('[Import] Notification creation failed:', notifError);
    }

    console.log(`[Import] Completed: ${totalImported} created, ${totalUpdated} updated, ${failedCount} failed, ${skippedCount} skipped in ${durationMs}ms`);

    return {
      ok: true,
      importedCount: totalImported,
      updatedCount: totalUpdated,
      skippedCount,
      failedCount,
      filteredCount,
      items: results,
      runId: run.id,
    } satisfies XmlImportResult;
  } finally {
    syncLocks.delete(lockKey);
  }
}

export async function fetchXmlFromUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`XML fetch failed with status ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error('XML content is empty');
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}
