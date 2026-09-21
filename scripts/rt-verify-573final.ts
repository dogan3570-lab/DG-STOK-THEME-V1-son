// scripts/rt-verify-573final.ts
// Verify 45 applied + protect 155 + recount
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

  const applied45 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  let okCat = 0, okLeaf = 0, okMap = 0, okMatch = 0, okManual = 0, okAudit = 0;
  const audit = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', meta: { contains: 'semantic-verified-573' } }, select: { meta: true } });
  const auditByPid = new Map<string, number>();
  for (const a of audit) { try { const m = JSON.parse(a.meta || '{}'); if (m.productId) auditByPid.set(m.productId, (auditByPid.get(m.productId) || 0) + 1); } catch {} }
  for (const r of applied45) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, categoryMatch: true, matchedBy: true } });
    if (p?.categoryId === r.newCategoryId) okCat++;
    if (tree.leafById.has(r.newCategoryId)) okLeaf++;
    if (mapSet.has(r.newCategoryId)) okMap++;
    if (p?.categoryMatch === true) okMatch++;
    if (p?.matchedBy === 'manual') okManual++;
    if (auditByPid.get(r.productId) === 1) okAudit++;
  }
  console.log(`45 VERIFY: cat=${okCat}/45 leaf=${okLeaf}/45 map=${okMap}/45 match=${okMatch}/45 manual=${okManual}/45 audit=${okAudit}/45`);

  // protect 155
  const applied155 = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-report-apply.json', 'utf8')).filter((r: any) => r.newCategoryId);
  let p155 = 0, changed155 = 0;
  for (const r of applied155) {
    const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, matchedBy: true } });
    if (p?.categoryId === r.newCategoryId && p?.matchedBy === 'manual') p155++; else changed155++;
  }
  console.log(`155 PROTECT: unchanged=${p155}/155 changed=${changed155}`);

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
