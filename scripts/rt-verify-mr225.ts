// scripts/rt-verify-mr225.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { readFileSync } from 'node:fs';
const prisma = new PrismaClient();
async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();
  const maps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true, externalId: { not: null } }, select: { categoryId: true } });
  const mapSet = new Set(maps.map(m => m.categoryId));

  const a = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-mr225-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  const auds = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', details: { contains: 'image-verified-mr225' } }, select: { meta: true } });
  const byPid = new Map<string, number>();
  for (const x of auds) { try { const m = JSON.parse(x.meta || '{}'); if (m.productId) byPid.set(m.productId, (byPid.get(m.productId) || 0) + 1); } catch {} }
  let ok = 0;
  for (const r of a) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, categoryMatch: true, matchedBy: true } });
    if (p?.categoryId === r.newCategoryId && p?.categoryMatch === true && p?.matchedBy === 'manual' && tree.leafById.has(r.newCategoryId) && mapSet.has(r.newCategoryId) && byPid.get(r.productId) === 1) ok++;
  }
  console.log(`31 VERIFY (cat+leaf+map+match+manual+audit): ${ok}/31`);

  const a155 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-apply.json', 'utf8')).filter((r: any) => r.newCategoryId);
  const a45 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  const a26 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-528-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  let p226 = 0, changed = 0;
  for (const r of [...a155, ...a45, ...a26]) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, matchedBy: true, categoryMatch: true } });
    if (p?.categoryId === r.newCategoryId && p?.matchedBy === 'manual' && p?.categoryMatch === true) p226++; else changed++;
  }
  console.log(`226 PROTECT: unchanged=${p226}/226 changed=${changed}`);

  const total = await prisma.product.count({ where: { status: { not: 'DELETED' } } });
  const matched = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryMatch: true } });
  const nullCat = await prisma.product.count({ where: { status: { not: 'DELETED' }, categoryId: null } });
  const nullSc = await prisma.product.count({ where: { status: { not: 'DELETED' }, supplierCategory: null } });
  const categories = await prisma.category.count();
  const mappings = await prisma.categoryMapping.count();
  const tpa = await prisma.trendyolProductAttribute.count();
  const rules = await prisma.marketplacePricingRule.count();
  console.log('RECOUNT + REGRESSION:', JSON.stringify({ total, matched, nullCat, nullSc, categories, mappings, tpa, rules }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
