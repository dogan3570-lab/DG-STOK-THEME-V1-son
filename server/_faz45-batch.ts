/**
 * FAZ 4/5 — KONTROLLÜ BATCH (AI match + strict verify + verified write).
 * Kullanım: npx tsx _faz45-batch.ts <limit> [--resume]
 * - categoryMatch=false ve daha önce işlenmemiş ürünleri seçer (state dosyası idempotent).
 * - AI sub-batch = 20; her HIGH aday ikinci doğrulamadan geçer.
 * - categoryMatch=true YALNIZCA leaf + numeric externalId + aktif tt CategoryMapping doğrulanınca yazılır (applyVerifiedMatch).
 * - READY hiçbir zaman zorla yazılmaz.
 * - Geçici (TIMEOUT/RATE_LIMIT/SERVER_ERROR) hata: 2 retry + backoff. Başarısız ürünler processed'e EKLENMEZ → sonraki koşuda yeniden denenir.
 * - Kalıcı hata: fail-closed, ürün değiştirilmez, MANUAL sayılmaz (FAILED olarak raporlanır).
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
const SUB = 20;

interface RunRecord {
  at: string; limit: number; total: number; matched: number; manual: number;
  failed: number; invalid: number; unchanged: number;
}
interface State { processedIds: string[]; runs: RunRecord[] }

function loadState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State; }
  catch { return { processedIds: [], runs: [] }; }
}
function saveState(s: State) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const args = process.argv.slice(2);
const limit = Math.max(1, Number(args.find((a) => /^\d+$/.test(a)) || '100'));

const TRANSIENT = new Set(['TIMEOUT', 'RATE_LIMIT', 'SERVER_ERROR', 'ALL_FAILED']);

async function classifyWithRetry(
  sub: any[],
  tree: any,
  mpName: string
): Promise<Awaited<ReturnType<typeof classifyByAi>>> {
  let last = await classifyByAi(sub, tree, mpName);
  if (last.ok) return last;

  // Geçici hatalarda backoff + retry
  for (let attempt = 0; attempt < 2 && TRANSIENT.has(last.errorCode || ''); attempt++) {
    const wait = 2000 * (attempt + 1);
    await new Promise((r) => setTimeout(r, wait));
    last = await classifyByAi(sub, tree, mpName);
    if (last.ok) return last;
  }
  return last;
}

async function main() {
  const state = loadState();
  const processed = new Set<string>(state.processedIds || []);
  const tree = await loadTrendyolTree();
  const mpId = await loadTrendyolMarketplaceId();
  if (!mpId) throw new Error('Trendyol marketplace bulunamadı');

  const before = await prisma.product.count({ where: { categoryMatch: false } });

  const products = await prisma.product.findMany({
    where: { categoryMatch: false, id: { notIn: Array.from(processed) }, supplierCategory: { not: null } },
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
  let unchanged = 0;
  const details: Array<Record<string, unknown>> = [];

  for (let i = 0; i < products.length; i += SUB) {
    const sub = products.slice(i, i + SUB);
    const ai = await classifyWithRetry(sub, tree, mp?.name ?? 'Trendyol');

    if (!ai.ok) {
      // Tüm retry'lere rağmen AI çalışmadı → ürünleri DEĞİŞTİRME; processed'e ekleme (sonraki koşuda tekrar).
      failed += sub.length;
      for (const p of sub) details.push({ productId: p.id, status: 'failed', reason: ai.error || 'AI başarısız' });
      continue;
    }

    for (const p of sub) {
      const d: MatchDecision | undefined = ai.decisions.get(p.id);
      if (!d) {
        failed++;
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
          // verified write reddetti (mapping yok / düşük güven / hedef geçersiz) → MANUAL terminal
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
  state.runs.push({ at: new Date().toISOString(), limit, total: products.length, matched, manual, failed, invalid, unchanged });
  saveState(state);

  const after = await prisma.product.count({ where: { categoryMatch: false } });

  console.log(JSON.stringify({
    run: { limit, total: products.length, matched, manual, failed, invalid, unchanged },
    beforeCategoryMatchFalse: before,
    afterCategoryMatchFalse: after,
    delta: before - after,
    processedTotal: processed.size,
    sample: details.slice(0, 30),
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
