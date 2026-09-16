/**
 * MARKETPLACE ATTRIBUTE LEARNING STORE — öğrenen global attribute motorunun
 * kalıcı mapping belleği.
 *
 * Ürünün gerçek attribute kaydından (TrendyolProductAttribute) AYRI tutulur.
 * İzolasyon: (marketplaceKey, categoryExternalId, attributeId, sourceType,
 * sourceKey, sourceValue) — bu yüzden Trendyol bilgisi HB/N11'e ASLA taşınmaz.
 *
 * GÜVEN KURALI (requirement): doğrulanmamış/düşük güvenli AI tahmini "öğrenilmiş
 * gerçek" olarak kabul EDİLMEZ. Yalnızca `verified=true` kayıtlar güvenilirdir.
 */
import { prisma } from '../db/prisma.ts';

export interface LearnedMappingInput {
  marketplaceKey: string;
  categoryExternalId: number;
  attributeId: number;
  attributeName: string;
  attributeValueId: number | null;
  attributeValue: string | null;
  sourceType: string; // 'variant' | 'title' | 'manual' | 'catalog'
  sourceKey: string; // normalize edilmiş (ör. "renk")
  sourceValue: string; // normalize edilmiş (ör. "kirmizi"); null yerine '' kullanılır
  confidence: number;
  reason?: string | null;
  verified: boolean;
  createdBy: string; // 'engine' | 'manual' | 'ai' | 'send'
  incrementSuccess?: boolean;
}

export interface LearnedMapping {
  attributeId: number;
  attributeName: string;
  attributeValueId: number | null;
  attributeValue: string | null;
  confidence: number;
  verified: boolean;
  successCount: number;
  createdBy: string;
}

function keyOf(q: Pick<LearnedMappingInput, 'marketplaceKey' | 'categoryExternalId' | 'attributeId' | 'sourceType' | 'sourceKey' | 'sourceValue'>) {
  return {
    marketplaceKey_categoryExternalId_attributeId_sourceType_sourceKey_sourceValue: {
      marketplaceKey: q.marketplaceKey,
      categoryExternalId: q.categoryExternalId,
      attributeId: q.attributeId,
      sourceType: q.sourceType,
      sourceKey: q.sourceKey,
      sourceValue: q.sourceValue || '',
    },
  };
}

/** Öğrenilmiş mapping'i upsert eder. verified=false ise güvenilir sayılmaz. */
export async function recordLearnedMapping(input: LearnedMappingInput): Promise<void> {
  const base = {
    marketplaceKey: input.marketplaceKey,
    categoryExternalId: input.categoryExternalId,
    attributeId: input.attributeId,
    attributeName: input.attributeName,
    sourceType: input.sourceType,
    sourceKey: input.sourceKey,
    sourceValue: input.sourceValue || '',
  };
  await prisma.marketplaceAttributeLearning.upsert({
    where: keyOf(base),
    create: {
      ...base,
      attributeValueId: input.attributeValueId,
      attributeValue: input.attributeValue,
      confidence: input.confidence,
      reason: input.reason ?? null,
      verified: input.verified,
      createdBy: input.createdBy,
      successCount: input.incrementSuccess ? 1 : 0,
    },
    update: {
      attributeName: input.attributeName,
      attributeValueId: input.attributeValueId,
      attributeValue: input.attributeValue,
      confidence: input.confidence,
      reason: input.reason ?? null,
      createdBy: input.createdBy,
      // verified yalnızca yükseltilebilir (true ise false'a düşürme; AI tahmini mevcut
      // doğrulanmış kaydı BOZMAZ).
      ...(input.verified ? { verified: true } : {}),
      ...(input.incrementSuccess ? { successCount: { increment: 1 } } : {}),
    },
  });
}

/** Güvenilir (verified=true) öğrenilmiş mapping'i getirir. Yoksa null. */
export async function findLearnedMapping(q: {
  marketplaceKey: string;
  categoryExternalId: number;
  attributeId: number;
  sourceType: string;
  sourceKey: string;
  sourceValue: string;
}): Promise<LearnedMapping | null> {
  const row = await prisma.marketplaceAttributeLearning.findUnique({ where: keyOf(q) });
  if (!row || !row.verified) return null;
  return {
    attributeId: row.attributeId,
    attributeName: row.attributeName,
    attributeValueId: row.attributeValueId,
    attributeValue: row.attributeValue,
    confidence: row.confidence,
    verified: row.verified,
    successCount: row.successCount,
    createdBy: row.createdBy,
  };
}

/** Bir kategori+attribute için tüm öğrenilmiş kayıtlar (izole). */
export async function listLearnedMappings(marketplaceKey: string, categoryExternalId: number, attributeId?: number) {
  return prisma.marketplaceAttributeLearning.findMany({
    where: {
      marketplaceKey,
      categoryExternalId,
      ...(attributeId !== undefined ? { attributeId } : {}),
    },
    orderBy: [{ attributeId: 'asc' }, { sourceType: 'asc' }, { sourceKey: 'asc' }],
  });
}

/** Bir pazaryeri için öğrenilmiş kayıt sayısı (izolasyon kanıtı / UI). */
export async function countLearnedMappings(marketplaceKey: string): Promise<number> {
  return prisma.marketplaceAttributeLearning.count({ where: { marketplaceKey } });
}

/**
 * Pazaryerinin gerçekten kabul ettiği başarılı gönderim → öğrenmeyi doğrula.
 * (ACTIVE/confirmed external id anında çağrılır.)
 */
export async function confirmLearningsForProduct(productId: string, marketplaceKey: string): Promise<number> {
  const rows = await prisma.trendyolProductAttribute.findMany({
    where: { productId, marketplaceKey },
    select: { categoryExternalId: true, attributeId: true, attributeValueId: true, attributeName: true, attributeValue: true },
  });
  let confirmed = 0;
  for (const r of rows) {
    // Bu ürün kaydına karşılık gelen öğrenme satırlarını (aynı kategori+attribute+değer) doğrula.
    const res = await prisma.marketplaceAttributeLearning.updateMany({
      where: {
        marketplaceKey,
        categoryExternalId: r.categoryExternalId,
        attributeId: r.attributeId,
        attributeValueId: r.attributeValueId,
      },
      data: { verified: true, successCount: { increment: 1 } },
    });
    confirmed += res.count;
  }
  return confirmed;
}
