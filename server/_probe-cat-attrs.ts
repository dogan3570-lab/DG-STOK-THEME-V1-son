import 'dotenv/config';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';

const cats = [
  { id: 2989, name: 'Tablet Kılıfı' },
  { id: 774, name: 'Bluetooth Hoparlör' },
  { id: 474, name: 'Tıraş Makinesi' },
  { id: 900, name: 'Termos' },
  { id: 1901, name: 'Diğer Oyun Konsolları' },
];

async function main() {
  for (const c of cats) {
    const attrs = await fetchTrendyolCategoryAttributes(c.id);
    const varianter = (Array.isArray(attrs) ? attrs : []).filter((a) => a.varianter || a.slicer);
    console.log(`\n=== ${c.name} (${c.id}) — toplam attr=${Array.isArray(attrs) ? attrs.length : 'n/a'} varianter=${varianter.length} ===`);
    for (const a of varianter.slice(0, 8)) {
      const values = await fetchTrendyolAttributeValues(c.id, a.attribute.id);
      const vals = Array.isArray(values) ? values : [];
      console.log(`  attrId=${a.attribute.id} name=${a.attribute.name} required=${a.required} allowCustom=${a.allowCustom} values=${vals.length}`);
      if (vals.length > 0 && vals.length < 60) {
        console.log(`    → ${JSON.stringify(vals.map((v) => ({ id: v.attributeValueId, v: v.attributeValue })).slice(0, 40))}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
