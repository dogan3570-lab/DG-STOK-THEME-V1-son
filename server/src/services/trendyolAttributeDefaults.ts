/**
 * TRENDYOL'A ÖZEL KALICI ZORUNLU ATTRIBUTE VARSAYILANLARI.
 *
 * Yalnızca Trendyol (marketplace.key === 'tt') için çalışır ve değerleri
 * sadece TrendyolProductAttribute tablosuna yazar. Hepsiburada/N11 akışlarına,
 * ortak Product/Variant verisine veya VariantAnalysis'e YAZMAZ.
 *
 * Değerler GERÇEK Trendyol kategori attribute/value yapısından (canlı katalog)
 * doğrulanır; whitelist'te karşılığı yoksa yazılmaz (fail-closed).
 */
import { prisma } from '../db/prisma.ts';
import { normalizeName } from './categoryBrandMapper.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './trendyolCatalog.ts';

// NOT: normalizeName() boşluk ve Türkçe karakterleri kaldırır (ör. "Web Color" -> "webcolor").
const MENSEI_NAME = normalizeName('Menşei');
const MENSEI_VALUE_NORM = normalizeName('TR');
const MENSEI_VALUE_LABEL = 'TR';

// ÖNEMLİ: Gerçek Trendyol Web Color value setinde tam "Renkli" YOKTUR; karşılık
// gelen gerçek değer "Çok Renkli"dir. Yanlış/olmayan ID kullanmamak için bu sabit.
const WEB_COLOR_NAME = normalizeName('Web Color');
const WEB_COLOR_VALUE_NORM = normalizeName('Çok Renkli');
const WEB_COLOR_VALUE_LABEL = 'Çok Renkli';

const RENK_NAME = normalizeName('Renk');
const RENK_VALUE_LABEL = 'Renkli';

export interface TrendyolDefaultAttribute {
  attributeId: number;
  attributeName: string;
  attributeValueId: number | null;
  attributeValue: string;
}

async function findValueId(categoryExternalId: number, attributeId: number, valueNorm: string): Promise<number | null> {
  const values = await fetchTrendyolAttributeValues(categoryExternalId, attributeId);
  const hit = values.find((v) => normalizeName(v.attributeValue) === valueNorm);
  return hit ? hit.attributeValueId : null;
}

/**
 * Verilen ürünler için Trendyol kategori varsayılanlarını hesaplar.
 * Yazmaz; yalnızca gerçek katalogla doğrulanmış değerleri döndürür.
 */
export async function buildTrendyolDefaultAttributes(
  productIds: string[],
  categoryExternalId: number
): Promise<Map<string, TrendyolDefaultAttribute[]>> {
  const result = new Map<string, TrendyolDefaultAttribute[]>();
  if (!Number.isInteger(categoryExternalId) || categoryExternalId <= 0 || productIds.length === 0) return result;

  const attrs = await fetchTrendyolCategoryAttributes(categoryExternalId);
  if (!Array.isArray(attrs) || attrs.length === 0) return result;

  const mensei = attrs.find((a) => normalizeName(a.attribute.name) === MENSEI_NAME);
  const webColor = attrs.find((a) => normalizeName(a.attribute.name) === WEB_COLOR_NAME);
  const renk = attrs.find((a) => normalizeName(a.attribute.name) === RENK_NAME);

  const menseiValueId = mensei ? await findValueId(categoryExternalId, mensei.attribute.id, MENSEI_VALUE_NORM) : null;
  const webColorValueId = webColor ? await findValueId(categoryExternalId, webColor.attribute.id, WEB_COLOR_VALUE_NORM) : null;

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, variants: { select: { name: true } } },
  });

  for (const p of products) {
    const list: TrendyolDefaultAttribute[] = [];
    if (mensei && mensei.required && menseiValueId !== null) {
      list.push({ attributeId: mensei.attribute.id, attributeName: mensei.attribute.name, attributeValueId: menseiValueId, attributeValue: MENSEI_VALUE_LABEL });
    }
    if (webColor && webColor.required && webColorValueId !== null) {
      list.push({ attributeId: webColor.attribute.id, attributeName: webColor.attribute.name, attributeValueId: webColorValueId, attributeValue: WEB_COLOR_VALUE_LABEL });
    }
    const hasRenkVariant = p.variants.some((v) => normalizeName(v.name) === RENK_NAME);
    if (renk && (renk.required || renk.slicer) && renk.allowCustom && !hasRenkVariant) {
      list.push({ attributeId: renk.attribute.id, attributeName: renk.attribute.name, attributeValueId: null, attributeValue: RENK_VALUE_LABEL });
    }
    result.set(p.id, list);
  }
  return result;
}

