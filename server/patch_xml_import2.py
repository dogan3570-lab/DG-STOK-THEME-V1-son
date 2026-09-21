import re

# Read the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the section where parseXmlImportPayload is called
# Move sourceRecord fetch before parsing
old_section = """  if (options?.signal?.aborted) {
    return { ok: false, error: { code: 'CANCELLED', message: 'Senkronizasyon iptal edildi' }, importedCount: 0, updatedCount: 0, items: [] } satisfies XmlImportResult;
  }

  const items = parseXmlImportPayload(xml);

  if (items.length === 0) {
    return { ok: true, importedCount: 0, updatedCount: 0, skippedCount: 0, items: [] } satisfies XmlImportResult;
  }

  const { filtered: filteredItems, filteredCount } = applyImportFilter(items, options?.filter);
  if (filteredCount > 0) {
    console.log(`[Import] Filter applied: ${filteredCount} items filtered out, ${filteredItems.length} remaining`);
  }

  let sourceRecord = null as Awaited<ReturnType<typeof prisma.xmlSource.findFirst>> | null;"""

new_section = """  if (options?.signal?.aborted) {
    return { ok: false, error: { code: 'CANCELLED', message: 'Senkronizasyon iptal edildi' }, importedCount: 0, updatedCount: 0, items: [] } satisfies XmlImportResult;
  }

  // Fetch sourceRecord early to get purchasePriceField for XML parsing
  let sourceRecord = null as Awaited<ReturnType<typeof prisma.xmlSource.findFirst>> | null;
  if (options?.sourceId) {
    sourceRecord = await prisma.xmlSource.findUnique({ where: { id: options.sourceId } });
  } else if (options?.sourceName) {
    sourceRecord = await prisma.xmlSource.findFirst({ where: { name: options.sourceName } });
  }

  const items = parseXmlImportPayload(xml, sourceRecord?.purchasePriceField ?? null);

  if (items.length === 0) {
    return { ok: true, importedCount: 0, updatedCount: 0, skippedCount: 0, items: [] } satisfies XmlImportResult;
  }

  const { filtered: filteredItems, filteredCount } = applyImportFilter(items, options?.filter);
  if (filteredCount > 0) {
    console.log(`[Import] Filter applied: ${filteredCount} items filtered out, ${filteredItems.length} remaining`);
  }"""

content = content.replace(old_section, new_section)

# Write the file
with open(r'C:\PROJE 1\DG-STOK-THEME-V1\server\src\services\xmlImport.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully!")