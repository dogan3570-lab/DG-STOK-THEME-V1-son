import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.auditLog.findMany({
    where: { action: { contains: 'CREDENTIAL' } },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('Credential audit logs:', JSON.stringify(logs, null, 2));
  
  const logs2 = await prisma.auditLog.findMany({
    where: { entity: 'marketplace' },
    orderBy: { createdAt: 'desc' },
    take: 30
  });
  console.log('\nAll marketplace audit logs:', JSON.stringify(logs2, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());