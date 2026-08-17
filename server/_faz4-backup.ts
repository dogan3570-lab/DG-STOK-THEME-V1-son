/**
 * FAZ 4 — BACKUP SNAPSHOT (yalnızca categoryMatch=false ürünlerin ilgili alanları).
 * Rollback için değişecek kayıtların önceki değerlerini saklar. YAZMA yalnızca JSON dosyasınadır.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './src/db/prisma.ts';

async function main() {
  const rows = await prisma.product.findMany({
    where: { categoryMatch: false },
    select: {
      id: true, xmlKey: true, categoryId: true, categoryMatch: true, matchedBy: true,
      aiSuggestedCategoryId: true, aiScore: true, lastMatchDate: true, status: true,
    },
  });
  const file = path.join(process.cwd(), `_backup-cat-engine-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  console.log(JSON.stringify({ backupFile: file, count: rows.length }));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
