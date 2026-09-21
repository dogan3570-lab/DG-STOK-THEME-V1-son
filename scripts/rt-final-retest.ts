import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
const prisma = new PrismaClient();

const TT_XML = '2fe5e126-3e1e-43a6-9b28-b77826300688';
const PRICE_IDS = ['49d591b9','cbecc681','429f6352','a176dbc7','01f127bd','831719f8','69ffa09d','567354a4','65440352','614dbe13','870c5be4','a9b863a8','8496f336','c1034ed5','c4e810c3','271ddbec','34743225','11bb31b0','d455aab4','a79fdd5c','71c465ba'];
const ATTR_IDS = ['94931112','1cea01f3','d104b3c3','2755030d','f2667457','ee2be0a0','cb6c2091','711881d8','53a7bedc','670e7314','04eaa732','ad290261','b5e61b3c','4f9fd098','a30a68a4','6a21b88b','517606b9','e47331c6','e2f68948','4352bb73','381eaadd','2e9c50fe','318ab7a9','74dfb062','d331036d','0f509864','fdcf5acb','f919200f','00861890','f4165230','c8add7d7','bb019714','47dc5758','f24a0957','eeb5bfa6','66f66e26','801ebcd6','16c2e52e','30163dd8','1b50cf4e','ff6bc2ce','d785911e','e259ff35','95fc1009','73008f27','b71b0ff2','58e6a257','69cd2c4b','64c72b8c','58a38a2c','23f0b341','a888911f','7715fe66','3284de9a','9df6510d','fd7bd9bc','8bcc1429','aeae7507','6f16f01f','7ef22123','3e157316','5ac73227','42c12366','4a95c1c7','31e2118f','df3a553f','f90b51ae','ada0a4cb','9233bb5f','0d5c993a','a081b629','6e8439c3','6116041c','803067a3','7eca9696','7d0279ff','30acbbe5','2b64db8f','89c28f6c','c0c98f29','9f80f4e5','54b2da99','cbe538cb','ccfcda69','9de25a3b','db20d707','da69eeac'];

async function main() {
  const tt = await prisma.marketplace.findFirst({ where: { key: 'tt', active: true }, select: { id: true } });
  const MP = tt!.id;

  const catMaps = await prisma.categoryMapping.findMany({ where: { marketplaceId: MP, active: true }, select: { categoryId: true, externalId: true }, orderBy: { createdAt: 'desc' } });
  const catExtMap = new Map<string, number>();
  for (const cm of catMaps) { if (!cm.categoryId || catExtMap.has(cm.categoryId)) continue; const n = Number(cm.externalId); if (Number.isInteger(n) && n > 0) catExtMap.set(cm.categoryId, n); }

  const tpls = await prisma.listingTemplate.findMany({ where: { marketplaceId: MP, active: true }, select: { productId: true, categoryId: true, brandId: true } });
  const prodTpls = new Set(tpls.filter(t => t.productId).map(t => t.productId));
  const catTpls = new Set(tpls.filter(t => t.categoryId && !t.productId).map(t => t.categoryId));
  const hasGeneral = tpls.some(t => !t.productId && !t.categoryId && !t.brandId);

  const tpaAll = await prisma.trendyolProductAttribute.findMany({ where: { marketplaceKey: 'tt' }, select: { productId: true, attributeId: true } });
  const tpaSet = new Map<string, Set<number>>();
  for (const r of tpaAll) { if (!tpaSet.has(r.productId)) tpaSet.set(r.productId, new Set()); tpaSet.get(r.productId)!.add(r.attributeId); }

  const rules = await prisma.marketplacePricingRule.findMany({ where: { marketplaceId: MP, active: true, OR: [{ xmlSourceId: TT_XML }, { xmlSourceId: null }] }, orderBy: { minPrice: 'asc' } });

  const allP = await prisma.product.findMany({ where: { xmlSourceId: { not: null }, status: { not: 'DELETED' } }, select: { id: true, categoryId: true, salePrice: true, xmlSourceId: true, brand: { select: { externalId: true } }, variants: { select: { id: true } } } });

  let ready = 0, blocked = 0;
  const blockedByCode: Record<string, number> = {};
  const readyIds = new Set<string>();
  const blockedIds = new Set<string>();

  for (const p of allP) {
    let fail: string | null = null;
    if (!p.categoryId || !catExtMap.has(p.categoryId)) fail = 'CATEGORY_MAPPING_NOT_FOUND';
    else { const b = p.brand?.externalId ? Number(p.brand.externalId) : NaN; if (!Number.isInteger(b) && b > 0) fail = 'BRAND_MAPPING_NOT_FOUND'; }
    if (!fail) { const tpa = tpaSet.get(p.id) || new Set(); if ((p.variants.length > 0 || tpa.size === 0) && tpa.size === 0) fail = 'REQUIRED_ATTRIBUTE_MISSING'; }
    if (!fail && !prodTpls.has(p.id) && !(p.categoryId && catTpls.has(p.categoryId)) && !hasGeneral) fail = 'TEMPLATE_NOT_FOUND';
    if (!fail) {
      if (p.salePrice == null || !Number.isFinite(p.salePrice) || p.salePrice <= 0) fail = 'PRICE_DATA_MISSING';
      else { const matches = rules.filter(r => p.salePrice! >= r.minPrice && (r.maxPrice === 0 || p.salePrice! <= r.maxPrice)); if (matches.length === 0) fail = 'PRICE_RULE_NOT_FOUND'; else if (matches.length > 1) fail = 'PRICE_RULE_AMBIGUOUS'; }
    }
    if (fail) { blocked++; blockedIds.add(p.id); blockedByCode[fail] = (blockedByCode[fail] || 0) + 1; }
    else { ready++; readyIds.add(p.id); }
  }

  const all108 = [...PRICE_IDS, ...ATTR_IDS];
  let opened108 = 0;
  for (const prefix of all108) {
    const fullId = allP.find(p => p.id.startsWith(prefix))?.id;
    if (fullId && readyIds.has(fullId)) opened108++;
  }

  console.log(JSON.stringify({
    total: allP.length, ready, blocked, checksum: ready + blocked, checksumPass: ready + blocked === allP.length,
    blockedByCode,
    before: { ready: 2353, blocked: 836 }, delta: { opened: ready - 2353 },
    priceOpened: PRICE_IDS.filter(p => { const f = allP.find(x => x.id.startsWith(p))?.id; return f && readyIds.has(f); }).length + '/' + PRICE_IDS.length,
    attrOpened: ATTR_IDS.filter(a => { const f = allP.find(x => x.id.startsWith(a))?.id; return f && readyIds.has(f); }).length + '/' + ATTR_IDS.length,
    category728: blockedByCode['CATEGORY_MAPPING_NOT_FOUND'] || 0,
    category728Same: (blockedByCode['CATEGORY_MAPPING_NOT_FOUND'] || 0) === 728,
    still108Blocked: 108 - opened108,
  }, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
