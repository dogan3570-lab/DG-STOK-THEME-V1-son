/**
 * FAZ 2 — TRENDYOL CATEGORY TREE BÜTÜNLÜK + MAPPING DOĞRULAMASI (READ-ONLY).
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  const ttId = tt?.id ?? null;

  const treeRows = await prisma.category.findMany({
    where: { externalId: { not: null } },
    select: { id: true, externalId: true, name: true, parentId: true },
  });

  // duplicate externalId
  const extMap = new Map<string, number>();
  for (const r of treeRows) extMap.set(String(r.externalId), (extMap.get(String(r.externalId)) || 0) + 1);
  const duplicateExternalId = Array.from(extMap.values()).filter((c) => c > 1).length;

  // numeric externalId kontrolü
  const nonNumeric = treeRows.filter((r) => !/^\d+$/.test(String(r.externalId).trim()));

  // orphan
  const idSet = new Set(treeRows.map((r) => r.id));
  const orphans = treeRows.filter((r) => r.parentId && !idSet.has(r.parentId));

  // cycle
  const parentMap = new Map(treeRows.map((r) => [r.id, r.parentId]));
  let cycleCount = 0;
  for (const r of treeRows) {
    let cur = r.id;
    const seen = new Set<string>();
    while (cur && parentMap.has(cur)) {
      if (seen.has(cur)) { cycleCount++; break; }
      seen.add(cur);
      cur = parentMap.get(cur)!;
    }
  }

  // leaf
  const childCount = new Map<string, number>();
  for (const r of treeRows) if (r.parentId) childCount.set(r.parentId, (childCount.get(r.parentId) || 0) + 1);
  const leafCount = treeRows.filter((r) => (childCount.get(r.id) || 0) === 0).length;

  // mapping bütünlüğü
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: ttId },
    select: { id: true, categoryId: true, externalId: true, source: true, active: true },
  });
  const catById = new Map(treeRows.map((r) => [r.id, r]));
  const mappingInvalid = mappings.filter((m) => !catById.has(m.categoryId));
  const mappingExternalMismatch = mappings.filter((m) => {
    const c = catById.get(m.categoryId);
    return c && String(c.externalId).trim() !== String(m.externalId ?? '').trim();
  });
  const mappingNonNumeric = mappings.filter((m) => !/^\d+$/.test(String(m.externalId ?? '').trim()));
  const mappingInactive = mappings.filter((m) => !m.active);
  const mappingSourceDist = mappings.reduce<Record<string, number>>((acc, m) => { acc[m.source] = (acc[m.source] || 0) + 1; return acc; }, {});

  // local XML kategorileri (Trendyol ağacıyla karışmamalı)
  const localCats = await prisma.category.count({ where: { externalId: null } });

  console.log(JSON.stringify({
    tree: {
      total: treeRows.length,
      leaf: leafCount,
      duplicateExternalId,
      nonNumericExternalId: nonNumeric.length,
      orphan: orphans.length,
      cycle: cycleCount,
    },
    mapping: {
      total: mappings.length,
      bySource: mappingSourceDist,
      invalidCategoryRef: mappingInvalid.length,
      externalIdMismatch: mappingExternalMismatch.length,
      nonNumeric: mappingNonNumeric.length,
      inactive: mappingInactive.length,
      samples: {
        invalidCategoryRef: mappingInvalid.slice(0, 5).map((m) => ({ id: m.id, categoryId: m.categoryId, externalId: m.externalId })),
        mismatch: mappingExternalMismatch.slice(0, 5).map((m) => ({ id: m.id, categoryId: m.categoryId, externalId: m.externalId, catExternalId: catById.get(m.categoryId)?.externalId })),
      },
    },
    localXmlCategoryCount: localCats,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
