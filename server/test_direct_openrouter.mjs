import { PrismaClient } from '@prisma/client';
import { decryptApiKey } from './src/services/crypto.ts';

const prisma = new PrismaClient();

async function test() {
  console.log('=== Testing OpenRouter API Key ===');
  const provider = await prisma.aIProviderConfig.findUnique({ where: { provider: 'openrouter' } });
  if (!provider || !provider.apiKeyEncrypted || !provider.apiKeyIv || !provider.apiKeyTag) {
    console.log('NO API KEY CONFIGURED');
    await prisma.$disconnect();
    return;
  }
  console.log('API Key encrypted: yes');
  
  let apiKey = '';
  try {
    apiKey = decryptApiKey(provider.apiKeyEncrypted, provider.apiKeyIv, provider.apiKeyTag);
    console.log('API Key decrypted (first 20 chars):', apiKey.substring(0, 20) + '...');
    console.log('API Key length:', apiKey.length);
  } catch (e) {
    console.log('Decrypt error:', e.message);
    await prisma.$disconnect();
    return;
  }
  
  console.log('\n=== Testing direct OpenRouter API call ===');
  try {
    console.log('\n=== Testing direct OpenRouter API call ===');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        messages: [{ role: 'user', content: 'Respond with exactly: TEST_OK' }],
        temperature: 0.1,
        max_tokens: 20,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    
    console.log('Response status:', res.status);
    const raw = await res.text();
    console.log('Raw response:', raw);
    
    if (!res.ok) {
      console.log('Response not OK:', res.status);
    } else {
      const data = JSON.parse(raw);
      console.log('Parsed response:', JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.log('Direct fetch error:', e.message);
    console.log(e.stack);
  }
  
  process.exit(0);
}

test().catch(e => {
  console.error('Test error:', e);
  console.error(e.stack);
  process.exit(1);
});