const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Check XML source details
  const sources = await prisma.xmlSource.findMany({ select: { id: true, name: true, company: true } });
  console.log('=== XML SOURCES ===');
  for (const s of sources) {
    console.log('  ' + s.name + ' (id=' + s.id + ', company=' + (s.company || 'none') + ')');
  }

  // Check what brands were created from XML import
  console.log('\n=== BRANDS FROM XML (created during import) ===');
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  for (const b of brands) {
    console.log('  Brand.name = "' + b.name + '" (id=' + b.id + ')');
  }

  // The key insight: XML import creates Brand records with the XML brand name
  // Then sets product.brandId to point to that Brand
  // So product.brand.name = actual XML brand
  // But xmlBrandName was never set during import!
  
  // Check if any products still have brandId pointing to these brands
  console.log('\n=== CHECKING PRODUCT.brandId → BRAND.name MAPPING ===');
  const sampleWithBrand = await prisma.product.findMany({
    where: { brandId: { not: null } },
    select: { id: true, brandId: true, xmlBrandName: true, brand: { select: { name: true } } },
    take: 5
  });
  console.log('Products with brandId: ' + sampleWithBrand.length);
  for (const p of sampleWithBrand) {
    console.log('  brandId=' + p.brandId + ' brand.name="' + (p.brand?.name || 'null') + '" xmlBrandName="' + p.xmlBrandName + '"');
  }

  // Since we unmatch'd everything, all brandIds are null
  // The correct xmlBrandName should be Brand.name from the product's brandId
  // But since brandId is null now, we need to determine the XML brand differently

  // For AKILLIBAYI1: The XML brand is "akilli bayi" (from the BrandMapping)
  // We can verify by checking the BrandMapping
  const mappings = await prisma.brandMapping.findMany();
  console.log('\n=== BRAND MAPPINGS (source of truth for XML brands) ===');
  for (const m of mappings) {
    const dgBrand = await prisma.brand.findUnique({ where: { id: m.dgBrandId }, select: { name: true } });
    console.log('  XML "' + m.xmlBrandName + '" → DG Brand "' + (dgBrand?.name || m.dgBrandId) + '"');
  }
  
  await prisma.$disconnect();
})();
