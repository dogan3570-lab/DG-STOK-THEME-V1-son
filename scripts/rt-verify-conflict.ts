// scripts/rt-verify-conflict.ts
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

  const a26 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-conflict-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  const auds = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', details: { contains: 'conflict-resolved-85' } }, select: { meta: true } });
  const byPid = new Map<string, number>();
  for (const x of auds) { try { const m = JSON.parse(x.meta || '{}'); if (m.productId) byPid.set(m.productId, (byPid.get(m.productId) || 0) + 1); } catch {} }
  let ok = 0;
  for (const r of a26) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, categoryMatch: true, matchedBy: true } });
    if (p?.categoryId === r.newCategoryId && p?.categoryMatch === true && p?.matchedBy === 'manual' && tree.leafById.has(r.newCategoryId) && mapSet.has(r.newCategoryId) && byPid.get(r.productId) === 1) ok++;
  }
  console.log(`26 VERIFY (cat+leaf+map+match+manual+audit): ${ok}/26`);

  const files = ['apply-report-apply.json', 'apply-573-apply.json', 'apply-528-apply.json', 'apply-mr225-apply.json'];
  const prev: any[] = [];
  for (const f of files) {
    const arr = JSON.parse(readFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/${f}`, 'utf8'));
    prev.push(...arr.filter((r: any) => (r.status === 'AUTO_SAFE' || r.newCategoryId) && r.newCategoryId));
  }
  let p257 = 0, changed = 0;
  for (const r of prev) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, matchedBy: true, categoryMatch: true } });
    if (p?.categoryId === r.newCategoryId && p?.matchedBy === 'manual' && p?.categoryMatch === true) p257++; else changed++;
  }
  console.log(`257 PROTECT: unchanged=${p257}/${prev.length} changed=${changed}`);

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
