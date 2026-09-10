/**
 * FAZ 3 — 10. ürün tamamlayıcı dry-run (yazma YOK).
 * İlk script 9 ürün seçti (bir örnek path'te categoryMatch=false kalmadı).
 * Bu script kalan categoryMatch=false ürünlerden 1 tane daha alıp AI ile preview eder.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { previewProducts } from './src/services/categoryMatchEngine.ts';

const DONE_IDS = new Set([
  '40e9e81a-62e4-4e8c-87eb-26f5bc0ee194',
  '2fdb9076-b7c0-45b4-ab14-022f10181ccb',
  '03913b2a-e242-44d0-ad16-6a53dd61c7ae',
  '5f620b6b-2027-403e-bd49-d27dec640a12',
  '448e8559-0123-410a-89b2-160900fa2af5',
  '05a304e2-d8f5-44a2-afd7-aa853db662f3',
  '3df04345-9039-4d93-a0c2-3832c1737292',
  '25460fa7-933a-4165-8e19-2427c2d900d7',
  '05a13bdd-f98d-4744-8397-2f0761667027',
]);

async function main() {
  const p = await prisma.product.findFirst({
    where: { categoryMatch: false, id: { notIn: Array.from(DONE_IDS) }, supplierCategory: { not: null } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!p) {
    console.log(JSON.stringify({ selected: null, message: 'Kalan ürün yok' }));
    await prisma.$disconnect();
    process.exit(0);
  }

  const result = await previewProducts([p.id], true);
  const row = result.rows[0];
  console.log(JSON.stringify({
    selected: p.id,
    tree: result.tree,
    ai: result.ai,
    row: row ? {
      xmlKey: row.xmlKey,
      title: row.title,
      supplierCategory: row.supplierCategory,
      xmlBrandName: row.xmlBrandName,
      method: row.method,
      confidence: row.confidence,
      targetCategoryId: row.categoryId,
      externalId: row.externalId,
      categoryName: row.categoryName,
      fullPath: row.fullPath,
      reason: row.reason,
      mappingExists: row.mappingExists,
      isLeaf: row.isLeaf,
      candidatesTop5: row.candidates.slice(0, 5).map((c) => ({ name: c.name, fullPath: c.fullPath, score: c.score })),
      gate: row.gate,
    } : null,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
