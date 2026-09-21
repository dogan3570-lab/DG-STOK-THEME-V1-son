// scripts/rt-dump-candidates.ts
// READ-ONLY: rule-based candidates for the 393 with supplierCategory (NO AI)
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { resolveCategoryCandidates } from '../server/src/services/categoryCanonical.ts';
const prisma = new PrismaClient();

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true, name: true } });
  const tree = await loadTrendyolTree();
  const MP = tt!.id;

  const products = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: srcId, status: { not: 'DELETED' }, supplierCategory: { not: null } },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Products with supplierCategory + null categoryId: ${products.length}`);
  console.log('');

  const byMethod = new Map<string, number>();
  let withTop = 0, withoutTop = 0;

  // Group by supplierCategory to show representative candidates
  const seen = new Set<string>();
  for (const p of products) {
    const r = resolveCategoryCandidates(p, tree, MP);
    byMethod.set(r.method, (byMethod.get(r.method) || 0) + 1);
    if (r.topCandidate) withTop++; else withoutTop++;

    const key = p.supplierCategory || '';
    if (!seen.has(key)) {
      seen.add(key);
      const top = r.candidates.slice(0, 3).map(c => `${c.name}(ext=${(c as any).externalId ?? '?'},score=${((c as any).score ?? 0).toFixed(2)})`).join(' | ');
      console.log(`"${key}"`);
      console.log(`  method=${r.method} conf=${r.confidence?.toFixed?.(2)} mappingVerified=${r.mappingVerified} top=[${top}]`);
    }
  }
  console.log('');
  console.log('By method:', JSON.stringify([...byMethod]));
  console.log(`withTop=${withTop} withoutTop=${withoutTop}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
