import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.auditLog.findMany({
    where: { action: { contains: 'MARKETPLACE' } },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('Marketplace audit logs:', JSON.stringify(logs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());