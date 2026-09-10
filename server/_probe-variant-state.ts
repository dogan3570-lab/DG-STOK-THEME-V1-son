import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { detectVariantAttributes } from './src/services/readiness.ts';

async function main() {
  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });
  if (!src) { console.log('NO_SOURCE'); process.exit(2); }

  const total = await prisma.product.count({ where: { xmlSourceId: src.id } });
  const variantMatchTrue = await prisma.product.count({ where: { xmlSourceId: src.id, variantMatch: true } });
  const variantMatchFalse = await prisma.product.count({ where: { xmlSourceId: src.id, variantMatch: false } });
  const statusGroup = await prisma.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: src.id }, _count: { id: true } });
  const variantRows = await prisma.variant.count({ where: { product: { xmlSourceId: src.id } } });
  const variantDistinctProducts = await prisma.variant.findMany({ where: { product: { xmlSourceId: src.id } }, select: { productId: true }, distinct: ['productId'] });
  const variantAnalysisCount = await prisma.variantAnalysis.count();
  const analysisValidated = await prisma.variantAnalysis.count({ where: { validationPassed: true } });
  const variantNameGroup = await prisma.variant.groupBy({ by: ['name'], _count: { name: true }, orderBy: { _count: { name: 'desc' } } });

  // XML varyant tespiti: title + xmlKey üzerinden gerçek varyant işareti
  const products = await prisma.product.findMany({
    where: { xmlSourceId: src.id },
    select: { id: true, title: true, xmlKey: true },
  });
  let detected = 0;
  let notDetected = 0;
  const detectedFields: Record<string, number> = {};
  const samples: string[] = [];
  for (const p of products) {
    const text = [p.title, p.xmlKey].filter(Boolean).join(' ');
    const attrs = detectVariantAttributes(text);
    if (attrs.length > 0) {
      detected++;
      attrs.forEach((a) => { detectedFields[a.name] = (detectedFields[a.name] || 0) + 1; });
      if (samples.length < 8) samples.push((p.title || p.xmlKey || '').slice(0, 90) + ' => ' + JSON.stringify(attrs));
    } else {
      notDetected++;
    }
  }

  console.log('SOURCE:', src.name);
  console.log('TOTAL:', total);
  console.log('variantMatch true/false:', variantMatchTrue, '/', variantMatchFalse);
  console.log('variantStatus group:', JSON.stringify(statusGroup.map((s) => ({ st: s.variantStatus, n: s._count.id }))));
  console.log('Variant rows:', variantRows, 'distinct products:', variantDistinctProducts.length);
  console.log('VariantAnalysis total/validated:', variantAnalysisCount, '/', analysisValidated);
  console.log('Variant name group:', JSON.stringify(variantNameGroup));
  console.log('DETECTED (title+key varyant işareti):', detected, 'NOT_DETECTED:', notDetected);
  console.log('DETECTED FIELDS:', JSON.stringify(detectedFields));
  console.log('SAMPLES:', JSON.stringify(samples, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
