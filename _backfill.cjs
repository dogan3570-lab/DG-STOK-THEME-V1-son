const http = require('http');
function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 4000, method, path: encodeURI(path), headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch(e) { resolve(b); } }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
(async () => {
  const login = await api('POST', '/auth/login', { email: 'admin@dgstok.com', password: 'admin123' });
  const t = login.token;
  
  console.log('Running backfill...');
  const result = await api('POST', '/brands/backfill-xml-brand', {}, t);
  console.log('Backfill result:', JSON.stringify(result));
  
  // Verify xml brands now
  const xmlBrands = await api('GET', '/brands/xml-brands', null, t);
  console.log('XML Brands after backfill:');
  (xmlBrands.items || []).forEach(b => console.log('  ' + b.name + ' (source: ' + b.sourceName + ')'));
  
  // Check sample products
  const products = await api('GET', '/brands/products?page=1&limit=3&xmlBrandName=' + encodeURIComponent('D&G'), null, t);
  console.log('D&G products:', products.pagination?.total || 0);
  (products.items || []).forEach(p => console.log('  xmlBrandName=' + p.xmlBrandName + ' brand=' + (p.brand?.name || 'null') + ' title=' + (p.title||'').substring(0,40)));
})();
