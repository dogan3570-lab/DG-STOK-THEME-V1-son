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
  
  // Verify xml brands work now
  const xb = await api('GET', '/brands/xml-brands?xmlSourceId=949855eb-d68c-4920-b378-c622a6a665e2', null, t);
  console.log('XML brands for AKILLIBAYI1:', JSON.stringify(xb));
  
  // Verify products can be loaded by xmlBrandName
  const prods = await api('GET', '/brands/products?page=1&limit=3&xmlBrandName=' + encodeURIComponent('D&G'), null, t);
  console.log('Products with xmlBrandName=D&G:', prods.pagination?.total);
  (prods.items || []).forEach(p => console.log('  xmlBrandName=' + p.xmlBrandName + ' brand=' + (p.brand?.name || 'null') + ' title=' + (p.title||'').substring(0,40)));
  
  // Preview test
  const hobBrand = await api('GET', '/brands', null, t);
  const hobItem = (hobBrand.items || []).find(b => b.name.includes('HOB'));
  if (hobItem) {
    const preview = await api('POST', '/brands/preview', { xmlBrandName: 'D&G', dgBrandId: hobItem.id }, t);
    console.log('Preview:', JSON.stringify(preview));
  }
})();
