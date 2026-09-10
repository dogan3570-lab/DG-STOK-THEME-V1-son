// RED TEAM — GERÇEK TRENDYOL CATALOG ZİNCİRİ (Category → Attribute → Value). Canlı response, hardcode YOK.
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';

(async () => {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt' } });
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: tt!.id, active: true },
    select: { externalId: true, categoryId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (mappings.length === 0) { console.log('active categoryMapping yok'); await prisma.$disconnect(); return; }

  let shown = 0;
  for (const mapping of mappings) {
    const ext = parseInt(String(mapping.externalId), 10);
    if (!Number.isInteger(ext) || ext <= 0) continue;
    const defs = await fetchTrendyolCategoryAttributes(ext);
    const relevant = defs.filter((a) => a.varianter || a.slicer);
    for (const a of relevant) {
      const values = await fetchTrendyolAttributeValues(ext, a.attribute.id);
      // Whitelist value'su OLAN gerçek zincir örneğini göster (Category -> Attribute -> Value)
      if (values.length > 0) {
        console.log('KATEGORİ externalId:', ext);
        console.log(`ATTRIBUTE: id=${a.attribute.id} name=${a.attribute.name} required=${a.required} varianter=${a.varianter} slicer=${a.slicer} allowCustom=${a.allowCustom}`);
        console.log(`VALUE sayısı: ${values.length}`);
        for (const v of values.slice(0, 8)) console.log(`  VALUE: id=${v.attributeValueId} value=${v.attributeValue}`);
        shown++;
        if (shown >= 2) break;
      }
    }
    if (shown >= 2) break;
  }
  if (shown === 0) {
    console.log('Whitelist value\'lu varianter/slicer attribute bulunamadı — allowCustom=true slicer kategorisi mevcut (id=47 Renk)');
    const ext = parseInt(String(mappings[0].externalId), 10);
    const defs = await fetchTrendyolCategoryAttributes(ext);
    const rel = defs.filter((a) => a.varianter || a.slicer);
    for (const a of rel) console.log(`custom slicer: id=${a.attribute.id} name=${a.attribute.name} allowCustom=${a.allowCustom}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
