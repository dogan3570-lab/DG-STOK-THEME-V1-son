// scripts/rt-pilot-30.ts
// READ-ONLY PILOT: select 30 products (10/10/10) + build IDF-weighted Trendyol LEAF candidates
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { loadTrendyolTree } from '../server/src/services/categoryMatchEngine.ts';
import { resolveCategoryCandidates } from '../server/src/services/categoryCanonical.ts';
import { writeFileSync } from 'node:fs';
const prisma = new PrismaClient();

function foldTr(s: string): string {
  return s.toLowerCase().replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
}
const STOP = new Set(['ve','ile','icin','için','adet','cm','mm','ml','gr','kg','lt','model','urun','ürün','urunu','renk','renkli','ozel','özel','tasarim','tasarım','boyut','buyuk','büyük','kucuk','küçük','set','seti','the','and','for','with','pcs','piece','x']);
function tokens(s: string): string[] {
  return foldTr(s).split(' ').filter(t => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

async function main() {
  const srcId = '2fe5e126-3e1e-43a6-9b28-b77826300688';
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true, name: true } });
  const MP = tt!.id;
  const tree = await loadTrendyolTree();

  // ---- Build IDF over leaf path tokens ----
  const df = new Map<string, number>();
  const leafTokens = new Map<string, Set<string>>();
  for (const l of tree.leaves) {
    const ts = new Set(tokens(l.fullPath));
    leafTokens.set(l.id, ts);
    for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = tree.leaves.length;
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) || 0)));

  function rankLeaves(p: { title: string | null; supplierCategory: string | null; description?: string | null }, topN = 8) {
    const titleTokens = p.title ? tokens(p.title) : [];
    const supSegs = (p.supplierCategory || '').split('>').map(s => s.trim()).filter(Boolean);
    const supLeafTokens = supSegs.length ? tokens(supSegs[supSegs.length - 1]) : [];
    const supAllTokens = tokens(p.supplierCategory || '');
    const titleFold = foldTr(p.title || '');

    const wTitle = new Map<string, number>();
    for (const t of titleTokens) wTitle.set(t, (wTitle.get(t) || 0) + 1);
    const wSup = new Map<string, number>();
    for (const t of supLeafTokens) wSup.set(t, (wSup.get(t) || 0) + 2.0);
    for (const t of supAllTokens) wSup.set(t, (wSup.get(t) || 0) + 0.5);

    const scored: Array<{ id: string; name: string; fullPath: string; externalId: number; score: number; hits: string[] }> = [];
    for (const l of tree.leaves) {
      const lNameFold = foldTr(l.name);
      const lTokens = leafTokens.get(l.id)!;
      let score = 0;
      const hits: string[] = [];
      // whole leaf-name containment in title (strong)
      if (lNameFold.length >= 4 && titleFold.includes(lNameFold)) { score += 25; hits.push('TITLE~LEAF'); }
      for (const [t, w] of wTitle) {
        if (!idf(t)) continue;
        if (lTokens.has(t)) { score += idf(t) * w * (lNameFold.includes(t) ? 3 : 1); hits.push(t); }
      }
      for (const [t, w] of wSup) {
        if (!idf(t)) continue;
        if (lTokens.has(t)) { score += idf(t) * w * (lNameFold.includes(t) ? 3 : 1); hits.push('S:' + t); }
      }
      if (score > 0) scored.push({ id: l.id, name: l.name, fullPath: l.fullPath, externalId: l.externalId, score: Number(score.toFixed(3)), hits: [...new Set(hits)].slice(0, 8) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  // ---- Classify 728 into 3 buckets ----
  const prods = await prisma.product.findMany({
    where: { xmlSourceId: srcId, status: { not: 'DELETED' }, categoryId: null },
    select: { id: true, xmlKey: true, title: true, description: true, supplierCategory: true, xmlBrandName: true, customBrandName: true, images: true, status: true, salePrice: true, aiSuggestedCategoryId: true, aiScore: true, brand: { select: { name: true } } },
    orderBy: { xmlKey: 'asc' },
  });

  const noSource: typeof prods = [];
  const needsAi: typeof prods = [];
  const manualLow: typeof prods = [];
  for (const p of prods) {
    if (!p.supplierCategory) { noSource.push(p); continue; }
    const r = resolveCategoryCandidates({ id: p.id, xmlKey: p.xmlKey, title: p.title, supplierCategory: p.supplierCategory, xmlBrandName: p.xmlBrandName }, tree, MP);
    if (r.confidence < 0.6 || !r.topCandidate) manualLow.push(p);
    else needsAi.push(p);
  }
  console.log(`Buckets: NO_SOURCE=${noSource.length} NEEDS_AI=${needsAi.length} MANUAL_LOW=${manualLow.length}`);

  function pick<T>(arr: T[], n: number): T[] {
    if (arr.length <= n) return arr.slice();
    const step = arr.length / n;
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }
  const sel = [
    ...pick(noSource, 10).map(p => ({ p, cls: 'NO_SOURCE_CATEGORY' })),
    ...pick(needsAi, 10).map(p => ({ p, cls: 'NEEDS_AI_VERIFICATION' })),
    ...pick(manualLow, 10).map(p => ({ p, cls: 'MANUAL_REVIEW_LOW_CONFIDENCE' })),
  ];

  // ---- Output ----
  const lines: string[] = [];
  const json: any[] = [];
  for (const { p, cls } of sel) {
    const img = (p.images || '').split(/[\s,]+/).find(u => /^https?:\/\//.test(u)) || null;
    const cands = rankLeaves(p, 8);
    const rec = {
      productId: p.id, xmlKey: p.xmlKey, class: cls, title: p.title, brand: p.brand?.name || p.customBrandName || p.xmlBrandName || null,
      supplierCategory: p.supplierCategory, status: p.status, salePrice: p.salePrice, image: img,
      description: (p.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      candidates: cands.map(c => ({ name: c.name, path: c.fullPath, externalId: c.externalId, id: c.id, score: c.score, hits: c.hits })),
    };
    json.push(rec);
    lines.push(`===== ${cls} | ${p.xmlKey} | ${p.id.substring(0,8)} =====`);
    lines.push(`TITLE: ${p.title}`);
    lines.push(`BRAND: ${rec.brand} | STATUS: ${p.status} | PRICE: ${p.salePrice} | IMG: ${img ? 'VAR' : 'YOK'}`);
    lines.push(`SUPPLIER_CAT: ${p.supplierCategory ?? '(NULL)'}`);
    lines.push(`DESC: ${rec.description.substring(0, 260)}`);
    lines.push(`CANDIDATES:`);
    for (const c of rec.candidates) lines.push(`  [${c.score}] ${c.name} ext=${c.externalId} | path=${c.path} | hits=${c.hits.join(',')}`);
    lines.push('');
  }

  const out = 'C:/Users/Dogan/AppData/Local/Temp/opencode/pilot-30.txt';
  writeFileSync(out, lines.join('\n'), 'utf8');
  writeFileSync('C:/Users/Dogan/AppData/Local/Temp/opencode/pilot-30.json', JSON.stringify(json, null, 2), 'utf8');
  console.log(`Wrote ${out}`);
  console.log('');
  console.log(lines.join('\n'));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
