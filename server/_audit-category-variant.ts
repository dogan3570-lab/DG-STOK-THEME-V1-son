import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { fetchTrendyolCategoryTree, fetchTrendyolCategoryAttributes, type TrendyolCategory } from './src/services/trendyolCatalog.ts';
import { matchTrendyolCategoryByPath, type MatchResult } from './src/services/categoryBrandMapper.ts';
import { detectVariantAttributes } from './src/services/readiness.ts';

async function main() {
  const src = await prisma.xmlSource.findFirst({ select: { id: true, name: true } });

  // 1) Distinct supplierCategory + ürün sayısı + varyant sinyali örnekleri
  const groups = await prisma.product.groupBy({
    by: ['supplierCategory'],
    where: { xmlSourceId: src!.id, supplierCategory: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 120,
  });

  const samples = await prisma.product.findMany({
    where: { xmlSourceId: src!.id, supplierCategory: { not: null } },
    select: { supplierCategory: true, title: true, xmlKey: true, sku: true, description: true },
    take: 4000,
  });

  const variantSignalByCat = new Map<string, { total: number; withVariant: number; fields: Record<string, number> }>();
  for (const p of samples) {
    const cat = p.supplierCategory || '';
    if (!cat) continue;
    const e = variantSignalByCat.get(cat) || { total: 0, withVariant: 0, fields: {} };
    e.total++;
    const attrs = detectVariantAttributes([p.title, p.xmlKey, p.sku, p.description].filter(Boolean).join(' '));
    if (attrs.length > 0) { e.withVariant++; attrs.forEach((a) => { e.fields[a.name] = (e.fields[a.name] || 0) + 1; }); }
    variantSignalByCat.set(cat, e);
  }

  // 2) Trendyol kategori ağacı
  const tree = await fetchTrendyolCategoryTree();
  console.log('TRENDYOL TREE:', (Array.isArray(tree) ? tree : []).length, 'root nodes');

  // 3) Her supplierCategory için Trendyol eşleşmesi dene
  const attrCache = new Map<number, boolean>(); // categoryId -> variantSupported
  const results: Array<{ xmlCat: string; count: number; withVariant: number; fields: string; matchStatus: string; trendyolId: number | null; trendyolName: string | null; variantSupported: string }> = [];

  for (const g of groups) {
    const xmlCat = String(g.supplierCategory ?? '');
    const sig = variantSignalByCat.get(xmlCat);
    const match: MatchResult = matchTrendyolCategoryByPath(xmlCat, Array.isArray(tree) ? tree : []);
    let varSup = 'n/a';
    if (match.status === 'MATCHED' && match.id !== null) {
      if (!attrCache.has(match.id)) {
        const attrs = await fetchTrendyolCategoryAttributes(match.id);
        attrCache.set(match.id, (Array.isArray(attrs) ? attrs : []).some((a) => a.varianter || a.slicer));
      }
      varSup = attrCache.get(match.id) ? 'YES' : 'NO';
    }
    results.push({
      xmlCat,
      count: g._count.id,
      withVariant: sig?.withVariant ?? 0,
      fields: sig ? Object.entries(sig.fields).map(([k, v]) => `${k}:${v}`).join(', ') : '',
      matchStatus: match.status,
      trendyolId: match.id,
      trendyolName: match.name,
      variantSupported: varSup,
    });
  }

  console.log('\n=== XML KATEGORİ → TRENDYOL EŞLEŞME ADAYLARI (ilk 60) ===');
  for (const r of results.slice(0, 60)) {
    console.log(`${r.matchStatus.padEnd(9)} | ${r.variantSupported.padEnd(4)} | ürün=${String(r.count).padStart(5)} | varyantlı=${String(r.withVariant).padStart(5)} | ${r.trendyolId ?? '-'} ${r.trendyolName ?? ''}  ←  ${r.xmlCat}  [${r.fields}]`);
  }

  const matchedVariantSupported = results.filter((r) => r.matchStatus === 'MATCHED' && r.variantSupported === 'YES');
  const matchedNoVariant = results.filter((r) => r.matchStatus === 'MATCHED' && r.variantSupported === 'NO');
  const ambiguous = results.filter((r) => r.matchStatus === 'AMBIGUOUS');
  const notFound = results.filter((r) => r.matchStatus === 'NOT_FOUND');
  console.log('\nÖZET: MATCHED+VARİANT=' + matchedVariantSupported.length + ' | MATCHED+NO-VARİANT=' + matchedNoVariant.length + ' | AMBIGUOUS=' + ambiguous.length + ' | NOT_FOUND=' + notFound.length);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => null); process.exit(1); });
