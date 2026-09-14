import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

async function main() {
  console.log('=== Testing DNS resolution for openrouter.ai ===');
  try {
    const dns = await import('dns/promises');
    const addresses = await dns.resolve4('openrouter.ai');
    console.log('DNS resolved:', addresses);
  } catch (e) {
    console.log('DNS resolution failed:', e.message);
  }

  console.log('\n=== Testing direct HTTPS connection to openrouter.ai ===');
  try {
    const https = await import('https');
    const agent = new https.Agent({ timeout: 10000 });
    const req = https.request('https://openrouter.ai', { method: 'HEAD', timeout: 10000 }, (res) => {
      console.log('HTTPS connection successful, status:', res.statusCode);
    });
    req.on('error', (e) => {
      console.log('HTTPS connection error:', e.code, e.message);
    });
    req.setTimeout(10000, () => {
      console.log('HTTPS request timeout');
    });
    req.end();
  } catch (e) {
    console.log('HTTPS test error:', e.message);
  }

  console.log('\n=== Testing fetch to OpenRouter API (no auth) ===');
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
    console.log('Fetch status:', res.status);
    const text = await res.text();
    console.log('Response length:', res.status, res.headers.get('content-length'));
  } catch (e) {
    console.log('Fetch error:', e.name, e.message, e.code, e.cause?.code);
  }

  // Test with API key
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (provider && provider.apiKeyEncrypted && provider.apiKeyIv && provider.apiKeyTag) {
    const crypto = await import('crypto');
    const currentKey = crypto.scryptSync(process.env.CREDENTIAL_ENCRYPTION_KEY, 'dg-stok-cred-v1', 32);
    const ivBuf = Buffer.from('abf0a387a6a231dc6dd8d372b41bbeb5', 'hex');
    const tagBuf = Buffer.from('288dd469fe5919fe3a706625bdb4bb50', 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(process.env.CREDENTIAL_ENCRYPTION_KEY, 'dg-stok-cred-v1', 32), Buffer.from('abf0a387a6a231dc6dd8d372b41bbeb5', 'hex'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from('288dd469fe5919fe3a706625bdb4bb50', 'hex'));
    let decrypted = decipher.update('85b00275312100d9e338743210de91a9ac703003a4607fcdbd4b3e68eb52bc37cce8daedc9133f1f50377ac322e139f15789', 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    const apiKey = decrypted;
    console.log('API key decrypted, testing authenticated fetch...');
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      console.log('Authenticated fetch status:', res.status);
      const text = await res.text();
      console.log('Response length:', res.status, res.headers.get('content-length'));
    } catch (e) {
      console.log('Authenticated fetch error:', e.name, e.message, e.code, e.cause?.code);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });