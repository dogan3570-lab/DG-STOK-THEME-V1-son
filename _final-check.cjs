const BASE = 'http://localhost:4000';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

(async () => {
  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (detail ? ' -> ' + detail : ''));
  };

  const xmlId = '949855eb-d68c-4920-b378-c622a6a665e2'; // AKILLIBAYI1
  const mpId = '757a071c-98c5-4c96-bb8c-2dceac1568dd';   // tt:Trendyol
  const badId = '00000000-0000-4000-8000-000000000000';

  // 1. health
  const h = await api('/health');
  check('GET /health 200', h.status === 200, 'status=' + h.status);

  // 2. login
  const login = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }),
  });
  const token = login.body?.token;
  check('POST /auth/login 200 + token', login.status === 200 && !!token, 'status=' + login.status);
  const auth = { headers: { Authorization: 'Bearer ' + token } };

  // 3. products context yok
  const pNoCtx = await api('/products', auth);
  check('GET /products context yok -> 400 CONTEXT_REQUIRED', pNoCtx.status === 400 && pNoCtx.body?.error?.code === 'CONTEXT_REQUIRED', 'status=' + pNoCtx.status + ' code=' + pNoCtx.body?.error?.code);

  // 4. products gecerli context
  const pCtx = await api('/products?page=1&limit=10&xmlSourceId=' + xmlId + '&marketplaceId=' + mpId, auth);
  const total = pCtx.body?.pagination?.total;
  check('GET /products gecerli context -> 200 ve total>0', pCtx.status === 200 && total > 0, 'status=' + pCtx.status + ' total=' + total);

  // 5. products gecersiz xmlSourceId
  const pBadXml = await api('/products?page=1&limit=10&xmlSourceId=' + badId + '&marketplaceId=' + mpId, auth);
  check('GET /products gecersiz xmlSourceId -> 404', pBadXml.status === 404, 'status=' + pBadXml.status + ' code=' + pBadXml.body?.error?.code);

  // 6. products gecersiz marketplaceId
  const pBadMp = await api('/products?page=1&limit=10&xmlSourceId=' + xmlId + '&marketplaceId=' + badId, auth);
  check('GET /products gecersiz marketplaceId -> 404', pBadMp.status === 404, 'status=' + pBadMp.status + ' code=' + pBadMp.body?.error?.code);

  // 7. gecerli XML import
  const xmlKey = 'DGTEST-' + Date.now();
  const xml = '<root><product><xmlKey>' + xmlKey + '</xmlKey><title>DG Test Urun</title><sku>' + xmlKey + '</sku><barcode>1234567890123</barcode><stock>5</stock><price>100</price><brand>DGTest</brand><category>TestKategori</category></product></root>';
  const imp = await api('/xml/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ xml }) });
  check('POST /xml/import gecerli -> ok:true', imp.status === 200 && imp.body?.ok === true, 'status=' + imp.status + ' body=' + JSON.stringify(imp.body).slice(0, 140));

  // 8. gecersiz XML import (kapali olmayan tag)
  const badXmlStr = '<root><product><xmlKey>X1</xmlKey></product>';
  const impBad = await api('/xml/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ xml: badXmlStr }) });
  check('POST /xml/import gecersiz -> 400', impBad.status === 400, 'status=' + impBad.status + ' body=' + JSON.stringify(impBad.body).slice(0, 140));

  // 9. categories auth yok
  const catNoAuth = await api('/categories');
  check('GET /categories auth yok -> 401', catNoAuth.status === 401, 'status=' + catNoAuth.status);

  // 10. categories auth var context yok
  const catAuth = await api('/categories', auth);
  const catAllCount = catAuth.body?.items?.length;
  check('GET /categories auth var context yok -> 200 (tum)', catAuth.status === 200 && catAllCount > 0, 'status=' + catAuth.status + ' items=' + catAllCount);

  // 11. categories xmlSourceId filtresi
  const catCtx = await api('/categories?xmlSourceId=' + xmlId, auth);
  const catCtxCount = catCtx.body?.items?.length;
  check('GET /categories?xmlSourceId -> 200 (context filtre)', catCtx.status === 200, 'status=' + catCtx.status + ' items=' + catCtxCount);

  // 12. brands auth yok
  const br = await api('/brands');
  check('GET /brands auth yok -> 401', br.status === 401, 'status=' + br.status);

  // 13. variants auth yok
  const vr = await api('/variants?page=1&limit=2');
  check('GET /variants auth yok -> 401', vr.status === 401, 'status=' + vr.status);

  const passed = results.filter(r => r.pass).length;
  console.log('\n=== SONUC: ' + passed + '/' + results.length + ' PASS ===');
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