/**
 * Trendyol kategori eşleştirmesi sonrası varsayılanları KALICI olarak yazar.
 * - Kategori değişirse eski kategoriye ait kayıtlar SİLİNİR (stale bırakılmaz).
 * - Aynı kategoride artık geçerli olmayan attribute kayıtları da temizlenir.
 * - Varyantlı ürünlerde mevcut Renk'e dokunulmaz (hasRenkVariant kontrolü).
 */
export async function seedTrendyolDefaultAttributes(
  productIds: string[],
  categoryExternalId: number
): Promise<{ seededProducts: number; seededAttributes: number }> {
  if (!Number.isInteger(categoryExternalId) || categoryExternalId <= 0 || productIds.length === 0) {
    return { seededProducts: 0, seededAttributes: 0 };
  }

  const map = await buildTrendyolDefaultAttributes(productIds, categoryExternalId);
  let seededProducts = 0;
  let seededAttributes = 0;

  for (const [productId, attrs] of map) {
    // Stale temizliği: bu ürünün BAŞKA kategoriye ait Trendyol attribute kayıtları geçersizdir.
    // İZOLASYON: yalnızca marketplaceKey='tt' kayıtlarına dokunur (HB/N11 korunur).
    await prisma.trendyolProductAttribute.deleteMany({
      where: { productId, marketplaceKey: 'tt', categoryExternalId: { not: categoryExternalId } },
    });

    const keepIds = attrs.map((a) => a.attributeId);
    if (keepIds.length === 0) {
      await prisma.trendyolProductAttribute.deleteMany({ where: { productId, marketplaceKey: 'tt', categoryExternalId } });
    } else {
      // Yalnızca "default" kaynaklı stale kayıtlar temizlenir; motorun öğrenilmiş/
      // AI kaynaklı kayıtları KORUNUR (source != 'default').
      await prisma.trendyolProductAttribute.deleteMany({
        where: { productId, marketplaceKey: 'tt', categoryExternalId, attributeId: { notIn: keepIds }, source: 'default' },
      });
    }

    for (const a of attrs) {
      await prisma.trendyolProductAttribute.upsert({
        where: {
          productId_marketplaceKey_categoryExternalId_attributeId: {
            productId,
            marketplaceKey: 'tt',
            categoryExternalId,
            attributeId: a.attributeId,
          },
        },
        create: {
          productId,
          marketplaceKey: 'tt',
          categoryExternalId,
          attributeId: a.attributeId,
          attributeName: a.attributeName,
          attributeValueId: a.attributeValueId,
          attributeValue: a.attributeValue,
          source: 'default',
          confidence: 1.0,
          reason: 'TT_DEFAULT_RULE',
        },
        update: {
          attributeName: a.attributeName,
          attributeValueId: a.attributeValueId,
          attributeValue: a.attributeValue,
          confidence: 1.0,
          reason: 'TT_DEFAULT_RULE',
        },
      });
      seededAttributes++;
    }
    seededProducts++;
  }

  return { seededProducts, seededAttributes };
}

/**
 * Ürünlerin KALICI attribute kayıtlarını döndürür (UI okuma).
 * İZOLASYON: marketplaceKey verilmezse varsayılan 'tt' (mevcut davranış korunur).
 */
export async function getPersistedTrendyolAttributes(productIds: string[], marketplaceKey = 'tt') {
  if (productIds.length === 0) return [];
  return prisma.trendyolProductAttribute.findMany({
    where: { productId: { in: productIds }, marketplaceKey },
    orderBy: [{ productId: 'asc' }, { attributeId: 'asc' }],
  });
}
