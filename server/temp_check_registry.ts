import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const row = await prisma.setting.findUnique({ where: { key: 'omniroute_registry' } });
  if (!row) { console.log('No registry'); return; }
  const reg = JSON.parse(row.value);
  console.log('Registry models:', reg.models?.length ?? 0);
  console.log('LastDiscoveryError:', reg.lastDiscoveryError);
  console.log('DiscoveredAt:', reg.discoveredAt);
  const freeModels = (reg.models || []).filter((m: any) => m.free);
  console.log('Free models:', freeModels.length);
  for (const m of freeModels.slice(0, 10)) {
    console.log(`  ${m.id}: health=${m.health}, quarantine=${m.quarantineReason || 'none'}, failures=${m.consecutiveFailures}, success=${m.successfulRequests}/${m.totalRequests}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
