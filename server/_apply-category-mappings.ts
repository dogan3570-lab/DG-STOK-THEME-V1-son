import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { fetchTrendyolCategoryTree, fetchTrendyolCategoryAttributes } from './src/services/trendyolCatalog.ts';
import { matchTrendyolCategoryByPath } from './src/services/categoryBrandMapper.ts';

/**
 * KONTROLLÜ GERÇEK KATEGORİ MAPPING (AKILLIBAYI1 + Trendyol).
 * - Yalnızca gerçek Trendyol category tree'sinden gelen MATCHED (tek aday) ID'ler yazılır.
 * - Yalnızca varyant destekleyen (varianter/slicer) kategoriler mapping'lenir (variant zinciri için).
 * - AMBIGUOUS / NOT_FOUND yazılmaz.
 */
async function main() {
  const src = await prisma.xmlSource.findFirst({ where: { name: 'AKILLIBAYI1' }, select: { id: true } });
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  if (!src || !tt) { console.log('NO_CTX'); await prisma.$disconnect(); process.exit(2); }

  const tree = await fetchTrendyolCategoryTree();
  const groups = await prisma.product.groupBy({
    by: ['supplierCategory'],
    where: { xmlSourceId: src.id, supplierCategory: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 200,
  });

  const attrCache = new Map<number, boolean>();
  let mapped = 0;
  const written: Array<{ xmlCat: string; ttId: number; ttName: string; products: number }> = [];

  for (const g of groups) {
    const xmlCat = String(g.supplierCategory ?? '').trim();
    if (!xmlCat) continue;
    const match = matchTrendyolCategoryByPath(xmlCat, Array.isArray(tree) ? tree : []);
    if (match.status !== 'MATCHED' || match.id === null) continue;

    // Yalnızca varyant destekleyen kategori (variant zinciri için)
    if (!attrCache.has(match.id)) {
      const attrs = await fetchTrendyolCategoryAttributes(match.id);
      attrCache.set(match.id, (Array.isArray(attrs) ? attrs : []).some((a) => a.varianter || a.slicer));
    }
    if (!attrCache.get(match.id)) continue;

    const leaf = xmlCat.split('>').map((s) => s.trim()).filter(Boolean).pop() || xmlCat;
    const category = await prisma.category.upsert({
      where: { name: leaf },
      update: { externalId: String(match.id) },
      create: { name: leaf, externalId: String(match.id) },
    });
    await prisma.categoryMapping.upsert({
      where: { categoryId_marketplaceId_source: { categoryId: category.id, marketplaceId: tt.id, source: 'trendyol_catalog' } },
      update: { externalId: String(match.id), externalName: match.name, externalPath: xmlCat, confidence: 1.0, active: true },
      create: {
        categoryId: category.id, marketplaceId: tt.id, externalId: String(match.id),
        externalName: match.name, externalPath: xmlCat, source: 'trendyol_catalog', confidence: 1.0, active: true,
      },
    });
    await prisma.product.updateMany({
      where: { xmlSourceId: src.id, supplierCategory: xmlCat },
      data: { categoryId: category.id, categoryMatch: true, matchedBy: 'trendyol_catalog', lastMatchDate: new Date() },
    });
    mapped++;
    written.push({ xmlCat, ttId: match.id, ttName: match.name ?? '', products: g._count.id });
  }

  console.log('MAPPED (varyant destekleyen, gerçek ID):', mapped);
  for (const w of written) console.log(`  ${w.ttId} ${w.ttName} (${w.products} ürün) ← ${w.xmlCat}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
