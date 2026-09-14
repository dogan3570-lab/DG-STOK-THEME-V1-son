import http from 'http';
function apiRequest(method: string, path: string, token: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({ hostname: 'localhost', port: 4000, path, method, headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(`HTTP:${res.statusCode}|BODY:${data.substring(0, 2000)}`));
    });
    req.on('error', (err) => resolve(`ERROR:${err.message}`));
    if (payload) req.write(payload);
    req.end();
  });
}
async function main() {
  // Login
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  const parsed = JSON.parse(login.substring(login.indexOf('{')));
  const tok = parsed.token;
  if (!tok) { console.log('FAIL: NO TOKEN'); process.exit(1); }

  // Test save endpoint with dummy key (will fail auth but proves flow works)
  console.log('=== TEST SAVE ENDPOINT (dummy key) ===');
  const saveResult = await apiRequest('POST', '/ai-settings/omniroute/add-test', tok, { apiKey: 'test-dummy-key-12345' });
  console.log('SAVE_RESULT:', saveResult.substring(0, 300));

  // Check DB after save
  console.log('=== VERIFY DB SAVE ===');
  const dbCheck = await apiRequest('GET', '/ai-settings/omniroute/status', tok, undefined);
  console.log('OMNIRoute_STATUS:', dbCheck.substring(0, 300));
}
main();