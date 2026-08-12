// ==================== LİSTELEME ŞABLONU V3 ENTERPRISE ====================
import { prisma } from '../db/prisma.ts';

// ==================== TİPLER ====================

export interface PriceRangeRule {
  min: number;
  max: number;
  multiplier: number;
  fixedAmount: number;
}

export interface ExcludeRules {
  categories: string[];
  brands: string[];
  suppliers: string[];
  products: string[];
  skus: string[];
  barcodes: string[];
}

export interface DescriptionBlock {
  type: 'text' | 'table' | 'list' | 'techspecs' | 'ai' | 'block';
  content: string;
  title?: string;
  order: number;
}

export interface ValidationConfig {
  checkTitleEmpty: boolean;
  checkTitleLength: boolean;
  checkTitleForbiddenWords: boolean;
  checkTitleDuplicateBrand: boolean;
  checkDescriptionEmpty: boolean;
  checkDescriptionLength: boolean;
  checkImagesEmpty: boolean;
  checkImagesCount: boolean;
  checkImagesSize: boolean;
  checkPriceValid: boolean;
  checkPriceRange: boolean;
  checkStockValid: boolean;
  checkBarcodeValid: boolean;
  checkBarcodeLength: boolean;
  checkCategoryMatch: boolean;
  checkBrandMatch: boolean;
  checkVariantMatch: boolean;
  checkCommissionRate: boolean;
}

