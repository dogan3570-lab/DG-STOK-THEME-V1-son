async function testModel() {
  const models = ['oc/nemotron-3-ultra-free', 'auto/best-free', 'auto/coding:free'];
  for (const model of models) {
    console.log(`Testing model: ${model}`);
    try {
      const body = {
        model,
        messages: [{ role: 'user', content: 'Say OK' }],
        temperature: 0.1,
        max_tokens: 50,
        stream: false,
      };
      const t0 = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('http://localhost:20128/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const elapsed = Date.now() - t0;
      const data = await res.json();
      console.log(`  HTTP ${res.status} (${elapsed}ms) model=${data?.model} content=${data?.choices?.[0]?.message?.content?.substring(0, 50)}`);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
  }
}
testModel();
