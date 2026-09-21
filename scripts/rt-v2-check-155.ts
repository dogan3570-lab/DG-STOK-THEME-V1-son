// scripts/rt-v2-check-155.ts
// READ-ONLY: run product-level V2 pipeline on the 155 whitelist ids, record verdict
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { evaluateProductsIndividually } from '../server/src/services/categoryCoreV2.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

async function main() {
  const data = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/auto-safe.json', 'utf8'));
  const WHITELIST_EXT = [934, 1881, 1795, 384, 2197, 4956, 931];
  const ids = data.filter((d: any) => d.safe && WHITELIST_EXT.includes(d.targetExt)).map((d: any) => d.productId);
  console.log(`ids: ${ids.length}`);

  const res = await evaluateProductsIndividually(ids, false); // apply=false (read-only)
  const out = (res as any).results ?? (res as any).decisions ?? res;
  const arr = Array.isArray(out) ? out : [];
  const byClass = new Map<string, number>();
  for (const d of arr) byClass.set(d.classification || 'UNKNOWN', (byClass.get(d.classification || 'UNKNOWN') || 0) + 1);
  console.log('V2 verdict by classification:', JSON.stringify([...byClass]));
  const accepted = arr.filter((d: any) => d.isAuto && d.newCategoryId);
  console.log(`V2 would auto-accept: ${accepted.length}`);
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/v2-check-155.json', JSON.stringify(arr, null, 2), 'utf8');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
