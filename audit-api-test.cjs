// AUDIT ONLY — read-only API test. No data mutations except /auth/login session creation.
const BASE = 'http://localhost:4000';
const R = [];
let TK = null;
let admin = null;

function log(kind, name, detail) {
  const line = '[' + kind + '] ' + name + (detail ? ' :: ' + detail : '');
  R.push(line);
  console.log(line);
}

async function call(method, path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (TK) headers['Authorization'] = 'Bearer ' + TK;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body, headers: res.headers };
}

(async () => {
  console.log('===== DG-STOK AUDIT — READ-ONLY API TEST =====');

  // A. Health / public
  let r = await call('GET', '/health');
  log(r.status === 200 ? 'PASS' : 'FAIL', 'GET /health', r.status + ' ' + JSON.stringify(r.body));

  r = await call('GET', '/api-status');
  log(r.status === 200 ? 'PASS' : 'FAIL', 'GET /api-status', r.status + ' ' + JSON.stringify(r.body));

  r = await call('GET', '/system/health');
  log(r.status === 200 ? 'PASS' : 'FAIL', 'GET /system/health', r.status + ' ' + JSON.stringify(r.body));

  r = await call('GET', '/');
  log(r.status === 200 ? 'PASS' : 'FAIL', 'GET / (frontend)', r.status + ' len=' + String(r.body).length);

  r = await call('GET', '/marketplaces');
  log(r.status === 200 ? 'PASS' : 'FAIL', 'GET /marketplaces (public)', r.status + ' items=' + (r.body && r.body.items ? r.body.items.length : 'n/a'));

  r = await call('GET', '/unknown-route-audit');
  log(r.status === 404 ? 'PASS' : 'FAIL', 'GET /unknown-route (404 expected)', r.status);

  // B. Auth
  r = await call('GET', '/auth/me');
  log(r.status === 401 ? 'PASS' : 'FAIL', 'GET /auth/me (no token -> 401)', r.status);

  r = await call('POST', '/auth/login', { body: { email: 'admin@dgstok.com', password: 'admin123' } });
  if (r.status === 200 && r.body && r.body.ok && r.body.token) {
    TK = r.body.token; admin = r.body.user;
    log('PASS', 'POST /auth/login (admin)', r.status + ' role=' + admin.role);
  } else {
    log('FAIL', 'POST /auth/login (admin)', r.status + ' ' + JSON.stringify(r.body));
  }

  r = await call('POST', '/auth/login', { body: { email: 'admin@dgstok.com', password: 'wrong-pass' } });
  log(r.status === 401 ? 'PASS' : 'FAIL', 'POST /auth/login (wrong pass -> 401)', r.status);

  r = await call('POST', '/auth/login', { body: { email: '', password: '' } });
  log(r.status === 400 ? 'PASS' : 'FAIL', 'POST /auth/login (empty -> 400)', r.status);

  r = await call('GET', '/auth/me');
  log(r.status === 200 && r.body && r.body.email === 'admin@dgstok.com' ? 'PASS' : 'FAIL', 'GET /auth/me (with token)', r.status + ' ' + JSON.stringify(r.body));

  // CORS preflight
  r = await call('OPTIONS', '/auth/login', { headers: { 'Origin': 'http://localhost:5175', 'Access-Control-Request-Method': 'POST' } });
  log((r.status === 204 || r.status === 200) ? 'PASS' : 'FAIL', 'OPTIONS /auth/login (CORS preflight)', r.status + ' acao=' + (r.headers.get('access-control-allow-origin') || 'none'));

  // C. Protected routes without context (expected behavior probes)
  r = await call('GET', '/products/stats');
  log(r.status === 400 ? 'PASS' : 'FAIL', 'GET /products/stats (no context -> 400)', r.status + ' ' + JSON.stringify(r.body && r.body.error ? r.body.error.code : r.body));

  // Fetch context ids (read-only)
  let ctx = { xml: null, mp: null };
  r = await call('GET', '/xml-sources');
  if (r.status === 200 && r.body && r.body.items && r.body.items.length) {
    ctx.xml = r.body.items[0].id;
    log('PASS', 'GET /xml-sources', r.status + ' items=' + r.body.items.length);
  } else {
    log('WARN', 'GET /xml-sources', r.status + ' ' + JSON.stringify(r.body));
  }

  r = await call('GET', '/marketplace-manage');
  if (r.status === 200 && r.body && r.body.items && r.body.items.length) {
    ctx.mp = r.body.items[0].id;
    log('PASS', 'GET /marketplace-manage', r.status + ' items=' + r.body.items.length);
  } else {
    log('WARN', 'GET /marketplace-manage', r.status + ' ' + JSON.stringify(r.body));
  }

  // D. Read-only module endpoints
  const gets = [
    ['/dashboard/stats', 'GET /dashboard/stats'],
    ['/xml-sources', 'GET /xml-sources (auth)'],
    ['/products/stats?xmlSourceId=' + (ctx.xml || 'x') + '&marketplaceId=' + (ctx.mp || 'y'), 'GET /products/stats (context)'],
    ['/products?page=1&limit=5&xmlSourceId=' + (ctx.xml || 'x') + '&marketplaceId=' + (ctx.mp || 'y'), 'GET /products (context)'],
    ['/products/status-counts?xmlSourceId=' + (ctx.xml || 'x') + '&marketplaceId=' + (ctx.mp || 'y'), 'GET /products/status-counts (context)'],
    ['/categories', 'GET /categories'],
    ['/categories/stats', 'GET /categories/stats'],
    ['/categories/tree', 'GET /categories/tree'],
    ['/categories/xml-categories', 'GET /categories/xml-categories'],
    ['/categories/all', 'GET /categories/all'],
    ['/categories/mappings', 'GET /categories/mappings'],
    ['/categories/logs', 'GET /categories/logs'],
    ['/brands', 'GET /brands'],
    ['/brands/stats', 'GET /brands/stats'],
    ['/brands/xml-brands', 'GET /brands/xml-brands'],
    ['/brands/mappings', 'GET /brands/mappings'],
    ['/brands/logs', 'GET /brands/logs'],
    ['/brands/default-brand', 'GET /brands/default-brand'],
    ['/variants', 'GET /variants'],
    ['/variants/stats', 'GET /variants/stats'],
    ['/variants/xml-variants', 'GET /variants/xml-variants'],
    ['/variants/unmatched-products', 'GET /variants/unmatched-products'],
    ['/variants/types', 'GET /variants/types'],
    ['/variants/universal-attributes', 'GET /variants/universal-attributes'],
    ['/variants/thresholds', 'GET /variants/thresholds'],
    ['/variants/screen', 'GET /variants/screen'],
    ['/variants/problems', 'GET /variants/problems'],
    ['/variants/logs', 'GET /variants/logs'],
    ['/listings', 'GET /listings'],
    ['/listings/stats/summary', 'GET /listings/stats/summary'],
    ['/listings/forbidden-words/list', 'GET /listings/forbidden-words/list'],
    ['/listings/marketplace-configs', 'GET /listings/marketplace-configs'],
    ['/listing-v2/rules', 'GET /listing-v2/rules'],
    ['/listing-v2/logs', 'GET /listing-v2/logs'],
    ['/ready-to-ship/stats', 'GET /ready-to-ship/stats'],
    ['/ready-to-ship', 'GET /ready-to-ship'],
    ['/orders', 'GET /orders'],
    ['/orders/stats', 'GET /orders/stats'],
    ['/reports/dashboard', 'GET /reports/dashboard'],
    ['/reports/products', 'GET /reports/products'],
    ['/reports/orders', 'GET /reports/orders'],
    ['/settings', 'GET /settings'],
    ['/marketplace-manage/stats', 'GET /marketplace-manage/stats'],
    ['/ai-settings', 'GET /ai-settings'],
  ];

  for (const [path, name] of gets) {
    r = await call('GET', path);
    if (r.status === 200) log('PASS', name, r.status);
    else log('FAIL', name, r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }

  console.log('\n===== SUMMARY =====');
  const pass = R.filter(l => l.startsWith('[PASS]')).length;
  const fail = R.filter(l => l.startsWith('[FAIL]')).length;
  const warn = R.filter(l => l.startsWith('[WARN]')).length;
  console.log('PASS=' + pass + ' FAIL=' + fail + ' WARN=' + warn);
  process.exit(fail > 0 ? 2 : 0);
})().catch((e) => { console.error('AUDIT SCRIPT CRASH', e); process.exit(3); });
