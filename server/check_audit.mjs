import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: { entity: 'ai_provider', action: 'AI_PROVIDER_UPDATE' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, action: true, entity: true, entityId: true, details: true, meta: true, createdAt: true }
  });
  console.log('Recent AI_PROVIDER_UPDATE logs:');
  console.log(JSON.stringify(logs, null, 2));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });