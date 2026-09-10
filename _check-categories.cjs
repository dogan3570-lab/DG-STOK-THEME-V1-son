const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // 1. System categories
  const cats = await prisma.category.findMany({ select: { id: true, name: true, parentId: true } });
  console.log('=== SYSTEM CATEGORIES (' + cats.length + ') ===');
  for (const c of cats) {
    console.log('  ' + c.name + (c.parentId ? ' (parent)' : ' (root)'));
  }

  // 2. XML supplier categories (distinct)
  const xmlCats = await prisma.product.groupBy({
    by: ['supplierCategory'],
    _count: { id: true },
    where: { supplierCategory: { not: null } }
  });
  console.log('\n=== XML SUPPLIER CATEGORIES (' + xmlCats.length + ') ===');
  for (const xc of xmlCats.sort((a, b) => b._count.id - a._count.id)) {
    console.log('  [' + xc._count.id + '] ' + xc.supplierCategory);
  }

  // 3. Product category match stats
  const total = await prisma.product.count();
  const matched = await prisma.product.count({ where: { categoryMatch: true } });
  const unmatched = await prisma.product.count({ where: { categoryMatch: false } });
  const withSupplierCat = await prisma.product.count({ where: { supplierCategory: { not: null } } });
  const withoutSupplierCat = await prisma.product.count({ where: { supplierCategory: null } });
  console.log('\n=== PRODUCT STATS ===');
  console.log('  Total: ' + total);
  console.log('  Matched: ' + matched + ' (' + (matched/total*100).toFixed(1) + '%)');
  console.log('  Unmatched: ' + unmatched + ' (' + (unmatched/total*100).toFixed(1) + '%)');
  console.log('  With supplierCategory: ' + withSupplierCat);
  console.log('  Without supplierCategory: ' + withoutSupplierCat);

  // 4. Sample products with supplierCategory
  const samples = await prisma.product.findMany({
    where: { supplierCategory: { not: null } },
    select: { title: true, supplierCategory: true, categoryMatch: true, categoryId: true },
    take: 10
  });
  console.log('\n=== SAMPLE PRODUCTS ===');
  for (const s of samples) {
    console.log('  supplierCategory: ' + s.supplierCategory);
    console.log('    title: ' + s.title.substring(0, 60));
    console.log('    matched: ' + s.categoryMatch + ', categoryId: ' + s.categoryId);
  }

  // 5. Check if any products have categoryId set
  const withCategoryId = await prisma.product.count({ where: { categoryId: { not: null } } });
  console.log('\n  Products with categoryId: ' + withCategoryId);

  // 6. Check category mappings
  const mappings = await prisma.categoryMapping.findMany();
  console.log('\n=== CATEGORY MAPPINGS (' + mappings.length + ') ===');
  for (const m of mappings) {
    console.log('  categoryId=' + m.categoryId + ' marketplaceId=' + m.marketplaceId + ' externalName=' + m.externalName);
  }

  await prisma.$disconnect();
})();
