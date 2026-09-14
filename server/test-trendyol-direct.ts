import { PrismaClient } from '@prisma/client';
import { decryptCredential } from './src/services/crypto.ts';

const prisma = new PrismaClient();
const BASE = 'https://apigw.trendyol.com/integration';

async function main() {
  const mp = await prisma.marketplace.findUnique({ where: { key: 'tt' } });
  if (!mp) { console.log('Marketplace not found'); return; }
  
  const apiKey = mp.apiKey ? decryptCredential(mp.apiKey) : null;
  const apiSecret = mp.apiSecret ? decryptCredential(mp.apiSecret) : null;
  let sellerId: string | null = null;
  try {
    const s = JSON.parse(mp.settings || '{}');
    if (typeof s.sellerId === 'string' && s.sellerId.trim()) sellerId = s.sellerId.trim();
  } catch { /* bozuk settings */ }
  
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
  console.log('apiKey (first 10):', apiKey?.substring(0, 10));
  console.log('apiSecret (first 10):', apiSecret?.substring(0, 10));
  
  // Test category attributes
  const res = await fetch(`${BASE}/product/categories/1476/attributes`, { headers, redirect: 'error' });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text.slice(0, 500));
  
  // Test another category that might have variants
  const res2 = await fetch(`${BASE}/product/categories/2853/attributes`, { headers, redirect: 'error' });
  const text2 = await res2.text();
  console.log('Status (2853):', res2.status);
  console.log('Response (2853):', text2.slice(0, 500));
  
  // Test category tree
  const res3 = await fetch(`${BASE}/product/product-categories`, { headers, redirect: 'error' });
  const text3 = await res3.text();
  console.log('Status (tree):', res3.status);
  console.log('Response (tree):', text3.slice(0, 500));
}

main().catch(console.error).finally(() => prisma.$disconnect());