/**
 * FAZ 4/5 — ROLLBACK (yalnızca categoryMatch ile ilgili alanları geri alır).
 * Kullanım: npx tsx _faz45-rollback.ts <backup-json-dosyası>
 * Backup dosyasındaki her satır için categoryId/categoryMatch/matchedBy/aiSuggestedCategoryId/aiScore/lastMatchDate geri yazılır.
 * status DEĞİŞTİRİLMEZ (READY'e dokunmaz). Sadece eşleştirme alanlarını eski haline döndürür.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Backup dosyası gerekli: npx tsx _faz45-rollback.ts <backup.json>');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows: any[] = data.rows || [];
  let restored = 0;
  for (const r of rows) {
    await prisma.product.updateMany({
      where: { id: r.id },
      data: {
        categoryId: r.categoryId ?? null,
        categoryMatch: r.categoryMatch ?? false,
        matchedBy: r.matchedBy ?? null,
        aiSuggestedCategoryId: r.aiSuggestedCategoryId ?? null,
        aiScore: r.aiScore ?? null,
        lastMatchDate: r.lastMatchDate ? new Date(r.lastMatchDate) : null,
      },
    });
    restored++;
  }
  console.log(JSON.stringify({ restored }));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
