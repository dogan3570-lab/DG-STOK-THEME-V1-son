import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Test 1: How big is the registry JSON
  const row = await prisma.setting.findUnique({ where: { key: 'omniroute_registry' } });
  if (!row) { console.log('No registry'); return; }
  const rawSize = row.value.length;
  console.log('Registry raw size:', rawSize, 'bytes', (rawSize / 1024).toFixed(1), 'KB');

  // Test 2: Parse time
  const t0 = Date.now();
  const parsed = JSON.parse(row.value);
  const parseMs = Date.now() - t0;
  console.log('Parse time:', parseMs, 'ms');
  console.log('Models:', parsed.models?.length);

  // Test 3: Simulate selectBestFreeModel filter
  const t1 = Date.now();
  const usable = (parsed.models || []).filter((m: any) => m.free && !m.quarantineReason && m.health !== 'quarantined');
  const filterMs = Date.now() - t1;
  console.log('Usable free models:', usable.length, 'filter time:', filterMs, 'ms');

  // Test 4: Sort and pick
  const t2 = Date.now();
  usable.sort((a: any, b: any) => {
    let sa = a.health === 'healthy' ? 100 : a.health === 'unknown' ? 50 : a.health === 'degraded' ? 20 : 0;
    let sb = b.health === 'healthy' ? 100 : b.health === 'unknown' ? 50 : b.health === 'degraded' ? 20 : 0;
    return sb - sa;
  });
  const sortMs = Date.now() - t2;
  console.log('Top model:', usable[0]?.id, 'score sort time:', sortMs, 'ms');
  console.log('Total parse+filter+sort:', parseMs + filterMs + sortMs, 'ms');

  // Test 5: Memory impact
  const mem = process.memoryUsage();
  console.log('Memory:', (mem.heapUsed / 1024 / 1024).toFixed(1), 'MB heap,', (mem.rss / 1024 / 1024).toFixed(1), 'MB RSS');
}

main().catch(e => { console.error(e); process.exit(1); });
