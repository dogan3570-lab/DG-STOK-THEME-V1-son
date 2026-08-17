import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { runVariantMatchFlow } from './src/services/variantMatch.ts';

async function main() {
  const src = await prisma.xmlSource.findFirst({ where: { name: 'AKILLIBAYI1' }, select: { id: true } });
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });

  // Yeni eşlenen kategorilere sahip, eşleşmemiş gerçek ürünler
  const mappedCatIds = (await prisma.categoryMapping.findMany({ where: { marketplaceId: tt!.id, active: true }, select: { categoryId: true } })).map((m) => m.categoryId);
  const products = await prisma.product.findMany({
    where: { xmlSourceId: src!.id, variantMatch: false, variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] }, categoryId: { in: mappedCatIds } },
    take: 50,
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  console.log('Gerçek mapped+matchsiz ürün:', products.length);
  if (products.length === 0) { await prisma.$disconnect(); process.exit(2); }

  const ids = products.map((p) => p.id);
  const flow = await runVariantMatchFlow({ xmlSourceId: src!.id, marketplaceId: tt!.id, productIds: ids, useAI: false, limit: 50 });

  console.log('\n=== GERÇEK 50 ÜRÜN MOTOR SONUCU ===');
  console.log('scanned:', flow.scanned, '| notRequired:', flow.notRequired, '| autoMatched:', flow.autoMatched, '| aiMatched:', flow.aiMatched, '| manual:', flow.manualReview, '| failed:', flow.failed);
  console.log('\nSonuçlar (real IDs):');
  for (const r of flow.results.slice(0, 50)) {
    const maps = r.mappings.map((m) => `[${m.xmlAttribute}=${m.xmlValue} → attrId=${m.attributeId ?? '-'} valueId=${m.attributeValueId ?? '-'} value=${m.marketplaceValue ?? '-'}]`).join(' ');
    console.log(`${r.status.padEnd(13)} | ${(r.title || '').slice(0, 38)} | ${r.reason ?? ''} | ${maps}`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
