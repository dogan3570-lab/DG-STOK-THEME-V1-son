// scripts/rt-variant-41.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { readFileSync } from 'node:fs';
const prisma = new PrismaClient();
function getTag(c: string, tag: string): string | null { const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'); const m = c.match(re); return m ? m[1].trim() : null; }
async function main() {
  const wa = await prisma.product.findMany({ where: { status: { not: 'DELETED' }, variantStatus: 'WAITING_AI' }, select: { xmlKey: true, title: true, sku: true } });
  console.log(`WAITING_AI products: ${wa.length}`);
  console.log('keys:', wa.map(p=>p.xmlKey).join(','));
  // check XML variant groups for these
  const xml = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/buffer-feed.xml', 'utf8');
  const blocks = new Map<string, string>();
  for (const m of xml.matchAll(/<(Product|product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)) { const id = getTag(m[2], 'Id'); if (id) blocks.set(id, m[2]); }
  let withVG = 0, withoutVG = 0;
  for (const p of wa) {
    const blk = blocks.get(p.xmlKey) || '';
    const vg = getTag(blk, 'VariantGroups');
    if (vg && vg.length > 5) withVG++; else withoutVG++;
  }
  console.log(`With <VariantGroups>: ${withVG}, without: ${withoutVG}`);
  // show samples with VariantGroups
  for (const p of wa.slice(0, 6)) {
    const blk = blocks.get(p.xmlKey) || '';
    const vg = getTag(blk, 'VariantGroups');
    console.log(`  ${p.xmlKey} | sku=${p.sku} | VG=${vg ? vg.replace(/\s+/g,' ').slice(0,120) : 'NONE'}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
