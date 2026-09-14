import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const user = await prisma.user.findUnique({ where: { email: 'admin@dg-stok.local' } });
console.log('User:', user ? { email: user.email, hasPassword: !!user.password } : 'NOT FOUND');
await prisma.$disconnect();