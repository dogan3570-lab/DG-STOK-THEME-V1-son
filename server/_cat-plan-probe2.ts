/**
 * READ-ONLY PLAN PROBE 2 — AI provider + marketplace credential varlığı + template ilişkisi.
 * YAZMA YOK.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const providersRaw = await prisma.aIProviderConfig.findMany({
    select: {
      provider: true, displayName: true, baseUrl: true, model: true, priority: true, active: true,
      lastStatus: true, lastError: true, totalRequests: true, successfulRequests: true, failedRequests: true,
      apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true,
    },
    orderBy: { priority: 'asc' },
  });

  const mp = await prisma.marketplace.findUnique({
    where: { key: 'tt' },
    select: { id: true, key: true, name: true, apiKey: true, apiSecret: true, apiStatus: true, active: true, merchantId: true, storeId: true, settings: true },
  });

  // template ilişkisi analizi
  const templates = await prisma.listingTemplate.findMany({
    select: { id: true, name: true, marketplaceId: true, productId: true, categoryId: true, brandId: true, active: true },
  });
  const t = {
    total: templates.length,
    active: templates.filter((x) => x.active).length,
    productScoped: templates.filter((x) => x.productId).length,
    categoryScoped: templates.filter((x) => x.categoryId && !x.productId && !x.brandId).length,
    general: templates.filter((x) => !x.productId && !x.categoryId && !x.brandId).length,
    brandScoped: templates.filter((x) => x.brandId && !x.productId && !x.categoryId).length,
    byMarketplace: templates.reduce<Record<string, number>>((acc, x) => { acc[x.marketplaceId ?? 'null'] = (acc[x.marketplaceId ?? 'null'] || 0) + 1; return acc; }, {}),
  };

  console.log(JSON.stringify({
    providers: providersRaw.map((p) => ({
      provider: p.provider,
      displayName: p.displayName,
      model: p.model,
      active: p.active,
      priority: p.priority,
      lastStatus: p.lastStatus,
      lastError: p.lastError,
      totalRequests: p.totalRequests,
      successfulRequests: p.successfulRequests,
      failedRequests: p.failedRequests,
      hasEncryptedKey: !!(p.apiKeyEncrypted && p.apiKeyIv && p.apiKeyTag),
    })),
    marketplace: {
      id: mp?.id,
      key: mp?.key,
      name: mp?.name,
      apiStatus: mp?.apiStatus,
      active: mp?.active,
      hasApiKey: !!mp?.apiKey,
      hasApiSecret: !!mp?.apiSecret,
      hasSellerId: (() => { try { const s = JSON.parse(mp?.settings || '{}'); return typeof s.sellerId === 'string' && s.sellerId.trim().length > 0; } catch { return false; } })(),
    },
    listingTemplates: t,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
