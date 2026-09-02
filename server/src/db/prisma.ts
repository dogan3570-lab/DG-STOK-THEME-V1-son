import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

async function applyPrismaPragmas(client: PrismaClient) {
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
    console.log('[Prisma] SQLite pragmas applied: WAL, busy_timeout=5000, synchronous=NORMAL');
  } catch (err) {
    console.error('[Prisma] Failed to apply pragmas:', err);
  }
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

  client.$connect()
    .then(async () => {
      console.log('[Prisma] Database connected successfully');
      await applyPrismaPragmas(client);
    })
    .catch((err) => console.error('[Prisma] Database connection failed:', err));

  return client;
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
