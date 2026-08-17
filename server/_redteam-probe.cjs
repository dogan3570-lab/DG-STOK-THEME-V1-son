// RED TEAM DB PROBE — yalnızca okuma. migration/seed/reset YOK.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function section(t) { console.log('\n==================== ' + t + ' ===================='); }

(async () => {
  try {
    // 1) XML kaynakları
    section('XML SOURCES');
    const sources = await prisma.xmlSource.findMany({ orderBy: { createdAt: 'asc' } });
    for (const s of sources) {
      console.log(`[${s.id}] ${s.name} | active=${s.active} | company=${s.company || '-'}`);
    }

    // 2) Kaynak bazlı ürün sayaçları
    section('PRODUCT COUNTS PER SOURCE');
    for (const s of sources) {
      const [total, catNull, catMatchFalse, catMatchTrue, varMatchTrue, varMatchFalse] = await Promise.all([
        prisma.product.count({ where: { xmlSourceId: s.id } }),
        prisma.product.count({ where: { xmlSourceId: s.id, categoryId: null } }),
        prisma.product.count({ where: { xmlSourceId: s.id, categoryMatch: false } }),
        prisma.product.count({ where: { xmlSourceId: s.id, categoryMatch: true } }),
        prisma.product.count({ where: { xmlSourceId: s.id, variantMatch: true } }),
        prisma.product.count({ where: { xmlSourceId: s.id, variantMatch: false } }),
      ]);
      console.log(`\n[${s.name}] total=${total} | categoryIdNull=${catNull} | categoryMatchFalse=${catMatchFalse} | categoryMatchTrue=${catMatchTrue} | variantMatchTrue=${varMatchTrue} | variantMatchFalse=${varMatchFalse}`);

      const vsRows = await prisma.product.groupBy({ by: ['variantStatus'], where: { xmlSourceId: s.id }, _count: { _all: true } });
      for (const r of vsRows) console.log(`    variantStatus=${r.variantStatus || '(null)'} -> ${r._count._all}`);
    }

    // 3) HEDEF ÜRÜN: Siyah-Beyaz false-positive kontrolü
    section('TARGET PRODUCT (Siyah-Beyaz)');
    const targets = await prisma.product.findMany({
      where: { title: { contains: 'Siyah-Beyaz' } },
      select: { id: true, title: true, xmlKey: true, sku: true, barcode: true, xmlSourceId: true, variantStatus: true, variantMatch: true, matchedBy: true, categoryId: true, categoryMatch: true },
    });
    console.log('contains "Siyah-Beyaz" =>', targets.length, 'ürün');
    for (const t of targets) {
      console.log(`\n  id=${t.id}`);
      console.log(`  title=${t.title}`);
      console.log(`  xmlKey=${t.xmlKey}`);
      console.log(`  sku=${t.sku} barcode=${t.barcode}`);
      console.log(`  variantStatus=${t.variantStatus} variantMatch=${t.variantMatch} matchedBy=${t.matchedBy}`);
      console.log(`  categoryId=${t.categoryId} categoryMatch=${t.categoryMatch}`);
      const variants = await prisma.variant.findMany({ where: { productId: t.id }, select: { name: true, value: true } });
      console.log(`  variants=`, JSON.stringify(variants));
      const va = await prisma.variantAnalysis.findFirst({ where: { productId: t.id }, select: { source: true, status: true, checkResults: true, validationPassed: true } });
      console.log(`  variantAnalysis=`, JSON.stringify(va));
    }

    // 4) Airpods hedefi (title 'Airpods' içeren)
    section('AIRPODS ÜRÜNLERİ');
    const airpods = await prisma.product.findMany({
      where: { title: { contains: 'Airpods' } },
      select: { id: true, title: true, xmlKey: true, variantStatus: true, variantMatch: true, xmlSourceId: true },
    });
    for (const a of airpods) console.log(`  [${a.xmlSourceId}] ${a.title} | variantStatus=${a.variantStatus} variantMatch=${a.variantMatch}`);

    // 5) Gerçek varyantlı ürün var mı (variantStatus != NOT_REQUIRED)
    section('VARIANT STATUS DISTRIBUTION (GLOBAL)');
    const globalVs = await prisma.product.groupBy({ by: ['variantStatus'], _count: { _all: true } });
    for (const r of globalVs) console.log(`  variantStatus=${r.variantStatus || '(null)'} -> ${r._count._all}`);

    // 6) WAITING_AI/MANUAL_REVIEW olan ürünler (gerçek varyant adayları)
    section('WAITING_AI / MANUAL_REVIEW ÜRÜNLERİ (ilk 30)');
    const candidates = await prisma.product.findMany({
      where: { variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] } },
      select: { id: true, title: true, xmlKey: true, xmlSourceId: true, variantStatus: true, variantMatch: true },
      take: 30,
    });
    console.log('toplam aday (ilk 30 gösteriliyor):', await prisma.product.count({ where: { variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] } } }));
    for (const c of candidates) console.log(`  [${c.variantStatus}] ${c.title} (src=${c.xmlSourceId})`);

    // 7) AKILLIBAYI1 kaynağını bul
    section('AKILLIBAYI1 ARA');
    const akilli = sources.find(s => /akilli/i.test(s.name) || /AKILLIBAYI/i.test(s.name));
    console.log('AKILLIBAYI1 bulundu mu:', akilli ? akilli.name + ' id=' + akilli.id : 'YOK');

    // 8) categoryMapping sayıları
    section('CATEGORY MAPPING COUNTS');
    const [mappingTotal, mappingManual] = await Promise.all([
      prisma.categoryMapping.count(),
      prisma.categoryMapping.count({ where: { source: 'manual' } }),
    ]);
    console.log(`categoryMapping total=${mappingTotal} manual=${mappingManual}`);

    // 9) variantAnalysis dağılımı
    section('VARIANT ANALYSIS DISTRIBUTION');
    const vaRows = await prisma.variantAnalysis.groupBy({ by: ['status'], _count: { _all: true } });
    for (const r of vaRows) console.log(`  status=${r.status || '(null)'} -> ${r._count._all}`);
    const vaSourceRows = await prisma.variantAnalysis.groupBy({ by: ['source'], _count: { _all: true } });
    for (const r of vaSourceRows) console.log(`  source=${r.source || '(null)'} -> ${r._count._all}`);
  } catch (e) {
    console.error('PROBE ERROR:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
