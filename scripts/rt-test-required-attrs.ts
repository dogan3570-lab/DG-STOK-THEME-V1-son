// scripts/rt-test-required-attrs.ts
// Check actual required attribute status from Trendyol API
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { fetchTrendyolCategoryAttributes } from '../server/src/services/trendyolCatalog.ts';
const prisma = new PrismaClient();

async function main() {
  const catExt = 4573; // Grup Priz Uzatma Kablosu

  console.log('Fetching attrs for catExt:', catExt);
  const defs = await fetchTrendyolCategoryAttributes(catExt);
  console.log('Total defs:', defs.length);

  // Check actual structure of first def
  if (defs.length > 0) {
    console.log('\nFirst def structure:');
    const d = defs[0] as any;
    console.log('  Keys:', Object.keys(d));
    console.log('  attribute:', JSON.stringify(d.attribute, null, 2)?.substring(0, 200));
    console.log('  varianter:', d.varianter);
    console.log('  slicer:', d.slicer);
    console.log('  required (top-level):', d.required);
  }

  // List ALL attributes with their actual required status
  console.log('\n=== ALL ATTRS ===');
  for (const d of defs as any[]) {
    const a = d.attribute;
    console.log(`  id=${a.id} name="${a.name}" required=${a.required} varianter=${d.varianter} slicer=${d.slicer}  raw_required_top=${d.required}`);
  }

  // Which ones are "required"?
  const required = (defs as any[]).filter((d) => d.attribute?.required || d.required);
  console.log('\nRequired attrs:', required.length);
  for (const r of required) {
    console.log(`  id=${r.attribute.id} name="${r.attribute.name}"`);
  }

  // varianter/slicer attrs
  const relevant = (defs as any[]).filter((d) => d.varianter || d.slicer);
  console.log('\nRelevant (varianter/slicer):', relevant.length);
  for (const r of relevant) {
    console.log(`  id=${r.attribute.id} name="${r.attribute.name}" varianter=${r.varianter} slicer=${r.slicer} required=${r.attribute.required}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
