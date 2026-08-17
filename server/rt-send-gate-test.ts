import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { encryptCredential } from './src/services/crypto.ts';
import { resolveListingTemplate } from './src/services/listingTemplateResolver.ts';
import { sendProductToMarketplace } from './src/services/marketplace/sendPipeline.ts';

/**
 * RED TEAM — 4/4 SEND GATE + LISTING TEMPLATE ÖNCELİĞİ (DB'li, ağ isteği MOCK).
 * Her gate FAIL olduğunda provider'a istek GİTMEDİĞİNİ doğrular.
 */
const TS = Date.now();
const REGISTRY_KEYS = ['pazarama', 'amazon', 'n11', 'he', 'tt'];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

let providerPostCount = 0;
const originalFetch = globalThis.fetch;

function installMockFetch(catalogMode: 'empty' | 'ok') {
  providerPostCount = 0;
  (globalThis as any).fetch = async (url: unknown, opts?: any) => {
    const u = String(url);
    if (u.includes('/v2/products') && String(opts?.method).toUpperCase() === 'POST') {
      providerPostCount++;
      return new Response(JSON.stringify({ batchRequestId: 'batch-test-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/product/categories/') && u.includes('/attributes')) {
      if (catalogMode === 'empty') {
        return new Response(JSON.stringify({ categoryAttributes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const attrs = [
        { attribute: { id: 338, name: 'Renk' }, categoryId: 1, required: true, varianter: true, slicer: false, allowCustom: false },
        { attribute: { id: 340, name: 'Beden' }, categoryId: 1, required: true, varianter: true, slicer: false, allowCustom: false },
      ];
      return new Response(JSON.stringify({ categoryAttributes: attrs }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/values')) {
      return new Response(JSON.stringify({ content: [{ attributeValueId: 33801, attributeValue: 'Siyah' }, { attributeValueId: 34001, attributeValue: 'M' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

interface Created {
  xmlSourceId: string;
  marketplaceIds: string[];
  ttMarketplaceId: string | null;
  createdTt: boolean;
}

const created: Created = { xmlSourceId: '', marketplaceIds: [], ttMarketplaceId: null, createdTt: false };

async function findFreeKey(exclude: string[]): Promise<string | null> {
  const existing = new Set((await prisma.marketplace.findMany({ select: { key: true } })).map((m) => m.key));
  return REGISTRY_KEYS.find((k) => !existing.has(k) && !exclude.includes(k)) ?? null;
}

async function cleanup() {
  const products = await prisma.product.findMany({ where: { xmlSourceId: created.xmlSourceId }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  await prisma.productMarketplaceState.deleteMany({ where: { productId: { in: productIds } } }).catch(() => null);
  await prisma.variantAnalysis.deleteMany({ where: { productId: { in: productIds } } }).catch(() => null);
  await prisma.product.deleteMany({ where: { xmlSourceId: created.xmlSourceId } }).catch(() => null);

  const cats = await prisma.category.findMany({ where: { name: { startsWith: 'RT-CAT' } }, select: { id: true } });
  for (const c of cats) await prisma.categoryMapping.deleteMany({ where: { categoryId: c.id } }).catch(() => null);
  await prisma.category.deleteMany({ where: { id: { in: cats.map((c) => c.id) } } }).catch(() => null);

  const brands = await prisma.brand.findMany({ where: { name: { startsWith: 'RT-BRAND' } }, select: { id: true } });
  for (const b of brands) await prisma.brandMapping.deleteMany({ where: { dgBrandId: b.id } }).catch(() => null);
  await prisma.brand.deleteMany({ where: { id: { in: brands.map((b) => b.id) } } }).catch(() => null);

  for (const mid of created.marketplaceIds) {
    await prisma.listingTemplate.deleteMany({ where: { marketplaceId: mid } }).catch(() => null);
    await prisma.productMarketplaceState.deleteMany({ where: { marketplaceId: mid } }).catch(() => null);
    await prisma.marketplace.deleteMany({ where: { id: mid } }).catch(() => null);
  }
  if (created.createdTt && created.ttMarketplaceId) {
    await prisma.marketplace.deleteMany({ where: { id: created.ttMarketplaceId } }).catch(() => null);
  }
  await prisma.xmlSource.deleteMany({ where: { id: created.xmlSourceId } }).catch(() => null);
}

async function main() {
  installMockFetch('empty');

  const src = await prisma.xmlSource.create({ data: { name: `RT-GATE-${TS}`, company: 'rt', sourceType: 'MANUAL', active: true } });
  created.xmlSourceId = src.id;

  // ==================== LISTING TEMPLATE ÖNCELİĞİ ====================
  const ltKey = await findFreeKey(['tt']);
  if (!ltKey) {
    console.log('SKIP: listing template önceliği için boş registry key yok');
  } else {
    const mp = await prisma.marketplace.create({ data: { key: ltKey, name: 'RT-LT-MP', apiUrl: 'https://example.com', active: true } });
    created.marketplaceIds.push(mp.id);
    const cat = await prisma.category.create({ data: { name: `RT-CAT-${TS}` } });
    const prod = await prisma.product.create({
      data: { xmlKey: `rt-lt-${TS}`, title: 'RT LT', xmlSourceId: src.id, categoryId: cat.id, stock: 1, status: 'XML' },
    });

    let t = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
    check('LISTING: template yok → NO_TEMPLATE', t.source === 'NO_TEMPLATE', t.source);

    const general = await prisma.listingTemplate.create({ data: { name: 'GEN', marketplaceId: mp.id, active: true, priceRangeRules: JSON.stringify([{ minPrice: 0, maxPrice: 0, profitMargin: 20, fixedAmount: 30 }]) } });
    t = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
    check('LISTING: GENEL template → GENERAL', t.source === 'GENERAL' && t.id === general.id, t.source);

    const catTpl = await prisma.listingTemplate.create({ data: { name: 'CAT', marketplaceId: mp.id, categoryId: cat.id, active: true, priceRangeRules: JSON.stringify([{ minPrice: 0, maxPrice: 0, profitMargin: 20, fixedAmount: 30 }]) } });
    t = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
    check('LISTING: KATEGORİ template → CATEGORY', t.source === 'CATEGORY' && t.id === catTpl.id, t.source);

    const prodTpl = await prisma.listingTemplate.create({ data: { name: 'PROD', marketplaceId: mp.id, productId: prod.id, active: true, priceRangeRules: JSON.stringify([{ minPrice: 0, maxPrice: 0, profitMargin: 20, fixedAmount: 30 }]) } });
    t = await resolveListingTemplate({ productId: prod.id, categoryId: cat.id, marketplaceId: mp.id });
    check('LISTING: ÜRÜN template → PRODUCT', t.source === 'PRODUCT' && t.id === prodTpl.id, t.source);
  }

  // ==================== 4/4 GATE FAIL → İSTEK YOK ====================
  let tt = await prisma.marketplace.findFirst({ where: { key: 'tt' } });
  if (!tt) {
    tt = await prisma.marketplace.create({
      data: {
        key: 'tt', name: 'RT-TT', active: true, apiUrl: 'https://apigw.trendyol.com/integration',
        apiKey: encryptCredential('rt-tt-apikey'), apiSecret: encryptCredential('rt-tt-apisecret'),
        settings: JSON.stringify({ sellerId: '12345' }),
      },
    });
    created.createdTt = true;
  }
  created.ttMarketplaceId = tt.id;

  const cat = await prisma.category.create({ data: { name: `RT-CAT2-${TS}` } });
  const brand = await prisma.brand.create({ data: { name: `RT-BRAND-${TS}`, externalId: null } });
  const prod = await prisma.product.create({
    data: { xmlKey: `rt-gate-${TS}`, title: 'RT Gate', xmlSourceId: src.id, categoryId: cat.id, brandId: brand.id, stock: 1, purchasePrice: 100, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: false, variantStatus: 'NOT_REQUIRED' },
  });

  // CATEGORY FAIL
  providerPostCount = 0;
  let res = await sendProductToMarketplace({ productId: prod.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('4/4: CATEGORY FAIL → CATEGORY_MAPPING_NOT_FOUND', res.errorCode === 'CATEGORY_MAPPING_NOT_FOUND', res.errorCode ?? '');
  check('4/4: CATEGORY FAIL → provider istek 0', providerPostCount === 0, String(providerPostCount));

  // BRAND FAIL
  await prisma.categoryMapping.create({
    data: { categoryId: cat.id, marketplaceId: tt.id, externalId: '12345', externalName: 'Elbise', externalPath: 'Elbise', source: 'rt-test', confidence: 1.0, active: true },
  });
  providerPostCount = 0;
  res = await sendProductToMarketplace({ productId: prod.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('4/4: BRAND FAIL → BRAND_MAPPING_NOT_FOUND', res.errorCode === 'BRAND_MAPPING_NOT_FOUND', res.errorCode ?? '');
  check('4/4: BRAND FAIL → provider istek 0', providerPostCount === 0, String(providerPostCount));

  // VARIANT FAIL (catalog boş)
  await prisma.brand.update({ where: { id: brand.id }, data: { externalId: '1001' } });
  providerPostCount = 0;
  res = await sendProductToMarketplace({ productId: prod.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('4/4: VARIANT FAIL (catalog boş) → VARIANT_ATTRIBUTE_NOT_FOUND', res.errorCode === 'VARIANT_ATTRIBUTE_NOT_FOUND', res.errorCode ?? '');
  check('4/4: VARIANT FAIL → provider istek 0', providerPostCount === 0, String(providerPostCount));

  // ==================== NON-TT: LISTING/PRICE FAIL → İSTEK YOK ====================
  const ntKey = await findFreeKey(['tt']);
  if (ntKey) {
    const ntMp = await prisma.marketplace.create({ data: { key: ntKey, name: 'RT-NT-MP', apiUrl: 'https://example.com', active: true, apiKey: encryptCredential('rt-nt-k'), apiSecret: encryptCredential('rt-nt-s') } });
    created.marketplaceIds.push(ntMp.id);
    const ntProd = await prisma.product.create({
      data: { xmlKey: `rt-nt-${TS}`, title: 'RT NT', xmlSourceId: src.id, stock: 1, purchasePrice: 100, status: 'READY', categoryMatch: true, brandMatch: true, templateMatch: true, variantMatch: true, variantStatus: 'NOT_REQUIRED', images: 'https://example.com/a.jpg', barcode: '8691234567890', sku: 'NT-SKU' },
    });

    providerPostCount = 0;
    let ntRes = await sendProductToMarketplace({ productId: ntProd.id, marketplaceId: ntMp.id, xmlSourceId: src.id });
    check('4/4: LISTING FAIL → TEMPLATE_NOT_FOUND', ntRes.errorCode === 'TEMPLATE_NOT_FOUND', ntRes.errorCode ?? '');
    check('4/4: LISTING FAIL → provider istek 0', providerPostCount === 0, String(providerPostCount));

    await prisma.listingTemplate.create({ data: { name: 'GEN-NT', marketplaceId: ntMp.id, active: true, priceRangeRules: null } });
    providerPostCount = 0;
    ntRes = await sendProductToMarketplace({ productId: ntProd.id, marketplaceId: ntMp.id, xmlSourceId: src.id });
    check('4/4: PRICE FAIL → PRICE_RULE_NOT_FOUND', ntRes.errorCode === 'PRICE_RULE_NOT_FOUND', ntRes.errorCode ?? '');
    check('4/4: PRICE FAIL → provider istek 0', providerPostCount === 0, String(providerPostCount));
  }

  restoreFetch();
  await cleanup();
  await prisma.$disconnect();

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  restoreFetch();
  await cleanup().catch(() => null);
  await prisma.$disconnect().catch(() => null);
  console.error('FATAL', e);
  process.exit(1);
});
