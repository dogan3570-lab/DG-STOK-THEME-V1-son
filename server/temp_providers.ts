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
  const login = await apiRequest('POST', '/auth/login', '', { email: 'admin@dgstok.com', password: 'Stok2026!' });
  const tok = login.body.match(/token":"([^"]+)/)?.[1];
  if (!tok) { console.log('FAIL'); process.exit(1); }

  const status = await apiRequest('GET', '/ai-settings', tok);
  const data = JSON.parse(status.body);
  console.log('=== ALL AI PROVIDERS ===');
  for (const item of data.items) {
    console.log(JSON.stringify({
      provider: item.provider,
      displayName: item.displayName,
      baseUrl: item.baseUrl,
      model: item.model,
      active: item.active,
      lastStatus: item.lastStatus,
      totalReqs: item.totalRequests,
      successReqs: item.successfulRequests,
      failReqs: item.failedRequests
    }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
