/**
 * FAZ 0/2 — READ-ONLY DB durum + ağaç bütünlüğü ölçümü.
 * Hiçbir şey yazmaz. Sadece sayar ve JSON döker.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const [productTotal, catTrue, catFalse, catNull, readyByStatus] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { categoryMatch: true } }),
    prisma.product.count({ where: { categoryMatch: false } }),
    prisma.product.count({ where: { categoryId: null } }),
    prisma.product.groupBy({ by: ['status'], _count: { id: true } }),
  ]);

  const [catTotal, trendyolCats, localCats] = await Promise.all([
    prisma.category.count(),
    prisma.category.count({ where: { externalId: { not: null } } }),
    prisma.category.count({ where: { externalId: null } }),
  ]);

  const mappings = await prisma.categoryMapping.groupBy({
    by: ['marketplaceId'],
    _count: { id: true },
  });
  const mp = await prisma.marketplace.findMany({
    select: { key: true, name: true, id: true, apiStatus: true, active: true },
  });
  const mpIdByKey = new Map(mp.map((m) => [m.key, m.id]));
  const mappingByKey: Record<string, number> = {};
  for (const m of mappings) {
    const key = mp.find((x) => x.id === m.marketplaceId)?.key ?? `unknown(${m.marketplaceId})`;
    mappingByKey[key] = (mappingByKey[key] || 0) + m._count.id;
  }

  const providers = await prisma.aIProviderConfig.findMany({
    select: {
      provider: true, displayName: true, model: true, active: true, priority: true,
      lastStatus: true, lastError: true, totalRequests: true, successfulRequests: true,
      failedRequests: true, apiKeyEncrypted: true, apiKeyIv: true, apiKeyTag: true,
      baseUrl: true,
    },
    orderBy: { priority: 'asc' },
  });

  const pricingRules = await prisma.marketplacePricingRule.findMany({
    select: { id: true, marketplaceId: true, xmlSourceId: true, productId: true, categoryId: true, active: true, priority: true },
  });

  const aiDecisionLogCount = await prisma.aIDecisionLog.count();
  const auditLogCount = await prisma.auditLog.count();

  // Ağaç bütünlüğü (Trendyol externalId dolu kategoriler)
  const treeRows = await prisma.category.findMany({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true, name: true, parentId: true },
  });
  const extToRows = new Map<string, { id: string; name: string }[]>();
  for (const r of treeRows) {
    const k = String(r.externalId).trim();
    if (!extToRows.has(k)) extToRows.set(k, []);
    extToRows.get(k)!.push({ id: r.id, name: r.name });
  }
  const duplicates = Array.from(extToRows.entries()).filter(([, v]) => v.length > 1).map(([k, v]) => ({ externalId: k, rows: v }));

  const idSet = new Set(treeRows.map((r) => r.id));
  const orphans = treeRows.filter((r) => r.parentId && !idSet.has(r.parentId)).map((r) => ({ id: r.id, externalId: r.externalId, name: r.name, parentId: r.parentId }));

  // Cycle tespiti: parentId zinciri takip (uuid üzerinden)
  const parentMap = new Map(treeRows.map((r) => [r.id, r.parentId]));
  const cycles: string[][] = [];
  const visitedCycle = new Set<string>();
  for (const r of treeRows) {
    let cur = r.id;
    const seen = new Set<string>();
    const path: string[] = [];
    while (cur && parentMap.has(cur) && !visitedCycle.has(cur)) {
      if (seen.has(cur)) { cycles.push([...path, cur]); break; }
      seen.add(cur);
      path.push(cur);
      cur = parentMap.get(cur)!;
    }
    for (const p of path) visitedCycle.add(p);
  }

  // Leaf hesapla: children=0 olanlar
  const childCount = new Map<string, number>();
  for (const r of treeRows) {
    if (r.parentId) childCount.set(r.parentId, (childCount.get(r.parentId) || 0) + 1);
  }
  const leaves = treeRows.filter((r) => (childCount.get(r.id) || 0) === 0);

  console.log(JSON.stringify({
    product: {
      total: productTotal,
      categoryMatchTrue: catTrue,
      categoryMatchFalse: catFalse,
      categoryIdNull: catNull,
      status: readyByStatus,
    },
    category: { total: catTotal, trendyol: trendyolCats, local: localCats },
    mapping: { total: Object.values(mappingByKey).reduce((a, b) => a + b, 0), byKey: mappingByKey },
    marketplace: mp.map((m) => ({ key: m.key, name: m.name, apiStatus: m.apiStatus, active: m.active })),
    providers: providers.map((p) => ({
      provider: p.provider, displayName: p.displayName, model: p.model, active: p.active, priority: p.priority,
      lastStatus: p.lastStatus, lastError: p.lastError, totalRequests: p.totalRequests,
      successfulRequests: p.successfulRequests, failedRequests: p.failedRequests,
      hasEncryptedKey: !!(p.apiKeyEncrypted && p.apiKeyIv && p.apiKeyTag), baseUrl: p.baseUrl,
    })),
    pricingRuleCount: pricingRules.length,
    pricingRules: pricingRules.map((p) => ({ id: p.id, marketplaceId: p.marketplaceId, xmlSourceId: p.xmlSourceId, productId: p.productId, categoryId: p.categoryId, active: p.active, priority: p.priority })),
    aiDecisionLogCount,
    auditLogCount,
    tree: {
      total: treeRows.length,
      leaf: leaves.length,
      duplicateExternalId: duplicates.length,
      duplicateSamples: duplicates.slice(0, 10),
      orphan: orphans.length,
      orphanSamples: orphans.slice(0, 10),
      cycle: cycles.length,
      cycleSamples: cycles.slice(0, 3),
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
