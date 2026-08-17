/**
 * FAZ 4 — KÖK NEDEN TANISI: "JSON ayrıştırma hatası" üreten AI yanıtlarının RAW içeriğini gösterir.
 * READ-ONLY + tek gerçek AI isteği. Ürün/DB yazmaz.
 * Kullanım: npx tsx _faz4-diag-parse.ts <productId> [adet]
 */
import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { loadTrendyolTree, classifyByRule } from './src/services/categoryMatchEngine.ts';
import { chatCompletion, type ProductForMatch, type CategoryCandidate } from './src/services/aiGateway.ts';

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

async function main() {
  const pid = process.argv[2];
  const count = Math.min(5, Math.max(1, Number(process.argv[3] || '1')));
  const tree = await loadTrendyolTree();

  let products: ProductForMatch[];
  if (pid) {
    const p = await prisma.product.findUnique({
      where: { id: pid },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
    });
    if (!p) throw new Error('Ürün bulunamadı: ' + pid);
    products = [p];
  } else {
    const rows = await prisma.product.findMany({
      where: { categoryMatch: false, supplierCategory: { not: null } },
      select: { id: true, xmlKey: true, title: true, supplierCategory: true, xmlBrandName: true, description: true },
      orderBy: { createdAt: 'asc' },
      take: count,
    });
    products = rows;
  }

  // Kural adayları + basit başlık skoru (buildAiCandidates benzeri, tek ürün için yeterli)
  for (const p of products) {
    const rule = classifyByRule(p, tree);
    const candidates: CategoryCandidate[] = rule.candidates.map((c) => ({ id: c.id, name: c.name, fullPath: c.fullPath }));
    const prompt = buildPrompt([p], candidates);
    console.log('=== PRODUCT', p.id, '|', p.title?.slice(0, 60));
    console.log('CANDIDATE_COUNT', candidates.length);
    const res = await chatCompletion({ messages: prompt, temperature: 0.05, max_tokens: 4096, response_format: { type: 'json_object' } });
    const raw = res.content || '';
    console.log('RAW_LEN', raw.length);
    console.log('RAW_CONTENT', raw.slice(0, 2000));
    let parseOk = false;
    let parseErr = '';
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('JSON yok');
      JSON.parse(m[0]);
      parseOk = true;
    } catch (e) {
      parseErr = String(e instanceof Error ? e.message : e);
    }
    console.log('PARSE_OK', parseOk, 'PARSE_ERR', parseErr);
    console.log('---');
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});
