import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  // Check aIDecisionLog for request/response logs
  const logs = await prisma.aIDecisionLog.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: { id: true, productId: true, module: true, suggestion: true, confidence: true, reason: true, autoApplied: true, createdAt: true }
  });
  console.log('AI Decision Logs:');
  console.log(JSON.stringify(logs, null, 2));
  
  // Check aiProviderConfig
  const providers = await prisma.aIProviderConfig.findMany({
    where: { active: true },
    select: { provider: true, model: true, active: true, totalRequests: true, successfulRequests: true, failedRequests: true, lastUsedAt: true, lastStatus: true, lastError: true }
  });
  console.log('Active Providers:');
  console.log(JSON.stringify(providers, null, 2));
  
  await prisma.$disconnect();
}

test();