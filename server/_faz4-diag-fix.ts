/**
 * FAZ 4 — FIX DOĞRULAMA: üretim matchCategoriesWithAI yolunu (sanitize dahil) N ürünle çağırır.
 * READ-ONLY + tek gerçek AI isteği. Kullanım: npx tsx _faz4-diag-fix.ts <N>
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './src/db/prisma.ts';
import { loadTrendyolTree, classifyByRule } from './src/services/categoryMatchEngine.ts';
import { normalizeName } from './src/services/categoryBrandMapper.ts';
import { matchCategoriesWithAI, type ProductForMatch, type CategoryCandidate } from './src/services/aiGateway.ts';

function tokensOf(text: string): string[] {
  return Array.from(new Set((text || '').toLowerCase().split(/[^a-z0-9çğıöşü]+/).map((t) => t.trim()).filter((t) => t.length >= 3)));
}
function pathTokens(xmlPath: string): string[] {
  return (xmlPath || '').split('>').map((s) => normalizeName(s.trim())).filter((t) => t.length > 0);
}
function leafToken(xmlPath: string): string {
  const toks = pathTokens(xmlPath);
  return toks[toks.length - 1] || '';
}
function buildAiCandidates(product: { title: string | null; supplierCategory: string | null }, tree: any, ruleCandidates: any[], topK: number): CategoryCandidate[] {
  const leafTok = leafToken(product.supplierCategory || '');
  const xmlTokens = new Set(pathTokens(product.supplierCategory || '').filter((t) => t.length >= 3));
  const titleTokens = tokensOf(product.title || '');
  const allTokens = new Set([...xmlTokens, ...titleTokens]);
  const scored = tree.leaves.map((l: any) => {
    const leafTokens = new Set(tokensOf(l.fullPath));
    let overlap = 0;
    for (const t of allTokens) if (leafTokens.has(t)) overlap++;
    const leafNorm = normalizeName(l.name);
    const contains = leafNorm.length >= 4 && leafTok.length >= 4 && (leafNorm.includes(leafTok) || leafTok.includes(leafNorm));
    return { leaf: l, score: overlap * 10 + (contains ? 25 : 0) };
  }).filter((s: any) => s.score > 0);
  scored.sort((a: any, b: any) => b.score - a.score);
  const out: CategoryCandidate[] = [];
  const seen = new Set<string>();
  for (const c of ruleCandidates) { if (!seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, name: c.name, fullPath: c.fullPath }); } }
  for (const s of scored) { if (!seen.has(s.leaf.id)) { seen.add(s.leaf.id); out.push({ id: s.leaf.id, name: s.leaf.name, fullPath: s.leaf.fullPath }); } }
  return out.slice(0, topK);
}

async function main() {
  const N = Math.max(1, Number(process.argv[2] || '20'));
  const tree = await loadTrendyolTree();

  let processed: string[] = [];
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), '_cat-engine-state.json'), 'utf8'));
    processed = state.processedIds || [];
  } catch { /* yok */ }

  const rows = await prisma.product.findMany({
    where: { categoryMatch: false, supplierCategory: { not: null }, id: { notIn: processed } },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
    orderBy: { createdAt: 'asc' },
    take: N,
  });

  const products: ProductForMatch[] = rows;
  const candidatesByProduct = new Map<string, CategoryCandidate[]>();
  for (const p of products) {
    const rule = classifyByRule(p, tree);
    candidatesByProduct.set(p.id, buildAiCandidates(p, tree, rule.candidates, 25));
  }
  const allCandidates = Array.from(new Map(products.flatMap((p) => candidatesByProduct.get(p.id) || []).map((c) => [c.id, c])).values());

  const res = await matchCategoriesWithAI(products, allCandidates, 'Trendyol');
  console.log(JSON.stringify({
    N,
    products: products.length,
    candidateCount: allCandidates.length,
    ok: res.ok,
    provider: res.provider,
    model: res.model,
    error: res.error,
    errorCode: res.errorCode,
    matches: res.matches.length,
    sample: res.matches.slice(0, 5).map((m) => ({ productId: m.productId, categoryId: m.categoryId, confidence: m.confidence })),
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
