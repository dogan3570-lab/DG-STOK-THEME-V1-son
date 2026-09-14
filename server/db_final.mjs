
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  try {
    const total = await prisma.product.count({ where: { status: { not: "DELETED" } } });
    const unmatched = await prisma.product.count({ where: { categoryMatch: false, status: { not: "DELETED" } } });
    const matched = await prisma.product.count({ where: { categoryMatch: true, status: { not: "DELETED" } } });
    console.log("DB PRODUCT TOTAL:", total);
    console.log("DB UNMATCHED CATEGORY:", unmatched);
    console.log("DB MATCHED CATEGORY:", matched);
  } catch(e) { console.error("DB ERROR:", e.message); }
  finally { await prisma.$disconnect(); }
}
main();

