// scripts/rt-nullcat-mechanism.ts
// READ-ONLY: Why 393 products have supplierCategory but NULL categoryId + group them
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

function parsePositiveInt(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  // ── Audit logs for category operations ──
  const audits = await prisma.auditLog.findMany({
    where: { action: { in: ['CATEGORY_UNMATCH', 'CATEGORY_MATCH', 'CATEGORY_APPLY', 'BULK_UNMATCH'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { action: true, details: true, createdAt: true, meta: true },
  });
  console.log(`═══ Recent category audit logs (${audits.length}) ═══`);
  for (const a of audits) {
    console.log(`  ${a.createdAt.toISOString().substring(0,19)} | ${a.action} | ${(a.details || '').substring(0, 70)}`);
  }
  console.log('');

  // ── updatedAt analysis for null-category products ──
  const nullCat = await prisma.product.findMany({
    where: { categoryId: null, xmlSourceId: srcId, status: { not: 'DELETED' } },
    select: { id: true, xmlKey: true, supplierCategory: true, updatedAt: true, createdAt: true },
  });
  console.log(`═══ Null-category products updatedAt range ═══`);
  const upDates = nullCat.map(p => p.updatedAt.getTime()).sort((a,b)=>a-b);
  console.log(`  earliest updatedAt: ${new Date(upDates[0]).toISOString()}`);
  console.log(`  latest updatedAt:   ${new Date(upDates[upDates.length-1]).toISOString()}`);
  console.log('');

  // ── Category tree + mappings ──
  const allCats = await prisma.category.findMany({
    select: { id: true, name: true, externalId: true, parentId: true },
  });
  const catByName = new Map<string, typeof allCats[0]>();
  for (const c of allCats) {
    const k = c.name.toLowerCase().trim();
    if (!catByName.has(k)) catByName.set(k, c);
  }
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: MP, active: true },
    select: { categoryId: true, externalId: true, externalName: true, source: true },
  });
  const mappedCatIds = new Set(mappings.map(m => m.categoryId));
  const leafIds = new Set(allCats.filter(c => !allCats.some(p => p.parentId === c.id)).map(c => c.id));

  // ── Group the 393 by supplierCategory ──
  const withSc = nullCat.filter(p => p.supplierCategory);
  const groups = new Map<string, typeof withSc>();
  for (const p of withSc) {
    const k = p.supplierCategory as string;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }

  console.log(`═══ 393 products with supplierCategory → ${groups.size} distinct groups ═══`);
  console.log('');
  console.log('┌────┬──────┬──────────────────────────────────────────────────────┬──────────────────────────────────────────┬────────┬──────────┐');
  console.log('│ #  │ Count│ XML Supplier Category (leaf)                         │ Suggested DG Category                    │ ExtID  │ Mapping  │');
  console.log('├────┼──────┼──────────────────────────────────────────────────────┼──────────────────────────────────────────┼────────┼──────────┤');

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  let exactProducts = 0, highProducts = 0, reviewProducts = 0, noMatchProducts = 0;

  for (let i = 0; i < sorted.length; i++) {
    const [sc, prods] = sorted[i];
    const parts = sc.split(' > ').map(s => s.trim()).filter(Boolean);
    const leaf = parts[parts.length - 1] || '';

    let suggested: string | null = null;
    let extId: number | null = null;
    let hasMapping = false;
    let confidence = 'NO_MATCH';

    // Try every segment from last to first for exact match
    for (let j = parts.length - 1; j >= 0; j--) {
      const seg = parts[j].toLowerCase();
      const m = catByName.get(seg);
      if (m) {
        suggested = `${m.name} [${m.parentId ? 'child' : 'root'}]`;
        extId = m.externalId ? Number(m.externalId) : null;
        hasMapping = mappedCatIds.has(m.id);
        confidence = j === parts.length - 1 ? 'EXACT_LEAF' : 'HIGH_CONFIDENCE_PARENT';
        break;
      }
    }

    if (confidence === 'EXACT_LEAF' && hasMapping) exactProducts += prods.length;
    else if (confidence === 'EXACT_LEAF') { highProducts += prods.length; confidence = 'EXACT_LEAF_NO_MAP'; }
    else if (confidence === 'HIGH_CONFIDENCE_PARENT') { highProducts += prods.length; confidence = 'HIGH_PARENT'; }
    else { noMatchProducts += prods.length; }

    const confIcon = confidence === 'EXACT_LEAF' ? 'G' : confidence.includes('HIGH') || confidence.includes('EXACT_LEAF_NO_MAP') ? 'B' : 'R';
    console.log(
      `│ ${(i+1).toString().padStart(2)} │  ${(prods.length.toString()).padStart(3)} │ ${leaf.substring(0, 52).padEnd(52)} │ ${(suggested || '---').substring(0, 40).padEnd(40)} │ ${(extId?.toString() || '---').padStart(6)} │ ${hasMapping ? 'YES' : 'no '}      │`
    );
  }
  console.log('└────┴──────┴──────────────────────────────────────────────────────┴──────────────────────────────────────────┴────────┴──────────┘');
  console.log('');

  console.log('═══ CONFIDENCE DISTRIBUTION (393 with supplierCategory) ═══');
  console.log(`  EXACT_LEAF (leaf exists + mapping): ${exactProducts}`);
  console.log(`  HIGH (leaf/parent exists, no mapping): ${highProducts}`);
  console.log(`  NO_MATCH (no segment found): ${noMatchProducts}`);
  console.log(`  TOTAL: ${exactProducts + highProducts + noMatchProducts}`);
  console.log('');

  // ── Check: are these 393 leaf names present as Category names at all? ──
  console.log('═══ Leaf-name presence in Category tree ═══');
  let leafFound = 0, leafNotFound = 0;
  const notFoundLeaves = new Set<string>();
  for (const [sc] of sorted) {
    const parts = sc.split(' > ').map(s => s.trim()).filter(Boolean);
    const leaf = (parts[parts.length - 1] || '').toLowerCase();
    if (catByName.has(leaf)) leafFound++;
    else { leafNotFound++; notFoundLeaves.add(parts[parts.length - 1]); }
  }
  console.log(`  Distinct leaf names found in Category tree: ${leafFound}`);
  console.log(`  Distinct leaf names NOT found: ${leafNotFound}`);
  console.log('');

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
