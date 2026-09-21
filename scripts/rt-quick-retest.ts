import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();
function parsePositiveInt(v: string | null | undefined): number | null {
  if (v == null) return null; const n = Number(String(v).trim()); return Number.isInteger(n) && n > 0 ? n : null;
}
async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;
  const catMaps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true }, select: { categoryId: true, externalId: true }, orderBy: { createdAt: 'desc' } });
  const catExtMap = new Map<string, number>();
  for (const cm of catMaps) { if (!cm.categoryId || catExtMap.has(cm.categoryId)) continue; const n = parsePositiveInt(cm.externalId); if (n) catExtMap.set(cm.categoryId, n); }
  const tpls = await prisma.listingTemplate.findMany({ where: { marketplaceId: MP, active: true }, select: { productId: true, categoryId: true, brandId: true } });
  const prodTpls = new Set(tpls.filter(t => t.productId).map(t => t.productId));
  const catTpls = new Set(tpls.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneral = tpls.some(t => !t.productId && !t.categoryId && !t.brandId);
  const tpaAll = await prisma.trendyolProductAttribute.findMany({ where: { marketplaceKey: 'tt' }, select: { productId: true, attributeId: true } });
  const tpaSet = new Map<string, Set<number>>();
  for (const r of tpaAll) { if (!tpaSet.has(r.productId)) tpaSet.set(r.productId, new Set()); tpaSet.get(r.productId)!.add(r.attributeId); }
  const rules = await prisma.marketplacePricingRule.findMany({ where: { marketplaceId: MP, active: true, OR: [{ xmlSourceId: '2fe5e126-3e1e-43a6-9b28-b77826300688' }, { xmlSourceId: null }] }, orderBy: { minPrice: 'asc' } });
  const allP = await prisma.product.findMany({ where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } }, select: { id: true, categoryId: true, salePrice: true, xmlSourceId: true, brand: { select: { externalId: true } }, variants: { select: { id: true } } } });
  let ready = 0, blocked = 0; const bc: Record<string, number> = {};
  for (const p of allP) {
    let f: string | null = null;
    if (!p.categoryId || !catExtMap.has(p.categoryId)) f = 'CATEGORY_MAPPING_NOT_FOUND';
    else { const b = p.brand?.externalId ? Number(p.brand.externalId) : NaN; if (!Number.isInteger(b) && b > 0) f = 'BRAND_MAPPING_NOT_FOUND'; }
    if (!f) { const tpa = tpaSet.get(p.id) || new Set(); if ((p.variants.length > 0 || tpa.size === 0) && tpa.size === 0) f = 'REQUIRED_ATTRIBUTE_MISSING'; }
    if (!f && !prodTpls.has(p.id) && !(p.categoryId && catTpls.has(p.categoryId)) && !hasGeneral) f = 'TEMPLATE_NOT_FOUND';
    if (!f) { if (p.salePrice == null || !Number.isFinite(p.salePrice) || p.salePrice <= 0) f = 'PRICE_DATA_MISSING'; else { const m = rules.filter(r => p.salePrice! >= r.minPrice && (r.maxPrice === 0 || p.salePrice! <= r.maxPrice)); if (m.length === 0) f = 'PRICE_RULE_NOT_FOUND'; else if (m.length > 1) f = 'PRICE_RULE_AMBIGUOUS'; } }
    if (f) { blocked++; bc[f] = (bc[f] || 0) + 1; } else { ready++; }
  }
  console.log(JSON.stringify({ total: allP.length, ready, blocked, checksum: ready + blocked, pass: ready + blocked === allP.length, bc, before: { ready: 2353, blocked: 836 }, delta: ready - 2353 }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
