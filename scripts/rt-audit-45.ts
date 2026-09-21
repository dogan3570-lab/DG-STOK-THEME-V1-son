// scripts/rt-audit-45.ts
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { readFileSync } from 'node:fs';
const p = new PrismaClient();
async function main() {
  const applied = JSON.parse(readFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/apply-573-apply.json', 'utf8')).filter((r: any) => r.status === 'AUTO_SAFE');
  const audits = await p.auditLog.findMany({ where: { action: 'CATEGORY_MATCH', details: { contains: 'semantic-verified-573' } }, select: { meta: true } });
  const byPid = new Map<string, number>();
  for (const a of audits) { try { const m = JSON.parse(a.meta || '{}'); if (m.productId) byPid.set(m.productId, (byPid.get(m.productId) || 0) + 1); } catch {} }
  let ok = 0, miss = 0, dup = 0;
  for (const r of applied) { const c = byPid.get(r.productId) || 0; if (c === 1) ok++; else if (c > 1) dup++; else miss++; }
  console.log(`audit total(semantic-verified-573): ${audits.length} | 1-each: ${ok}/${applied.length} | missing: ${miss} | dup: ${dup}`);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
