// scripts/rt-cat-delete-audit.ts
// READ-ONLY: Check audit logs + orphan categoryIds + Genel history
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  // All category-related audits
  const audits = await prisma.auditLog.findMany({
    where: { OR: [{ entity: 'category' }, { action: { startsWith: 'CATEGORY' } }] },
    orderBy: { createdAt: 'asc' },
    select: { action: true, details: true, createdAt: true, entityId: true },
  });
  console.log(`═══ ALL category audit logs (${audits.length}) ═══`);
  const byAction = new Map<string, number>();
  for (const a of audits) byAction.set(a.action, (byAction.get(a.action) || 0) + 1);
  console.log(`  by action: ${JSON.stringify([...byAction])}`);
  console.log('  DELETE actions:');
  for (const a of audits.filter(a => a.action.includes('DELETE'))) {
    console.log(`    ${a.createdAt.toISOString().substring(0,19)} | ${a.details}`);
  }
  console.log('  CREATE actions (last 10):');
  for (const a of audits.filter(a => a.action.includes('CREATE')).slice(-10)) {
    console.log(`    ${a.createdAt.toISOString().substring(0,19)} | ${a.details}`);
  }
  console.log('');

  // Orphan categoryId check
  const cats = await prisma.category.findMany({ select: { id: true } });
  const catIds = new Set(cats.map(c => c.id));
  const products = await prisma.product.findMany({
    where: { xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688', status: { not: 'DELETED' } },
    select: { categoryId: true },
  });
  const orphan = products.filter(p => p.categoryId && !catIds.has(p.categoryId));
  console.log(`═══ Orphan categoryId (references missing Category) ═══`);
  console.log(`  Products with orphan categoryId: ${orphan.length}`);
  console.log('');

  // Genel-like categories
  const genelLike = await prisma.category.findMany({ where: { name: { contains: 'Genel' } }, select: { id: true, name: true, createdAt: true } });
  console.log(`═══ Categories containing "Genel" (${genelLike.length}) ═══`);
  for (const c of genelLike) console.log(`  ${c.id} | ${c.name} | created=${c.createdAt.toISOString()}`);
  console.log('');

  // Category count + root categories
  const total = await prisma.category.count();
  const roots = await prisma.category.findMany({ where: { parentId: null }, select: { id: true, name: true, externalId: true }, take: 40 });
  console.log(`═══ Categories total=${total}, roots (first 40) ═══`);
  for (const r of roots) console.log(`  ${r.name} (ext=${r.externalId ?? 'null'})`);
  console.log('');

  // Check product status transitions: any product with non-XML status?
  const byStatus = await prisma.product.groupBy({ by: ['status'], where: { xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688' }, _count: true });
  console.log(`═══ Product status distribution ═══`);
  for (const s of byStatus) console.log(`  ${s.status}: ${s._count}`);

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
