// scripts/rt-time-scan.ts — DB'deki tüm zaman damgalı GERÇEK veriyi tara
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

async function main() {
  const tables: Array<{ name: string }> = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name"
  );
  console.log('TABLE COUNT:', tables.length, '\n');
  for (const t of tables) {
    const cols: Array<{ name: string; type: string }> = await prisma.$queryRawUnsafe(`PRAGMA table_info("${t.name}")`);
    let count = 0;
    try { const c: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM "${t.name}"`); count = Number(c[0].c); } catch { }
    if (count === 0) { console.log(`${t.name.padEnd(32)} rows=0`); continue; }
    const dateCols = cols.filter(c => /date|time|At$|createdAt|updatedAt/i.test(c.name));
    const parts: string[] = [];
    for (const dc of dateCols) {
      try {
        const r: any[] = await prisma.$queryRawUnsafe(`SELECT MIN("${dc.name}") as mn, MAX("${dc.name}") as mx FROM "${t.name}" WHERE "${dc.name}" IS NOT NULL`);
        const mn = r[0]?.mn, mx = r[0]?.mx;
        if (mn || mx) parts.push(`${dc.name}=[${String(mn).slice(0, 19)} .. ${String(mx).slice(0, 19)}]`);
        else parts.push(`${dc.name}=[null]`);
      } catch (e) { parts.push(`${dc.name}=ERR`); }
    }
    console.log(`${t.name.padEnd(32)} rows=${String(count).padEnd(6)} ${parts.join(' | ')}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
