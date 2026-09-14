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
  console.log('HARNESS_START', new Date().toISOString());
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  console.log('LOGIN:', login.substring(0, 60));
  const parsed = JSON.parse(login.substring(login.indexOf('{')));
  if (!parsed.token) { console.log('FAIL: NO TOKEN'); process.exit(1); }
  const tok = parsed.token;
  console.log('TOKEN OK');

  const me = await apiRequest('GET', '/auth/me', tok, undefined);
  console.log('ME:', me.substring(0, 60));

  const prev = await apiRequest('POST', '/category-engine/preview', tok, { limit: 3, withAi: false });
  console.log('PREVIEW:', prev.substring(0, 60));

  const run = await apiRequest('POST', '/category-engine/run', tok, { productIds: ['439bd5e1-790d-421c-8cfa-21278b4a5098'] });
  console.log('RUN:', run.substring(0, 120));
  console.log('HARNESS_END', new Date().toISOString());
}
main();