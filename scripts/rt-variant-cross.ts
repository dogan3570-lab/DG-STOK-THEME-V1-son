// scripts/rt-variant-cross.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { readFileSync } from 'node:fs';
const prisma = new PrismaClient();
function getTag(c: string, tag: string): string | null { const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'); const m = c.match(re); return m ? m[1].trim() : null; }
async function main() {
  const xml = readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/buffer-feed.xml', 'utf8');
  const hasVG = new Map<string, boolean>();
  for (const m of xml.matchAll(/<(Product|product|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const id = getTag(m[2], 'Id'); if (!id) continue;
    const vg = getTag(m[2], 'VariantGroups');
    const pid = getTag(m[2], 'parentId') || getTag(m[2], 'groupId');
    hasVG.set(id, (!!vg && vg.length > 5) || !!pid);
  }
  const prods = await prisma.product.findMany({ where: { status: { not: 'DELETED' } }, select: { xmlKey: true, variantStatus: true } });
  const xt: Record<string, number> = {};
  let xmlWithVG = 0, dbWAITING = 0;
  const mismatch: string[] = [];
  for (const p of prods) {
    const vg = hasVG.get(p.xmlKey) ?? false;
    if (vg) xmlWithVG++;
    const dbWait = p.variantStatus === 'WAITING_AI';
    if (dbWait) dbWAITING++;
    const k = `xmlVG=${vg} | db=${p.variantStatus}`;
    xt[k] = (xt[k] || 0) + 1;
    if (vg !== dbWait && mismatch.length < 40) mismatch.push(`${p.xmlKey}: xmlVG=${vg} db=${p.variantStatus}`);
  }
  console.log(`XML products with VariantGroups/parentId: ${xmlWithVG}`);
  console.log(`DB products WAITING_AI: ${dbWAITING}`);
  console.log('CROSS-TAB:', JSON.stringify(xt, null, 2));
  console.log('\nMISMATCH samples (xmlVG != dbWAITING):');
  for (const s of mismatch) console.log('  ' + s);
  console.log(`\nTotal mismatch: ${mismatch.length >= 40 ? '>=40' : mismatch.length}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
