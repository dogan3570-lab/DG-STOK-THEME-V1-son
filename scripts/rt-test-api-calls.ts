// scripts/rt-test-api-calls.ts
// Trace exactly what happens inside proposeForProduct for a single product
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateTrendyolSendGate } from '../server/src/services/sendReadiness.ts';
import { fetchTrendyolCategoryAttributes, fetchTrendyolAttributeValues } from '../server/src/services/trendyolCatalog.ts';
const prisma = new PrismaClient();

function fold(s: string): string {
  return String(s || '')
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ç/g, 'c').replace(/Ğ/g, 'g').replace(/Ö/g, 'o').replace(/Ş/g, 's').replace(/Ü/g, 'u')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const pid = '94931112-1287-4376-8c9e-fdda2ee4e860';

  const prod = await prisma.product.findUnique({
    where: { id: pid },
    select: { id: true, title: true, description: true, categoryId: true, xmlSourceId: true,
      brand: { select: { name: true } },
      variants: { select: { name: true, value: true }, take: 20 } },
  });
  console.log('Product:', prod?.title?.substring(0, 80));
  console.log('Description:', prod?.description?.substring(0, 120));
  console.log('Category:', prod?.categoryId);
  console.log('Variants:', prod?.variants?.length);

  // 1) Gate check
  console.log('\n=== GATE CHECK ===');
  const gate = await evaluateTrendyolSendGate({ productId: pid, marketplaceId: MP, xmlSourceId: prod?.xmlSourceId || '' });
  console.log('Gate OK:', gate.ok);
  console.log('First failure:', gate.firstFailureCode);
  console.log('Message:', gate.firstFailureMessage?.substring(0, 200));

  // 2) Category mapping
  const catMap = await prisma.categoryMapping.findFirst({
    where: { categoryId: prod?.categoryId!, marketplaceId: MP, active: true, externalId: { not: null } },
    select: { externalId: true, externalName: true },
  });
  const catExt = catMap ? Number(catMap.externalId) : null;
  console.log('\nCategory extId:', catExt, 'name:', catMap?.externalName);

  if (!catExt) { console.log('NO CATEGORY EXT ID - aborting'); await prisma.$disconnect(); return; }

  // 3) Fetch Trendyol category attributes
  console.log('\n=== TRENDYOL CATEGORY ATTRS ===');
  try {
    const defs = await fetchTrendyolCategoryAttributes(catExt);
    console.log('Defs count:', defs.length);
    for (const d of defs as any[]) {
      const required = d.attribute?.required ? 'ZORUNLU' : 'opsiyonel';
      console.log(`  [${required}] id=${d.attribute?.id} name="${d.attribute?.name}"`);
    }

    // 4) Extract missing names from gate message
    const m = /:\s*(.+)$/.exec(gate.firstFailureMessage || '');
    const missing = m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
    console.log('\nMissing names from gate:', missing);

    // 5) For each missing name, try to find matching def
    for (const name of missing) {
      const def = (defs as any[]).find((d: any) => fold(d.attribute.name) === fold(name));
      if (def) {
        console.log(`  "${name}" -> FOUND id=${def.attribute.id}`);
        // Try fetch values
        try {
          const vals = await fetchTrendyolAttributeValues(catExt, def.attribute.id, 10);
          console.log(`    Values count: ${vals.length}`);
          if (vals.length > 0) console.log(`    Sample: ${vals.slice(0,3).map((v:any) => `${v.attributeValueId}=${v.attributeValue}`).join(', ')}`);
        } catch (e: any) {
          console.log(`    Values ERROR: ${e.message?.substring(0, 150)}`);
        }
      } else {
        console.log(`  "${name}" -> NOT FOUND in defs`);
        // Fuzzy search
        const fuzzy = (defs as any[]).filter((d: any) => {
          const dn = fold(d.attribute.name);
          const mn = fold(name);
          return dn.includes(mn) || mn.includes(dn) || dn.split(' ').some((w: string) => mn.includes(w));
        });
        if (fuzzy.length > 0) {
          console.log(`    Fuzzy matches: ${fuzzy.map((f: any) => `"${f.attribute.name}" (id=${f.attribute.id})`).join(', ')}`);
        }
      }
    }
  } catch (e: any) {
    console.error('fetchTrendyolCategoryAttributes FAILED:', e.message?.substring(0, 200));
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
