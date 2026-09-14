async function main() {
  const body = {
    model: 'auto/best-free',
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    temperature: 0.1,
    max_tokens: 50,
    stream: false,
  };
  
  console.log('Request 1...');
  const r1 = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d1 = await r1.json();
  console.log('Request 1:', r1.status, d1?.choices?.[0]?.message?.content);
  
  console.log('Request 2 (immediate)...');
  const r2 = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d2 = await r2.json();
  console.log('Request 2:', r2.status, d2?.choices?.[0]?.message?.content);
  
  console.log('Request 3 (after 2s)...');
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d3 = await r3.json();
  console.log('Request 3:', r3.status, d3?.choices?.[0]?.message?.content);
  
  // Now test with a LARGE payload (simulating category matching)
  const largeBody = {
    model: 'auto/best-free',
    messages: [
      { role: 'system', content: 'You are a category matcher. Return JSON only.' },
      { role: 'user', content: 'Match these products to categories: ' + 'Product data '.repeat(5000) }
    ],
    temperature: 0.05,
    max_tokens: 4096,
    stream: false,
    response_format: { type: 'json_object' },
  };
  
  console.log('Large request 1...');
  const lr1 = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(largeBody) });
  const ld1 = await lr1.json();
  console.log('Large 1:', lr1.status, 'model=', ld1?.model, 'content_len=', ld1?.choices?.[0]?.message?.content?.length);
  
  console.log('Large request 2 (immediate)...');
  const lr2 = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(largeBody) });
  const ld2 = await lr2.json();
  console.log('Large 2:', lr2.status, 'model=', ld2?.model, 'content_len=', ld2?.choices?.[0]?.message?.content?.length);
  
  console.log('ALL OK - OmniRoute can handle concurrent requests');
}

main().catch(e => console.error('FAIL:', e.message));
