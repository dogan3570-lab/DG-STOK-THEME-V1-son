import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: "file:./dev.db" } });
try {
  const adminLocal = await prisma.user.findUnique({ where: { email: "admin@dg-stok.local" }, select: { id: true, email: true } });
  const adminCom = await prisma.user.findUnique({ where: { email: "admin@dgstok.com" }, select: { id: true, email: true, role: true } });
  console.log("admin@dg-stok.local:", adminLocal ? adminLocal.email + " FOUND" : "NOT FOUND");
  console.log("admin@dgstok.com:", adminCom ? adminCom.email + " (" + adminCom.role + ") FOUND" : "NOT FOUND");
} catch (e) { console.error("DB ERROR:", e.message); }
finally { await prisma.$disconnect(); }
