// scripts/rt-check-desc.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
async function main() {
  for (const k of ['46059','46060','46066','46086','46113','46125']) {
    const p = await prisma.product.findUnique({ where: { xmlKey: k }, select: { title: true, description: true } });
    const d = (p?.description || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    console.log(`${k} | ${p?.title}\n   DESC: ${d.slice(0,160)}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
