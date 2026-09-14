import http from 'http';

const BASE = 'http://localhost:20128';
const TIMEOUT = 60000;

// Large payload simulating CATEGORY_MATCHING
const CATEGORY_BODY = JSON.stringify({
  model: 'auto/best-free',
  messages: [
    { role: 'system', content: 'You are an e-commerce category matcher. Return JSON only.' },
    { role: 'user', content: 'Match these products to Trendyol categories. Products: ' + 'ProductID|Title|SupplierCategory '.repeat(200) }
  ],
  temperature: 0.05,
  max_tokens: 4096,
  stream: false,
  response_format: { type: 'json_object' },
});

// Large payload simulating verifyHighConfidence
const VERIFY_BODY = JSON.stringify({
  model: 'auto/best-free',
  messages: [
    { role: 'system', content: 'You are a strict e-commerce category verifier. Return JSON only.' },
    { role: 'user', content: 'Verify these candidate categories: ' + 'ProductID|Title|CategoryName|FullPath '.repeat(200) }
  ],
  temperature: 0,
  max_tokens: 4096,
  stream: false,
  response_format: { type: 'json_object' },
});

function postJSON(body) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = http.request(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latencyMs = Date.now() - startTime;
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, latencyMs, model: parsed?.model, contentLen: parsed?.choices?.[0]?.message?.content?.length || 0, content: (parsed?.choices?.[0]?.message?.content || '').slice(0, 100) });
        } catch {
          resolve({ ok: false, status: res.statusCode, latencyMs, error: `PARSE_ERROR: ${data.slice(0, 100)}` });
        }
      });
    });
    req.on('error', (err) => reject({ ok: false, latencyMs: Date.now() - startTime, error: err.message }));
    req.on('timeout', () => { req.destroy(); reject({ ok: false, latencyMs: Date.now() - startTime, error: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

async function healthCheck() {
  try {
    const data = await new Promise((resolve, reject) => {
      http.get(BASE + '/api/health', { timeout: 5000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ status: 'parse_error' }); } });
      }).on('error', reject);
    });
    return data.status === 'ok';
  } catch { return false; }
}

async function run() {
  console.log('=== CONTROLLED CONCURRENT TEST ===');
  console.log(`OmniRoute: ${BASE}`);
  
  // Health before
  const h1 = await healthCheck();
  console.log(`\nHealth BEFORE: ${h1 ? 'OK' : 'FAIL'}`);
  
  // Test A: Single CATEGORY_MATCHING-like request
  console.log('\n--- Test A: Single large request (CATEGORY_MATCHING) ---');
  try {
    const a = await postJSON(CATEGORY_BODY);
    console.log(`  Result: ${a.ok ? 'PASS' : 'FAIL'} status=${a.status} latency=${a.latencyMs}ms model=${a.model} contentLen=${a.contentLen}`);
    if (a.error) console.log(`  Error: ${a.error}`);
  } catch (e) {
    console.log(`  Result: FAIL error=${e.error} latency=${e.latencyMs}ms`);
  }
  
  // Health after A
  const ha = await healthCheck();
  console.log(`  Health after A: ${ha ? 'OK' : 'FAIL'}`);
  
  // Test B: Single verifyHighConfidence-like request
  console.log('\n--- Test B: Single large request (verifyHighConfidence) ---');
  try {
    const b = await postJSON(VERIFY_BODY);
    console.log(`  Result: ${b.ok ? 'PASS' : 'FAIL'} status=${b.status} latency=${b.latencyMs}ms model=${b.model} contentLen=${b.contentLen}`);
    if (b.error) console.log(`  Error: ${b.error}`);
  } catch (e) {
    console.log(`  Result: FAIL error=${e.error} latency=${e.latencyMs}ms`);
  }
  
  const hb = await healthCheck();
  console.log(`  Health after B: ${hb ? 'OK' : 'FAIL'}`);
  
  // Test C: Two large requests SEQUENTIAL (with 3s wait between)
  console.log('\n--- Test C: Two large requests SEQUENTIAL (3s gap) ---');
  try {
    const c1 = await postJSON(CATEGORY_BODY);
    console.log(`  C1: ${c1.ok ? 'PASS' : 'FAIL'} status=${c1.status} latency=${c1.latencyMs}ms model=${c1.model}`);
    
    console.log('  Waiting 3s...');
    await new Promise(r => setTimeout(r, 3000));
    
    const c2 = await postJSON(VERIFY_BODY);
    console.log(`  C2: ${c2.ok ? 'PASS' : 'FAIL'} status=${c2.status} latency=${c2.latencyMs}ms model=${c2.model}`);
  } catch (e) {
    console.log(`  FAIL: ${e.error} latency=${e.latencyMs}ms`);
  }
  
  const hc = await healthCheck();
  console.log(`  Health after C: ${hc ? 'OK' : 'FAIL'}`);
  
  // Test D: Two large requests CONCURRENT
  console.log('\n--- Test D: Two large requests CONCURRENT ---');
  let d1Result, d2Result;
  try {
    const [d1, d2] = await Promise.allSettled([postJSON(CATEGORY_BODY), postJSON(VERIFY_BODY)]);
    d1Result = d1.status === 'fulfilled' ? d1.value : { ok: false, error: d1.reason?.error || 'rejected' };
    d2Result = d2.status === 'fulfilled' ? d2.value : { ok: false, error: d2.reason?.error || 'rejected' };
    console.log(`  D1: ${d1Result.ok ? 'PASS' : 'FAIL'} status=${d1Result.status} latency=${d1Result.latencyMs}ms model=${d1Result.model}`);
    console.log(`  D2: ${d2Result.ok ? 'PASS' : 'FAIL'} status=${d2Result.status} latency=${d2Result.latencyMs}ms model=${d2Result.model}`);
    if (d1Result.error) console.log(`  D1 Error: ${d1Result.error}`);
    if (d2Result.error) console.log(`  D2 Error: ${d2Result.error}`);
  } catch (e) {
    console.log(`  CONCURRENT FAIL: ${e}`);
  }
  
  // Health after D — THIS IS THE CRITICAL CHECK
  const hd = await healthCheck();
  console.log(`  Health after D: ${hd ? 'OK' : 'FAIL (OmniRoute crashed!)'}`);
  
  // Test E: Can OmniRoute still serve after D?
  console.log('\n--- Test E: Post-concurrent recovery test ---');
  try {
    const e = await postJSON(JSON.stringify({
      model: 'auto/best-free',
      messages: [{ role: 'user', content: 'Reply: RECOVERY_OK' }],
      max_tokens: 10,
      stream: false,
    }));
    console.log(`  Result: ${e.ok ? 'PASS' : 'FAIL'} status=${e.status} latency=${e.latencyMs}ms model=${e.model}`);
  } catch (err) {
    console.log(`  Result: FAIL error=${err.error}`);
  }
  
  // Final health
  const hf = await healthCheck();
  console.log(`\nHealth FINAL: ${hf ? 'OK' : 'FAIL'}`);
  
  console.log('\n=== SUMMARY ===');
  console.log(`A (single CATEGORY): see above`);
  console.log(`B (single VERIFY): see above`);
  console.log(`C (sequential): see above`);
  console.log(`D (concurrent): see above`);
  console.log(`E (recovery): see above`);
  console.log(`Health chain: before=${h1} afterA=${ha} afterB=${hb} afterC=${hc} afterD=${hd} final=${hf}`);
}

run().catch(e => console.error('FATAL:', e));
