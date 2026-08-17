/**
 * FAZ 4/5 — KONTROLLÜ BATCH (AI match + strict verify + verified write).
 * Kullanım: npx tsx _faz4-batch-run.ts <limit>
 * - Yalnızca categoryMatch=false ve daha önce işlenmemiş ürünleri seçer (state dosyası ile idempotent).
 * - AI sub-batch = 20; her HIGH aday ikinci doğrulamadan geçer.
 * - categoryMatch=true YALNIZCA leaf + numeric externalId + aktif tt CategoryMapping doğrulanınca yazılır.
 * - READY hiçbir zaman zorla yazılmaz.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './src/db/prisma.ts';
import {
  loadTrendyolTree,
  loadTrendyolMarketplaceId,
  classifyByAi,
  applyVerifiedMatch,
  type MatchDecision,
} from './src/services/categoryMatchEngine.ts';

const STATE_FILE = path.join(process.cwd(), '_cat-engine-state.json');

interface RunRecord { at: string; limit: number; total: number; matched: number; manual: number; failed: number; invalid: number }
interface State { processedIds: string[]; runs: RunRecord[] }

function loadState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State; }
  catch { return { processedIds: [], runs: [] }; }
}
function saveState(s: State) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const limit = Math.max(1, Number(process.argv[2] || '50'));
const SUB = 20;

async function main() {
  const state = loadState();
  const processed = new Set<string>(state.processedIds || []);
  const tree = await loadTrendyolTree();
  const mpId = await loadTrendyolMarketplaceId();
  if (!mpId) throw new Error('Trendyol marketplace bulunamadı');

  const products = await prisma.product.findMany({
    where: { categoryMatch: false, id: { notIn: Array.from(processed) } },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  if (products.length === 0) {
    console.log(JSON.stringify({ done: true, processedTotal: processed.size, message: 'İşlenecek yeni ürün yok' }));
    await prisma.$disconnect();
    process.exit(0);
  }

  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' }, select: { name: true } });

  let matched = 0;
  let manual = 0;
  let failed = 0;
  let invalid = 0;
  const details: Array<Record<string, unknown>> = [];

  for (let i = 0; i < products.length; i += SUB) {
    const sub = products.slice(i, i + SUB);
    let ai = await classifyByAi(sub, tree, mp?.name ?? 'Trendyol');
    if (!ai.ok) {
      // transient hata için tek cooldown+retry
      await new Promise((r) => setTimeout(r, 2000));
      ai = await classifyByAi(sub, tree, mp?.name ?? 'Trendyol');
    }

    for (const p of sub) {
      const d: MatchDecision | undefined = ai.decisions.get(p.id);
      if (!d) {
        failed++;
        processed.add(p.id);
        details.push({ productId: p.id, status: 'failed', reason: 'AI karar üretmedi' });
        continue;
      }
      if (d.method === 'invalid') {
        invalid++;
        processed.add(p.id);
        details.push({ productId: p.id, status: 'invalid', reason: d.reason });
        continue;
      }
      if (d.categoryId !== null) {
        const res = await applyVerifiedMatch(d, mpId);
        if (res.applied) {
          matched++;
          details.push({ productId: p.id, status: 'matched', method: d.method, externalId: d.externalId, categoryName: d.categoryName, confidence: d.confidence });
        } else {
          manual++;
          details.push({ productId: p.id, status: 'manual', reason: res.reason });
        }
      } else {
        manual++;
        details.push({ productId: p.id, status: 'manual', reason: d.reason });
      }
      processed.add(p.id);
    }
  }

  state.processedIds = Array.from(processed);
  state.runs = state.runs || [];
  state.runs.push({ at: new Date().toISOString(), limit, total: products.length, matched, manual, failed, invalid });
  saveState(state);

  console.log(JSON.stringify({
    run: { limit, total: products.length, matched, manual, failed, invalid },
    processedTotal: processed.size,
    sample: details.slice(0, 20),
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
