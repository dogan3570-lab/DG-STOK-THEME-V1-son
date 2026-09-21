import { spawnSync } from 'child_process';
const models = [
  'deepseek/deepseek-flash',
  'deepseek/deepseek-v4-pro',
  'opencode/nemotron-3-ultra-free',
  'opencode/mimo-v2.5-free',
  'nvidia/gpt-oss-20b',
  'nvidia/gemma-4-31b-it',
  'openrouter/ling-3.0-flash-fin:free',
  'openrouter/nemotron-3-super-120b:free',
  'xkiro/minimax/minimax-m3:free',
  'xkiro/qwen/qwen3.8-max:free',
];
const out = [];
for (const m of models) {
  const t = Date.now();
  const r = spawnSync('opencode', ['run', '-m', m, 'Reply with exactly :=OK:='], {
    shell: true, timeout: 60000, encoding: 'utf8', windowsHide: true,
  });
  const ms = Date.now() - t;
  const txt = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '').trim();
  const ok = (r.status === 0) && txt.includes(':=OK:=');
  const firstErr = (txt.split('\n').find(l => /error|not found|unauthor|forbidden|invalid|model/i.test(l)) || '').slice(0, 140);
  out.push({ model: m, exit: r.status, ms, ok, snippet: txt.slice(0, 160).replace(/\s+/g, ' '), err: firstErr });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${m} | exit=${r.status} | ${ms}ms | ${firstErr || out[out.length - 1].snippet}`);
}
console.log('\nSUMMARY_JSON=' + JSON.stringify(out));
