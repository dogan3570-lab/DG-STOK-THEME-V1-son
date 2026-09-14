import { PrismaClient } from '@prisma/client';
import { decryptCredential } from './src/services/crypto.ts';

const prisma = new PrismaClient();
const BASE = 'https://apigw.trendyol.com/integration';

async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  if (!mp) { console.log('Marketplace not found'); return; }
  
  console.log('apiKey raw:', mp.apiKey);
  console.log('apiSecret raw:', mp.apiSecret);
  console.log('settings:', mp.settings);
  
  const apiKey = mp.apiKey ? decryptCredential(mp.apiKey) : null;
  const apiSecret = mp.apiSecret ? decryptCredential(mp.apiSecret) : null;
  let sellerId: string | null = null;
  try {
    const s = JSON.parse(mp.settings || '{}');
    if (typeof s.sellerId === 'string' && s.sellerId.trim()) sellerId = s.sellerId.trim();
  } catch { /* bozuk settings */ }
  
  console.log('apiKey decrypted:', apiKey ? 'OK (' + apiKey.length + ' chars)' : 'NULL');
  console.log('apiSecret decrypted:', apiSecret ? 'OK (' + apiSecret.length + ' chars)' : 'NULL');
  console.log('sellerId:', sellerId);
  
  if (!apiKey || !apiSecret || !sellerId) { 
    console.log('CREDENTIAL_MISSING');
    return; 
  }
  
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'),
    'User-Agent': `${sellerId} - SelfIntegration`,
    Accept: 'application/json',
  };
  
  console.log('Testing with sellerId:', sellerId);
  
  // Test category attributes
  const res = await fetch(`${BASE}/product/categories/1476/attributes`, { headers, redirect: 'error' });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text.slice(0, 1000));
}

main().catch(console.error).finally(() => prisma.$disconnect());