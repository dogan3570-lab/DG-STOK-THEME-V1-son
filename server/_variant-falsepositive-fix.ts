// VARIANT FALSE POSITIVE RE-CLASSIFICATION (tek seferlik, gerçek DB üzerinde)
// - AKYI çöp varyant satırlarını siler.
// - Başlıktan sahte varyant (Beden=S, Numara=45, Kapasite=1L) taşıyan eşleşmemiş
//   ürünleri gerçek kurala göre yeniden sınıflandırır: gerçek varyant yoksa NOT_REQUIRED.
import { prisma } from './src/db/prisma.ts';
import { detectVariantAttributes } from './src/services/readiness.ts';

const XML_SOURCE = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1

async function main() {
  // 1) AKYI çöp satırlarını sil (her üründe 1 tane var; SKU kodu, varyant DEĞİL)
  const akyiDeleted = await prisma.variant.deleteMany({
    where: { name: 'AKYI', product: { xmlSourceId: XML_SOURCE } },
  });
  console.log('[1] AKYI variant satırı silindi:', akyiDeleted.count);

  // 2) Eşleşmemiş + varyant bekleyen ürünleri gerçek kurala göre yeniden sınıflandır
  const candidates = await prisma.product.findMany({
    where: {
      xmlSourceId: XML_SOURCE,
      variantMatch: false,
      variantStatus: { in: ['WAITING_AI', 'MANUAL_REVIEW'] },
    },
    select: { id: true, title: true, sku: true, description: true, variantStatus: true },
  });
  console.log('[2] Yeniden sınıflandırılacak ürün (WAITING_AI/MANUAL_REVIEW):', candidates.length);

  let movedToNotRequired = 0;
  let keptVariant = 0;
  let cleanedRows = 0;
  const movedIds: string[] = [];

  for (const prod of candidates) {
    const text = [prod.title, prod.sku, prod.description].filter(Boolean).join(' ');
    const detected = detectVariantAttributes(text);

    if (detected.length === 0) {
      // Gerçek varyant yok → NOT_REQUIRED + tüm sahte varyant satırlarını sil
      const del = await prisma.variant.deleteMany({ where: { productId: prod.id } });
      cleanedRows += del.count;
      await prisma.product.update({
        where: { id: prod.id },
        data: { variantMatch: false, variantStatus: 'NOT_REQUIRED', matchedBy: null },
      });
      movedToNotRequired++;
      movedIds.push(prod.id);
    } else {
      // Gerçek varyant var → yalnızca canonical varyant satırlarını koru, sahte olanları sil
      const existing = await prisma.variant.findMany({ where: { productId: prod.id }, select: { id: true, name: true, value: true } });
      const keep = new Set<string>();
      for (const d of detected) {
        keep.add(`${d.name}:${d.value}`);
      }
      let deleted = 0;
      for (const row of existing) {
        const key = `${row.name}:${row.value}`;
        if (!keep.has(key) && !keep.has(`${row.name}:${row.value.toUpperCase()}`) && !keep.has(`${row.name}:${row.value.toLowerCase()}`)) {
          await prisma.variant.delete({ where: { id: row.id } });
          deleted++;
        }
      }
      cleanedRows += deleted;
      keptVariant++;
    }
  }

  console.log('[3] NOT_REQUIRED yapılan:', movedToNotRequired);
  console.log('[4] Gerçek varyantlı kalan:', keptVariant);
  console.log('[5] Silinen sahte varyant satırı:', cleanedRows);

  // Hedef ürün kontrolü
  const target = await prisma.product.findFirst({
    where: { sku: 'AKYI-053937' },
    select: { id: true, variantStatus: true, variantMatch: true, matchedBy: true, variants: { select: { name: true, value: true } } },
  });
  console.log('[6] HEDEF ÜRÜN (AKYI-053937):', JSON.stringify(target, null, 0));

  // Yeni sayaçlar
  const [total, notRequired, waiting, manual, completed, matched] = await Promise.all([
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE } }),
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE, variantStatus: 'NOT_REQUIRED' } }),
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE, variantStatus: 'WAITING_AI', variantMatch: false } }),
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE, variantStatus: 'MANUAL_REVIEW' } }),
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE, variantStatus: 'COMPLETED' } }),
    prisma.product.count({ where: { xmlSourceId: XML_SOURCE, variantMatch: true } }),
  ]);
  console.log('[7] YENİ SAYAÇLAR:', JSON.stringify({ total, notRequired, waitingAi: waiting, manual, completed, variantMatch: matched, hasVariant: total - notRequired }, null, 0));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
