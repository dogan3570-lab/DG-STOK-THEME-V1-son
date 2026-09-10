import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { mapTrendyolCategories, mapTrendyolBrands, mapTrendyolVariants } from './src/services/trendyolMapping.ts';

/**
 * AŞAMA 3 — KONTROLLÜ DB YAZIMI (10 category / 10 brand / 10 variant).
 * Yalnızca gerçek Trendyol API response'undan gelen numeric ID yazılır.
 * Canlı ürün gönderimi YOK.
 */
async function main() {
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  if (!tt) {
    console.log('RESULT: tt marketplace bulunamadı');
    await prisma.$disconnect();
    process.exit(1);
  }

  const src = await prisma.xmlSource.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true } });
  if (!src) {
    console.log('RESULT: XML kaynağı bulunamadı');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`XML: ${src.name} (${src.id})`);
  console.log(`Marketplace: tt (${tt.id})`);

  const cat = await mapTrendyolCategories({ xmlSourceId: src.id, marketplaceId: tt.id, limit: 10 });
  console.log('\n=== CATEGORY MAPPING ===');
  console.log(`scanned=${cat.scanned} autoMatched=${cat.autoMatched} manualReview=${cat.manualReview} notFound=${cat.notFound} catalogUnavailable=${cat.catalogUnavailable ?? false} error=${cat.error ?? '-'}`);
  for (const r of cat.results.slice(0, 10)) {
    console.log(`  [${r.status}] ${r.input} → externalId=${r.externalId} name=${r.externalName}${r.reason ? ` (${r.reason})` : ''}`);
  }

  const brand = await mapTrendyolBrands({ xmlSourceId: src.id, marketplaceId: tt.id, limit: 10 });
  console.log('\n=== BRAND MAPPING ===');
  console.log(`scanned=${brand.scanned} autoMatched=${brand.autoMatched} manualReview=${brand.manualReview} notFound=${brand.notFound} catalogUnavailable=${brand.catalogUnavailable ?? false} error=${brand.error ?? '-'}`);
  for (const r of brand.results.slice(0, 10)) {
    console.log(`  [${r.status}] ${r.input} → externalId=${r.externalId} name=${r.externalName}${r.reason ? ` (${r.reason})` : ''}`);
  }

  const variant = await mapTrendyolVariants({ xmlSourceId: src.id, marketplaceId: tt.id, limit: 10 });
  console.log('\n=== VARIANT MAPPING ===');
  console.log(`scanned=${variant.scanned} matched=${variant.matched} manualReview=${variant.manualReview} catalogUnavailable=${variant.catalogUnavailable ?? false} error=${variant.error ?? '-'}`);
  for (const r of variant.results.slice(0, 10)) {
    console.log(`  [${r.status}] ${r.title ?? r.productId}${r.reason ? ` → ${r.reason}` : ''}`);
  }

  await prisma.$disconnect();
  console.log('\nCONTROLLED_MAPPING_DONE');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('CONTROLLED_MAPPING_ERROR:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
