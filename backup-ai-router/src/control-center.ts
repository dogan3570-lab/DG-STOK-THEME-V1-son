import http from 'node:http';
import { routeRequest, getAgentStates, selectBestAgent } from './router.ts';
import { getPool } from './router.ts';
import { getLogs } from './logger.ts';
import type { CompletionRequest } from './types.ts';

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  const json = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(json);
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', `http://localhost`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }

  if (path === '/api/route' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const request: CompletionRequest = {
        messages: body.messages || [{ role: 'user', content: 'Hello' }],
        model: body.model,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
      };
      const result = await routeRequest(request);
      sendJson(res, result.ok ? 200 : 502, result);
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  if (path === '/api/agents' && req.method === 'GET') {
    const states = getAgentStates();
    sendJson(res, 200, { agents: states });
    return true;
  }

  if (path === '/api/select' && req.method === 'GET') {
    const selection = selectBestAgent();
    sendJson(res, 200, { selection });
    return true;
  }

  if (path === '/api/logs' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const logs = getLogs(limit);
    sendJson(res, 200, { logs });
    return true;
  }

  if (path === '/api/health' && req.method === 'GET') {
    const pool = getPool();
    const agents = pool.getAllAgents();
    const healthChecks = await Promise.allSettled(
      agents.map(async (agent) => {
        const healthy = await agent.healthCheck();
        return { id: agent.config.id, provider: agent.config.provider, healthy };
      })
    );
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      agents: healthChecks.map(r => r.status === 'fulfilled' ? r.value : { id: 'unknown', provider: 'unknown', healthy: false }),
    });
    return true;
  }

  if (path === '/' || path === '/index.html') {
    const fs = await import('node:fs/promises');
    const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return true;
  }

  return false;
}
