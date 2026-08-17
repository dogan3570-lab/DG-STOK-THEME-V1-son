/**
 * FAZ 4 — KÖK NEDEN TANISI (batch boyutu): N ürünü TEK AI çağrısına koyup RAW yanıtı ve parse sonucunu gösterir.
 * classifyByAi'nin aday üretimini ve matchCategoriesWithAI'nin prompt/parse mantığını birebir kopyalar.
 * READ-ONLY + tek gerçek AI isteği. Kullanım: npx tsx _faz4-diag-batch.ts <N> [baslangicIndex]
 * Batch runner ile AYNI ürün seçimini kullanır (state'teki processed ID'leri hariç tutar).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './src/db/prisma.ts';
import { loadTrendyolTree, classifyByRule } from './src/services/categoryMatchEngine.ts';
import { normalizeName } from './src/services/categoryBrandMapper.ts';
import { chatCompletion, type ProductForMatch, type CategoryCandidate } from './src/services/aiGateway.ts';

function tokensOf(text: string): string[] {
  return Array.from(new Set(
    (text || '').toLowerCase().split(/[^a-z0-9çğıöşü]+/).map((t) => t.trim()).filter((t) => t.length >= 3)
  ));
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

function buildPrompt(products: ProductForMatch[], categories: CategoryCandidate[]) {
  const categoryList = categories.map((c) => `- ID: "${c.id}" | Name: "${c.name}" | Path: "${c.fullPath}"`).join('\n');
  const productList = products.map((p) => {
    const parts: string[] = [];
    parts.push(`productId: "${p.id}"`);
    if (p.title) parts.push(`title: "${p.title.substring(0, 120)}"`);
    if (p.supplierCategory) parts.push(`supplierCategory: "${p.supplierCategory}"`);
    if (p.xmlBrandName) parts.push(`brand: "${p.xmlBrandName}"`);
    if (p.description) parts.push(`description: "${p.description.substring(0, 200)}"`);
    return `  { ${parts.join(', ')} }`;
  }).join(',\n');
  const systemMessage = `You are a product category matcher for an e-commerce system. Your task is to match products to the correct system category.

RULES:
1. You MUST only choose from the provided category list. Never invent new categories.
2. Return ONLY valid JSON, no other text.
3. Each product must be matched to exactly one category.
4. Confidence must be between 0 and 1.
5. confidence >= 0.95 = automatic match, 0.85-0.949 = suggestion, < 0.85 = manual review.
6. If you are not confident, set confidence below 0.85.
7. Look at the product title, supplier category path, and brand to determine the best category.

Response format (strict JSON):
{
  "matches": [
    { "productId": "...", "categoryId": "...", "confidence": 0.95, "reason": "brief reason" }
  ]
}`;
  const userMessage = `Match these products to categories:

PRODUCTS:
[${productList}]

AVAILABLE CATEGORIES:
${categoryList}

Return ONLY the JSON response.`;
  return [
    { role: 'system' as const, content: systemMessage },
    { role: 'user' as const, content: userMessage },
  ];
}

function parseMatches(content: string): { ok: boolean; count: number; err?: string } {
  try {
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const m = jsonStr.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, count: 0, err: 'JSON yok' };
    const parsed = JSON.parse(m[0]);
    const arr = Array.isArray(parsed?.matches) ? parsed.matches : [];
    return { ok: true, count: arr.length };
  } catch (e) {
    return { ok: false, count: 0, err: String(e instanceof Error ? e.message : e) };
  }
}

async function main() {
  const N = Math.max(1, Number(process.argv[2] || '20'));
  const startIdx = Math.max(0, Number(process.argv[3] || '0'));
  const tree = await loadTrendyolTree();

  // Batch runner ile aynı seçim: processed ID'leri hariç tut
  let processed: string[] = [];
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), '_cat-engine-state.json'), 'utf8'));
    processed = state.processedIds || [];
  } catch { /* state yok */ }

  const rows = await prisma.product.findMany({
    where: { categoryMatch: false, supplierCategory: { not: null }, id: { notIn: processed } },
    select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
    orderBy: { createdAt: 'asc' },
    skip: startIdx,
    take: N,
  });

  const products: ProductForMatch[] = rows;
  const candidatesByProduct = new Map<string, CategoryCandidate[]>();
  for (const p of products) {
    const rule = classifyByRule(p, tree);
    candidatesByProduct.set(p.id, buildAiCandidates(p, tree, rule.candidates, 25));
  }
  const allCandidates = Array.from(new Map(
    products.flatMap((p) => candidatesByProduct.get(p.id) || []).map((c) => [c.id, c])
  ).values());

  const prompt = buildPrompt(products, allCandidates);
  const res = await chatCompletion({ messages: prompt, temperature: 0.05, max_tokens: 4096, response_format: { type: 'json_object' } });
  const raw = res.content || '';
  const parse = parseMatches(raw);

  console.log(JSON.stringify({
    N,
    products: products.length,
    candidateCount: allCandidates.length,
    rawLength: raw.length,
    rawHead: raw.slice(0, 300),
    rawTail: raw.slice(-300),
    parse,
    error: res.error,
    errorCode: res.errorCode,
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
