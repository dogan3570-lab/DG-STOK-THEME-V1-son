import http from 'node:http';
import fs from 'node:fs';
import { handleRequest } from './control-center.ts';
import { getPool } from './router.ts';
import type { AgentConfig } from './types.ts';

const PORT = parseInt(process.env.PORT || '4100', 10);

function loadEnv(): void {
  try {
    const envPath = new URL('../.env', import.meta.url);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = value;
        }
      }
    }
  } catch {}
}

function registerAgents(): void {
  const pool = getPool();

  const omnirouteConfig: AgentConfig = {
    id: 'omniroute-1',
    provider: 'omniroute',
    baseUrl: process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128',
    apiKey: process.env.OMNIROUTE_API_KEY || 'omni',
    models: ['auto/best-free', 'auto/primary'],
    freeModels: ['auto/best-free', 'auto/primary'],
    maxTokens: 4096,
    timeoutMs: 60000,
  };
  pool.registerAgent(omnirouteConfig);

  if (process.env.NVIDIA_API_KEY) {
    const nvidiaConfig: AgentConfig = {
      id: 'nvidia-1',
      provider: 'nvidia',
      baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY,
      models: ['meta/llama-3.1-8b-instruct', 'mistralai/mistral-7b-instruct-v0.3'],
      freeModels: ['meta/llama-3.1-8b-instruct', 'mistralai/mistral-7b-instruct-v0.3'],
      maxTokens: 4096,
      timeoutMs: 30000,
    };
    pool.registerAgent(nvidiaConfig);
  }

  if (process.env.OPENROUTER_API_KEY) {
    const openrouterConfig: AgentConfig = {
      id: 'openrouter-1',
      provider: 'openrouter',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      models: ['meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
      freeModels: ['meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
      maxTokens: 4096,
      timeoutMs: 30000,
    };
    pool.registerAgent(openrouterConfig);
  }

  const agents = pool.getAllAgents();
  console.log(`[bootstrap] Registered ${agents.length} agents:`);
  for (const a of agents) {
    console.log(`  - ${a.config.id} (${a.config.provider}) models=${a.config.freeModels.join(',')} key=${a.config.apiKey ? 'SET' : 'MISSING'}`);
  }
}

loadEnv();
registerAgents();

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleRequest(req, res);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err: any) {
    console.error('[server] Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`[server] AI Control Center Backup running on http://localhost:${PORT}`);
  console.log(`[server] Control Center UI: http://localhost:${PORT}/`);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});
