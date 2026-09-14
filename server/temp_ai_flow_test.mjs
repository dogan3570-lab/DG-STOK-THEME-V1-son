async function testCategoryAiFlow() {
  console.log('=== ISOLATED AI FLOW TEST ===');
  
  // Step 1: Test what matchCategoriesWithAI actually does
  // It calls executeMasterRequest which now calls omniRouteManager.completeWithFreeModel
  
  // Step 2: Simulate exact same call
  const messages = [
    { role: 'system', content: 'You are a category matching assistant. Return JSON.' },
    { role: 'user', content: 'Match product "Dekoratif Tabak Seti" to Trendyol categories. Candidates: [Ev Yasam > Mutfak > Tabak, Ev Yasam > Sofra > Tabak]' }
  ];
  
  const body = {
    model: 'auto/best-free',
    messages,
    temperature: 0.05,
    max_tokens: 4096,
    stream: false,
    response_format: { type: 'json_object' },
  };
  
  console.log('Sending to OmniRoute-2 with json_object format...');
  const t0 = Date.now();
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    
    const res = await fetch('http://localhost:20128/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    const elapsed = Date.now() - t0;
    console.log(`Status: ${res.status} (${elapsed}ms)`);
    
    const text = await res.text();
    console.log(`Response length: ${text.length}`);
    
    if (res.ok) {
      const data = JSON.parse(text);
      console.log(`Model: ${data.model}`);
      console.log(`Content preview: ${data.choices?.[0]?.message?.content?.substring(0, 200)}`);
      console.log('PASS: Real AI completion works with json_object');
    } else {
      console.log(`FAIL: HTTP ${res.status}`);
      console.log(text.substring(0, 300));
    }
  } catch (err) {
    console.error('FAIL:', err.message);
  }
}

testCategoryAiFlow();
