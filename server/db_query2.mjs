
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  try {
    const admin = await prisma.user.findUnique({ where: { email: "admin@dg-stok.local" }, select: { id: true, email: true, password: true } });
    if (admin) {
      console.log("ADMIN PASSWORD HASH (first 60 chars):", admin.password ? admin.password.substring(0, 60) : "NULL/EMPTY");
      console.log("HASH LENGTH:", admin.password ? admin.password.length : 0);
      console.log("HASH STARTS WITH:$2b$?", admin.password ? admin.password.startsWith("$2") : false);
    }
  } catch(e) { console.error("DB ERROR:", e.message); }
  finally { await prisma.$disconnect(); }
}
main();

