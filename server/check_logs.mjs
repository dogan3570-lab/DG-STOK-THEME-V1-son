import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  const logs = await prisma.aiRequestLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, provider: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true, duration: true, success: true, error: true, createdAt: true }
  });
  console.log('AI Request Logs:');
  console.log(JSON.stringify(logs, null, 2));
  
  const providers = await prisma.aiProviderConfig.findMany({
    where: { active: true },
    select: { provider: true, model: true, active: true, totalRequests: true, successfulRequests: true, failedRequests: true, lastUsedAt: true, lastStatus: true, lastError: true }
  });
  console.log('Active Providers:');
  console.log(JSON.stringify(providers, null, 2));
  
  await prisma.$disconnect();
}

test();