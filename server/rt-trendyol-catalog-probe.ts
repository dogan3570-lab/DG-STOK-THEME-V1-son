import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import {
  fetchTrendyolCategoryTree,
  fetchTrendyolBrands,
  fetchTrendyolCategoryAttributes,
  fetchTrendyolAttributeValues,
} from './src/services/trendyolCatalog.ts';

/**
 * READ-ONLY canlı Trendyol catalog probe. Sahte veri ÜRETMEZ.
 * API response yoksa FAIL (NOT_VERIFIED) döner.
 */
async function main() {
  const tree = await fetchTrendyolCategoryTree();
  const treeOk = Array.isArray(tree) && tree.length > 0;
  console.log(`CATALOG CategoryTree: ${treeOk ? `PASS (${tree.length} root)` : 'FAIL (NOT_VERIFIED)'}`);

  const brands = await fetchTrendyolBrands(0, 1000);
  const brandsOk = Array.isArray(brands) && brands.length > 0;
  console.log(`CATALOG Brands: ${brandsOk ? `PASS (${brands.length})` : 'FAIL (NOT_VERIFIED)'}`);

  let attrsOk = false;
  let valuesOk = false;
  let leafId: number | null = null;
  const findLeaf = (nodes: typeof tree): void => {
    for (const n of nodes) {
      if (n.subCategories && n.subCategories.length > 0) findLeaf(n.subCategories);
      else if (leafId === null) leafId = n.id;
    }
  };
  if (treeOk) {
    findLeaf(tree);
    if (leafId !== null) {
      const attrs = await fetchTrendyolCategoryAttributes(leafId);
      attrsOk = Array.isArray(attrs) && attrs.length > 0;
      console.log(`CATALOG CategoryAttributes(${leafId}): ${attrsOk ? `PASS (${attrs.length})` : 'FAIL (NOT_VERIFIED)'}`);
      if (attrsOk) {
        const target = attrs.find((a) => a.varianter || a.slicer) ?? attrs[0];
        const values = await fetchTrendyolAttributeValues(leafId, target.attribute.id);
        valuesOk = Array.isArray(values) && values.length > 0;
        console.log(`CATALOG AttributeValues(attr=${target.attribute.id}): ${valuesOk ? `PASS (${values.length})` : 'FAIL (NOT_VERIFIED)'}`);
      }
    }
  }

  await prisma.$disconnect();
  const allOk = treeOk && brandsOk && attrsOk && valuesOk;
  console.log(`CATALOG_RESULT: ${allOk ? 'ALL_PASS' : 'PARTIAL_OR_NOT_VERIFIED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('PROBE ERROR:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
