// scripts/rt-group-samples.ts
// READ-ONLY: one verified product per applied leaf group, DB truth
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
const GROUPS = ['Avize','Vazo','Toka','Bere','El Çantası','Abajur','Tablet Standı'];
async function main() {
  for (const g of GROUPS) {
    const cat = await prisma.category.findFirst({ where: { name: g }, select: { id: true, name: true, externalId: true } });
    if (!cat) { console.log(`${g}: category not found`); continue; }
    const n = await prisma.product.count({ where: { categoryId: cat.id, matchedBy: 'manual', categoryMatch: true } });
    const p = await prisma.product.findFirst({ where: { categoryId: cat.id, matchedBy: 'manual', categoryMatch: true }, select: { xmlKey: true, title: true, categoryId: true, categoryMatch: true, matchedBy: true, updatedAt: true } });
    console.log(`${g} (ext=${cat.externalId}) count=${n} | sample xmlKey=${p?.xmlKey} cat=${cat.name} match=${p?.categoryMatch} by=${p?.matchedBy} updated=${p?.updatedAt?.toISOString()}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
