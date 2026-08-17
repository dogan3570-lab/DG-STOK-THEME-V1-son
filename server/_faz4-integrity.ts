/**
 * FAZ 4 — BATCH SONRASI BÜTÜNLÜK KONTROLÜ (read-only).
 * Her categoryMatch=true ürünün gerçek Trendyol leaf + aktif mapping taşıdığını doğrular.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true } });
  const ttId = tt?.id ?? null;

  const totalTrue = await prisma.product.count({ where: { categoryMatch: true } });
  const totalFalse = await prisma.product.count({ where: { categoryMatch: false } });
  const ready = await prisma.product.count({ where: { status: 'READY' } });

  // categoryMatch=true ama kategori externalId null (SAHTE olur) — 0 olmalı
  const trueButNoExternal = await prisma.product.count({
    where: { categoryMatch: true, OR: [{ categoryId: null }, { category: { externalId: null } }] },
  });

  // categoryMatch=true ama aktif tt mapping yok — 0 olmalı
  const trueWithoutMapping = await prisma.product.count({
    where: {
      categoryMatch: true,
      categoryId: { not: null },
      NOT: { category: { mappings: { some: { marketplaceId: ttId, active: true, externalId: { not: null } } } } },
    },
  });

  // categoryMatch=true ama hedef kategori LEAF değil (çocuğu olan) — 0 olmalı
  const trueNonLeaf = await prisma.product.count({
    where: { categoryMatch: true, category: { children: { some: {} } } },
  });

  // matchedBy dağılımı
  const byMethod = await prisma.product.groupBy({
    by: ['matchedBy'],
    where: { categoryMatch: true },
    _count: { id: true },
  });

  // Son 100 categoryMatch=true üründen örnek (en yeni eşleşenler)
  const sample = await prisma.product.findMany({
    where: { categoryMatch: true },
    select: {
      xmlKey: true, title: true, categoryId: true, matchedBy: true, aiScore: true,
      category: { select: { name: true, externalId: true } },
      categoryMatch: true, brandMatch: true, variantMatch: true, variantStatus: true, templateMatch: true, status: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  console.log(JSON.stringify({
    totalTrue, totalFalse, ready,
    trueButNoExternal,
    trueWithoutMapping,
    trueNonLeaf,
    byMethod,
    sample: sample.map((s) => ({ xmlKey: s.xmlKey, title: s.title, matchedBy: s.matchedBy, aiScore: s.aiScore, categoryName: s.category?.name, externalId: s.category?.externalId, categoryMatch: s.categoryMatch, brandMatch: s.brandMatch, variantMatch: s.variantMatch, variantStatus: s.variantStatus, templateMatch: s.templateMatch, status: s.status })),
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
