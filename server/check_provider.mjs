import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  console.log('OpenRouter Provider Config:', JSON.stringify({
    provider: provider.provider,
    active: provider.active,
    model: provider.model,
    hasKey: !!provider.apiKeyEncrypted,
    lastStatus: provider.lastStatus,
    totalRequests: provider.totalRequests,
    successfulRequests: provider.successfulRequests,
    failedRequests: provider.failedRequests,
    lastUsedAt: provider.lastUsedAt
  }, null, 2));
  
  await prisma.$disconnect();
}

test();