// scripts/rt-fix-variant41.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry';
async function main() {
  const affected = await prisma.product.findMany({ where: { status: { not: 'DELETED' }, variantStatus: 'WAITING_AI' }, select: { id: true, xmlKey: true, variantMatch: true, variantStatus: true } });
  console.log(`Mode=${MODE} WAITING_AI products: ${affected.length}`);
  console.log('keys:', affected.map(a=>a.xmlKey).join(','));
  if (MODE === 'apply') {
    const res = await prisma.product.updateMany({ where: { status: { not: 'DELETED' }, variantStatus: 'WAITING_AI' }, data: { variantStatus: 'NOT_REQUIRED' } });
    console.log('updated:', res.count);
    await prisma.auditLog.create({ data: { action: 'VARIANT_STATUS_FIX', entity: 'product', details: `${res.count} ürün: XML'de varyant (VariantGroups) yok → NOT_REQUIRED`, meta: JSON.stringify({ reason: 'xml has no VariantGroups (all empty) nor parentId/groupId', fixed: res.count, sampleKeys: affected.slice(0,20).map(a=>a.xmlKey) }) } });
  }
  const nr = await prisma.product.count({ where: { status: { not: 'DELETED' }, variantStatus: 'NOT_REQUIRED' } });
  const wa = await prisma.product.count({ where: { status: { not: 'DELETED' }, variantStatus: 'WAITING_AI' } });
  console.log('NOW: NOT_REQUIRED=', nr, 'WAITING_AI=', wa);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
