// scripts/rt-verify-lnf.ts
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

  const auds = await prisma.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', details: { contains: 'lnf192-resolved' } }, select: { meta: true } });
  const byPid = new Map<string, number>();
  for (const x of auds) { try { const m = JSON.parse(x.meta || '{}'); if (m.productId) byPid.set(m.productId, (byPid.get(m.productId) || 0) + 1); } catch {} }
  let ok = 0; const bad: any[] = [];
  for (const [pid, cnt] of byPid) {
    const p = await prisma.product.findUnique({ where: { id: pid }, select: { categoryId: true, categoryMatch: true, matchedBy: true } });
    if (p?.categoryId && tree.leafById.has(p.categoryId) && mapSet.has(p.categoryId) && p.categoryMatch === true && p.matchedBy === 'manual' && cnt === 1) ok++; else bad.push({ pid, cnt });
  }
  console.log(`LNF192 APPLIED VERIFY (cat+leaf+map+match+manual+audit): ${ok}/${byPid.size} bad=${bad.length}`);

  const files = ['apply-report-apply.json','apply-573-apply.json','apply-528-apply.json','apply-mr225-apply.json','apply-conflict-apply.json'];
  const prev: any[] = [];
  for (const f of files) { const arr = JSON.parse(readFileSync(`C:/Users/Dogan/AppData/Local/Temp/opencode/${f}`, 'utf8')); prev.push(...arr.filter((r: any) => (r.status === 'AUTO_SAFE' || r.newCategoryId) && r.newCategoryId)); }
  let p283 = 0, changed = 0;
  for (const r of prev) { const p = await prisma.product.findUnique({ where: { id: r.productId }, select: { categoryId: true, matchedBy: true, categoryMatch: true } }); if (p?.categoryId === r.newCategoryId && p?.matchedBy === 'manual' && p?.categoryMatch === true) p283++; else changed++; }
  console.log(`283 PROTECT: unchanged=${p283}/${prev.length} changed=${changed}`);

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
