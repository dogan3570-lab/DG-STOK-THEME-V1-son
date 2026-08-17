// KATEGORİ MATCH VERİ BÜTÜNLÜĞÜ — KONTROLLÜ BACKFILL.
// Kural (authoritative): categoryMatch=true  ⟺  ürünün kategorisinde AKTİF + NUMERIC Trendyol CategoryMapping var.
// status=READY ⟺ 4/4 gate (categoryMatch + brandMatch + templateMatch + variant) TAMAM.
// Kullanım: node _backfill-category-match.cjs [--apply]
//   --apply OLMADAN dry-run (değişiklik yapmaz, backup üretir).
//   --apply ile backup alıp uygular.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

const XS = '949855eb-d68c-4920-b378-c622a6a665e2';
const MP_TT = '757a071c-98c5-4c96-bb8c-2dceac1568dd';
const APPLY = process.argv.includes('--apply');

async function main() {
  // Gerçek numeric mapping'li categoryId'ler (Trendyol)
  const mappings = await prisma.categoryMapping.findMany({
    where: { marketplaceId: MP_TT, active: true },
    select: { categoryId: true, externalId: true },
  });
  const mappedCatIds = new Set(
    mappings.filter(m => /^\d+$/.test(String(m.externalId || ''))).map(m => m.categoryId)
  );
  console.log(`Trendyol gerçek numeric mapping'li kategori = ${mappedCatIds.size}`);

  const products = await prisma.product.findMany({
    where: { xmlSourceId: XS, categoryId: { not: null } },
    select: { id: true, categoryId: true, categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: true, status: true },
  });
  console.log(`categoryId set ürün = ${products.length}`);

  // Hesaplanan doğru değerler
  const computed = products.map(p => {
    const hasMap = !!p.categoryId && mappedCatIds.has(p.categoryId);
    const variantComplete = p.variantMatch === true || p.variantStatus === 'NOT_REQUIRED';
    const ready = hasMap && p.brandMatch === true && p.templateMatch === true && variantComplete;
    return {
      id: p.id,
      oldCategoryMatch: p.categoryMatch,
      newCategoryMatch: hasMap,
      oldStatus: p.status,
      newStatus: ready ? 'READY' : 'XML',
      changed: p.categoryMatch !== hasMap || p.status !== (ready ? 'READY' : 'XML'),
    };
  });

  const toChange = computed.filter(c => c.changed);
  const catTrueToFalse = computed.filter(c => c.oldCategoryMatch === true && c.newCategoryMatch === false).length;
  const catFalseToTrue = computed.filter(c => c.oldCategoryMatch === false && c.newCategoryMatch === true).length;
  const statusReadyToXml = computed.filter(c => c.oldStatus === 'READY' && c.newStatus === 'XML').length;
  const statusXmlToReady = computed.filter(c => c.oldStatus === 'XML' && c.newStatus === 'READY').length;

  console.log(`\n=== DRY-RUN SONUÇ ===`);
  console.log(`değişecek ürün = ${toChange.length}`);
  console.log(`categoryMatch true→false (sahte-ready kaldırılır) = ${catTrueToFalse}`);
  console.log(`categoryMatch false→true (gerçek mapping doğrulanır) = ${catFalseToTrue}`);
  console.log(`status READY→XML = ${statusReadyToXml}`);
  console.log(`status XML→READY = ${statusXmlToReady}`);

  // Backup (her zaman)
  const backup = computed.filter(c => c.changed).map(c => ({
    id: c.id,
    oldCategoryMatch: c.oldCategoryMatch,
    oldStatus: c.oldStatus,
  }));
  const backupFile = `_backup-category-match-${Date.now()}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`\nBACKUP yazıldı: ${backupFile} (${backup.length} kayıt)`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] Değişiklik YAPILMADI. Uygulamak için: node _backfill-category-match.cjs --apply');
    await prisma.$disconnect();
    return;
  }

  // APPLY
  let updated = 0;
  for (const c of computed) {
    if (!c.changed) continue;
    await prisma.product.update({
      where: { id: c.id },
      data: { categoryMatch: c.newCategoryMatch, status: c.newStatus },
    });
    updated++;
  }
  console.log(`\n[APPLY] ${updated} ürün güncellendi`);

  // Doğrulama
  const [readyCount, catTrue, catFalse, limbo] = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: XS, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, OR: [{ variantMatch: true }, { variantStatus: 'NOT_REQUIRED' }] } }),
    prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: true } }),
    prisma.product.count({ where: { xmlSourceId: XS, categoryMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: XS, categoryId: { not: null }, categoryMatch: false } }),
  ]);
  console.log(`\n=== UYGULAMA SONRASI (AKILLIBAYI1) ===`);
  console.log(`READY (4/4) = ${readyCount}`);
  console.log(`categoryMatch true = ${catTrue}`);
  console.log(`categoryMatch false = ${catFalse}`);
  console.log(`LIMBO (catId set & match false) = ${limbo}`);
  console.log(`\nROLLBACK için: backup dosyasındaki kayıtlar geri yazılabilir.`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
