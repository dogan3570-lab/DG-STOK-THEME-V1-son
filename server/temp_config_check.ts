import { PrismaClient } from '@prisma/client';
import http from 'http';

const prisma = new PrismaClient();

function apiRequest(method: string, path: string, token: string, body?: unknown): Promise<{status: number, body: string}> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({ hostname: 'localhost', port: 4000, path, method, headers: { 'Content-Type': 'application/json', Cookie: `token=${token}`, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', (err) => resolve({ status: 0, body: `ERROR:${err.message}` }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. DB check: what AI provider config exists
  const providers = await prisma.aIProviderConfig.findMany({
    select: { provider: true, active: true, lastStatus: true, apiKeyEncrypted: true }
  });
  console.log('AI Provider Config (no secrets):');
  for (const p of providers) {
    console.log(`  ${p.provider}: active=${p.active}, lastStatus=${p.lastStatus}, keyPresent=${p.apiKeyEncrypted ? 'YES' : 'NO'}`);
  }

  // 2. Login and test gateway endpoint
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  console.log('\nLogin status:', login.status);
  const tok = login.body.match(/token":"([^"]+)/)?.[1];
  if (!tok) { console.log('FAIL: no token'); process.exit(1); }

  // Check /auth/me for mustChangePassword state
  const me = await apiRequest('GET', '/auth/me', tok);
  console.log('auth/me:', me.body.substring(0, 200));

  // Test AI settings status page
  const status = await apiRequest('GET', '/ai-settings', tok);
  console.log('AI Settings:', status.status, status.body.substring(0, 300));
}
main().catch(e => { console.error(e); process.exit(1); });
