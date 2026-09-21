import re

# Read the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the duplicate sourceRecord fetch
old_duplicate = """  const { filtered: filteredItems, filteredCount } = applyImportFilter(items, options?.filter);
  if (filteredCount > 0) {
    console.log(`[Import] Filter applied: ${filteredCount} items filtered out, ${filteredItems.length} remaining`);
  }
  if (options?.sourceId) {
    sourceRecord = await prisma.xmlSource.findUnique({ where: { id: options.sourceId } });
  } else if (options?.sourceName) {
    sourceRecord = await prisma.xmlSource.findFirst({ where: { name: options.sourceName } });
  }

  // VERİ KÖPRÜSÜ: kaynak garantile — ürünler asla xmlSourceId=null kalmaz"""

new_duplicate = """  const { filtered: filteredItems, filteredCount } = applyImportFilter(items, options?.filter);
  if (filteredCount > 0) {
    console.log(`[Import] Filter applied: ${filteredCount} items filtered out, ${filteredItems.length} remaining`);
  }

  // VERİ KÖPRÜSÜ: kaynak garantile — ürünler asla xmlSourceId=null kalmaz"""

content = content.replace(old_duplicate, new_duplicate)

# Write the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Duplicate removed successfully!")