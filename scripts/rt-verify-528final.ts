// scripts/rt-verify-528final.ts
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

  // verify 26
  const a26 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-528-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  const aud26 = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', details: { contains: 'hand-verified-528' } }, select: { meta: true } });
  const byPid = new Map<string, number>();
  for (const a of aud26) { try { const m = JSON.parse(a.meta || '{}'); if (m.productId) byPid.set(m.productId, (byPid.get(m.productId) || 0) + 1); } catch {} }
  let ok = 0;
  for (const r of a26) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, categoryMatch: true, matchedBy: true } });
    const pass = p?.categoryId === r.newCategoryId && p?.categoryMatch === true && p?.matchedBy === 'manual' && tree.leafById.has(r.newCategoryId) && mapSet.has(r.newCategoryId) && byPid.get(r.productId) === 1;
    if (pass) ok++;
  }
  console.log(`26 VERIFY (cat+leaf+map+match+manual+audit): ${ok}/26`);

  // protect 200
  const a155 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-apply.json', 'utf8')).filter((r: any) => r.newCategoryId);
  const a45 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  let p200 = 0, changed = 0;
  for (const r of [...a155, ...a45]) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, matchedBy: true, categoryMatch: true } });
    if (p?.categoryId === r.newCategoryId && p?.matchedBy === 'manual' && p?.categoryMatch === true) p200++; else changed++;
  }
  console.log(`200 PROTECT: unchanged=${p200}/200 changed=${changed}`);

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