export interface ValidationResult {
  passed: boolean;
  score: number;
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  field: string;
  label: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface PriceSimulationResult {
  productId: string;
  productTitle: string;
  purchasePrice: number | null;
  salePrice: number | null;
  oldPrice: number | null;
  newPrice: number;
  profit: number;
  profitMargin: number;
  commission: number;
  commissionRate: number;
  vat: number;
  vatRate: number;
  netPrice: number;
  currency: string;
}

export interface ListingPreview {
  title: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  stock: number;
  barcode: string;
  sku: string;
  category: string;
  brand: string;
  variantInfo: Record<string, string>[];
  validation: ValidationResult;
  jsonPayload: Record<string, unknown>;
  xmlPayload: string;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  checkTitleEmpty: true,
  checkTitleLength: true,
  checkTitleForbiddenWords: true,
  checkTitleDuplicateBrand: true,
  checkDescriptionEmpty: false,
  checkDescriptionLength: true,
  checkImagesEmpty: true,
  checkImagesCount: true,
  checkImagesSize: false,
  checkPriceValid: true,
  checkPriceRange: false,
  checkStockValid: true,
  checkBarcodeValid: true,
  checkBarcodeLength: true,
  checkCategoryMatch: true,
  checkBrandMatch: true,
  checkVariantMatch: true,
  checkCommissionRate: true,
};

// ==================== FİYAT MOTORU ====================

export function calculatePrice(
  product: {
    purchasePrice: number | null;
    salePrice: number | null;
    vatRate: number | null;
    commissionRate?: number | null;
  },
  template: {
    priceSource: string;
    vatMode: string;
    priceMultiplier: number;
    priceFixedAmount: number;
    priceRangeRules: string | null;
    vatRate: number | null;
    commissionRate: number | null;
  }
): { price: number; vat: number; commission: number; profit: number; vatRate: number; commissionRate: number } {
  let basePrice = 0;
  switch (template.priceSource) {
    case 'XML_PURCHASE': basePrice = product.purchasePrice ?? 0; break;
    case 'XML_SALE': basePrice = product.salePrice ?? 0; break;
    case 'FIXED': basePrice = 0; break;
    case 'AI_CALCULATE': basePrice = product.purchasePrice ?? product.salePrice ?? 0; break;
    default: basePrice = product.purchasePrice ?? 0;
  }
  if (basePrice <= 0) basePrice = 1;

  let multiplier = template.priceMultiplier;
  let fixedAmount = template.priceFixedAmount;

  if (template.priceRangeRules) {
    try {
      const rangeRules: PriceRangeRule[] = JSON.parse(template.priceRangeRules);
      for (const rule of rangeRules) {
        if (basePrice >= rule.min && basePrice <= rule.max) {
          multiplier = rule.multiplier;
          fixedAmount = rule.fixedAmount;
          break;
        }
      }
    } catch { /* ignore */ }
  }

  let finalPrice = basePrice * multiplier + fixedAmount;

  const vatRate = template.vatRate ?? product.vatRate ?? 20;
  let vat = 0;

  switch (template.vatMode) {
    case 'INCLUDED':
      vat = finalPrice - (finalPrice / (1 + vatRate / 100));
      break;
    case 'EXCLUDED':
      vat = finalPrice * (vatRate / 100);
      break;
    case 'BY_CATEGORY':
      vat = finalPrice - (finalPrice / (1 + vatRate / 100));
      break;
    case 'AUTO':
      if (vatRate === 0) { vat = finalPrice * (vatRate / 100); }
      else { vat = finalPrice - (finalPrice / (1 + vatRate / 100)); }
      break;
    default:
      vat = finalPrice - (finalPrice / (1 + vatRate / 100));
  }

  const priceWithVat = finalPrice + (finalPrice * vatRate / 100);
  const commissionRate = template.commissionRate ?? product.commissionRate ?? 0;
  const commission = priceWithVat * (commissionRate / 100);
  const profit = priceWithVat - commission - basePrice;

  return {
    price: Math.round(finalPrice * 100) / 100,
    vat: Math.round((finalPrice * vatRate / 100) * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    vatRate,
    commissionRate,
  };
}

// ==================== BAŞLIK RENDER ====================

export function renderTitle(
  product: {
    title: string | null;
    originalTitle?: string | null;
    brand?: { name: string } | null;
    category?: { name: string } | null;
    variants?: { name: string; value: string }[];
    sku?: string | null;
    barcode?: string | null;
    stock?: number | null;
    salePrice?: number | null;
    purchasePrice?: number | null;
    vatRate?: number | null;
    commissionRate?: number | null;
    profitMargin?: number | null;
    seoTitle?: string | null;
  },
  titleFormat: string,
  maxLength?: number | null
): string {
  if (!titleFormat) return product.title || '';

  const brandName = product.brand?.name || '';
  const categoryName = product.category?.name || '';
  const variants = product.variants || [];

  let color = '', size = '', numberVal = '', gender = '', material = '', model = '';
  for (const v of variants) {
    const n = v.name.toLowerCase();
    const val = v.value;
    if (n.includes('renk') || n.includes('color')) color = val;
    else if (n.includes('beden') || n.includes('size') || n.includes('ebat')) size = val;
    else if (n.includes('numara') || n.includes('number')) numberVal = val;
    else if (n.includes('cinsiyet') || n.includes('gender')) gender = val;
    else if (n.includes('materyal') || n.includes('material')) material = val;
    else if (n.includes('model')) model = val;
  }

  const variables: Record<string, string> = {
    '{{Marka}}': brandName,
    '{{ÜrünAdı}}': product.title || '',
    '{{Renk}}': color,
    '{{Beden}}': size,
    '{{Numara}}': numberVal,
    '{{Model}}': model || product.title?.split(' ').slice(1).join(' ') || '',
    '{{Kategori}}': categoryName,
    '{{SKU}}': product.sku || '',
    '{{Barkod}}': product.barcode || '',
    '{{Stok}}': String(product.stock ?? ''),
    '{{Fiyat}}': product.salePrice ? `${product.salePrice.toFixed(2)} TL` : '',
    '{{KDV}}': product.vatRate ? `%${product.vatRate}` : '',
    '{{Komisyon}}': product.commissionRate ? `%${product.commissionRate}` : '',
    '{{KarMarjı}}': product.profitMargin ? `%${product.profitMargin}` : '',
    '{{Cinsiyet}}': gender,
    '{{Materyal}}': material,
    '{{SEO_Başlık}}': product.seoTitle || '',
    '{{OrijinalBaşlık}}': product.title || '',
  };

  let result = titleFormat;
  for (const [key, val] of Object.entries(variables)) {
    result = result.replaceAll(key, val || '');
  }

  result = result.replace(/\s+/g, ' ').trim();
  result = result.replace(/(\s*\|\s*){2,}/g, ' | ');

  if (maxLength && result.length > maxLength) {
    result = result.substring(0, maxLength - 3) + '...';
  }

  return result || product.title || '';
}

// ==================== AÇIKLAMA RENDER ====================

export function renderDescription(
  product: {
    title: string | null;
    description: string | null;
    technicalSpecs?: string | null;
    brand?: { name: string } | null;
    category?: { name: string } | null;
    variants?: { name: string; value: string }[];
  },
  descriptionBlocks: string | null,
  defaultDescription?: string | null
): string {
  if (!descriptionBlocks) {
    return defaultDescription || product.description || product.title || '';
  }

  try {
    const blocks: DescriptionBlock[] = JSON.parse(descriptionBlocks);
    blocks.sort((a, b) => a.order - b.order);

    const brandName = product.brand?.name || '';
    const categoryName = product.category?.name || '';
    const variants = product.variants || [];
    const productName = product.title || '';

    let html = '';
    for (const block of blocks) {
      switch (block.type) {
        case 'text': {
          let content = block.content
            .replaceAll('{{Marka}}', brandName)
            .replaceAll('{{ÜrünAdı}}', productName)
            .replaceAll('{{Kategori}}', categoryName);
          if (block.title) html += `<h2>${block.title}</h2>\n`;
          html += `<p>${content}</p>\n`;
          break;
        }
        case 'table': {
          html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%">\n`;
          if (block.title) html += `<caption><strong>${block.title}</strong></caption>\n`;
          const rows = block.content.split('\n').filter(r => r.trim());
          for (const row of rows) {
            const cells = row.split('|').map(c => c.trim());
            if (cells.length >= 2) {
              html += `<tr><td style="font-weight:bold;width:40%">${cells[0]}</td><td>${cells.slice(1).join(' | ')}</td></tr>\n`;
            }
          }
          html += `</table>\n`;
          break;
        }
        case 'list': {
          if (block.title) html += `<h3>${block.title}</h3>\n`;
          html += `<ul>\n`;
          const items = block.content.split('\n').filter(r => r.trim());
          for (const item of items) {
            let processed = item
              .replaceAll('{{Marka}}', brandName)
              .replaceAll('{{ÜrünAdı}}', productName);
            html += `<li>${processed}</li>\n`;
          }
          html += `</ul>\n`;
          break;
        }
        case 'techspecs': {
          if (product.technicalSpecs) {
            html += `<div class="technical-specs">\n${product.technicalSpecs}\n</div>\n`;
          }
          break;
        }
        case 'ai': {
          if (product.description) {
            let content = product.description
              .replaceAll('{{Marka}}', brandName)
              .replaceAll('{{ÜrünAdı}}', productName);
            html += `<div class="ai-description">${content}</div>\n`;
          }
          break;
        }
        case 'block': {
          let content = block.content
            .replaceAll('{{Marka}}', brandName)
            .replaceAll('{{ÜrünAdı}}', productName)
            .replaceAll('{{Kategori}}', categoryName);
          html += `${content}\n`;
          break;
        }
      }
    }

    if (variants.length > 0) {
      html += `<h3>Ürün Özellikleri</h3>\n<ul>\n`;
      for (const v of variants) {
        html += `<li><strong>${v.name}:</strong> ${v.value}</li>\n`;
      }
      html += `</ul>\n`;
    }

    return html;
  } catch {
    return defaultDescription || product.description || product.title || '';
  }
}

// ==================== DOĞRULAMA MOTORU ====================

export function validateProduct(
  product: {
    title: string | null;
    originalTitle?: string | null;
    description: string | null;
    images: string | null;
    purchasePrice: number | null;
    salePrice: number | null;
    stock: number | null;
    barcode: string | null;
    sku: string | null;
    categoryId: string | null;
    brandId: string | null;
    categoryMatch: boolean;
    brandMatch: boolean;
    variantMatch: boolean;
    variants?: { name: string; value: string }[];
    commissionRate?: number | null;
    vatRate?: number | null;
  },
  template: {
    titleFormat?: string | null;
    titleMaxLength?: number | null;
    imageMinCount?: number | null;
    imageMaxCount?: number | null;
    imageMinSize?: number | null;
    validationRules?: string | null;
    commissionRate?: number | null;
  },
  forbiddenWords?: string[]
): ValidationResult {
  const config: ValidationConfig = { ...DEFAULT_VALIDATION_CONFIG };

  if (template.validationRules) {
    try {
      const rules = JSON.parse(template.validationRules);
      for (const [key, value] of Object.entries(rules)) {
        if (key in config) { (config as any)[key] = value; }
      }
    } catch { /* ignore */ }
  }

  const checks: ValidationCheck[] = [];
  const title = product.title || product.originalTitle || '';
  const images = product.images ? product.images.split(',').filter(Boolean) : [];
  const desc = product.description || '';
  const variants = product.variants || [];

  if (config.checkTitleEmpty) {
    checks.push({ field: 'title', label: 'Başlık dolu', passed: title.trim().length > 0, message: title.trim().length > 0 ? 'Başlık mevcut' : 'Başlık boş', severity: 'error' });
  }

  if (config.checkTitleLength && template.titleMaxLength) {
    const maxLen = template.titleMaxLength;
    checks.push({ field: 'titleLength', label: `Başlık ≤${maxLen} karakter`, passed: title.length <= maxLen, message: `${title.length}/${maxLen} karakter`, severity: title.length > maxLen ? 'error' : 'info' });
  }

  if (config.checkTitleForbiddenWords && forbiddenWords && forbiddenWords.length > 0) {
    const foundWords = forbiddenWords.filter(w => title.toLowerCase().includes(w.toLowerCase()));
    checks.push({ field: 'titleForbidden', label: 'Yasaklı kelime yok', passed: foundWords.length === 0, message: foundWords.length > 0 ? `Yasaklı kelimeler: ${foundWords.join(', ')}` : 'Temiz', severity: 'error' });
  }

  if (config.checkTitleDuplicateBrand) {
    const brandNames = title.match(/[A-ZÇĞİÖŞÜ][a-zçğıöşü]+/g) || [];
    const hasDuplicate = brandNames.length > 1 && new Set(brandNames.map(b => b.toLowerCase())).size < brandNames.length;
    checks.push({ field: 'titleDuplicateBrand', label: 'Çift marka yok', passed: !hasDuplicate, message: hasDuplicate ? 'Başlıkta muhtemel çift marka var' : 'Temiz', severity: 'warning' });
  }

  if (config.checkDescriptionEmpty) {
    checks.push({ field: 'description', label: 'Açıklama dolu', passed: desc.trim().length > 0, message: desc.trim().length > 0 ? 'Açıklama mevcut' : 'Açıklama boş', severity: 'warning' });
  }

  if (config.checkImagesEmpty) {
    checks.push({ field: 'images', label: 'Görsel mevcut', passed: images.length > 0, message: images.length > 0 ? `${images.length} görsel` : 'Görsel yok', severity: 'error' });
  }

  if (config.checkImagesCount && (template.imageMinCount || template.imageMaxCount)) {
    const minOk = template.imageMinCount ? images.length >= template.imageMinCount : true;
    const maxOk = template.imageMaxCount ? images.length <= template.imageMaxCount : true;
    checks.push({ field: 'imagesCount', label: `Görsel sayısı ${template.imageMinCount || 0}-${template.imageMaxCount || '∞'}`, passed: minOk && maxOk, message: `${images.length} görsel`, severity: !minOk ? 'error' : 'warning' });
  }

  if (config.checkPriceValid) {
    const price = product.salePrice || product.purchasePrice || 0;
    checks.push({ field: 'price', label: 'Fiyat geçerli', passed: price > 0, message: price > 0 ? `${price.toFixed(2)} TL` : 'Fiyat yok', severity: 'error' });
  }

  if (config.checkStockValid) {
    const stock = product.stock ?? 0;
    checks.push({ field: 'stock', label: 'Stok > 0', passed: stock > 0, message: stock > 0 ? `${stock} adet` : 'Stok yok', severity: 'error' });
  }

  if (config.checkBarcodeValid) {
    const barcode = product.barcode || '';
    const isNumeric = /^\d+$/.test(barcode);
    checks.push({ field: 'barcode', label: 'Barkod geçerli', passed: barcode.length > 0 && isNumeric, message: !barcode ? 'Barkod yok' : !isNumeric ? 'Sayısal olmalı' : barcode, severity: 'warning' });
  }

  if (config.checkCategoryMatch) {
    checks.push({ field: 'category', label: 'Kategori eşleşmiş', passed: product.categoryMatch || product.categoryId !== null, message: product.categoryMatch ? 'Eşleşmiş' : 'Eşleşmemiş', severity: 'error' });
  }

  if (config.checkBrandMatch) {
    checks.push({ field: 'brand', label: 'Marka eşleşmiş', passed: product.brandMatch || product.brandId !== null, message: product.brandMatch ? 'Eşleşmiş' : 'Eşleşmemiş', severity: 'error' });
  }

  if (config.checkVariantMatch) {
    checks.push({ field: 'variant', label: 'Varyant eşleşmiş', passed: product.variantMatch || variants.length > 0, message: product.variantMatch ? 'Eşleşmiş' : 'Eşleşmemiş', severity: 'warning' });
  }

  if (config.checkCommissionRate) {
    const rate = product.commissionRate || template.commissionRate || 0;
    checks.push({ field: 'commission', label: 'Komisyon oranı', passed: rate > 0, message: rate > 0 ? `%${rate}` : 'Belirtilmemiş', severity: 'warning' });
  }

  const totalChecks = checks.length;
  const passedChecks = checks.filter(c => c.passed).length;
  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

  return {
    passed: score >= 70 && checks.filter(c => c.severity === 'error' && !c.passed).length === 0,
    score,
    checks,
  };
}

// ==================== FİYAT SİMÜLASYONU ====================

export async function simulatePrices(
  productIds: string[],
  templateId: string
): Promise<PriceSimulationResult[]> {
  const template = await prisma.listingTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Template not found');

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: true, purchasePrice: true, salePrice: true, vatRate: true, commissionRate: true, currency: true },
  });

  const results: PriceSimulationResult[] = [];
  for (const product of products) {
    const calc = calculatePrice(product, {
      priceSource: template.priceSource,
      vatMode: template.vatMode,
      priceMultiplier: template.priceMultiplier,
      priceFixedAmount: template.priceFixedAmount,
      priceRangeRules: template.priceRangeRules,
      vatRate: template.vatRate ?? product.vatRate,
      commissionRate: template.commissionRate ?? product.commissionRate,
    });

    results.push({
      productId: product.id,
      productTitle: product.title || 'İsimsiz Ürün',
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      oldPrice: product.salePrice,
      newPrice: calc.price,
      profit: calc.profit,
      profitMargin: calc.price > 0 ? Math.round((calc.profit / calc.price) * 100) : 0,
      commission: calc.commission,
      commissionRate: calc.commissionRate,
      vat: calc.vat,
      vatRate: calc.vatRate,
      netPrice: calc.price - calc.commission - calc.vat,
      currency: product.currency || 'TRY',
    });
  }

  return results;
}

