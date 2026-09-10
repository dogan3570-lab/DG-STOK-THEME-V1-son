const http = require('http');
function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 4000, method, path, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const start = Date.now();
    const r = http.request(opts, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b), ms: Date.now() - start }); } catch(e) { resolve({ status: res.statusCode, data: b, ms: Date.now() - start }); } }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
(async () => {
  const login = await apiCall('POST', '/auth/login', { email: 'admin@dgstok.com', password: 'admin123' });
  const t = login.data.token;
  console.log('Token obtained');

  // First unmatch to reset state
  const unmatch = await apiCall('POST', '/brands/unmatch', { xmlBrandName: 'D&G' }, t);
  console.log('Unmatch:', unmatch.data, '(' + unmatch.ms + 'ms)');

  // Now test match endpoint timing
  const brand = await apiCall('GET', '/brands?search=' + encodeURIComponent('TEST MARKA'), null, t);
  let dgBrandId;
  if (brand.data.items && brand.data.items.length > 0) {
    dgBrandId = brand.data.items.find(b => b.name === 'TEST MARKA')?.id;
  }
  if (!dgBrandId) {
    const cr = await apiCall('POST', '/brands', { name: 'TEST MARKA' }, t);
    dgBrandId = cr.data.item.id;
    console.log('Created brand:', dgBrandId);
  } else {
    console.log('Found existing brand:', dgBrandId);
  }

  console.log('Starting match...');
  const match = await apiCall('POST', '/brands/match', { xmlBrandName: 'D&G', dgBrandId }, t);
  console.log('Match result:', JSON.stringify(match.data), '(' + match.ms + 'ms)');
  console.log('Match took: ' + (match.ms / 1000).toFixed(1) + 's');

  // Cleanup
  await apiCall('DELETE', '/brands/' + dgBrandId, null, t);
  console.log('Cleanup done');
})();
