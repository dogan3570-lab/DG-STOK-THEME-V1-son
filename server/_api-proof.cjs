// GEÇİCİ API KANIT TESTİ — gerçek DB/API üzerinden.
const BASE = 'http://localhost:4000';
const TOKEN = process.argv[2] || '';

async function api(path, opts) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opts && opts.headers) },
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

(async () => {
  const xsId = '949855eb-d68c-4920-b378-c622a6a665e2';
  const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';

  // 1) Category products kapsamı
  const cp = await api('/categories/products?limit=1000&xmlSourceId=' + xsId + '&marketplaceId=' + mpId);
  const items = (cp.json && cp.json.items) || [];
  const nullC = items.filter((p) => !p.categoryId).length;
  console.log('CAT_PRODUCTS', JSON.stringify({ status: cp.status, total: cp.json && cp.json.pagination && cp.json.pagination.total, items: items.length, categoryIdNull: nullC }));
  const sample = items[0] || null;
  if (sample) console.log('CAT_SAMPLE_FIELDS', JSON.stringify({ hasTitle: !!sample.title, hasSku: !!sample.sku, hasBarcode: !!sample.barcode, hasBrand: !!(sample.brand && sample.brand.name), hasXmlSource: !!(sample.xmlSource && sample.xmlSource.name) }));

  // 2) ai-suggest false-positive testi: ölçülü/teknik başlık varyant ÜRETMEMELİ
  const ai = await api('/variants/ai-suggest', { method: 'POST', body: JSON.stringify({ title: 'HOBİBAHÇEM® 18 Inc 45 Cm Kumandali Sanayi Tipi Ayakli Vantilator 65W 137CM', description: '' }) });
  console.log('AI_SUGGEST_FALSE_POSITIVE', JSON.stringify({ status: ai.status, suggestions: ai.json && ai.json.suggestions }));

  // 3) ai-suggest gerçek varyant testi: açık "Beden: M" etiketi ÜRETMELİ
  const ai2 = await api('/variants/ai-suggest', { method: 'POST', body: JSON.stringify({ title: 'Beden: M Renk: Siyah Spor Ayakkabi', description: '' }) });
  console.log('AI_SUGGEST_REAL_VARIANT', JSON.stringify({ status: ai2.status, suggestions: ai2.json && ai2.json.suggestions }));

  // 4) manual-options yeni alanlar
  const targetId = '5c43c90b-d02d-42d2-946d-739f70015a7a'; // HOBİBAHÇEM N15 Dijital Gostergeli Vantilator
  const mo = await api('/variants/manual-options?productId=' + targetId + '&marketplaceId=' + mpId);
  console.log('MANUAL_OPTIONS', JSON.stringify({ status: mo.status, title: mo.json && mo.json.title, sku: mo.json && mo.json.sku, barcode: mo.json && mo.json.barcode, brandName: mo.json && mo.json.brandName, xmlSourceName: mo.json && mo.json.xmlSourceName, xmlVariants: mo.json && mo.json.xmlVariants, existingMatch: mo.json && mo.json.existingMatch, categoryMapped: mo.json && mo.json.categoryMapped }));

  // 5) Variant dashboard (temizlik sonrası)
  const vd = await api('/variants/dashboard?xmlSourceId=' + xsId + '&marketplaceId=' + mpId);
  console.log('VARIANT_DASHBOARD_AFTER', JSON.stringify(vd.json));

  await new Promise((r) => setTimeout(r, 100));
})().catch((e) => { console.error('ERR', e); process.exit(1); });
