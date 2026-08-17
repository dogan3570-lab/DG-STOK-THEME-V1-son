import 'dotenv/config';
import { fetchTrendyolCategoryTree, fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';

function walk(nodes: any[], out: Array<{ id: number; name: string; parentId: number | null }>) {
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, parentId: n.parentId ?? null });
    if (Array.isArray(n.subCategories)) walk(n.subCategories, out);
  }
}

async function main() {
  const tree = await fetchTrendyolCategoryTree();
  const flat: Array<{ id: number; name: string; parentId: number | null }> = [];
  walk(Array.isArray(tree) ? tree : [], flat);
  console.log('TREE total categories:', flat.length);

  const keywords = ['elbise', 'ayakkabi', 'giyim', 'tisort', 'pantolon', 'canta', 'kazak', 'gomlek'];
  const candidates = flat.filter((c) => keywords.some((k) => (c.name || '').toLowerCase().includes(k)));
  console.log('CANDIDATE variant categories:', JSON.stringify(candidates.slice(0, 40)));

  // İlk birkaç adayın varianter attribute'larını getir
  for (const c of candidates.slice(0, 5)) {
    const attrs = await fetchTrendyolCategoryAttributes(c.id);
    const varianter = (Array.isArray(attrs) ? attrs : []).filter((a) => a.varianter || a.slicer);
    if (varianter.length === 0) continue;
    console.log(`\n=== ${c.name} (${c.id}) varianter=${varianter.length} ===`);
    for (const a of varianter.slice(0, 6)) {
      const values = await fetchTrendyolAttributeValues(c.id, a.attribute.id);
      console.log(`  attrId=${a.attribute.id} name=${a.attribute.name} required=${a.required} allowCustom=${a.allowCustom}`);
      console.log(`    values: ${JSON.stringify((Array.isArray(values) ? values : []).slice(0, 10).map((v) => ({ id: v.attributeValueId, v: v.attributeValue })))}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
