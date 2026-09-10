/**
 * FAZ 1 — AI PROVIDER GERÇEKLİK TESTİ (gerçek API isteği; mock yok).
 * testProvider gerçek HTTP isteği gönderir, yanıtı doğrular ve sayaçları artırır.
 * Bu script yalnızca AIProviderConfig sayaç/status alanlarını günceller; ürün verisi DEĞİŞMEZ.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { testProvider } from './src/services/aiGateway.ts';

async function snapshot() {
  const rows = await prisma.aIProviderConfig.findMany({
    select: {
      provider: true, model: true, active: true, priority: true, lastStatus: true, lastError: true,
      totalRequests: true, successfulRequests: true, failedRequests: true,
      apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true,
    },
    orderBy: { priority: 'asc' },
  });
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    active: r.active,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    totalRequests: r.totalRequests,
    successfulRequests: r.successfulRequests,
    failedRequests: r.failedRequests,
    hasEncryptedKey: !!(r.apiKeyEncrypted && r.apiKeyIv && r.apiKeyTag),
  }));
}

async function main() {
  console.log('BEFORE', JSON.stringify(await snapshot(), null, 2));

  const results: any[] = [];
  for (const provider of ['openrouter', 'deepseek', 'nvidia']) {
    const r = await testProvider(provider);
    results.push({ provider, ok: r.ok, model: r.model, latencyMs: r.latencyMs, error: r.error, errorCode: r.errorCode, catalogModels: r.catalogModels });
  }

  console.log('TEST_RESULTS', JSON.stringify(results, null, 2));
  console.log('AFTER', JSON.stringify(await snapshot(), null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
