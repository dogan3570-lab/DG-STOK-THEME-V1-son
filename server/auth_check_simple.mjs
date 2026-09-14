const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const admin = await prisma.user.findUnique({ where: { email: "admin@dgstok.com" }, select: { id: true, email: true, role: true } });
    console.log("ADMIN FOUND:", admin ? admin.email + " (" + admin.role + ")" : "NOT FOUND");
    const oldAdmin = await prisma.user.findUnique({ where: { email: "admin@dg-stok.local" }, select: { id: true, email: true } });
    console.log("OLD ADMIN FOUND:", oldAdmin ? oldAdmin.email : "NOT FOUND (DELETED?)");
    const adminPass = await prisma.user.findUnique({ where: { email: "admin@dgstok.com" }, select: { password: true } });
    console.log("PASSWORD HASH EXISTS:", adminPass ? adminPass.password ? adminPass.password.substring(0, 20) + "..." : "EMPTY" : "NULL");
  } catch(e) { console.error("DB ERROR:", e.message); }
  finally { await prisma.$disconnect(); }
}
main();