// ==================== CANLI ÖNİZLEME ====================

export async function generatePreview(
  productId: string,
  templateId: string
): Promise<ListingPreview> {
  const [product, template] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true } },
        variants: { select: { name: true, value: true } },
      },
    }),
    prisma.listingTemplate.findUnique({ where: { id: templateId } }),
  ]);

  if (!product) throw new Error('Product not found');
  if (!template) throw new Error('Template not found');

  const title = renderTitle(product, template.titleFormat || '', template.titleMaxLength);
  const description = renderDescription(product, template.descriptionBlocks, template.description);
  const priceCalc = calculatePrice(product, {
    priceSource: template.priceSource,
    vatMode: template.vatMode,
    priceMultiplier: template.priceMultiplier,
    priceFixedAmount: template.priceFixedAmount,
    priceRangeRules: template.priceRangeRules,
    vatRate: template.vatRate ?? product.vatRate,
    commissionRate: template.commissionRate ?? product.commissionRate,
  });

  const images = product.images ? product.images.split(',').filter(Boolean) : [];
  const validation = validateProduct(product, {
    titleFormat: template.titleFormat,
    titleMaxLength: template.titleMaxLength,
    imageMinCount: template.imageMinCount,
    imageMaxCount: template.imageMaxCount,
    validationRules: template.validationRules,
    commissionRate: template.commissionRate ?? undefined,
  });

  const variantInfo = product.variants.map(v => ({ [v.name]: v.value }));

  const jsonPayload: Record<string, unknown> = {
    title, description, price: priceCalc.price, currency: product.currency || 'TRY',
    images, stock: product.stock, barcode: product.barcode, sku: product.sku,
    categoryId: product.categoryId, brandId: product.brandId, variants: product.variants,
    vatRate: priceCalc.vatRate, commissionRate: priceCalc.commissionRate,
  };

  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<product>
  <title><![CDATA[${title}]]></title>
  <description><![CDATA[${description}]]></description>
  <price>${priceCalc.price}</price>
  <currency>${product.currency || 'TRY'}</currency>
  <stock>${product.stock}</stock>
  <barcode>${product.barcode || ''}</barcode>
  <sku>${product.sku || ''}</sku>
