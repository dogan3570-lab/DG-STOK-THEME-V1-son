/**
 * FAZ 3 — 10 GERÇEK ÜRÜN DRY-RUN (YAZMA YOK).
 * Gerçek AI + gerçek DB Trendyol ağacı kullanılır; hiçbir ürün/categoryMatch/READY değiştirilmez.
 * previewProducts yalnızca okur ve sınıflandırır.
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { previewProducts } from './src/services/categoryMatchEngine.ts';

const SAMPLE_PATHS = [
  // exact/rule eşleşmesi beklenenler (Grup D)
  'Aksesuarlar > Saat/Gozluk/Aksesuar > Baston > Saat/Gozluk/Aksesuar >>> Aksesuarlar >>> Baston',
  'Alt Giyim > Giyim > Etek > Giyim >>> Alt Giyim >>> Etek',
  'Altin > Aksesuar > Tam Altin > Aksesuar >>> Altin >>> Tam Altin',
  'Atki & Bere & Eldiven > Aksesuar > Bere > Aksesuar >>> Atki & Bere & Eldiven >>> Bere',
  'Bahce > Bahce & Elektrikli El Aletleri > Bahce Sulama > Bahce & Elektrikli El Aletleri >>> Bahce >>> Bahce Sulama >>> Sulama Basliklari',
  // AI gerektirenler (Grup F)
  'Airtag > Telefon & Tablet Aksesuarlari > Telefon & Tablet Aksesuarlari >>> Airtag',
  'Aksesuarlar > Bilgisayar > Apple Aksesuarlari > Bilgisayar >>> Aksesuarlar >>> Apple Aksesuarlari',
  'Aksesuarlar > Bilgisayar > Notebook Aksesuarlari > Bilgisayar >>> Aksesuarlar >>> Notebook Aksesuarlari >>> Notebook Adaptorleri',
  'Aksesuarlar > Bilgisayar > Kablolar/Swich ve Coklayicilar > Bilgisayar >>> Aksesuarlar >>> Kablolar/Swich ve Coklayicilar >>> Cevirici ve Adaptorler',
  'Ag / Modem > Bilgisayar > Bluetooth Urunler > Bilgisayar >>> Ag / Modem >>> Bluetooth Urunler',
];

async function main() {
  const ids: string[] = [];
  for (const path of SAMPLE_PATHS) {
    const p = await prisma.product.findFirst({
      where: { supplierCategory: path, categoryMatch: false },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (p) ids.push(p.id);
  }

  console.log('SELECTED_PRODUCTS', JSON.stringify(ids));
  const result = await previewProducts(ids, true);

  // Kompakt rapor
  const rows = result.rows.map((r) => ({
    xmlKey: r.xmlKey,
    title: r.title,
    supplierCategory: r.supplierCategory,
    xmlBrandName: r.xmlBrandName,
    method: r.method,
    confidence: r.confidence,
    targetCategoryId: r.categoryId,
    externalId: r.externalId,
    categoryName: r.categoryName,
    fullPath: r.fullPath,
    reason: r.reason,
    mappingExists: r.mappingExists,
    isLeaf: r.isLeaf,
    candidatesTop5: r.candidates.slice(0, 5).map((c) => ({ name: c.name, fullPath: c.fullPath, score: c.score })),
    gate: r.gate,
  }));

  console.log(JSON.stringify({
    tree: result.tree,
    ai: result.ai,
    rows,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
