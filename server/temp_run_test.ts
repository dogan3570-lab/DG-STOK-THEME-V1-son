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
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  const loginBody = login.substring(login.indexOf('{'));
  const parsed = JSON.parse(loginBody);
  if (!parsed.token) { console.log('FAIL: NO TOKEN'); process.exit(1); }
  const tok = parsed.token;

  console.log('=== TEST 1: Category Run (single product) ===');
  const run = await apiRequest('POST', '/category-engine/run', tok, { productIds: ['439bd5e1-790d-421c-8cfa-21278b4a5098'] });
  console.log('RUN:', run.substring(0, 200));
}

main();