/**
 * FAZ 1 — AI PROVIDER GERÇEKLİK TESTİ (aktif provider odaklı).
 * Gerçek HTTP isteği gönderir; mock yok. Yalnızca AIProviderConfig sayaç/status alanları değişir.
 * testProvider("deepseek") → gerçek API + decryptable key + "DEEPSEEK_OK" doğrulaması.
 * matchCategoriesWithAI (in-memory) → gerçek parser zinciri (buildPrompt + call + parseAndValidateMatches) kanıtı.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { testProvider, matchCategoriesWithAI, type ProductForMatch, type CategoryCandidate } from './src/services/aiGateway.ts';

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
  const before = await snapshot();
  const logBefore = await prisma.aIDecisionLog.count();

  // 1) Aktif provider: gerçek test isteği + decryptable key + yanıt doğrulaması
  const active = before.filter((p) => p.active);
  const activeNames = active.map((p) => `${p.provider}(${p.model || 'model-yok'})`).join(', ');
  const testResults: any[] = [];
  for (const p of active) {
    const r = await testProvider(p.provider);
    testResults.push({ provider: p.provider, ok: r.ok, model: r.model, latencyMs: r.latencyMs, error: r.error, errorCode: r.errorCode, catalogModels: r.catalogModels });
  }

  // 2) Parser zinciri kanıtı: gerçek AI isteği ile in-memory JSON kategorik eşleşme (DB yazma YOK)
  const products: ProductForMatch[] = [
    { id: 'p-1', xmlKey: 'x-1', title: 'Erkek Siyah Deri Bot', supplierCategory: 'Ayakkabı > Bot', xmlBrandName: 'X', description: null },
    { id: 'p-2', xmlKey: 'x-2', title: 'Bluetooth Kulaklık Mikrofonlu', supplierCategory: 'Aksesuar > Kulaklık', xmlBrandName: 'Y', description: null },
  ];
  const categories: CategoryCandidate[] = [
    { id: 'c-1', name: 'Bot', fullPath: 'Ayakkabı > Bot' },
    { id: 'c-2', name: 'Kulaklık', fullPath: 'Aksesuar > Kulaklık' },
    { id: 'c-3', name: 'Saat', fullPath: 'Aksesuar > Saat' },
  ];
  const matchRes = await matchCategoriesWithAI(products, categories, 'Trendyol');

  const after = await snapshot();
  const logAfter = await prisma.aIDecisionLog.count();

  console.log(JSON.stringify({
    activeProviders: activeNames,
    testResults,
    parserChain: {
      ok: matchRes.ok,
      provider: matchRes.provider,
      model: matchRes.model,
      matches: matchRes.matches,
      error: matchRes.error,
      errorCode: matchRes.errorCode,
    },
    counters: {
      before,
      after,
      aiDecisionLogBefore: logBefore,
      aiDecisionLogAfter: logAfter,
      aiDecisionLogDelta: logAfter - logBefore,
      note: 'AIDecisionLog yalnızca gerçek ürün eşleştirme yazma anında artar; bu test ürün yazmadığı için delta 0 olmalı. AIProviderConfig sayaçları artmalı.',
    },
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
