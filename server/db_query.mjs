import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, name: true } });
    console.log('USERS:', JSON.stringify(users));
    const admin = users.find(u => u.email === 'admin@dg-stok.local');
    if (admin) console.log('ADMIN FOUND:', admin.email, 'role:', admin.role);
  } catch(e) { console.error('DB ERROR:', e.message); }
  finally { await prisma.$disconnect(); }
}
main();
