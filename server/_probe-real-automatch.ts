import 'dotenv/config';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';
import { resolveTrendyolAttributes } from './src/services/trendyolVariantResolver.ts';

async function main() {
  // GERÇEK Trendyol "Elbise" kategorisi (1182) — variant attribute'ları
  const cid = 1182;
  const attrs = await fetchTrendyolCategoryAttributes(cid);
  const varianter = (Array.isArray(attrs) ? attrs : []).filter((a) => a.varianter || a.slicer);
  console.log(`ELBISE (${cid}) varianter attrs:`);
  for (const a of varianter) console.log(`  attrId=${a.attribute.id} name=${a.attribute.name} required=${a.required} allowCustom=${a.allowCustom}`);

  const valuesByAttribute = new Map<number, Array<{ attributeValueId: number; attributeValue: string }>>();
  for (const a of varianter) {
    const v = await fetchTrendyolAttributeValues(cid, a.attribute.id);
    valuesByAttribute.set(a.attribute.id, Array.isArray(v) ? v : []);
  }

  // Beden whitelist'inden M / S / L gerçek ID'lerini bul
  for (const a of varianter) {
    const vals = valuesByAttribute.get(a.attribute.id) || [];
    const m = vals.find((v) => String(v.attributeValue).trim().toUpperCase() === 'M');
    const s = vals.find((v) => String(v.attributeValue).trim().toUpperCase() === 'S');
    const l = vals.find((v) => String(v.attributeValue).trim().toUpperCase() === 'L');
    console.log(`\n${a.attribute.name} (${a.attribute.id}) values=${vals.length} | M=${JSON.stringify(m)} S=${JSON.stringify(s)} L=${JSON.stringify(l)}`);
  }

  // GERÇEK motor testi: XML Beden=M → Trendyol Elbise Beden
  const resolution = resolveTrendyolAttributes(
    Array.isArray(attrs) ? attrs : [],
    valuesByAttribute,
    [{ name: 'Beden', value: 'M' }],
  );
  console.log('\n=== GERÇEK AUTO_MATCH KANITI (XML Beden=M → Trendyol Elbise) ===');
  console.log('status:', resolution.status);
  console.log('attributes payload:', JSON.stringify(resolution.attributes));
  console.log('resolved:', JSON.stringify(resolution.resolved, null, 2));
  console.log('missing:', JSON.stringify(resolution.missing));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
