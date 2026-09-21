import { PrismaClient } from './prisma/client.js';
const prisma = new PrismaClient();
const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, name: true } });
console.log(JSON.stringify(users, null, 2));
await prisma.$disconnect();