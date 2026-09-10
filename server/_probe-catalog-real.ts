import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';

async function main() {
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplace: { key: 'tt' }, active: true },
    select: { externalId: true, externalName: true },
  });
  console.log('MAPPED CATEGORIES:', JSON.stringify(mappings));

  for (const m of mappings) {
    const cid = Number(m.externalId);
    if (!Number.isFinite(cid)) continue;
    const attrs = await fetchTrendyolCategoryAttributes(cid);
    const varianter = (Array.isArray(attrs) ? attrs : []).filter((a) => a.varianter || a.slicer);
    console.log(`\n=== CATEGORY ${m.externalName} (${cid}) — attrs=${Array.isArray(attrs) ? attrs.length : 'n/a'} varianter=${varianter.length} ===`);
    for (const a of varianter.slice(0, 12)) {
      const values = await fetchTrendyolAttributeValues(cid, a.attribute.id);
      console.log(`  attrId=${a.attribute.id} name=${a.attribute.name} required=${a.required} varianter=${a.varianter} slicer=${a.slicer} allowCustom=${a.allowCustom}`);
      console.log(`    values(${(Array.isArray(values) ? values : []).length}): ${JSON.stringify((Array.isArray(values) ? values : []).slice(0, 15).map((v) => ({ id: v.attributeValueId, v: v.attributeValue })))}`);
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
