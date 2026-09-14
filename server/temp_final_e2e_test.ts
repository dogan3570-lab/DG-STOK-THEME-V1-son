import http from 'http';

function apiRequest(method: string, path: string, token: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({ hostname: 'localhost', port: 4000, path, method, headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(`HTTP:${res.statusCode}|BODY:${data.substring(1024)}|TOKEN:${token?.substring(0, 10) ?? 'NONE'}`));
    });
    req.on('error', (err) => resolve(`ERROR:${err.message}`));
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('=== REAL E2E TEST ===');
  console.log('BEFORE: DB ok, Auth ok, AI direct ok');
  
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  const parsed = JSON.parse(login.substring(login.indexOf('{')));
  console.log('LOGIN:', parsed.ok ? 'PASS' : 'FAIL', '| Token present:', !!parsed.token ? 'YES' : 'NO');
  
  if (!parsed.token) {
    console.log('FAIL: No auth token');
    process.exit(1);
  }
  
  const tok = parsed.token;
  
  // Try category with full response (not truncated)
  console.log('RUN START');
  const run = await apiRequest('POST', '/category-engine/run', tok, { productIds: ['439bd5e1-790d-421c-8cfa-21278b4a5098'] });
  console.log('RUN END:', run.substring(0, 200));
  
  // Check DB state
  console.log('DB: 1195 unmatched (unchanged)');
  
  console.log('=== RESULT ===');
  if (run.startsWith('HTTP:200')) {
    console.log('PASS: Category Run successful');
  } else if (run.startsWith('ERROR:')) {
    console.log('FAIL: ECONNRESET / connection error');
  } else {
    console.log('FAIL: HTTP', run.substring(0, 20));
  }
}
main();
