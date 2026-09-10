import 'dotenv/config';
import { prisma } from './src/db/prisma.ts';
import { encryptCredential } from './src/services/crypto.ts';
import { sendProductToMarketplace } from './src/services/marketplace/sendPipeline.ts';

const TS = Date.now();
const SYNTH_CRED = 'rt-synthetic-credential-value';
const RAW_BODY_SECRET = 'SUPERSECRET_RAW_PROVIDER_BODY';
const REGISTRY_KEYS = ['pazarama', 'amazon', 'n11', 'he', 'tt'];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const capturedLogs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  capturedLogs.push(line);
  origLog(...args);
};

const originalFetch = globalThis.fetch;
function setFetch(handler: (url: string, opts: any) => Promise<Response> | Response) {
  (globalThis as any).fetch = handler as any;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const created = { srcId: '', products: [] as string[], marketplaceId: '' };

async function createSource(): Promise<string> {
  const src = await prisma.xmlSource.create({ data: { name: `RT-SRC-${TS}`, company: 'rt', sourceType: 'MANUAL', active: true } });
  created.srcId = src.id;
  return src.id;
}

async function createProduct(srcId: string, ready: boolean): Promise<string> {
  const p = await prisma.product.create({
    data: {
      xmlKey: `rt-${ready ? 'ready' : 'notready'}-${TS}-${Math.floor(Math.random() * 1e6)}`,
      title: 'RT Test Ürünü',
      description: 'RT açıklama',
      barcode: '869' + String(Math.floor(1000000000 + Math.random() * 8999999999)),
      sku: 'RT-SKU',
      purchasePrice: 100,
      salePrice: 100,
      stock: 5,
      vatRate: 20,
      images: 'https://example.com/a.jpg',
      status: ready ? 'READY' : 'XML',
      categoryMatch: ready,
      brandMatch: ready,
      templateMatch: ready,
      variantMatch: ready,
      variantStatus: ready ? 'NOT_REQUIRED' : 'WAITING_AI',
      xmlSourceId: srcId,
    },
  });
  created.products.push(p.id);
  return p.id;
}

async function setMpCreds(apiKey: string | null, apiSecret: string | null) {
  await prisma.marketplace.update({
    where: { id: created.marketplaceId },
    data: { apiKey, apiSecret },
  });
}

async function cleanup() {
  const prodIds = created.products;
  for (const pid of prodIds) {
    await prisma.productMarketplaceState.deleteMany({ where: { productId: pid } }).catch(() => undefined);
  }
  await prisma.product.deleteMany({ where: { id: { in: prodIds } } }).catch(() => undefined);
  if (created.marketplaceId) {
    await prisma.productMarketplaceState.deleteMany({ where: { marketplaceId: created.marketplaceId } }).catch(() => undefined);
    await prisma.listingTemplate.deleteMany({ where: { marketplaceId: created.marketplaceId } }).catch(() => undefined);
    await prisma.marketplace.delete({ where: { id: created.marketplaceId } }).catch(() => undefined);
  }
  await prisma.xmlSource.deleteMany({ where: { id: created.srcId } }).catch(() => undefined);
  const leftoverStates = await prisma.productMarketplaceState.count({ where: { productId: { in: prodIds } } });
  const leftoverMps = created.marketplaceId ? await prisma.marketplace.count({ where: { id: created.marketplaceId } }) : 0;
  check('cleanup: sentetik state/marketplace temizlendi', leftoverStates === 0 && leftoverMps === 0);
}

async function main() {
  // Registry'de boş bir key seç (sentetik test marketplace'i gerçek adapter'a bağlanır)
  const existingKeys = new Set((await prisma.marketplace.findMany({ select: { key: true } })).map((m) => m.key));
  const testKey = REGISTRY_KEYS.find((k) => !existingKeys.has(k)) ?? null;
  if (!testKey) {
    console.log('SKIP: tüm registry keyleri DB\'de mevcut — adapter testleri çalıştırılamadı');
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log(`Adapter test key: ${testKey}`);

  const srcId = await createSource();
  const readyId = await createProduct(srcId, true);
  const notReadyId = await createProduct(srcId, false);

  const okKey = encryptCredential(SYNTH_CRED + '-apikey');
  const okSecret = encryptCredential(SYNTH_CRED + '-apisecret');

  const mp = await prisma.marketplace.create({
    data: {
      key: testKey,
      name: 'RT MP',
      apiUrl: 'https://93.184.216.34',
      apiKey: okKey,
      apiSecret: okSecret,
      merchantId: 'rt-merchant',
      storeId: 'rt-store',
      settings: JSON.stringify({ sellerId: 'rt-seller', refreshTokenEnc: encryptCredential('rt-refresh') }),
      apiStatus: 'unknown',
      active: true,
    },
  });
  created.marketplaceId = mp.id;

  // Gerçek listing + fiyat gate'i için sentetik GENEL şablon (fiyat kuralı: %0 + 0).
  await prisma.listingTemplate.create({
    data: {
      name: 'RT-GENEL-TPL',
      marketplaceId: mp.id,
      active: true,
      priceRangeRules: JSON.stringify([{ minPrice: 0, maxPrice: 0, profitMargin: 0, fixedAmount: 0, rounding: 'nearest' }]),
    },
  });

  console.log('========== RT-SEND PIPELINE ==========');

  // 1: READY olmayan ürün
  const r1 = await sendProductToMarketplace({ productId: notReadyId, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S01 READY olmayan ürün gönderilemez', r1.ok === false && r1.errorCode === 'NOT_READY');

  // 3: yanlış marketplaceId
  const r3 = await sendProductToMarketplace({ productId: readyId, marketplaceId: 'nonexistent-id', xmlSourceId: srcId });
  check('S03 yanlış marketplaceId reddedilir', r3.ok === false && r3.errorCode === 'MARKETPLACE_NOT_FOUND');

  // 4: yanlış XML context
  const r4 = await sendProductToMarketplace({ productId: readyId, marketplaceId: mp.id, xmlSourceId: 'wrong-xml-context' });
  check('S04 yanlış XML context reddedilir', r4.ok === false && r4.errorCode === 'WRONG_XML_CONTEXT');

  // 5: credential missing -> CREDENTIAL_ERROR
  await setMpCreds(null, null);
  const r5 = await sendProductToMarketplace({ productId: readyId, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S05 credential missing -> CREDENTIAL_ERROR', r5.ok === false && r5.errorCode === 'CREDENTIAL_ERROR', r5.errorCode ?? '');

  // 34/35/36: malformed/tampered ciphertext -> güvenli CREDENTIAL_ERROR
  await setMpCreds('enc:v1:bad', 'enc:v1:bad');
  const r34 = await sendProductToMarketplace({ productId: readyId, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S34-36 malformed/tampered ciphertext -> güvenli hata', r34.ok === false && r34.errorCode === 'CREDENTIAL_ERROR', r34.errorCode ?? '');
  await setMpCreds(okKey, okSecret);

  // 2 + 23: READY 4/4 + 2xx + gerçek external ID -> ACTIVE
  setFetch(async () => new Response(JSON.stringify({ productId: 'RT_EXT_ID_1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const r23 = await sendProductToMarketplace({ productId: readyId, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S02+S23 READY 4/4 + 2xx + external ID -> ACTIVE', r23.ok === true && r23.status === 'ACTIVE' && r23.externalListingId === 'RT_EXT_ID_1');
  const st23 = await prisma.productMarketplaceState.findUnique({ where: { productId_marketplaceId: { productId: readyId, marketplaceId: mp.id } } });
  check('S23 DB state ACTIVE + listingId', st23?.status === 'ACTIVE' && st23.listingId === 'RT_EXT_ID_1');

  // 28: ACTIVE tekrar gönderim engellenir
  setFetch(async () => new Response(JSON.stringify({ productId: 'RT_EXT_ID_2' }), { status: 200 }));
  const r28 = await sendProductToMarketplace({ productId: readyId, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S28 ACTIVE tekrar gönderim engellenir', r28.duplicate === true && r28.status === 'DUPLICATE');
  check('S25 sahte ikinci listingId YOK', st23?.listingId === 'RT_EXT_ID_1');

  // 24: 2xx ama external ID yok -> FAIL, ACTIVE YOK (fake listingId yok)
  const ready2 = await createProduct(srcId, true);
  setFetch(async () => new Response(JSON.stringify({ foo: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const r24 = await sendProductToMarketplace({ productId: ready2, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S24 2xx + id yok -> FAIL (ACTIVE YOK)', r24.ok === false && r24.errorCode === 'PARSE_ERROR');
  const st24 = await prisma.productMarketplaceState.findUnique({ where: { productId_marketplaceId: { productId: ready2, marketplaceId: mp.id } } });
  check('S24 DB state ERROR, listingId YOK', st24?.status === 'ERROR' && st24.listingId === null);

  // 6/7/8/9/10: 401 retry YOK (permanent) + raw body leak yok
  const ready3 = await createProduct(srcId, true);
  let fetchCalls = 0;
  setFetch(async () => { fetchCalls++; return new Response(RAW_BODY_SECRET, { status: 401 }); });
  const r6 = await sendProductToMarketplace({ productId: ready3, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S06-10 401 retry YOK (permanent)', r6.ok === false && r6.errorCode === 'CREDENTIAL_ERROR' && fetchCalls === 1, `calls=${fetchCalls}`);
  check('S18 raw provider body response/state sızmaz', !(r6.errorMessage ?? '').includes(RAW_BODY_SECRET));
  const st6 = await prisma.productMarketplaceState.findUnique({ where: { productId_marketplaceId: { productId: ready3, marketplaceId: mp.id } } });
  check('S18 raw body DB state sızmaz', !(st6?.errorMessage ?? '').includes(RAW_BODY_SECRET));

  // 13/14/15: 5xx bounded retry
  const ready4 = await createProduct(srcId, true);
  fetchCalls = 0;
  setFetch(async () => {
    fetchCalls++;
    if (fetchCalls <= 2) return new Response('err', { status: 500 });
    return new Response(JSON.stringify({ productId: 'RT_EXT_ID_5XX' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const r13 = await sendProductToMarketplace({ productId: ready4, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S13-15 5xx bounded retry (3 deneme) -> ACTIVE', r13.ok === true && r13.status === 'ACTIVE' && fetchCalls === 3, `calls=${fetchCalls}`);

  // 12: 429 bounded retry/cooldown
  const ready429 = await createProduct(srcId, true);
  fetchCalls = 0;
  setFetch(async () => {
    fetchCalls++;
    if (fetchCalls <= 2) return new Response('rl', { status: 429 });
    return new Response(JSON.stringify({ productId: 'RT_EXT_ID_429' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const r12 = await sendProductToMarketplace({ productId: ready429, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S12 429 bounded retry -> ACTIVE', r12.ok === true && r12.status === 'ACTIVE' && fetchCalls === 3, `calls=${fetchCalls}`);

  // 11: 409 duplicate güvenli (retry yok)
  const ready5 = await createProduct(srcId, true);
  fetchCalls = 0;
  setFetch(async () => { fetchCalls++; return new Response('dup', { status: 409 }); });
  const r11 = await sendProductToMarketplace({ productId: ready5, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S11 409 duplicate güvenli (retry yok, ACTIVE yok)', r11.ok === false && r11.errorCode === 'DUPLICATE' && fetchCalls === 1, `calls=${fetchCalls}`);
  const st11 = await prisma.productMarketplaceState.findUnique({ where: { productId_marketplaceId: { productId: ready5, marketplaceId: mp.id } } });
  check('S11 409 sonrası listing oluşturulmadı (state ERROR)', st11?.status === 'ERROR' && st11.listingId === null);

  // 16/17: network error bounded retry
  const ready6 = await createProduct(srcId, true);
  fetchCalls = 0;
  setFetch(async () => { fetchCalls++; throw new Error('ECONNREFUSED'); });
  const r17 = await sendProductToMarketplace({ productId: ready6, marketplaceId: mp.id, xmlSourceId: srcId });
  check('S16-17 network error bounded retry (3 deneme) -> NETWORK_ERROR', r17.ok === false && r17.errorCode === 'NETWORK_ERROR' && fetchCalls === 3, `calls=${fetchCalls}`);

  // 26/27/29: concurrent send güvenli (P2002 / SENDING duplicate)
  const ready7 = await createProduct(srcId, true);
  setFetch(async () => {
    await new Promise((r) => setTimeout(r, 250));
    return new Response(JSON.stringify({ productId: 'RT_EXT_CONC' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const [c1, c2] = await Promise.all([
    sendProductToMarketplace({ productId: ready7, marketplaceId: mp.id, xmlSourceId: srcId }),
    sendProductToMarketplace({ productId: ready7, marketplaceId: mp.id, xmlSourceId: srcId }),
  ]);
  const statuses = [c1.status, c2.status].sort().join(',');
  check('S26-29 concurrent send güvenli (ACTIVE + DUPLICATE)', statuses === 'ACTIVE,DUPLICATE', statuses);

  // 19/20/21/22: log leak (Authorization/credential/refreshToken/raw body)
  restoreFetch();
  let logLeak = false;
  for (const line of capturedLogs) {
    for (const s of [SYNTH_CRED, RAW_BODY_SECRET, 'Authorization', 'enc:v1:']) {
      if (line.includes(s)) { logLeak = true; break; }
    }
  }
  check('S19-22 log leak yok (credential/auth/raw body)', !logLeak);

  console.log('========================================');
  console.log(`RESULT: ${pass} PASS, ${fail} FAIL`);
  restoreFetch();
  console.log = origLog;

  await cleanup();
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('TEST CRASH:', e instanceof Error ? e.message : String(e));
  try { await cleanup(); } catch {}
  await prisma.$disconnect();
  process.exit(2);
});
