const { PrismaClient } = require('./server/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Check existing mappings
  const mappings = await prisma.brandMapping.findMany();
  console.log('Existing mappings: ' + mappings.length);
  for (const m of mappings) {
    console.log('  xmlBrandName=' + m.xmlBrandName + ' dgBrandId=' + m.dgBrandId + ' isAuto=' + m.isAuto);
  }
  
  // All existing mappings are global (no marketplace) - they'll become marketplaceKey=null
  // This is fine since the new unique constraint is [xmlBrandName, marketplaceKey]
  // And null is treated as unique in SQLite for the purpose of this constraint
  
  // Actually SQLite treats NULLs as distinct in unique constraints
  // So we need to check if there are duplicates with null marketplaceKey
  const seen = new Map();
  const duplicates = [];
  for (const m of mappings) {
    const key = m.xmlBrandName + '|null';
    if (seen.has(key)) {
      duplicates.push(m);
    } else {
      seen.set(key, m);
    }
  }
  
  if (duplicates.length > 0) {
    console.log('\nDuplicates found (need cleanup):');
    for (const d of duplicates) {
      console.log('  Deleting: ' + d.xmlBrandName + ' id=' + d.id);
      await prisma.brandMapping.delete({ where: { id: d.id } });
    }
  } else {
    console.log('\nNo duplicates - safe to migrate');
  }
  
  await prisma.$disconnect();
})();
