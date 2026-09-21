const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: 'file:./dev.db' } } });

async function main() {
  // FilterRule tablosunu oluştur (eğer yoksa)
  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FilterRule" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      xmlSourceId TEXT,
      marketplaceId TEXT,
      desiMode TEXT NOT NULL DEFAULT 'xml',
      manualDesi REAL,
      minPurchasePrice REAL,
      maxPurchasePrice REAL,
      active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Index'ler
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_FilterRule_active" ON "FilterRule"(active)`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_FilterRule_xmlSourceId" ON "FilterRule"(xmlSourceId)`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_FilterRule_marketplaceId" ON "FilterRule"(marketplaceId)`);

  // Tabloyu kontrol et
  const count = await p.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "FilterRule"`);
  console.log('FilterRule tablosu oluşturuldu. Mevcut kayıt:', count[0].c);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
