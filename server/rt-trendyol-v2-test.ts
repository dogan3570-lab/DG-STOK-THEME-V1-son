import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { trendyolAdapter } from './src/services/marketplace/adapters.ts';
import { sendProductToMarketplace } from './src/services/marketplace/sendPipeline.ts';
import type { MarketplaceListingPayload } from './src/services/marketplace/types.ts';

/**
 * Trendyol V2 resmi sözleşmesi mock red team testi.
 * CANLI API çağrısı YAPMAZ; provider fetch mocklanır ve mapping gate'i kanıtlanır.
 * Sentetik kayıtlar cleanup ile silinir.
 */
const TS = Date.now();
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('========== RT-TRENDYOL-V2 ADAPTER PAYLOAD ==========');

  const payload: MarketplaceListingPayload = {
    barcode: '8690000000001',
    sku: 'SKU1',
    title: 'Test Ürünü',
    description: 'Açıklama',
    price: 100,
    stock: 5,
    vatRate: 20,
    categoryExternalId: null,
    brandName: null,
    images: ['https://example.com/a.jpg'],
    brandId: 10,
    categoryId: 20,
    quantity: 5,
    stockCode: 'SKU1',
    dimensionalWeight: 1.5,
    listPrice: 120,
    productMainId: 'SKU1',
    attributes: [{ attributeId: 1, attributeValueIds: [5] }],
  };

  const req = trendyolAdapter.buildRequest(
    { apiKey: 'k', apiSecret: 's', sellerId: '123', refreshToken: null, merchantId: null, storeId: null },
    payload,
    'https://api.trendyol.com/sapigw/selling/' // eski/yanlış DB apiUrl'si bypass edilir
  );

  check('URL resmi V2 (eski base bypass)', req.url === 'https://apigw.trendyol.com/integration/product/sellers/123/v2/products', req.url);
  check('method POST', req.method === 'POST');
  check('Authorization Basic', req.headers.Authorization === `Basic ${Buffer.from('k:s').toString('base64')}`);
  check('User-Agent zorunlu', req.headers['User-Agent'] === '123 - SelfIntegration');

  const body = JSON.parse(req.body ?? '{}');
  check('items wrapper', Array.isArray(body.items) && body.items.length === 1);
  const it = body.items?.[0] ?? {};
  check('brandId integer', it.brandId === 10);
  check('categoryId integer', it.categoryId === 20);
  check('quantity', it.quantity === 5);
  check('stockCode', it.stockCode === 'SKU1');
  check('dimensionalWeight', it.dimensionalWeight === 1.5);
  check('listPrice', it.listPrice === 120);
  check('salePrice', it.salePrice === 100);
  check('vatRate', it.vatRate === 20);
  check('productMainId', it.productMainId === 'SKU1');
  check('images [{url}]', it.images?.[0]?.url === 'https://example.com/a.jpg');
  check('attributes yapısı', it.attributes?.[0]?.attributeId === 1 && it.attributes?.[0]?.attributeValueIds?.[0] === 5);
  check('currencyType YOK (resmi şemada yok)', !('currencyType' in it));
  check('flat eski alanlar YOK', !('categoryExternalId' in it) && !('brandName' in it) && !('sku' in it) && !('stock' in it));

  console.log('========== RT-TRENDYOL-V2 PARSE RESPONSE ==========');
  const rBatch = trendyolAdapter.parseResponse(200, JSON.stringify({ batchRequestId: 'BATCH-1' }));
  check('200 + batchRequestId -> ok=true, externalListingId=null', rBatch.ok === true && rBatch.batchRequestId === 'BATCH-1' && rBatch.externalListingId === null);
  const rBarcode = trendyolAdapter.parseResponse(200, JSON.stringify({ barcode: '8690000000001' }));
  check('200 + barcode (batchRequestId yok) -> PARSE_ERROR', rBarcode.ok === false && rBarcode.error?.code === 'PARSE_ERROR');
  const r401 = trendyolAdapter.parseResponse(401, 'x');
  check('401 -> CREDENTIAL_ERROR', r401.ok === false && r401.error?.code === 'CREDENTIAL_ERROR');

  console.log('========== RT-TRENDYOL-V2 MAPPING GATE (fetch mocklu) ==========');

  const src = await prisma.xmlSource.create({ data: { name: `RT-TT-SRC-${TS}`, company: 'rt', sourceType: 'MANUAL', active: true } });
  const cat = await prisma.category.create({ data: { name: `RT-TT-CAT-${TS}` } });
  const brand = await prisma.brand.create({ data: { name: `RT-TT-BRAND-${TS}` } }); // externalId null
  const product = await prisma.product.create({
    data: {
      xmlKey: `rt-tt-${TS}`,
      title: 'RT TT Ürün',
      description: 'açıklama',
      barcode: '869' + String(Math.floor(1000000000 + Math.random() * 8999999999)),
      sku: 'RT-TT-SKU',
      salePrice: 100,
      stock: 5,
      vatRate: 20,
      images: 'https://example.com/a.jpg',
      status: 'READY',
      categoryMatch: true,
      brandMatch: true,
      templateMatch: true,
      variantMatch: true,
      variantStatus: 'NOT_REQUIRED',
      xmlSourceId: src.id,
      categoryId: cat.id,
      brandId: brand.id,
    },
  });

  const tt = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  if (!tt) {
    check('tt marketplace mevcut', false, 'tt bulunamadı');
    console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
    await prisma.$disconnect();
    process.exit(2);
  }

  let providerCalls = 0;
  const origFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: unknown, opts?: any) => {
    const u = String(url);
    if (u.includes('/v2/products') && String(opts?.method).toUpperCase() === 'POST') {
      providerCalls++;
      return new Response(JSON.stringify({ batchRequestId: 'SHOULD_NOT_HAPPEN' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // catalog GET (read-only) → boş attributes (variant fail-closed)
    return new Response(JSON.stringify({ categoryAttributes: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  // 1: kategori mapping yok → CATEGORY_MAPPING_NOT_FOUND, provider'a istek GİTMEZ
  const r1 = await sendProductToMarketplace({ productId: product.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('gate 1: category mapping yok -> CATEGORY_MAPPING_NOT_FOUND', r1.ok === false && r1.errorCode === 'CATEGORY_MAPPING_NOT_FOUND', r1.errorCode ?? '');
  check('gate 1: provider isteği GİTMEDİ', providerCalls === 0, `calls=${providerCalls}`);

  // 2: category mapping var ama brand externalId yok → BRAND_MAPPING_NOT_FOUND (marka)
  await prisma.categoryMapping.create({ data: { categoryId: cat.id, marketplaceId: tt.id, externalId: '12345', source: 'manual', active: true } });
  const r2 = await sendProductToMarketplace({ productId: product.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('gate 2: brand mapping yok -> BRAND_MAPPING_NOT_FOUND', r2.ok === false && r2.errorCode === 'BRAND_MAPPING_NOT_FOUND' && /marka/i.test(r2.errorMessage ?? ''), r2.errorCode ?? '');
  check('gate 2: provider isteği GİTMEDİ', providerCalls === 0, `calls=${providerCalls}`);

  // 3: category + brand mapping var ama attributes yok → VARIANT_ATTRIBUTE_NOT_FOUND
  await prisma.brand.update({ where: { id: brand.id }, data: { externalId: '999' } });
  const r3 = await sendProductToMarketplace({ productId: product.id, marketplaceId: tt.id, xmlSourceId: src.id });
  check('gate 3: attributes yok -> VARIANT_ATTRIBUTE_NOT_FOUND', r3.ok === false && r3.errorCode === 'VARIANT_ATTRIBUTE_NOT_FOUND' && /özellik|attribute|verified/i.test(r3.errorMessage ?? ''), r3.errorCode ?? '');
  check('gate 3: provider isteği GİTMEDİ', providerCalls === 0, `calls=${providerCalls}`);

  (globalThis as any).fetch = origFetch;

  // cleanup
  await prisma.productMarketplaceState.deleteMany({ where: { productId: product.id } });
  await prisma.product.delete({ where: { id: product.id } });
  await prisma.categoryMapping.deleteMany({ where: { categoryId: cat.id } });
  await prisma.category.delete({ where: { id: cat.id } });
  await prisma.brand.delete({ where: { id: brand.id } });
  await prisma.xmlSource.delete({ where: { id: src.id } });
  const leftover = await prisma.product.count({ where: { id: product.id } });
  check('cleanup: sentetik kayıtlar temizlendi', leftover === 0);

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  if (failures.length) { for (const f of failures) console.log(' - ' + f); }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  await prisma.$disconnect();
  process.exit(2);
});
