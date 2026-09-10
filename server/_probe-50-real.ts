import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { detectVariantAttributes } from './src/services/readiness.ts';
import { fetchTrendyolCategoryAttributes } from './src/services/trendyolCatalog.ts';
import { resolveTrendyolAttributes } from './src/services/trendyolVariantResolver.ts';
import { parsePositiveInt } from './src/services/sendReadiness.ts';

async function main() {
  const src = await prisma.xmlSource.findFirst({ select: { id: true } });
  const products = await prisma.product.findMany({
    where: { xmlSourceId: src!.id, variantMatch: false, variantStatus: 'WAITING_AI' },
    take: 50,
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, xmlKey: true, sku: true, description: true, categoryId: true },
  });

  const mappings = await prisma.categoryMapping.findMany({ where: { marketplace: { key: 'tt' }, active: true }, select: { categoryId: true, externalId: true } });
  const mapByCat = new Map(mappings.map((m) => [m.categoryId, Number(m.externalId)]));
  const attrCache = new Map<number, any[]>();

  const rows: Array<Record<string, string>> = [];
  const summary: Record<string, number> = { NOT_REQUIRED: 0, AUTO_MATCH: 0, AI_MATCH: 0, MANUAL_REVIEW: 0, WAITING_AI: 0, ERROR: 0 };

  for (const p of products) {
    const attrs = detectVariantAttributes([p.title, p.xmlKey, p.sku, p.description].filter(Boolean).join(' '));
    const xmlVariant = attrs.map((a) => `${a.name}=${a.value}`).join('; ') || '-';

    let result = 'ERROR';
    let reason = '';
    let attrId = '-';
    let valueId = '-';

    if (attrs.length === 0) {
      result = 'NOT_REQUIRED';
      reason = 'XML varyantı yok';
    } else {
      const cid = p.categoryId ? mapByCat.get(p.categoryId) : undefined;
      if (cid === undefined || !Number.isFinite(cid)) {
        result = 'MANUAL_REVIEW';
        reason = 'CATEGORY_MAPPING_NOT_FOUND';
      } else {
        let attrsDef = attrCache.get(cid);
        if (attrsDef === undefined) {
          attrsDef = await fetchTrendyolCategoryAttributes(cid);
          attrCache.set(cid, Array.isArray(attrsDef) ? attrsDef : []);
        }
        const varianter = attrsDef.filter((a) => a.varianter || a.slicer);
        if (varianter.length === 0) {
          result = 'NOT_REQUIRED';
          reason = 'KATEGORİ VARYANT KULLANMIYOR (varianter=0)';
        } else {
          const res = resolveTrendyolAttributes(attrsDef, new Map(), attrs);
          if (res.status === 'OK') {
            result = 'AUTO_MATCH';
            const m = res.resolved.find((r) => r.attributeId !== null);
            if (m) { attrId = String(m.attributeId); valueId = String(m.attributeValueId); }
          } else {
            result = 'MANUAL_REVIEW';
            reason = res.missing[0]?.reason || res.requiredMissing[0]?.attributeName || res.status;
          }
        }
      }
    }

    summary[result]++;
    rows.push({ id: p.id.slice(0, 8), title: (p.title || p.xmlKey).slice(0, 40), xmlVariant, result, attrId, valueId, reason });
  }

  console.log('=== 50 GERÇEK ÜRÜN SINIFLANDIRMA (READ-ONLY, motor mantığı) ===');
  console.table(rows.slice(0, 50));
  console.log('\nÖZET:', JSON.stringify(summary));
  console.log('TOPLAM:', rows.length);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
