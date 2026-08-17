// RED TEAM — SEND GATE (runtime 4/4) NO_VARIANTS davranışı. Canlı gönderim YOK; yalnızca catalog/mapping okuma.
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { evaluateTrendyolSendGate } from './src/services/sendReadiness.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from './src/services/trendyolCatalog.ts';
import { resolveTrendyolAttributes } from './src/services/trendyolVariantResolver.ts';

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';

(async () => {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt' } });
  console.log('Trendyol marketplace:', tt?.id);

  // 1) HEDEF NO_VARIANTS ürünü (Airpods 3 Spor Delikli Siyah-Beyaz)
  const hedef = await prisma.product.findFirst({
    where: { xmlSourceId: XS, title: { contains: 'Apple Airpods 3 (3.nesil) Spor Delikli Kilif - Siyah-Beyaz' } },
    select: { id: true, title: true, variantStatus: true, variants: { select: { name: true, value: true } } },
  });
  console.log('\n=== HEDEF NO_VARIANTS ÜRÜN ===');
  if (hedef) {
    console.log('id=' + hedef.id + ' variantStatus=' + hedef.variantStatus + ' variants=' + JSON.stringify(hedef.variants));
    const g1 = await evaluateTrendyolSendGate({ productId: hedef.id, marketplaceId: tt!.id, xmlSourceId: XS });
    console.log('sendGate ok=' + g1.ok + ' firstFailure=' + g1.firstFailureCode + ' / ' + g1.firstFailureMessage);
    console.log('steps:', JSON.stringify(g1.steps));
  } else {
    console.log('HEDEF ürün bulunamadı');
  }

  // 2) READY + NO_VARIANTS ürün (tam zincir)
  const ready = await prisma.product.findFirst({
    where: {
      xmlSourceId: XS,
      status: 'READY',
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantStatus: 'NOT_REQUIRED',
    },
    select: { id: true, title: true, variantStatus: true, variants: { select: { name: true, value: true } } },
  });
  console.log('\n=== READY + NO_VARIANTS ÜRÜN (tam zincir) ===');
  if (ready) {
    console.log('id=' + ready.id + ' variantStatus=' + ready.variantStatus + ' variants=' + JSON.stringify(ready.variants));
    const g2 = await evaluateTrendyolSendGate({ productId: ready.id, marketplaceId: tt!.id, xmlSourceId: XS });
    console.log('sendGate ok=' + g2.ok + ' firstFailure=' + g2.firstFailureCode + ' / ' + g2.firstFailureMessage);
    console.log('steps:', JSON.stringify(g2.steps));
  } else {
    console.log('READY + NO_VARIANTS ürün bulunamadı');
  }

  // 3) NO_VARIANTS (boş varyant) + GERÇEK Trendyol kategori attribute ağacı
  console.log('\n=== NO_VARIANTS + GERÇEK TRENDYOL CATALOG (variant adımı) ===');
  const mapping = await prisma.categoryMapping.findFirst({
    where: { marketplaceId: tt!.id, active: true },
    select: { externalId: true, categoryId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (mapping) {
    const ext = parseInt(String(mapping.externalId), 10);
    if (Number.isInteger(ext) && ext > 0) {
      try {
        const defs = await fetchTrendyolCategoryAttributes(ext);
        const relevant = (Array.isArray(defs) ? defs : []).filter((a) => a.varianter || a.slicer).slice(0, 30);
        const values = new Map<number, { attributeValueId: number; attributeValue: string }[]>();
        for (const a of relevant) {
          const v = await fetchTrendyolAttributeValues(ext, a.attribute.id);
          values.set(a.attribute.id, Array.isArray(v) ? v : []);
        }
        const res = resolveTrendyolAttributes(Array.isArray(defs) ? defs : [], values, []);
        console.log('externalId=' + ext + ' relevantVariantAttr=' + relevant.length);
        console.log('NO_VARIANTS resolution.status=' + res.status);
        console.log('requiredMissing=' + JSON.stringify(res.requiredMissing.map((m) => m.attributeName)));
      } catch (e) {
        console.log('Trendyol catalog okunamadı (fail-closed senaryo):', String(e).slice(0, 200));
      }
    } else {
      console.log('numeric externalId yok:', mapping.externalId);
    }
  } else {
    console.log('active categoryMapping bulunamadı');
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERR', e); process.exitCode = 1; });