</product>`;

  return {
    title, description: description.substring(0, 500), price: priceCalc.price,
    currency: product.currency || 'TRY', images, stock: product.stock,
    barcode: product.barcode || '', sku: product.sku || '',
    category: product.category?.name || '', brand: product.brand?.name || '',
    variantInfo, validation, jsonPayload, xmlPayload,
  };
}

// ==================== BARKOT OTOMATİK ÜRET ====================

export function generateBarcode(prefix?: string, suffix?: string): string {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  let barcode = (prefix || '') + timestamp + random + (suffix || '');

  if (barcode.length === 12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(barcode[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    barcode += checkDigit;
  }

  return barcode;
}

// ==================== STOK HESAPLAMA ====================

export function calculateStock(
  currentStock: number,
  template: {
    stockMultiplier?: number | null;
    stockMinValue?: number | null;
    stockMaxValue?: number | null;
    stockHide?: boolean;
    stockAutoDeactivate?: boolean;
  }
): { stock: number; hidden: boolean; deactivated: boolean } {
  let stock = currentStock;

  if (template.stockMultiplier && template.stockMultiplier > 0) {
    stock = stock * template.stockMultiplier;
  }
  if (template.stockMinValue !== null && template.stockMinValue !== undefined) {
    stock = Math.max(stock, template.stockMinValue);
  }
  if (template.stockMaxValue !== null && template.stockMaxValue !== undefined) {
    stock = Math.min(stock, template.stockMaxValue);
  }

  const hidden = stock <= 0 && !!template.stockHide;
  const deactivated = stock <= 0 && !!template.stockAutoDeactivate;

  return { stock, hidden, deactivated };
}

// ==================== YASAKLI KELİMELERİ GETİR ====================

export async function getForbiddenWords(marketplaceId?: string | null): Promise<string[]> {
  const words = await prisma.forbiddenWord.findMany();
  return words
    .filter(w => {
      if (!marketplaceId) return true;
      try {
        const mps: string[] = JSON.parse(w.marketplaces || '[]');
        return mps.length === 0 || mps.includes(marketplaceId);
      } catch { return true; }
    })
    .map(w => w.word);
}
