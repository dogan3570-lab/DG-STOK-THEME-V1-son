const http = require('http');
function api(m, path, body, t) {
  return new Promise((r, j) => {
    const o = { hostname: 'localhost', port: 4000, method: m, path, headers: { 'Content-Type': 'application/json' } };
    if (t) o.headers['Authorization'] = 'Bearer ' + t;
    const req = http.request(o, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { r(JSON.parse(b)); } catch(e) { r(b); } }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
(async () => {
  const login = await api('POST', '/auth/login', { email: 'admin@dgstok.com', password: 'admin123' });
  const t = login.token;
  
  console.log('=== TEST 1: XML Brands for AKILLIBAYI1 ===');
  const akilliSrc = await api('GET', '/xml-sources', null, t);
  const src = (akilliSrc.items || []).find(s => s.name === 'AKILLIBAYI1');
  console.log('AKILLIBAYI1 id:', src?.id);
  
  const xmlBrands = await api('GET', '/brands/xml-brands?xmlSourceId=' + src?.id, null, t);
  console.log('XML Brands:', JSON.stringify(xmlBrands, null, 2));
  
  // Verify: should show "akilli bayi", NOT "D&G" or "HOBİBAHÇEM"
  const hasAkilli = xmlBrands.items.some(b => b.name === 'akilli bayi');
  const hasDG = xmlBrands.items.some(b => b.name === 'D&G');
  const hasHobibahcem = xmlBrands.items.some(b => b.name === 'HOBİBAHÇEM');
  console.log('\n=== VERIFICATION ===');
  console.log('PASS: xmlBrandName = "akilli bayi": ' + hasAkilli);
  console.log('PASS: No D&G in XML brands: ' + !hasDG);
  console.log('PASS: No HOBİBAHÇEM in XML brands: ' + !hasHobibahcem);
  
  console.log('\n=== TEST 2: Products for akilli bayi ===');
  const products = await api('GET', '/brands/products?xmlBrandName=' + encodeURIComponent('akilli bayi') + '&page=1&limit=5', null, t);
  console.log('Total products:', products.pagination?.total);
  if (products.items?.length > 0) {
    const p = products.items[0];
    console.log('Sample product:');
    console.log('  xmlBrandName:', p.xmlBrandName);
    console.log('  title:', p.title);
    console.log('  brandMatch:', p.brandMatch);
  }
  
  console.log('\n=== TEST 3: Preview (Marka Eslesme) ===');
  // Find HOBİBAHÇEM brand
  const brands = await api('GET', '/brands?search=' + encodeURIComponent('HOBİBAHÇEM'), null, t);
  const hobiBrand = (brands.items || []).find(b => b.name === 'HOBİBAHÇEM');
  console.log('HOBİBAHÇEM brand:', hobiBrand?.id);
  
  const preview = await api('POST', '/brands/preview', { xmlBrandName: 'akilli bayi', dgBrandId: hobiBrand?.id }, t);
  console.log('Preview:', JSON.stringify(preview, null, 2));
  
  console.log('\n=== ALL TESTS PASSED? ===');
  const allPass = hasAkilli && !hasDG && !hasHobibahcem && (products.pagination?.total > 0) && preview.count > 0;
  console.log('RESULT: ' + (allPass ? 'PASS' : 'FAIL'));
  
  process.exit(allPass ? 0 : 1);
})();
