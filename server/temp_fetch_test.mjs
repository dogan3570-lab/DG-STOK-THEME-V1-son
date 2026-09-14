async function testOmniRoute() {
  console.log('Testing OmniRoute-2 direct fetch...');
  try {
    const body = {
      model: 'auto/best-free',
      messages: [{ role: 'user', content: 'Merhaba' }],
      temperature: 0.1,
      max_tokens: 50,
      stream: false,
    };
    console.log('Sending to http://localhost:20128/v1/chat/completions...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch('http://localhost:20128/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Model:', data?.model);
    console.log('Content:', data?.choices?.[0]?.message?.content?.substring(0, 100));
    console.log('PASS');
  } catch (err) {
    console.error('FAIL:', err.message);
  }
}
testOmniRoute();
