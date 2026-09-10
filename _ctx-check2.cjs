const BASE = 'http://localhost:4000';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

(async () => {
  const log = (s) => console.log(s);

  const login = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dgstok.com', password: 'admin123' }),
  });
  const token = login.body?.token;
  const auth = { headers: { Authorization: 'Bearer ' + token } };
  const xmlId = '949855eb-d68c-4920-b378-c622a6a665e2';

  const mps = await api('/marketplaces');
  const mpItems = mps.body?.items || [];
  log('=== MARKETPLACE ID -> PRODUCTS TOTAL KARSILASTIRMASI ===\n');
  for (const mp of mpItems) {
    const r = await api('/products?page=1&limit=10&xmlSourceId=' + xmlId + '&marketplaceId=' + mp.id, auth);
    const total = r.body?.pagination?.total ?? r.body?.total ?? '?';
    log(mp.key + ' (' + mp.id + '): ' + r.status + ' -> total=' + total);
  }

  log('\n=== /products/stats (contextli) ===');
  for (const mp of mpItems) {
    const r = await api('/products/stats?xmlSourceId=' + xmlId + '&marketplaceId=' + mp.id, auth);
    log(mp.key + ': ' + r.status + ' -> ' + JSON.stringify(r.body).slice(0, 200));
  }

  log('\n=== /categories/products (contextli, referans) ===');
  for (const mp of mpItems) {
    const r = await api('/categories/products?limit=10&xmlSourceId=' + xmlId + '&marketplaceId=' + mp.id, auth);
    const total = r.body?.pagination?.total ?? r.body?.total ?? r.body?.stats?.total ?? '?';
    log(mp.key + ': ' + r.status + ' -> total=' + total);
  }

  log('\n=== XML-SOURCES detay ===');
  const xml = await api('/xml-sources', auth);
  const xmlItems = xml.body?.items || [];
  for (const x of xmlItems) {
    log(JSON.stringify(x));
  }

  log('\n=== BITTI ===');
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
