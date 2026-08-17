import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const [sources, products, tt, mappings, brands] = await Promise.all([
    prisma.xmlSource.findMany({ select: { id: true, name: true, _count: { select: { products: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.product.count(),
    prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { id: true, name: true } }),
    prisma.categoryMapping.count(),
    prisma.brand.count(),
  ]);
  console.log('XML_SOURCES:', JSON.stringify(sources, null, 2));
  console.log('TOTAL_PRODUCTS:', products);
  console.log('TT_MARKETPLACE:', JSON.stringify(tt));
  console.log('CATEGORY_MAPPING_COUNT:', mappings);
  console.log('BRAND_COUNT:', brands);

  if (sources.length > 0) {
    const sample = await prisma.product.groupBy({
      by: ['supplierCategory'],
      where: { supplierCategory: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 15,
    });
    console.log('SAMPLE_SUPPLIER_CATEGORIES:', JSON.stringify(sample, null, 2));
    const brandsSample = await prisma.product.groupBy({
      by: ['xmlBrandName'],
      where: { xmlBrandName: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 15,
    });
    console.log('SAMPLE_XML_BRANDS:', JSON.stringify(brandsSample, null, 2));
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
